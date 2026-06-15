import { CFG, NOW, logJsonl, loadJson, saveJson, fileInState, safeReadJsonFile } from './common.mjs';
import { loadPortfolio } from './portfolio.mjs';

/**
 * Partial Take-Profit & Scale-Out Module
 * 
 * Tiered exits: configurable partial TP levels
 * Trail remainder with dynamic give-back (regime-aware)
 * Scale-in: add to winners on pullback to EMA (max 2 adds)
 * Integrates with executor.mjs profit target logic
 */

// Default tiered exit configuration
const DEFAULT_TP_TIERS = [
  { pct: 1.5, size: 0.3, label: 'TP1' },  // 30% at 1.5%
  { pct: 3.0, size: 0.3, label: 'TP2' },  // 30% at 3%
  { pct: 5.0, size: 0.4, label: 'TP3' },  // 40% at 5%
];

// Scale-in configuration
const DEFAULT_SCALE_IN_CONFIG = {
  maxAdds: 2,
  pullbackPct: 1.0,     // pullback % from peak to trigger add
  emaDistancePct: 0.5,  // max distance from EMA to allow add
  addSizeMult: 0.5,     // each add is 50% of original position size
  minConfidence: 0.6,   // regime confidence required
};

// State for tracking partial exits and scale-ins
let partialExitState = {
  tiers: [],
  activeTiers: [],
  completedTiers: [],
  peakSinceEntry: 0,
  scaleInCount: 0,
  lastScaleInPrice: 0,
  originalPositionSize: 0,
  avgEntryPrice: 0,
  trailingActive: false,
  trailArmed: false,
};

/**
 * Initialize partial exit state for a new position
 */
export function initPartialExits(positionSize, avgEntryPrice, tiers = null) {
  const configTiers = tiers || parseTpTiers(CFG.partialTpTiers) || DEFAULT_TP_TIERS;
  
  partialExitState = {
    tiers: configTiers.map(t => ({ ...t, triggered: false, filled: 0 })),
    activeTiers: [],
    completedTiers: [],
    peakSinceEntry: avgEntryPrice,
    scaleInCount: 0,
    lastScaleInPrice: 0,
    originalPositionSize: positionSize,
    avgEntryPrice,
    trailingActive: false,
    trailArmed: false,
  };
  
  logJsonl('partial_exits.jsonl', { t: NOW(), type: 'init', positionSize, avgEntryPrice, tiers: configTiers });
  return partialExitState;
}

/**
 * Parse TP tiers from config string or array
 */
function parseTpTiers(config) {
  if (!config) return null;
  if (Array.isArray(config)) return config;
  try {
    return JSON.parse(config);
  } catch {
    // Try parsing as "pct:size,pct:size" format
    return config.split(',').map(s => {
      const [pct, size] = s.split(':').map(v => parseFloat(v.trim()));
      return { pct, size };
    });
  }
}

/**
 * Update peak price (for trailing logic)
 */
function updatePeak(currentPrice) {
  if (currentPrice > partialExitState.peakSinceEntry) {
    partialExitState.peakSinceEntry = currentPrice;
  }
  return partialExitState.peakSinceEntry;
}

/**
 * Check and execute partial take-profit tiers
 * Returns array of exit orders to execute
 */
