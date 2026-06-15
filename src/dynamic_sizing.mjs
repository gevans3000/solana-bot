import { CFG, NOW, logJsonl, loadJson, saveJson, fileInState, safeReadJsonFile } from './common.mjs';
import { loadPortfolio } from './portfolio.mjs';

/**
 * Dynamic Position Sizing Module
 * 
 * Kelly fraction: f = (p*b - q)/b where p=win rate, b=avg win/loss
 * Vol-targeting: size = target_vol / current_vol * base_size
 * Max drawdown control: reduce size as DD approaches limit
 * Regime-aware: bull=1.5x, bear=0.5x, chop=0.3x base Kelly
 */

// Sizing state
let sizingState = {
  // Trade history for Kelly calculation
  trades: [],
  maxTradesWindow: 100,
  
  // Volatility tracking
  returns: [],
  volWindow: 50,
  
  // Drawdown tracking
  peakEquity: 0,
  currentDrawdown: 0,
  maxDrawdownLimit: 0.15, // 15% max DD
  
  // Current sizing params
  lastKellyFraction: 0,
  lastVolTargetSize: 0,
  lastDdAdjSize: 0,
  lastRegimeMult: 1,
  finalSizeMult: 1,
  
  // Config
  targetVolDaily: 0.02, // 2% daily vol target
  kellyLookback: 50,
  volLookback: 20,
  ddScaleStart: 0.05,  // start scaling at 5% DD
  ddScaleEnd: 0.15,    // zero size at 15% DD
};

/**
 * Initialize dynamic sizing
 */
export function initDynamicSizing(config = {}) {
  sizingState = {
    ...sizingState,
    ...config,
    trades: [],
    returns: [],
    peakEquity: config.initialEquity || 1000,
    maxDrawdownLimit: config.maxDrawdownLimit || (CFG.maxDrawdownLimitPct ? CFG.maxDrawdownLimitPct / 100 : 0.15),
    targetVolDaily: config.targetVolDaily || (CFG.targetVolDaily ? CFG.targetVolDaily / 100 : 0.02),
  };
  
  logJsonl('dynamic_sizing.jsonl', { t: NOW(), type: 'init', config: sizingState });
  return sizingState;
}

/**
 * Record a trade result for Kelly calculation
 */
export function recordTrade(pnlPct, isWin, regime = 'chop') {
  if (!CFG.dynamicSizingEnabled) return;
  
  sizingState.trades.push({
    t: NOW(),
    pnlPct,
    isWin,
    regime,
    equity: loadPortfolio().usdc + loadPortfolio().sol * (safeReadJsonFile(fileInState('price-cache.json'))?.price || 180),
  });
  
  // Track returns for volatility
  sizingState.returns.push(pnlPct / 100);
  
  // Trim windows
  if (sizingState.trades.length > sizingState.maxTradesWindow) {
    sizingState.trades.shift();
  }
  if (sizingState.returns.length > sizingState.volWindow * 3) {
    sizingState.returns.shift();
  }
  
  // Update peak equity and drawdown
  const equity = sizingState.trades[sizingState.trades.length - 1].equity;
  if (equity > sizingState.peakEquity) {
    sizingState.peakEquity = equity;
  }
  sizingState.currentDrawdown = sizingState.peakEquity > 0 
    ? (sizingState.peakEquity - equity) / sizingState.peakEquity 
    : 0;
  
  saveSizingState();
}

/**
 * Calculate Kelly fraction from trade history
 * f = (p*b - q) / b where p=win rate, q=1-p, b=avg win/avg loss
 */
export function calculateKellyFraction(regime = null) {
  let trades = sizingState.trades;
  
  // Filter by regime if specified
  if (regime) {
    trades = trades.filter(t => t.regime === regime);
  }
  
  // Need minimum trades
  const lookback = Math.min(sizingState.kellyLookback, trades.length);
  if (lookback < 10) return 0.1; // default conservative
  
  const recentTrades = trades.slice(-lookback);
  const wins = recentTrades.filter(t => t.isWin);
  const losses = recentTrades.filter(t => !t.isWin);
  
  if (wins.length === 0 || losses.length === 0) return 0.1;
  
  const p = wins.length / recentTrades.length; // win rate
  const q = 1 - p;
  
  const avgWin = wins.reduce((sum, t) => sum + t.pnlPct, 0) / wins.length;
  const avgLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnlPct, 0) / losses.length);
  
  if (avgLoss === 0) return 0.1;
  
  const b = avgWin / avgLoss; // win/loss ratio
  const kelly = (p * b - q) / b;
  
  // Cap Kelly at reasonable bounds (0 to 0.5)
  const cappedKelly = Math.max(0, Math.min(0.5, kelly));
  
  sizingState.lastKellyFraction = cappedKelly;
  return cappedKelly;
}

