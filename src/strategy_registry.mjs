/**
 * Strategy Registry - Central integration point for all advanced strategy features
 * 
 * Provides a unified interface for the executor to access all strategy modules
 * and coordinates their interactions.
 */

import { CFG, NOW, logJsonl } from './common.mjs';
import { regimeAdaptiveStrategy } from './regime_adaptive.mjs';
import { partialExitsStrategy } from './partial_exits.mjs';
import { multiTfStrategy } from './multi_tf.mjs';
import { smartRoutingStrategy } from './smart_routing.mjs';
import { dynamicSizingStrategy } from './dynamic_sizing.mjs';

// Strategy registry
const strategyRegistry = {
  regime_adaptive: regimeAdaptiveStrategy,
  partial_exits: partialExitsStrategy,
  multi_tf: multiTfStrategy,
  smart_routing: smartRoutingStrategy,
  dynamic_sizing: dynamicSizingStrategy,
};

/**
 * Initialize all enabled strategies
 */
export async function initStrategies() {
  const results = {};
  
  for (const [name, strategy] of Object.entries(strategyRegistry)) {
    const enabledFlag = strategy.enabledFlag;
    if (CFG[enabledFlag]) {
      try {
        if (strategy.init) {
          await strategy.init();
        }
        results[name] = { enabled: true, initialized: true };
        logJsonl('strategy_registry.jsonl', { t: NOW(), type: 'init', strategy: name, status: 'ok' });
      } catch (error) {
        results[name] = { enabled: true, initialized: false, error: String(error) };
        logJsonl('strategy_registry.jsonl', { t: NOW(), type: 'init', strategy: name, status: 'error', error: String(error) });
      }
    } else {
      results[name] = { enabled: false };
      logJsonl('strategy_registry.jsonl', { t: NOW(), type: 'init', strategy: name, status: 'disabled' });
    }
  }
  
  return results;
}

/**
 * Get current regime and parameters (for executor/bots)
 */
export async function getRegimeParams() {
  if (!CFG.regimeAdaptiveEnabled) return null;
  
  // Update regime detection
  if (regimeAdaptiveStrategy.update) {
    await regimeAdaptiveStrategy.update();
  }
  
  return regimeAdaptiveStrategy.getParameters();
}

/**
 * Get current regime state
 */
export function getRegimeState() {
  if (!CFG.regimeAdaptiveEnabled) return { regime: 'chop', confidence: 0 };
  return regimeAdaptiveStrategy.getState();
}

/**
 * Check partial exits for current position
 */
export function checkPartialExits(currentPrice) {
  if (!CFG.partialTpEnabled) return [];
  
  const regimeState = getRegimeState();
  return partialExitsStrategy.checkExits(currentPrice, regimeState.current, regimeState.confidence);
}

/**
 * Check scale-in opportunity
 */
export function checkScaleIn(currentPrice, emaFast, emaSlow) {
  if (!CFG.partialTpEnabled || !CFG.scaleInEnabled) return null;
  
  const regimeState = getRegimeState();
  return partialExitsStrategy.checkScaleIn(currentPrice, emaFast, emaSlow, regimeState.current, regimeState.confidence);
}

/**
 * Initialize partial exits for new position
 */
export function initPartialExits(positionSize, avgEntryPrice) {
  if (!CFG.partialTpEnabled) return;
  return partialExitsStrategy.init(positionSize, avgEntryPrice);
}

/**
 * Get multi-TF confirmation for a signal
 */
export async function getMultiTfConfirmation(botType = 'BULL') {
  if (!CFG.multiTfEnabled) return { allowed: true, reason: 'multi_tf_disabled' };
  
  const result = await multiTfStrategy.analyze(botType);
  return result.confirmation;
}

/**
 * Get best venue for order routing
 */
export function getBestVenue(side, amountUsdc, amountSol) {
  if (!CFG.smartRoutingEnabled) return 'jupiter';
  return smartRoutingStrategy.getBestVenue(side, amountUsdc, amountSol);
}

/**
 * Record quote result for smart routing health tracking
 */
export function recordQuoteResult(venueId, result) {
  if (!CFG.smartRoutingEnabled) return;
  return smartRoutingStrategy.recordQuoteResult(venueId, result);
}

/**
 * Calculate dynamic position size
 */
export function calculatePositionSize(signal) {
  if (!CFG.dynamicSizingEnabled) return null;
  
  const regimeState = getRegimeState();
  return dynamicSizingStrategy.getPositionSize(signal, regimeState.current);
}

/**
 * Record trade result for Kelly/volatility/DD tracking
 */
export function recordTradeResult(pnlPct, isWin) {
  if (!CFG.dynamicSizingEnabled) return;
  
  const regimeState = getRegimeState();
  return dynamicSizingStrategy.recordTrade(pnlPct, isWin, regimeState.current);
}

/**
 * Get combined strategy state for monitoring/UI
 */
export function getStrategyState() {
  const regimeState = getRegimeState();
  const partialState = CFG.partialTpEnabled ? partialExitsStrategy.getStatus() : null;
  const multiTfState = CFG.multiTfEnabled ? multiTfStrategy.getCached() : null;
  const routingState = CFG.smartRoutingEnabled ? smartRoutingStrategy.getStats() : null;
  const sizingState = CFG.dynamicSizingEnabled ? dynamicSizingStrategy.getState() : null;
  
  return {
    regime: regimeState,
    partialExits: partialState,
    multiTf: multiTfState,
    smartRouting: routingState,
    dynamicSizing: sizingState,
  };
}

/**
 * Get all enabled strategies
 */
export function getEnabledStrategies() {
  return Object.entries(strategyRegistry)
    .filter(([_, s]) => CFG[s.enabledFlag])
    .map(([name]) => name);
}

/**
 * Reset all strategy states (for testing)
 */
export function resetAllStrategies() {
  for (const [_, strategy] of Object.entries(strategyRegistry)) {
    if (strategy.reset) strategy.reset();
  }
}

export { strategyRegistry };
export default {
  init: initStrategies,
  getRegimeParams,
  getRegimeState,
  checkPartialExits,
  checkScaleIn,
  initPartialExits,
  getMultiTfConfirmation,
  getBestVenue,
  recordQuoteResult,
  calculatePositionSize,
  recordTradeResult,
  getStrategyState,
  getEnabledStrategies,
  resetAllStrategies,
};