export function checkPartialExits(currentPrice, regime = 'chop', regimeConfidence = 0) {
  if (!CFG.partialTpEnabled) return [];
  if (partialExitState.tiers.length === 0) return [];

  const portfolio = loadPortfolio();
  const positionSize = portfolio.sol;
  const avgEntry = portfolio.avgEntryPrice;
  
  if (positionSize <= 0 || avgEntry <= 0) {
    // Position closed, reset state
    resetPartialExits();
    return [];
  }

  // Update peak
  const peak = updatePeak(currentPrice);
  
  // Calculate gain from avg entry
  const gainPct = ((currentPrice - avgEntry) / avgEntry) * 100;
  const giveBackPct = peak > 0 ? ((peak - currentPrice) / peak) * 100 : 0;

  const exits = [];
  let remainingPosition = positionSize;

  // Check each tier
  for (let i = 0; i < partialExitState.tiers.length; i++) {
    const tier = partialExitState.tiers[i];
    
    if (tier.triggered) continue;

    // Check if tier should trigger
    let shouldTrigger = false;
    let exitType = 'partial_tp';
    
    if (gainPct >= tier.pct) {
      // Fixed TP tier hit
      shouldTrigger = true;
    } else if (partialExitState.trailArmed && giveBackPct >= getEffectiveTrailGive(regime)) {
      // Trailing exit triggered on remainder
      shouldTrigger = true;
      exitType = 'trail_exit';
      // This will sell ALL remaining position
    }

    if (shouldTrigger) {
      const sellAmount = tier.size * partialExitState.originalPositionSize;
      const actualSell = Math.min(sellAmount, remainingPosition);
      
      if (actualSell > 0) {
        tier.triggered = true;
        tier.filled = actualSell;
        tier.fillPrice = currentPrice;
        tier.fillTime = NOW();
        tier.exitType = exitType;
        partialExitState.completedTiers.push({ ...tier });
        
        exits.push({
          side: 'SELL',
          amount: actualSell,
          price: currentPrice,
          reason: exitType,
          tier: tier.label || `TP${i + 1}`,
          tierIndex: i,
          isFinal: exitType === 'trail_exit' || i === partialExitState.tiers.length - 1,
        });
        
        remainingPosition -= actualSell;
        
        // If trailing exit, we're done - sell everything remaining
        if (exitType === 'trail_exit') {
          // Add any remaining position to this exit
          if (remainingPosition > 0) {
            exits[exits.length - 1].amount += remainingPosition;
            remainingPosition = 0;
          }
          partialExitState.trailingActive = false;
          break;
        }
      }
    }
  }

  // Check if we should arm trailing (after first TP or at trailArmPct)
  if (!partialExitState.trailArmed && 
      (partialExitState.completedTiers.length > 0 || gainPct >= (CFG.trailArmPct || 2.0))) {
    partialExitState.trailArmed = true;
    partialExitState.trailingActive = true;
    logJsonl('partial_exits.jsonl', { t: NOW(), type: 'trail_armed', gainPct, peak });
  }

  // Update state
  savePartialExitState();

  return exits;
}

/**
 * Get regime-aware trailing give-back percentage
 */
function getEffectiveTrailGive(regime) {
  const baseTrailGive = CFG.trailGivePct || 10;
  const bullTrailGive = CFG.bullTrailGivePct || 25;
  
  if (regime === 'bull') {
    return Math.max(baseTrailGive, bullTrailGive);
  } else if (regime === 'bear') {
    return baseTrailGive * 0.5; // tighter in bear
  } else {
    return baseTrailGive;
  }
}

/**
 * Check scale-in opportunity (add to winners on pullback to EMA)
 * Returns scale-in order if conditions met
 */
export function checkScaleIn(currentPrice, emaFast, emaSlow, regime = 'chop', regimeConfidence = 0) {
  if (!CFG.scaleInEnabled) return null;
  if (partialExitState.scaleInCount >= (CFG.scaleInMaxAdds || 2)) return null;
  if (regime !== 'bull' || regimeConfidence < (CFG.scaleInMinConfidence || 0.6)) return null;

  const portfolio = loadPortfolio();
  const positionSize = portfolio.sol;
  const avgEntry = portfolio.avgEntryPrice;
  const peak = partialExitState.peakSinceEntry;

  if (positionSize <= 0 || avgEntry <= 0 || peak <= 0) return null;

  // Calculate pullback from peak
  const pullbackPct = ((peak - currentPrice) / peak) * 100;
  const requiredPullback = CFG.scaleInPullbackPct || 1.0;

  // Check distance from EMA (only add near EMA support)
  let emaDistancePct = 100;
  if (emaFast) {
    emaDistancePct = Math.abs((currentPrice - emaFast) / emaFast) * 100;
  }
  const maxEmaDistance = CFG.scaleInEmaDistancePct || 0.5;

  // Conditions for scale-in:
  // 1. In bull regime with high confidence
  // 2. Price pulled back from peak
  // 3. Price near fast EMA (support)
  // 4. Still in profit overall
  const gainPct = ((currentPrice - avgEntry) / avgEntry) * 100;
  
  if (pullbackPct >= requiredPullback 
      && emaDistancePct <= maxEmaDistance 
      && gainPct > 0
      && partialExitState.scaleInCount < (CFG.scaleInMaxAdds || 2)) {
    
    // Calculate add size
    const addSize = partialExitState.originalPositionSize * (CFG.scaleInAddSizeMult || 0.5);
    const maxAdd = portfolio.usdc / currentPrice; // limited by available USDC
    const actualAdd = Math.min(addSize, maxAdd);

    if (actualAdd > 0.001) { // minimum meaningful size
      partialExitState.scaleInCount++;
      partialExitState.lastScaleInPrice = currentPrice;
      partialExitState.originalPositionSize += actualAdd; // increase base for TP calc
      
      logJsonl('partial_exits.jsonl', { 
        t: NOW(), 
        type: 'scale_in', 
        addNumber: partialExitState.scaleInCount,
        addSize: actualAdd,
        price: currentPrice,
        pullbackPct,
        emaDistancePct,
        gainPct,
      });
      
      savePartialExitState();
      
      return {
        side: 'BUY',
        amount: actualAdd * currentPrice, // USDC amount
        price: currentPrice,
        reason: 'scale_in',
        addNumber: partialExitState.scaleInCount,
        pullbackPct,
      };
    }
  }

  return null;
}