/**
 * Calculate volatility-targeted size multiplier
 * size = target_vol / current_vol * base_size
 */
export function calculateVolTargetMultiplier() {
  const returns = sizingState.returns.slice(-sizingState.volLookback);
  if (returns.length < 10) return 1.0;
  
  // Calculate daily volatility from returns
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const dailyVol = Math.sqrt(variance);
  
  if (dailyVol === 0) return 1.0;
  
  // Annualize if needed (assuming returns are per-trade, scale to daily)
  // For simplicity, use trade vol directly
  const currentVol = dailyVol;
  const targetVol = sizingState.targetVolDaily;
  
  const volMult = targetVol / currentVol;
  
  // Cap volatility multiplier
  const cappedMult = Math.max(0.2, Math.min(3.0, volMult));
  
  sizingState.lastVolTargetSize = cappedMult;
  return cappedMult;
}

/**
 * Calculate drawdown-adjusted size multiplier
 * Linear scale down from ddScaleStart to ddScaleEnd
 */
export function calculateDrawdownMultiplier() {
  const dd = sizingState.currentDrawdown;
  const start = sizingState.ddScaleStart;
  const end = sizingState.ddScaleEnd;
  
  if (dd <= start) return 1.0;
  if (dd >= end) return 0.0;
  
  // Linear interpolation
  const mult = 1.0 - (dd - start) / (end - start);
  sizingState.lastDdAdjSize = mult;
  return mult;
}

/**
 * Get regime-aware sizing multiplier
 */
export function getRegimeSizingMultiplier(regime) {
  const mults = {
    [REGIME.BULL]: CFG.regimeSizeBullMult || 1.5,
    [REGIME.BEAR]: CFG.regimeSizeBearMult || 0.5,
    [REGIME.CHOP]: CFG.regimeSizeChopMult || 0.3,
  };
  
  const mult = mults[regime] || 1.0;
  sizingState.lastRegimeMult = mult;
  return mult;
}

// Re-export REGIME from regime_adaptive
const REGIME = {
  BULL: 'bull',
  BEAR: 'bear',
  CHOP: 'chop',
};

/**
 * Calculate final position size multiplier
 * Combines Kelly, vol-targeting, drawdown control, and regime awareness
 */
export function calculateSizeMultiplier(baseSize, regime = 'chop') {
  if (!CFG.dynamicSizingEnabled) return baseSize;
  
  // Kelly fraction (base)
  const kelly = calculateKellyFraction(regime);
  
  // Volatility targeting
  const volMult = calculateVolTargetMultiplier();
  
  // Drawdown control
  const ddMult = calculateDrawdownMultiplier();
  
  // Regime awareness
  const regimeMult = getRegimeSizingMultiplier(regime);
  
  // Combined multiplier
  const combined = kelly * volMult * ddMult * regimeMult;
  
  // Apply to base size
  const finalSize = baseSize * combined;
  
  // Cap final size
  const maxSizeMult = CFG.maxDynamicSizeMult || 3.0;
  const minSizeMult = CFG.minDynamicSizeMult || 0.1;
  const cappedMult = Math.max(minSizeMult, Math.min(maxSizeMult, combined));
  const finalSizeCapped = baseSize * cappedMult;
  
  sizingState.finalSizeMult = cappedMult;
  
  logJsonl('dynamic_sizing.jsonl', {
    t: NOW(),
    type: 'size_calc',
    baseSize,
    finalSize: +finalSizeCapped.toFixed(2),
    kelly: +kelly.toFixed(4),
    volMult: +volMult.toFixed(3),
    ddMult: +ddMult.toFixed(3),
    regimeMult,
    currentDD: +(sizingState.currentDrawdown * 100).toFixed(2),
    regime,
  });
  
  saveSizingState();
  return finalSizeCapped;
}

/**
 * Get dynamic position size for a trade
 * Integrates with executor's sizing logic
 */
