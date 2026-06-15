import { CFG, NOW, logJsonl, safeReadJsonFile, fileInState } from './common.mjs';

/**
 * Regime-Adaptive Parameters Module
 * 
 * HMM-style regime detector (3 states: bull/bear/chop) using EMA spread, volatility, trend
 * Per-regime parameter sets with smooth transitions during regime changes
 * Integrates via strategy registry pattern with executor
 */

// Regime states
export const REGIME = {
  BULL: 'bull',
  BEAR: 'bear',
  CHOP: 'chop',
};

// Default per-regime parameter sets
const DEFAULT_REGIME_PARAMS = {
  [REGIME.BULL]: {
    stopLossPct: 8.0,          // tight SL
    trailGivePct: 20.0,        // wide trail
    trailArmPct: 1.5,          // early arm
    profitTargetPct: 4.0,      // aggressive target
    sizeMult: 1.5,             // aggressive size
    maxNotionalUsdc: 10,       // higher cap
    minExpectedEdgeBps: 10,    // lower edge threshold
    rsiOversold: 45,           // wider entry
    rsiOverbought: 75,
    buyEnabled: true,
    sellEnabled: true,
  },
  [REGIME.BEAR]: {
    stopLossPct: 15.0,         // wide SL
    trailGivePct: 5.0,         // tight trail
    trailArmPct: 3.0,          // late arm
    profitTargetPct: 2.0,      // conservative target
    sizeMult: 0.5,             // small size
    maxNotionalUsdc: 5,        // lower cap
    minExpectedEdgeBps: 30,    // higher edge threshold
    rsiOversold: 30,           // tighter entry
    rsiOverbought: 65,
    buyEnabled: true,
    sellEnabled: true,
  },
  [REGIME.CHOP]: {
    stopLossPct: 10.0,
    trailGivePct: 10.0,
    trailArmPct: 2.0,
    profitTargetPct: 1.5,
    sizeMult: 0.3,             // minimal size
    maxNotionalUsdc: 2,        // very low cap
    minExpectedEdgeBps: 50,    // very high edge threshold
    rsiOversold: 35,
    rsiOverbought: 70,
    buyEnabled: false,         // no trade in chop
    sellEnabled: true,         // allow exits only
  },
};

// Transition state for smooth blending
let regimeState = {
  current: REGIME.CHOP,
  previous: REGIME.CHOP,
  transitionTicks: 0,
  confidence: 0,
  history: [], // last N regime observations for smoothing
};

/**
 * HMM-style regime detection using observable features:
 * - EMA spread (fast - slow) / slow: trend strength
 * - Rolling volatility (ATR-like): market regime volatility
 * - Trend persistence: consecutive bars in same direction
 * Returns regime with confidence score
 */
