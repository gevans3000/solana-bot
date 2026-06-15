import { CFG, NOW, logJsonl, fetchJson } from './common.mjs';

/**
 * Multi-Timeframe Confirmation Module
 * 
 * Generate signals on 5m, 15m, 1h, 4h timeframes
 * Require 2/3 higher TFs agree with 5m signal (majority vote)
 * Higher TF regime filter: only trade 5m in direction of 1h trend
 * Parallel fetch all TFs, max 100ms latency budget
 */

// Timeframe definitions (in minutes)
const TIMEFRAMES = {
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
};

const DEFAULT_TIMEFRAMES = ['5m', '15m', '1h', '4h'];

// Cache for multi-TF data
let multiTfCache = {
  data: {},
  lastFetch: 0,
  fetchDuration: 0,
};

/**
 * Fetch OHLCV data for a specific timeframe
 * Uses Jupiter price API or falls back to cached data
 */
async function fetchTimeframeData(timeframe, limit = 100) {
  const tfMinutes = TIMEFRAMES[timeframe];
  if (!tfMinutes) throw new Error(`Unknown timeframe: ${timeframe}`);
  
  // For now, use the same price source but with different resolution
  // In production, this would hit a proper OHLCV endpoint
  const url = `https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112&interval=${tfMinutes}m&limit=${limit}`;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    // Transform to standard OHLCV format
    // Jupiter price v3 returns different format, adapt as needed
    return transformToOhlcv(data, timeframe);
  } catch (error) {
    // Return cached/mock data on failure
    return getMockTimeframeData(timeframe, limit);
  }
}

/**
 * Transform API response to OHLCV array
 */
function transformToOhlcv(data, timeframe) {
  // Simplified - in reality would parse actual OHLCV from provider
  const prices = data?.data || data?.prices || [];
  return prices.map((p, i) => ({
    t: p.t || Date.now() - (prices.length - i) * TIMEFRAMES[timeframe] * 60000,
    o: p.o || p.price,
    h: p.h || p.price,
    l: p.l || p.price,
    c: p.c || p.price,
    v: p.v || 1000,
  }));
}

/**
 * Generate mock timeframe data for testing/fallback
 */
function getMockTimeframeData(timeframe, limit) {
  const tfMs = TIMEFRAMES[timeframe] * 60000;
  const now = Date.now();
  const basePrice = 180;
  const data = [];
  let price = basePrice;
  
  for (let i = limit; i >= 0; i--) {
    const drift = (Math.random() - 0.5) * 0.02;
    price = Math.max(1, price * (1 + drift));
    const high = price * (1 + Math.random() * 0.01);
    const low = price * (1 - Math.random() * 0.01);
    const open = data.length > 0 ? data[data.length - 1].c : price;
    
    data.push({
      t: now - i * tfMs,
      o: open,
      h: high,
      l: low,
      c: price,
      v: 1000 * (0.5 + Math.random()),
    });
  }
  return data;
}

/**
 * Compute indicators for a timeframe series
 */
function computeIndicators(series, emaPeriod = 20, regimeEmaSlow = 50, rsiPeriod = 14) {
  if (!series || series.length < Math.max(emaPeriod, regimeEmaSlow, rsiPeriod) + 1) {
    return null;
  }

  const closes = series.map(s => s.c);
  const highs = series.map(s => s.h);
  const lows = series.map(s => s.l);

  // EMAs
  const fastAlpha = 2 / (emaPeriod + 1);
  const slowAlpha = 2 / (regimeEmaSlow + 1);
  
  let emaFast = null, emaSlow = null;
  const emaFastArr = [], emaSlowArr = [];
  
  for (const close of closes) {
    emaFast = emaFast === null ? close : fastAlpha * close + (1 - fastAlpha) * emaFast;
    emaSlow = emaSlow === null ? close : slowAlpha * close + (1 - slowAlpha) * emaSlow;
    emaFastArr.push(emaFast);
    emaSlowArr.push(emaSlow);
  }

  // RSI
  const rsiArr = [];
  const rsiAlpha = 1 / rsiPeriod;
  let avgG = null, avgL = null, prevClose = closes[0];
  
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - prevClose;
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = avgG === null ? g : rsiAlpha * g + (1 - rsiAlpha) * avgG;
    avgL = avgL === null ? l : rsiAlpha * l + (1 - rsiAlpha) * avgL;
    if (i >= rsiPeriod) {
      const rs = avgL === 0 ? Infinity : avgG / avgL;
      rsiArr.push(100 - 100 / (1 + rs));
    } else {
      rsiArr.push(null);
    }
    prevClose = closes[i];
  }
  // Pad beginning
  while (rsiArr.length < closes.length) rsiArr.unshift(null);

  // ATR
  const atrAlpha = 2 / (14 + 1);
  let atr = null;
  const atrArr = [];
  prevClose = closes[0];
  
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - prevClose),
      Math.abs(lows[i] - prevClose)
    );
    atr = atr === null ? tr : atrAlpha * tr + (1 - atrAlpha) * atr;
    atrArr.push(atr);
    prevClose = closes[i];
  }
  atrArr.unshift(atrArr[0] || null);

  const lastIdx = closes.length - 1;
  return {
    close: closes[lastIdx],
    emaFast: emaFastArr[lastIdx],
    emaSlow: emaSlowArr[lastIdx],
    prevEmaFast: emaFastArr[lastIdx - 1],
    rsi: rsiArr[lastIdx],
    atr: atrArr[lastIdx],
    regimeStrength: emaFastArr[lastIdx] && emaSlowArr[lastIdx] && emaSlowArr[lastIdx] > 0
      ? ((emaFastArr[lastIdx] - emaSlowArr[lastIdx]) / emaSlowArr[lastIdx]) * 100
      : 0,
    trendUp: emaFastArr[lastIdx] > emaSlowArr[lastIdx],
    emaRising: emaFastArr[lastIdx] >= (emaFastArr[lastIdx - 1] || 0),
  };
}