export function getPositionSize(signal, regime = 'chop') {
  const portfolio = loadPortfolio();
  const price = safeReadJsonFile(fileInState('price-cache.json'))?.price || 180;
  const equity = portfolio.usdc + portfolio.sol * price;
  
  // Base size from config (e.g., bullBuyUsdc)
  let baseSize = signal.side === 'BUY' 
    ? (CFG.bullBuyUsdc || 25)
    : (CFG.bullSellSol || 0.15) * price;
  
  // Apply dynamic sizing
  const dynamicSize = calculateSizeMultiplier(baseSize, regime);
  
  // Apply existing regime sizing (from bot-lib.mjs)
  let finalSize = dynamicSize;
  if (CFG.regimeSizeEnabled) {
    // This will be applied in bot-lib, but we can also apply here for executor
    // The bot-lib applies regimeSizeUpMult/DownMult, so we avoid double-applying
  }
  
  // Ensure within bounds
  const minTrade = CFG.minTradeUsdc || 10;
  const maxNotional = CFG.maxNotionalUsdc || 75;
  const effectiveMax = Math.min(maxNotional, equity * 0.5); // never more than 50% equity
  
  finalSize = Math.max(minTrade, Math.min(effectiveMax, finalSize));
  
  return Math.round(finalSize * 100) / 100; // round to cents
}

/**
 * Get current sizing state for monitoring
 */
export function getSizingState() {
  const kelly = calculateKellyFraction();
  
  return {
    enabled: CFG.dynamicSizingEnabled,
    kellyFraction: +kelly.toFixed(4),
    volTargetMult: +sizingState.lastVolTargetSize.toFixed(3),
    ddAdjMult: +sizingState.lastDdAdjSize.toFixed(3),
    regimeMult: +sizingState.lastRegimeMult.toFixed(3),
    finalMult: +sizingState.finalSizeMult.toFixed(3),
    currentDrawdownPct: +(sizingState.currentDrawdown * 100).toFixed(2),
    peakEquity: +sizingState.peakEquity.toFixed(2),
    tradeCount: sizingState.trades.length,
    winRate: sizingState.trades.length > 0
      ? +(sizingState.trades.filter(t => t.isWin).length / sizingState.trades.length * 100).toFixed(1)
      : 0,
    avgWinPct: sizingState.trades.filter(t => t.isWin).length > 0
      ? +(sizingState.trades.filter(t => t.isWin).reduce((a, b) => a + b.pnlPct, 0) / sizingState.trades.filter(t => t.isWin).length).toFixed(2)
      : 0,
    avgLossPct: sizingState.trades.filter(t => !t.isWin).length > 0
      ? +(Math.abs(sizingState.trades.filter(t => !t.isWin).reduce((a, b) => a + b.pnlPct, 0) / sizingState.trades.filter(t => !t.isWin).length)).toFixed(2)
      : 0,
  };
}

/**
 * Save sizing state to disk
 */
function saveSizingState() {
  const stateFile = fileInState('dynamic_sizing_state.json');
  saveJson(stateFile, sizingState);
}

/**
 * Load sizing state from disk
 */
export function loadSizingState() {
  const stateFile = fileInState('dynamic_sizing_state.json');
  const saved = loadJson(stateFile, null);
  if (saved) {
    sizingState = { ...sizingState, ...saved };
  }
  return sizingState;
}

/**
 * Reset sizing state
 */
export function resetSizingState() {
  initDynamicSizing();
}

/**
 * Backtest helper: simulate dynamic sizing on historical trades
 */
export function backtestDynamicSizing(trades, regimes, initialEquity = 1000) {
  const results = [];
  let equity = initialEquity;
  let peakEquity = initialEquity;
  
  // Initialize with first trade's regime
  initDynamicSizing({ initialEquity });
  
  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i];
    const regime = regimes[i] || 'chop';
    
    const baseSize = trade.side === 'BUY' ? 25 : 0.15 * trade.price;
    const dynSize = calculateSizeMultiplier(baseSize, regime);
    const pnlPct = trade.pnl / dynSize * 100;
    
    // Record for next iteration
    recordTrade(pnlPct, trade.pnl > 0, regime);
    
    equity += trade.pnl;
    if (equity > peakEquity) peakEquity = equity;
    
    results.push({
      trade,
      regime,
      baseSize,
      dynSize,
      pnlPct: +pnlPct.toFixed(2),
      equity: +equity.toFixed(2),
      drawdown: +((peakEquity - equity) / peakEquity * 100).toFixed(2),
    });
  }
  
  return results;
}

/**
 * Strategy registry pattern
 */
export const dynamicSizingStrategy = {
  name: 'dynamic_sizing',
  version: '1.0.0',
  enabledFlag: 'dynamicSizingEnabled',
  init: initDynamicSizing,
  calculateSizeMultiplier,
  getPositionSize,
  calculateKellyFraction,
  calculateVolTargetMultiplier,
  calculateDrawdownMultiplier,
  getRegimeSizingMultiplier,
  recordTrade,
  getState: getSizingState,
  loadState: loadSizingState,
  reset: resetSizingState,
  backtest: backtestDynamicSizing,
  REGIME,
};

export default dynamicSizingStrategy;