export function detectRegime(priceSeries, emaFast, emaSlow) {
  if (!priceSeries || priceSeries.length < 20) {
    return { regime: REGIME.CHOP, confidence: 0, features: null };
  }

  const n = priceSeries.length;
  const closes = priceSeries.map(p => p.price || p.c || p.close);
  const highs = priceSeries.map(p => p.high || p.price || p.c || p.close);
  const lows = priceSeries.map(p => p.low || p.price || p.c || p.close);

  // Feature 1: EMA spread (normalized)
  const emaSpread = emaFast != null && emaSlow != null && emaSlow > 0
    ? ((emaFast - emaSlow) / emaSlow) * 100
    : 0;

  // Feature 2: Rolling volatility (last 20 bars)
  let volSum = 0;
  for (let i = Math.max(0, n - 20); i < n; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - (closes[i - 1] || closes[i])),
      Math.abs(lows[i] - (closes[i - 1] || closes[i]))
    );
    volSum += tr / closes[i];
  }
  const avgVol = (volSum / Math.min(20, n)) * 100; // as percentage

  // Feature 3: Trend persistence (consecutive higher/lower closes)
  let bullStreak = 0, bearStreak = 0, maxBullStreak = 0, maxBearStreak = 0;
  for (let i = 1; i < n; i++) {
    if (closes[i] > closes[i - 1]) {
      bullStreak++;
      bearStreak = 0;
      maxBullStreak = Math.max(maxBullStreak, bullStreak);
    } else if (closes[i] < closes[i - 1]) {
      bearStreak++;
      bullStreak = 0;
      maxBearStreak = Math.max(maxBearStreak, bearStreak);
    } else {
      bullStreak = bearStreak = 0;
    }
  }
  const trendPersistence = maxBullStreak - maxBearStreak; // positive = bullish

  // Feature 4: Price position relative to EMAs
  const lastClose = closes[n - 1];
  const aboveFast = lastClose > emaFast;
  const aboveSlow = lastClose > emaSlow;
  const pricePosition = (aboveFast ? 1 : 0) + (aboveSlow ? 1 : 0); // 0, 1, or 2

  // HMM-like scoring (simplified 3-state discriminant)
  // Bull: positive spread, low vol, positive persistence, price above EMAs
  // Bear: negative spread, high vol, negative persistence, price below EMAs
  // Chop: near-zero spread, medium vol, mixed persistence
  
  const bullScore = Math.max(0, emaSpread) * 0.4 
    + Math.max(0, -avgVol + 2) * 0.2 
    + Math.max(0, trendPersistence) * 0.2 
    + pricePosition * 0.2;

  const bearScore = Math.max(0, -emaSpread) * 0.4 
    + Math.max(0, avgVol - 2) * 0.2 
    + Math.max(0, -trendPersistence) * 0.2 
    + (2 - pricePosition) * 0.2;

  const chopScore = Math.max(0, 2 - Math.abs(emaSpread) * 0.5) * 0.4
    + Math.max(0, 2 - Math.abs(avgVol - 1.5)) * 0.3
    + (1 - Math.abs(trendPersistence) / 10) * 0.3;

  const scores = { [REGIME.BULL]: bullScore, [REGIME.BEAR]: bearScore, [REGIME.CHOP]: chopScore };
  const total = bullScore + bearScore + chopScore;
  
  let regime, confidence;
  if (total > 0) {
    const normalized = { [REGIME.BULL]: bullScore/total, [REGIME.BEAR]: bearScore/total, [REGIME.CHOP]: chopScore/total };
    const sorted = Object.entries(normalized).sort((a, b) => b[1] - a[1]);
    regime = sorted[0][0];
    confidence = sorted[0][1] - sorted[1][1]; // gap between top 2
  } else {
    regime = REGIME.CHOP;
    confidence = 0;
  }

  return {
    regime,
    confidence: Math.max(0, Math.min(1, confidence)),
    features: { emaSpread, avgVol, trendPersistence, pricePosition, scores },
  };
}

/**
 * Get per-regime parameters with smooth transition blending
 * During regime change, blend params over TRANSITION_TICKS (default 5)
 */