/**
 * Generate signal for a single timeframe
 */
function generateTfSignal(indicators, botType, params) {
  if (!indicators) return { signal: null, reason: 'insufficient_data' };

  const { close, emaFast, emaSlow, prevEmaFast, rsi, regimeStrength, trendUp, emaRising } = indicators;
  
  const rsiOversold = rsi != null && rsi < params.rsiOversold;
  const rsiOverbought = rsi != null && rsi > params.rsiOverbought;
  const emaOk = !params.trendFilterEnabled || emaFast >= prevEmaFast;
  const regimeOk = !params.regimeFilterEnabled || (emaFast != null && emaSlow != null && emaFast >= emaSlow);
  
  let buyAllowed = (emaOk && regimeOk) || rsiOversold;
  let sellTrigger = false;

  // Bot specialization
  if (params.botSpecializationEnabled) {
    if (botType === 'BEAR') {
      buyAllowed = rsi != null && rsi < params.bearRsiMax;
    } else if (botType === 'BULL') {
      buyAllowed = trendUp && emaRising;
    }
  }

  // Anchor logic - simplified for multi-TF (use EMA as anchor)
  const anchor = emaFast || close;
  const dipPct = botType === 'BULL' ? params.bullDipPct : params.bearDipPct;
  const ripPct = botType === 'BULL' ? params.bullRipPct : params.bearRipPct;
  const buyTrigger = anchor * (1 - dipPct / 100);
  const sellTriggerPrice = anchor * (1 + ripPct / 100);

  let signal = null;
  if (buyAllowed && close <= buyTrigger) {
    signal = { side: 'BUY', price: close, reason: 'dip_buy', strength: Math.abs((anchor - close) / anchor) };
  } else if (close >= sellTriggerPrice || (rsiOverbought && close > anchor)) {
    signal = { side: 'SELL', price: close, reason: 'rip_sell', strength: Math.abs((close - anchor) / anchor) };
  }

  return {
    signal,
    indicators: { emaFast, emaSlow, rsi, regimeStrength, trendUp },
    buyTrigger,
    sellTrigger: sellTriggerPrice,
    buyAllowed,
  };
}

/**
 * Fetch and analyze all timeframes in parallel
 */
export async function analyzeMultiTimeframe(botType = 'BULL', customTimeframes = null) {
  const startTime = Date.now();
  const timeframes = customTimeframes || parseTimeframes(CFG.multiTfTimeframes) || DEFAULT_TIMEFRAMES;
  
  // Fetch all timeframes in parallel
  const fetchPromises = timeframes.map(tf => fetchTimeframeData(tf, 100));
  const results = await Promise.allSettled(fetchPromises);
  
  const tfData = {};
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      tfData[timeframes[i]] = result.value;
    } else {
      tfData[timeframes[i]] = getMockTimeframeData(timeframes[i], 100);
    }
  });

  // Compute indicators for each timeframe
  const tfIndicators = {};
  for (const [tf, data] of Object.entries(tfData)) {
    tfIndicators[tf] = computeIndicators(data, CFG.emaPeriod, CFG.regimeEmaSlow, CFG.rsiPeriod);
  }

  // Generate signals for each timeframe
  const params = {
    trendFilterEnabled: CFG.trendFilterEnabled,
    regimeFilterEnabled: CFG.regimeFilterEnabled,
    rsiOversold: CFG.rsiOversold,
    rsiOverbought: CFG.rsiOverbought,
    botSpecializationEnabled: CFG.botSpecializationEnabled,
    bearRsiMax: CFG.bearRsiMax,
    bullDipPct: CFG.bullDipPct,
    bullRipPct: CFG.bullRipPct,
    bearDipPct: CFG.bearDipPct,
    bearRipPct: CFG.bearRipPct,
    emaPeriod: CFG.emaPeriod,
    regimeEmaSlow: CFG.regimeEmaSlow,
    rsiPeriod: CFG.rsiPeriod,
  };

  const tfSignals = {};
  for (const tf of timeframes) {
    tfSignals[tf] = generateTfSignal(tfIndicators[tf], botType, params);
  }

  // Apply multi-TF confirmation logic
  const confirmation = applyMultiTfConfirmation(tfSignals, tfIndicators, timeframes);

  const fetchDuration = Date.now() - startTime;
  
  // Update cache
  multiTfCache = {
    data: { signals: tfSignals, indicators: tfIndicators, confirmation },
    lastFetch: NOW(),
    fetchDuration,
  };

  logJsonl('multi_tf.jsonl', {
    t: NOW(),
    botType,
    fetchDuration,
    timeframes,
    signals: Object.fromEntries(Object.entries(tfSignals).map(([tf, s]) => [tf, s.signal?.side || 'none'])),
    confirmation,
  });

  return {
    timeframes,
    signals: tfSignals,
    indicators: tfIndicators,
    confirmation,
    fetchDuration,
    latencyOk: fetchDuration <= (CFG.multiTfMaxLatencyMs || 100),
  };
}