/**
 * Get dynamic trailing give-back based on regime and volatility
 */
export function getDynamicTrailGive(regime, volatility = null) {
  let baseGive = CFG.trailGivePct || 10;
  
  // Regime adjustment
  switch (regime) {
    case 'bull':
      baseGive = Math.max(baseGive, CFG.bullTrailGivePct || 25);
      break;
    case 'bear':
      baseGive = baseGive * 0.5;
      break;
    case 'chop':
      baseGive = baseGive * 0.7;
      break;
  }
  
  // Volatility adjustment (wider trail in high vol)
  if (volatility != null) {
    const volMult = Math.max(0.5, Math.min(2.0, 1 + (volatility - 2) * 0.2));
    baseGive *= volMult;
  }
  
  return baseGive;
}

/**
 * Save partial exit state to disk
 */
function savePartialExitState() {
  const stateFile = fileInState('partial_exits_state.json');
  saveJson(stateFile, partialExitState);
}

/**
 * Load partial exit state from disk
 */
export function loadPartialExitState() {
  const stateFile = fileInState('partial_exits_state.json');
  const saved = loadJson(stateFile, null);
  if (saved) {
    partialExitState = { ...partialExitState, ...saved };
  }
  return partialExitState;
}

/**
 * Reset partial exit state (new position or flat)
 */
export function resetPartialExits() {
  partialExitState = {
    tiers: [],
    activeTiers: [],
    completedTiers: [],
    peakSinceEntry: 0,
    scaleInCount: 0,
    lastScaleInPrice: 0,
    originalPositionSize: 0,
    avgEntryPrice: 0,
    trailingActive: false,
    trailArmed: false,
  };
  savePartialExitState();
}

/**
 * Get current partial exit status (for UI/logging)
 */
export function getPartialExitStatus(currentPrice = null) {
  const portfolio = loadPortfolio();
  const positionSize = portfolio.sol;
  const avgEntry = portfolio.avgEntryPrice;
  
  let gainPct = 0, giveBackPct = 0;
  if (currentPrice && avgEntry > 0) {
    gainPct = ((currentPrice - avgEntry) / avgEntry) * 100;
    giveBackPct = partialExitState.peakSinceEntry > 0 
      ? ((partialExitState.peakSinceEntry - currentPrice) / partialExitState.peakSinceEntry) * 100 
      : 0;
  }
  
  return {
    enabled: CFG.partialTpEnabled,
    positionSize,
    avgEntry,
    originalSize: partialExitState.originalPositionSize,
    peakSinceEntry: partialExitState.peakSinceEntry,
    gainPct: +gainPct.toFixed(2),
    giveBackPct: +giveBackPct.toFixed(2),
    trailArmed: partialExitState.trailArmed,
    trailingActive: partialExitState.trailingActive,
    scaleInCount: partialExitState.scaleInCount,
    completedTiers: partialExitState.completedTiers.map(t => ({
      label: t.label,
      pct: t.pct,
      filled: t.filled,
      fillPrice: t.fillPrice,
      exitType: t.exitType,
    })),
    pendingTiers: partialExitState.tiers
      .filter(t => !t.triggered)
      .map(t => ({ label: t.label, pct: t.pct, size: t.size })),
  };
}

/**
 * Strategy registry pattern
 */
export const partialExitsStrategy = {
  name: 'partial_exits',
  version: '1.0.0',
  enabledFlag: 'partialTpEnabled',
  init: initPartialExits,
  checkExits: checkPartialExits,
  checkScaleIn,
  getStatus: getPartialExitStatus,
  reset: resetPartialExits,
  getDynamicTrailGive,
  DEFAULT_TP_TIERS,
  DEFAULT_SCALE_IN_CONFIG,
};

export default partialExitsStrategy;