import { CFG, NOW, rpcRequest, logJsonl, sleep } from './common.mjs';

const JITO_BLOCK_ENGINE_URL = 'https://mainnet.block-engine.jito.wtf';
const BUNDLE_STATUS_TIMEOUT_MS = 2000;
const TIP_FLOOR_LAMPORTS = 1000;
const TIP_CEILING_LAMPORTS = 50000;
const JITO_TIP_BASE = 2000;
const JITO_TIP_ALPHA = 0.5;

export function isJitoEnabled() {
  return CFG.jitoEnabled === true;
}

export async function calculateJitoTip({ expectedSlippageBps, notionalUsdc }) {
  const slippageComponent = expectedSlippageBps * (notionalUsdc / 10000);
  const tip = JITO_TIP_BASE + JITO_TIP_ALPHA * slippageComponent;
  return Math.min(Math.max(Math.round(tip), TIP_FLOOR_LAMPORTS), TIP_CEILING_LAMPORTS);
}

export async function submitJitoBundle({ transactions, tipLamports }) {
  const bundleId = `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(`${JITO_BLOCK_ENGINE_URL}/api/v1/bundles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [
          transactions,
          { tipLamports }
        ]
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Jito bundle submit HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    
    const body = await response.json();
    if (body.error) {
      throw new Error(`Jito RPC error: ${JSON.stringify(body.error)}`);
    }
    
    return { success: true, bundleId: body.result, tipLamports };
  } catch (error) {
    return { success: false, error: String(error), bundleId };
  }
}

export async function pollBundleStatus(bundleId) {
  const start = Date.now();
  
  while (Date.now() - start < BUNDLE_STATUS_TIMEOUT_MS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch(`${JITO_BLOCK_ENGINE_URL}/api/v1/bundles/${bundleId}`, {
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        await sleep(500);
        continue;
      }
      
      const body = await response.json();
      const status = body.result?.status || body.status;
      
      if (status === 'landed' || status === 'finalized') {
        return { success: true, status, landed: true };
      }
      if (status === 'failed' || status === 'rejected') {
        return { success: false, status, error: `Bundle ${status}` };
      }
      
      await sleep(500);
    } catch {
      await sleep(500);
    }
  }
  
  return { success: false, status: 'timeout', error: 'Bundle status polling timeout' };
}

export async function executeViaJito({ side, amount, walletKeypair, expectedSlippageBps, notionalUsdc }) {
  if (!isJitoEnabled()) {
    return { success: false, error: 'Jito not enabled', fallback: true };
  }
  
  const tipLamports = await calculateJitoTip({ expectedSlippageBps, notionalUsdc });
  
  const { executeJupiterSwap } = await import('./jupiter-swap.mjs');
  const swapResult = await executeJupiterSwap({ side, amount, walletKeypair });
  
  if (!swapResult.success) {
    return { success: false, error: swapResult.error, step: swapResult.step, fallback: true };
  }
  
  const signedTransaction = swapResult.signedTransaction;
  if (!signedTransaction) {
    return { success: false, error: 'No signed transaction from Jupiter', fallback: true };
  }
  
  const bundleResult = await submitJitoBundle({ transactions: [signedTransaction], tipLamports });
  
  if (!bundleResult.success) {
    await logJsonl('jito-bundles.jsonl', { t: NOW(), type: 'bundle_submit_failed', error: bundleResult.error, tipLamports });
    return { success: false, error: bundleResult.error, fallback: true };
  }
  
  const statusResult = await pollBundleStatus(bundleResult.bundleId);
  
  if (statusResult.success && statusResult.landed) {
    await logJsonl('jito-bundles.jsonl', { t: NOW(), type: 'bundle_landed', bundleId: bundleResult.bundleId, tipLamports });
    return { success: true, txSignature: statusResult.signature, bundleId: bundleResult.bundleId, tipLamports };
  }
  
  await logJsonl('jito-bundles.jsonl', { t: NOW(), type: 'bundle_failed', bundleId: bundleResult.bundleId, statusResult, tipLamports });
  return { success: false, error: statusResult.error, bundleId: bundleResult.bundleId, fallback: true };
}