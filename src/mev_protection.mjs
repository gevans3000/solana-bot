import { CFG, NOW, rpcRequest, logJsonl, sleep } from './common.mjs';

const MEV_CHECK_WINDOW_MS = 500;
const LARGE_SWAP_THRESHOLD_SOL = 5;
const MEV_DELAY_MS = 1000;
const SLIPPAGE_ALERT_MULTIPLIER = 2;

const adversarialPatterns = {
  timeOfDay: new Map(),
  sizeClusters: new Map(),
  venueClusters: new Map(),
};

export async function checkMempoolForLargeSwaps() {
  try {
    const result = await rpcRequest('getTransactionCount', []);
    return result || 0;
  } catch (error) {
    await logJsonl('mev-protection.jsonl', { t: NOW(), type: 'mempool_check_error', error: String(error) });
    return 0;
  }
}

export async function detectAdversarialActivity() {
  try {
    const signatures = await rpcRequest('getSignaturesForAddress', [CFG.solMint, { limit: 50 }]);
    const recentTxs = signatures?.result || [];
    
    const now = Date.now();
    let largeSwapCount = 0;
    
    for (const tx of recentTxs) {
      if (now - (tx.blockTime || 0) * 1000 > MEV_CHECK_WINDOW_MS) continue;
      
      try {
        const txDetail = await rpcRequest('getTransaction', [tx.signature, { maxSupportedTransactionVersion: 0 }]);
        if (!txDetail?.result) continue;
        
        const meta = txDetail.result.meta;
        if (!meta) continue;
        
        const preBalances = meta.preTokenBalances || [];
        const postBalances = meta.postTokenBalances || [];
        
        for (let i = 0; i < preBalances.length; i++) {
          const pre = preBalances[i];
          const post = postBalances[i];
          if (pre.mint === CFG.solMint && post.mint === CFG.solMint) {
            const solChange = Math.abs((post.uiTokenAmount?.uiAmount || 0) - (pre.uiTokenAmount?.uiAmount || 0));
            if (solChange > LARGE_SWAP_THRESHOLD_SOL) {
              largeSwapCount++;
            }
          }
        }
      } catch {
        continue;
      }
    }
    
    return { detected: largeSwapCount > 0, largeSwapCount };
  } catch (error) {
    await logJsonl('mev-protection.jsonl', { t: NOW(), type: 'detection_error', error: String(error) });
    return { detected: false, largeSwapCount: 0 };
  }
}

export async function preTradeMevCheck({ side, amount, expectedSlippageBps }) {
  if (side !== 'BUY' && side !== 'SELL') return { proceed: true };
  
  const notionalSol = side === 'BUY' ? amount / (await getSolPrice()) : amount;
  
  if (notionalSol < LARGE_SWAP_THRESHOLD_SOL) {
    return { proceed: true, reason: 'below_threshold' };
  }
  
  const detection = await detectAdversarialActivity();
  
  if (detection.detected) {
    await logJsonl('mev-protection.jsonl', { 
      t: NOW(), 
      type: 'mev_detected_pre', 
      side, 
      amount, 
      notionalSol,
      largeSwapCount: detection.largeSwapCount,
      action: 'delay_and_refetch'
    });
    
    await sleep(MEV_DELAY_MS);
    
    return { proceed: true, delayed: true, reason: 'mev_detected', largeSwapCount: detection.largeSwapCount };
  }
  
  return { proceed: true };
}

async function getSolPrice() {
  try {
    const { getSolUsdPrice } = await import('./price-source.mjs');
    return await getSolUsdPrice();
  } catch {
    return 150;
  }
}

export function recordExecution({ side, amount, quotePrice, executionPrice, expectedSlippageBps, venue = 'jupiter' }) {
  const realizedSlippageBps = quotePrice > 0 
    ? Math.abs((executionPrice - quotePrice) / quotePrice) * 10000 
    : 0;
  
  const alertThreshold = expectedSlippageBps * SLIPPAGE_ALERT_MULTIPLIER;
  const potentialSandwich = realizedSlippageBps > alertThreshold;
  
  const hour = new Date().getHours();
  const sizeBucket = Math.floor(amount / 0.5) * 0.5;
  
  adversarialPatterns.timeOfDay.set(hour, (adversarialPatterns.timeOfDay.get(hour) || 0) + 1);
  adversarialPatterns.sizeClusters.set(sizeBucket, (adversarialPatterns.sizeClusters.get(sizeBucket) || 0) + 1);
  adversarialPatterns.venueClusters.set(venue, (adversarialPatterns.venueClusters.get(venue) || 0) + 1);
  
  const record = {
    t: NOW(),
    type: 'execution_analysis',
    side,
    amount,
    quotePrice,
    executionPrice,
    expectedSlippageBps,
    realizedSlippageBps: Math.round(realizedSlippageBps),
    alertThreshold,
    potentialSandwich,
    venue,
    hour,
    sizeBucket,
  };
  
  logJsonl('mev-protection.jsonl', record);
  
  if (potentialSandwich) {
    logJsonl('mev-protection.jsonl', {
      t: NOW(),
      type: 'SANDWICH_ALERT',
      ...record,
      message: `Potential sandwich attack: realized slippage ${realizedSlippageBps.toFixed(1)}bps > ${alertThreshold}bps (2x expected)`
    });
  }
  
  return { realizedSlippageBps: Math.round(realizedSlippageBps), potentialSandwich };
}

export function getAdversarialPatterns() {
  return {
    timeOfDay: Object.fromEntries(adversarialPatterns.timeOfDay),
    sizeClusters: Object.fromEntries(adversarialPatterns.sizeClusters),
    venueClusters: Object.fromEntries(adversarialPatterns.venueClusters),
  };
}

export function clearPatterns() {
  adversarialPatterns.timeOfDay.clear();
  adversarialPatterns.sizeClusters.clear();
  adversarialPatterns.venueClusters.clear();
}