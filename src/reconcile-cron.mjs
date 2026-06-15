#!/usr/bin/env node
/**
 * Reconciliation Cron Job
 * 
 * Scans trades.jsonl for UNCONFIRMED trades, verifies on-chain status,
 * and fixes portfolio state. Run every 5 minutes via cron.
 * 
 * Usage: node src/reconcile-cron.mjs
 * 
 * Cron: */5 * * * * cd /path/to/bot && node src/reconcile-cron.mjs >> logs/reconcile-cron.log 2>&1
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load the common module to get RPC failover and other utilities
// We need to set up the environment first
const ENV_PATH = path.join(ROOT, '.env');
const EXAMPLE_ENV_PATH = path.join(ROOT, '.env.example');

function loadEnvFile(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  const text = fs.readFileSync(targetPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(ENV_PATH);
loadEnvFile(EXAMPLE_ENV_PATH);

// Now import the common module (which has multi-RPC failover)
import { 
  ROOT, 
  LOG_DIR, 
  STATE_DIR, 
  NOW, 
  fileInState, 
  fileInLogs,
  loadJson, 
  saveJson,
  rpcRequest,
  getWalletBalance,
  getRpcEndpoints,
  checkRpcHealth
} from './common.mjs';

// Import portfolio functions
import { loadPortfolio, savePortfolio } from './common.mjs';

// Configuration
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes (matches cron)
const MAX_UNCONFIRMED_AGE_HOURS = 2; // After 2 hours, escalate alert

async function main() {
  console.log(`[${NOW()}] Starting reconciliation cron...`);
  
  try {
    // 1. Check RPC health first
    const endpoints = getRpcEndpoints();
    console.log(`[${NOW()}] RPC endpoints: ${endpoints.map(e => `${e.url} (${e.healthy ? 'healthy' : 'unhealthy'})`).join(', ')}`);
    
    // 2. Load trades log
    const tradesPath = fileInLogs('trades.jsonl');
    if (!fs.existsSync(tradesPath)) {
      console.log(`[${NOW()}] No trades.jsonl found, nothing to reconcile`);
      return;
    }
    
    const tradesContent = fs.readFileSync(tradesPath, 'utf8').trim();
    if (!tradesContent) {
      console.log(`[${NOW()}] trades.jsonl is empty`);
      return;
    }
    
    const lines = tradesContent.split('\n').filter(Boolean);
    const unconfirmedTrades = [];
    
    for (const line of lines) {
      try {
        const trade = JSON.parse(line);
        if (trade.status === 'UNCONFIRMED' || trade.confirmationStatus === 'UNCONFIRMED') {
          unconfirmedTrades.push(trade);
        }
      } catch (e) {
        console.warn(`[${NOW()}] Failed to parse trade line: ${e.message}`);
      }
    }
    
    if (unconfirmedTrades.length === 0) {
      console.log(`[${NOW()}] No UNCONFIRMED trades found`);
      return;
    }
    
    console.log(`[${NOW()}] Found ${unconfirmedTrades.length} UNCONFIRMED trade(s)`);
    
    // 3. Load current portfolio state
    const portfolio = loadPortfolio();
    const walletAddress = CFG.executionMode === 'real' 
      ? (await import('./solana-signer.mjs')).then(m => m.getWalletPublicKey())
      : portfolio.address || 'SimulatedWallet';
    
    // 4. Check each unconfirmed trade
    let fixed = 0;
    let stillPending = 0;
    let failed = 0;
    
    for (const trade of unconfirmedTrades) {
      const ageHours = (Date.now() - new Date(trade.timestamp || trade.t).getTime()) / (1000 * 60 * 60);
      
      if (!trade.signature) {
        console.warn(`[${NOW()}] Trade missing signature, cannot verify: ${JSON.stringify(trade)}`);
        failed++;
        continue;
      }
      
      try {
        // Check transaction status on-chain
        const status = await checkTransactionStatus(trade.signature);
        
        if (status === 'confirmed' || status === 'finalized') {
          // Trade succeeded on-chain but wasn't recorded in portfolio
          console.log(`[${NOW()}] FIXING: Trade ${trade.signature} confirmed on-chain but missing from portfolio`);
          await applyTradeToPortfolio(trade, portfolio);
          fixed++;
        } else if (status === 'failed' || status === 'expired') {
          // Trade failed on-chain, mark as failed
          console.log(`[${NOW()}] Trade ${trade.signature} failed on-chain: ${status}`);
          await markTradeFailed(trade);
          failed++;
        } else {
          // Still pending
          console.log(`[${NOW()}] Trade ${trade.signature} still pending (${status}), age: ${ageHours.toFixed(2)}h`);
          stillPending++;
          
          // Alert if very old
          if (ageHours > MAX_UNCONFIRMED_AGE_HOURS) {
            await sendAlert({
              type: 'stale_unconfirmed',
              message: `Trade ${trade.signature} unconfirmed for ${ageHours.toFixed(1)}h`,
              data: { signature: trade.signature, ageHours, trade }
            });
          }
        }
      } catch (e) {
        console.error(`[${NOW()}] Error checking trade ${trade.signature}: ${e.message}`);
        failed++;
      }
    }
    
    // 5. Save updated portfolio if any fixes
    if (fixed > 0) {
      savePortfolio(portfolio);
      console.log(`[${NOW()}] Fixed ${fixed} trade(s), portfolio saved`);
    }
    
    console.log(`[${NOW()}] Reconciliation complete: ${fixed} fixed, ${stillPending} still pending, ${failed} failed/skipped`);
    
  } catch (error) {
    console.error(`[${NOW()}] Reconciliation cron failed: ${error.message}`);
    console.error(error.stack);
    await sendAlert({
      type: 'reconcile_error',
      message: `Reconciliation cron failed: ${error.message}`,
      data: { error: error.stack }
    });
  }
}

/**
 * Checks transaction status on-chain via RPC
 */
async function checkTransactionStatus(signature) {
  try {
    const result = await rpcRequest('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
    const status = result?.value?.[0];
    
    if (!status) return 'not_found';
    if (status.err) return 'failed';
    if (status.confirmationStatus === 'finalized') return 'finalized';
    if (status.confirmationStatus === 'confirmed') return 'confirmed';
    return 'processing';
  } catch (e) {
    console.warn(`[${NOW()}] Failed to check signature status: ${e.message}`);
    return 'error';
  }
}

/**
 * Applies a confirmed trade to the portfolio
 */
async function applyTradeToPortfolio(trade, portfolio) {
  // This mirrors portfolio.mjs executeTrade logic
  const side = trade.side;
  const amount = Number(trade.amount);
  const price = Number(trade.price);
  
  if (side === 'BUY') {
    // BUY: spend USDC, receive SOL
    const usdcAmount = amount; // amount is USDC for BUY
    const solAmount = usdcAmount / price;
    
    portfolio.usdc -= usdcAmount;
    portfolio.sol += solAmount;
    
    // Update avg entry price
    if (portfolio.avgEntryPrice === 0) {
      portfolio.avgEntryPrice = price;
    } else {
      const totalCost = portfolio.avgEntryPrice * (portfolio.sol - solAmount) + usdcAmount;
      portfolio.avgEntryPrice = totalCost / portfolio.sol;
    }
  } else {
    // SELL: spend SOL, receive USDC
    const solAmount = amount; // amount is SOL for SELL
    const usdcAmount = solAmount * price;
    
    portfolio.sol -= solAmount;
    portfolio.usdc += usdcAmount;
    
    // Calculate realized PnL
    if (portfolio.avgEntryPrice > 0) {
      const pnlPerSol = price - portfolio.avgEntryPrice;
      const realizedPnl = pnlPerSol * solAmount;
      portfolio.realizedPnlUsdc += realizedPnl;
    }
    
    // If flat, reset avg entry
    if (portfolio.sol <= 0.000001) {
      portfolio.avgEntryPrice = 0;
    }
  }
  
  portfolio.lastUpdatedAt = NOW();
  
  // Also update the trade log to mark as confirmed
  await updateTradeLogStatus(trade.signature, 'confirmed');
}

/**
 * Marks a trade as failed in the log
 */
async function markTradeFailed(trade) {
  await updateTradeLogStatus(trade.signature, 'failed');
}

/**
 * Updates a trade's status in trades.jsonl
 */
async function updateTradeLogStatus(signature, newStatus) {
  const tradesPath = fileInLogs('trades.jsonl');
  const content = fs.readFileSync(tradesPath, 'utf8').trim();
  if (!content) return;
  
  const lines = content.split('\n');
  let updated = false;
  
  for (let i = 0; i < lines.length; i++) {
    try {
      const trade = JSON.parse(lines[i]);
      if (trade.signature === signature) {
        trade.status = newStatus;
        trade.confirmationStatus = newStatus;
        trade.reconciledAt = NOW();
        lines[i] = JSON.stringify(trade);
        updated = true;
      }
    } catch {
      // Skip invalid lines
    }
  }
  
  if (updated) {
    fs.writeFileSync(tradesPath, lines.join('\n') + '\n');
  }
}

/**
 * Sends alert via webhook
 */
async function sendAlert(alertData) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;
  
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `**${alertData.type.toUpperCase()}**\n${alertData.message}\n\`\`\`json\n${JSON.stringify(alertData.data, null, 2)}\n\`\`\``
      })
    });
  } catch (e) {
    console.warn(`[${NOW()}] Failed to send alert: ${e.message}`);
  }
}

// Run the reconciliation
main().catch(e => {
  console.error(`[${NOW()}] Fatal error: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});