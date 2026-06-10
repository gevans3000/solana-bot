import fs from 'node:fs';
import path from 'node:path';
import { CFG, loadPortfolio, loadWallet } from './common.mjs';
import { getOnChainBalances } from './on-chain-balance.mjs';
import { sendAlert } from './alerts.mjs';

// Reconciliation: tracked portfolio vs on-chain wallet balances.
// Cron-safe: logs to logs/reconcile.log, alerts + exits 2 on MISMATCH in real mode.
// In simulated mode the on-chain wallet is NOT expected to match — informational only.

const LOG_FILE = path.join(process.cwd(), 'logs', 'reconcile.log');

function logLine(status, detail) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${status} ${detail}\n`);
  } catch {}
}

async function main() {
  try {
    const wallet = loadWallet({ createIfMissing: false });
    const portfolio = loadPortfolio();
    const onChain = await getOnChainBalances(wallet.address);
    const isLive = CFG.executionMode === 'real' && !CFG.dryRun; // alert only when actually live

    if (onChain.error) {
      logLine('RPC_ERROR', onChain.error);
      console.error(`Reconcile: RPC error — ${onChain.error}`);
      if (isLive) {
        await sendAlert({ type: 'reconcile_rpc_error', message: `Reconciliation could not read on-chain balances: ${onChain.error}` }).catch(() => {});
        process.exit(2);
      }
      process.exit(0); // not live: informational
    }

    const solDiff = Math.abs(portfolio.sol - onChain.sol);
    const solStatus = solDiff < 0.001 ? 'OK' : solDiff < 0.01 ? 'DRIFT' : 'MISMATCH';
    const usdcDiff = Math.abs(portfolio.usdc - onChain.usdc);
    const usdcStatus = usdcDiff < 0.01 ? 'OK' : usdcDiff < 1 ? 'DRIFT' : 'MISMATCH';

    const rows = [];
    rows.push('Solana SOL/USDC Portfolio Reconciliation');
    rows.push('=========================================');
    rows.push(`Wallet: ${wallet.address}`);
    rows.push(`Portfolio Mode: ${portfolio.mode}${isLive ? '' : '  (not live — on-chain comparison informational only)'}`);
    rows.push('');
    rows.push('Asset    | Tracked  | On-Chain | Status');
    rows.push('---------|----------|----------|--------');
    rows.push(`SOL      | ${portfolio.sol.toFixed(6).padEnd(8)} | ${onChain.sol.toFixed(6).padEnd(8)} | ${solStatus}`);
    rows.push(`USDC     | ${portfolio.usdc.toFixed(2).padEnd(8)} | ${onChain.usdc.toFixed(2).padEnd(8)} | ${usdcStatus}`);
    rows.push('');
    rows.push('Summary');
    rows.push('-------');
    rows.push(`Realized PnL: $${portfolio.realizedPnlUsdc.toFixed(2)}`);
    rows.push(`Swept Profit: $${portfolio.sweptUsdc.toFixed(2)}`);
    if (portfolio.avgEntryPrice) rows.push(`Avg Entry Price: $${portfolio.avgEntryPrice.toFixed(2)}`);
    rows.push(`Last Updated: ${portfolio.lastUpdatedAt}`);
    console.log(rows.join('\n'));

    const worst = [solStatus, usdcStatus].includes('MISMATCH') ? 'MISMATCH'
      : [solStatus, usdcStatus].includes('DRIFT') ? 'DRIFT' : 'OK';
    logLine(worst, `sol ${portfolio.sol.toFixed(6)}/${onChain.sol.toFixed(6)} usdc ${portfolio.usdc.toFixed(2)}/${onChain.usdc.toFixed(2)} mode=${portfolio.mode}`);

    if (isLive && worst === 'MISMATCH') {
      await sendAlert({
        type: 'reconcile_mismatch',
        message: `RECONCILE MISMATCH — tracked vs on-chain: SOL ${portfolio.sol.toFixed(6)} vs ${onChain.sol.toFixed(6)}, USDC ${portfolio.usdc.toFixed(2)} vs ${onChain.usdc.toFixed(2)}`,
        data: { solDiff, usdcDiff },
      }).catch(() => {});
      process.exit(2);
    }
  } catch (error) {
    logLine('ERROR', String(error?.message || error));
    console.error(error?.stack || error);
    process.exit(1);
  }
}

main();
