import { CFG, NOW, rpcRequest, logJsonl } from './common.mjs';

const PRIORITY_FEE_WINDOW_BLOCKS = 100;
const FEE_HISTORY_MAX = 50;
const FEE_PER_CU_FLOOR = 5000;
const FEE_PER_CU_CEILING = 200000;
const ADAPTIVE_REDUCE_FACTOR = 0.9;
const ADAPTIVE_INCREASE_FACTOR = 1.2;
const ADAPTIVE_FAST_THRESHOLD = 2;
const ADAPTIVE_SLOW_THRESHOLD = 5;
const URGENT_NOTIONAL_THRESHOLD = 500;

let feeHistory = [];
let landingSlotsHistory = [];

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export async function fetchRecentPrioritizationFees() {
  try {
    const result = await rpcRequest('getRecentPrioritizationFees', []);
    const fees = result || [];
    return fees
      .map(f => f.prioritizationFee)
      .filter(f => Number.isFinite(f) && f > 0);
  } catch (error) {
    await logJsonl('dynamic-fees.jsonl', { t: NOW(), type: 'fetch_error', error: String(error) });
    return [];
  }
}

export function computeFeePercentiles(fees) {
  if (!fees.length) return { p50: 0, p75: 0, p95: 0 };
  return {
    p50: percentile(fees, 50),
    p75: percentile(fees, 75),
    p95: percentile(fees, 95),
  };
}

export function adaptiveAdjustment(baseFeePerCu, landingSlotsHistory) {
  if (landingSlotsHistory.length < 3) return baseFeePerCu;
  
  const recent3 = landingSlotsHistory.slice(-3);
  const avgSlots = recent3.reduce((a, b) => a + b, 0) / 3;
  
  if (avgSlots < ADAPTIVE_FAST_THRESHOLD) {
    return baseFeePerCu * ADAPTIVE_REDUCE_FACTOR;
  }
  if (avgSlots > ADAPTIVE_SLOW_THRESHOLD) {
    return baseFeePerCu * ADAPTIVE_INCREASE_FACTOR;
  }
  return baseFeePerCu;
}

export function computeDynamicPriorityFee({ notionalUsdc, maxSlippageBps }) {
  const percentiles = computeFeePercentiles(feeHistory);
  
  const isUrgent = notionalUsdc > URGENT_NOTIONAL_THRESHOLD;
  const targetPercentile = isUrgent ? 90 : 75;
  const targetFee = percentile(feeHistory, targetPercentile);
  
  const baseFee = targetFee * (isUrgent ? 1.1 : 1.1);
  const adjustedFee = adaptiveAdjustment(baseFee, landingSlotsHistory);
  
  const cappedFee = Math.min(Math.max(Math.round(adjustedFee), FEE_PER_CU_FLOOR), FEE_PER_CU_CEILING);
  
  const slippageBudgetLamports = (maxSlippageBps / 10000) * notionalUsdc * 1e6;
  const estimatedCu = 200000;
  const maxFeeFromSlippage = slippageBudgetLamports / estimatedCu;
  
  const finalFee = Math.min(cappedFee, maxFeeFromSlippage);
  
  return {
    feePerCu: Math.max(Math.round(finalFee), FEE_PER_CU_FLOOR),
    percentiles,
    isUrgent,
    adaptiveFactor: adjustedFee / baseFee,
    slippageBudgetLamports,
  };
}

export async function updateFeeHistory() {
  const fees = await fetchRecentPrioritizationFees();
  feeHistory = [...feeHistory, ...fees].slice(-FEE_HISTORY_MAX);
  
  await logJsonl('dynamic-fees.jsonl', {
    t: NOW(),
    type: 'fee_history_update',
    historyLength: feeHistory.length,
    percentiles: computeFeePercentiles(feeHistory),
  });
}

export function recordLandingSlots(slots) {
  landingSlotsHistory.push(slots);
  if (landingSlotsHistory.length > 20) landingSlotsHistory.shift();
}

export function getFeeHistory() {
  return [...feeHistory];
}

export function getLandingHistory() {
  return [...landingSlotsHistory];
}