export function getRegimeParams(currentRegime, previousRegime = null, transitionTicks = 0) {
  const TRANSITION_TICKS = CFG.regimeTransitionTicks || 5;
  const params = { ...DEFAULT_REGIME_PARAMS };
  
  // Allow config override
  if (CFG.regimeParams) {
    for (const [regime, overrides] of Object.entries(CFG.regimeParams)) {
      if (params[regime]) params[regime] = { ...params[regime], ...overrides };
    }
  }

  // If no transition or same regime, return current regime params
  if (!previousRegime || currentRegime === previousRegime || transitionTicks >= TRANSITION_TICKS) {
    return { params: params[currentRegime], blending: false, progress: 1 };
  }

  // Blend between previous and current regime params
  const progress = Math.min(1, transitionTicks / TRANSITION_TICKS);
  const easedProgress = easeInOutCubic(progress); // Smooth easing
  
  const prevParams = params[previousRegime];
  const currParams = params[currentRegime];
  const blended = {};

  for (const key of Object.keys(currParams)) {
    const prevVal = prevParams[key];
    const currVal = currParams[key];
    if (typeof prevVal === 'number' && typeof currVal === 'number') {
      blended[key] = prevVal + (currVal - prevVal) * easedProgress;
    } else {
      // For booleans, switch at midpoint
      blended[key] = progress >= 0.5 ? currVal : prevVal;
    }
  }

  return { params: blended, blending: true, progress };
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Main regime detection and parameter update function
 * Called from executor tick() or botTick()
 */
export async function updateRegimeAdaptive(priceSource = null) {
  if (!CFG.regimeAdaptiveEnabled) return null;

  // Get price series (last 100 5m candles for detection)
  let priceSeries;
  if (priceSource) {
    priceSeries = priceSource;
  } else {
    // Fetch from price cache or generate mock
    const cache = safeReadJsonFile(fileInState('price-cache.json'));
    if (cache && cache.history && cache.history.length >= 20) {
      priceSeries = cache.history.slice(-100);
    }
  }

  // Get current EMAs from regime.json
  const regimeData = safeReadJsonFile(fileInState('regime.json')) || {};
  const emaFast = regimeData.emaFast;
  const emaSlow = regimeData.emaSlow;

  // Detect regime
  const detection = detectRegime(priceSeries || [], emaFast, emaSlow);
  
  // Update state with hysteresis (require confidence > threshold to switch)
  const MIN_CONFIDENCE = 0.15;
  let newRegime = regimeState.current;
  let transitionReset = false;

  if (detection.confidence >= MIN_CONFIDENCE && detection.regime !== regimeState.current) {
    // Check if we've been seeing this regime consistently
    regimeState.history.push(detection.regime);
    if (regimeState.history.length > 3) regimeState.history.shift();
    
    const consistent = regimeState.history.every(r => r === detection.regime);
    if (consistent && regimeState.history.length >= 2) {
      regimeState.previous = regimeState.current;
      regimeState.current = detection.regime;
      regimeState.transitionTicks = 0;
      transitionReset = true;
      logJsonl('regime.jsonl', { t: NOW(), type: 'regime_change', from: regimeState.previous, to: regimeState.current, confidence: detection.confidence, features: detection.features });
    }
  } else if (detection.regime === regimeState.current) {
    regimeState.history = []; // reset history on confirmation
  }

  // Increment transition ticks if in transition
  if (regimeState.current !== regimeState.previous) {
    regimeState.transitionTicks++;
  }

  // Get blended parameters
  const { params, blending, progress } = getRegimeParams(
    regimeState.current,
    regimeState.previous,
    regimeState.transitionTicks
  );

  regimeState.confidence = detection.confidence;

  // Persist regime state
  const stateToSave = {
    t: NOW(),
    regime: regimeState.current,
    previousRegime: regimeState.previous,
    confidence: regimeState.confidence,
    transitionTicks: regimeState.transitionTicks,
    blending,
    blendProgress: progress,
    params,
    features: detection.features,
  };
  
  // Save to state file (overwrites regime.json with enhanced data)
  const fs = await import('node:fs');
  const path = await import('node:path');
  const STATE_DIR = process.env.SOLBOT_STATE_DIR || path.join(process.cwd(), 'state');
  fs.writeFileSync(path.join(STATE_DIR, 'regime.json'), JSON.stringify(stateToSave, null, 2));

  return stateToSave;
}

/**
 * Get current regime parameters (for use in executor/bots)
 */
export function getCurrentRegimeParams() {
  return getRegimeParams(regimeState.current, regimeState.previous, regimeState.transitionTicks).params;
}

/**
 * Get current regime info
 */
export function getRegimeState() {
  return { ...regimeState };
}

/**
 * Reset regime state (for testing)
 */
export function resetRegimeState() {
  regimeState = {
    current: REGIME.CHOP,
    previous: REGIME.CHOP,
    transitionTicks: 0,
    confidence: 0,
    history: [],
  };
}

/**
 * Backtest helper: run regime detection on historical data
 * Returns regime labels for each bar
 */
export function backtestRegimes(priceSeries, emaPeriod = 20, regimeEmaSlow = 50) {
  const fastAlpha = 2 / (emaPeriod + 1);
  const slowAlpha = 2 / (regimeEmaSlow + 1);
  
  const results = [];
  let emaFast = null, emaSlow = null;
  
  for (let i = 0; i < priceSeries.length; i++) {
    const price = priceSeries[i].price || priceSeries[i].c || priceSeries[i].close;
    emaFast = updateEma(emaFast, price, fastAlpha);
    emaSlow = updateEma(emaSlow, price, slowAlpha);
    
    if (i >= Math.max(emaPeriod, regimeEmaSlow)) {
      const detection = detectRegime(priceSeries.slice(Math.max(0, i - 99), i + 1), emaFast, emaSlow);
      results.push({ index: i, timestamp: priceSeries[i].t, ...detection });
    } else {
      results.push({ index: i, timestamp: priceSeries[i].t, regime: REGIME.CHOP, confidence: 0 });
    }
  }
  
  return results;
}

function updateEma(prev, price, alpha) {
  return prev == null ? price : alpha * price + (1 - alpha) * prev;
}

/**
 * Strategy registry pattern: register this module's parameter provider
 */
export const regimeAdaptiveStrategy = {
  name: 'regime_adaptive',
  version: '1.0.0',
  enabledFlag: 'regimeAdaptiveEnabled',
  getParameters: getCurrentRegimeParams,
  update: updateRegimeAdaptive,
  getState: getRegimeState,
  detectRegime,
  backtestRegimes,
  REGIME,
};

export default regimeAdaptiveStrategy;