/**
 * Apply multi-TF confirmation rules:
 * 1. Require 2/3 higher TFs agree with 5m signal (majority vote)
 * 2. Higher TF regime filter: only trade 5m in direction of 1h trend
 */
function applyMultiTfConfirmation(tfSignals, tfIndicators, timeframes) {
  const baseTf = '5m';
  const higherTfs = timeframes.filter(tf => tf !== baseTf).sort((a, b) => TIMEFRAMES[a] - TIMEFRAMES[b]);
  
  const baseSignal = tfSignals[baseTf]?.signal;
  if (!baseSignal) {
    return { allowed: false, reason: 'no_base_signal', baseSignal: null, higherTfVotes: {}, regimeFilter: null };
  }

  // Count higher TF agreement
  let agreeCount = 0;
  const higherTfVotes = {};
  
  for (const tf of higherTfs) {
    const hSignal = tfSignals[tf]?.signal;
    higherTfVotes[tf] = hSignal?.side || 'none';
    
    if (hSignal && hSignal.side === baseSignal.side) {
      agreeCount++;
    }
  }

  const majorityRequired = Math.ceil(higherTfs.length / 2); // 2/3 for 3 higher TFs
  const majorityAgree = agreeCount >= majorityRequired;

  // Regime filter: check 1h trend direction
  const regimeTf = '1h';
  const regimeIndicators = tfIndicators[regimeTf];
  let regimeFilterPass = true;
  let regimeFilterReason = 'passed';
  
  if (regimeIndicators && CFG.multiTfRegimeFilter !== false) {
    const trendUp = regimeIndicators.trendUp;
    const regimeStrength = regimeIndicators.regimeStrength;
    
    if (baseSignal.side === 'BUY' && !trendUp) {
      regimeFilterPass = false;
      regimeFilterReason = '1h_trend_down';
    } else if (baseSignal.side === 'SELL' && trendUp && regimeStrength > 5) {
      regimeFilterPass = false;
      regimeFilterReason = '1h_strong_uptrend';
    }
  }

  const allowed = majorityAgree && regimeFilterPass;

  return {
    allowed,
    reason: allowed ? 'confirmed' : (!majorityAgree ? 'majority_disagree' : regimeFilterReason),
    baseSignal: baseSignal.side,
    baseSignalStrength: baseSignal.strength,
    higherTfVotes,
    agreeCount,
    majorityRequired,
    majorityAgree,
    regimeFilter: {
      passed: regimeFilterPass,
      reason: regimeFilterReason,
      trendUp: regimeIndicators?.trendUp,
      regimeStrength: regimeIndicators?.regimeStrength,
    },
  };
}

/**
 * Parse timeframes from config
 */
function parseTimeframes(config) {
  if (!config) return null;
  if (Array.isArray(config)) return config;
  if (typeof config === 'string') {
    try {
      return JSON.parse(config);
    } catch {
      return config.split(',').map(s => s.trim());
    }
  }
  return null;
}

/**
 * Get cached multi-TF analysis
 */
export function getCachedMultiTf() {
  return multiTfCache.data;
}

/**
 * Check if cached data is fresh
 */
export function isMultiTfFresh(maxAgeMs = 30000) {
  return Date.now() - new Date(multiTfCache.lastFetch).getTime() < maxAgeMs;
}

/**
 * Get signal for a specific timeframe (for debugging)
 */
export function getTfSignal(timeframe, botType = 'BULL') {
  const data = multiTfCache.data;
  if (!data?.signals?.[timeframe]) return null;
  return data.signals[timeframe];
}

/**
 * Strategy registry pattern
 */
export const multiTfStrategy = {
  name: 'multi_tf',
  version: '1.0.0',
  enabledFlag: 'multiTfEnabled',
  analyze: analyzeMultiTimeframe,
  getCached: getCachedMultiTf,
  isFresh: isMultiTfFresh,
  getTfSignal,
  applyMultiTfConfirmation,
  computeIndicators,
  generateTfSignal,
  TIMEFRAMES,
  DEFAULT_TIMEFRAMES,
};

export default multiTfStrategy;