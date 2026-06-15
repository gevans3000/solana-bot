import { CFG, NOW, logJsonl, loadJson, saveJson, fileInState } from './common.mjs';

/**
 * Smart Order Routing Module
 * 
 * Real-time venue health (latency, error rate, depth)
 * Dynamic venue weights: favor venues with best fill quality
 * Toxic flow detection: skip venues with high adverse selection
 * Integration: called from jupiter-swap.mjs before quote fetch
 */

// Venue configuration
const DEFAULT_VENUES = [
  {
    id: 'jupiter',
    name: 'Jupiter Aggregator',
    endpoint: 'https://lite-api.jup.ag',
    priority: 1,
    enabled: true,
    weight: 1.0,
  },
  {
    id: 'jupiter_ultra',
    name: 'Jupiter Ultra',
    endpoint: 'https://lite-api.jup.ag/ultra/v1',
    priority: 2,
    enabled: true,
    weight: 1.2, // Ultra often better prices
  },
  {
    id: 'raydium',
    name: 'Raydium',
    endpoint: 'https://api.raydium.io',
    priority: 3,
    enabled: false, // disabled by default
    weight: 0.8,
  },
  {
    id: 'orca',
    name: 'Orca',
    endpoint: 'https://api.orca.so',
    priority: 4,
    enabled: false,
    weight: 0.8,
  },
  {
    id: 'phoenix',
    name: 'Phoenix',
    endpoint: 'https://api.phoenix.trade',
    priority: 5,
    enabled: false,
    weight: 0.7,
  },
];

// Venue health state
let venueHealth = {};
let routingState = {
  lastUpdate: 0,
  totalQuotes: 0,
  venueStats: {},
  toxicVenues: new Set(),
};

// Health metrics window (keep last N observations)
const HEALTH_WINDOW_SIZE = 50;
const TOXIC_THRESHOLD = 0.03; // 3% adverse selection rate
const MIN_LATENCY_MS = 50;    // minimum expected latency
const MAX_LATENCY_MS = 5000;  // maximum acceptable latency
const MAX_ERROR_RATE = 0.2;   // 20% error rate max

/**
 * Initialize venue health tracking
 */
export function initSmartRouting(venues = null) {
  const configVenues = venues || parseVenues(CFG.smartRoutingVenues) || DEFAULT_VENUES;
  
  venueHealth = {};
  for (const venue of configVenues) {
    venueHealth[venue.id] = {
      ...venue,
      latency: [],
      errors: 0,
      successes: 0,
      totalRequests: 0,
      fillQuality: [], // slippage vs quoted
      adverseSelection: [], // price move after fill
      depthSamples: [],
      lastUpdate: 0,
      healthScore: 1.0,
      weight: venue.weight,
      enabled: venue.enabled,
      status: 'unknown',
    };
  }
  
  routingState = {
    lastUpdate: NOW(),
    totalQuotes: 0,
    venueStats: {},
    toxicVenues: new Set(),
  };
  
  saveRoutingState();
  logJsonl('smart_routing.jsonl', { t: NOW(), type: 'init', venues: Object.keys(venueHealth) });
  return venueHealth;
}

/**
 * Parse venues from config
 */
function parseVenues(config) {
  if (!config) return null;
  if (Array.isArray(config)) return config;
  try {
    return JSON.parse(config);
  } catch {
    return null;
  }
}

/**
 * Record a quote request result for health tracking
 */
export function recordQuoteResult(venueId, { latencyMs, success, error, quotedPrice, fillPrice, slippageBps, depth }) {
  if (!venueHealth[venueId]) {
    // Auto-add unknown venue
    venueHealth[venueId] = createDefaultVenueHealth(venueId);
  }

  const health = venueHealth[venueId];
  health.totalRequests++;
  health.lastUpdate = NOW();

  if (success) {
    health.successes++;
    health.latency.push(latencyMs);
    if (health.latency.length > HEALTH_WINDOW_SIZE) health.latency.shift();
    
    if (quotedPrice && fillPrice) {
      const actualSlippage = Math.abs((fillPrice - quotedPrice) / quotedPrice) * 10000; // bps
      health.fillQuality.push(actualSlippage);
      if (health.fillQuality.length > HEALTH_WINDOW_SIZE) health.fillQuality.shift();
    }
    
    if (depth) {
      health.depthSamples.push(depth);
      if (health.depthSamples.length > HEALTH_WINDOW_SIZE) health.depthSamples.shift();
    }
  } else {
    health.errors++;
  }

  // Check for toxic flow (adverse selection)
  if (success && quotedPrice && fillPrice) {
    // Adverse selection: price moves against us after fill
    // This would need post-fill price observation - simplified for now
    const adverseBps = Math.max(0, slippageBps - (CFG.maxSlippageBps || 100));
    if (adverseBps > 0) {
      health.adverseSelection.push(adverseBps);
      if (health.adverseSelection.length > HEALTH_WINDOW_SIZE) health.adverseSelection.shift();
    }
  }

  updateVenueHealthScore(venueId);
  checkToxicFlow(venueId);
  routingState.totalQuotes++;
  routingState.lastUpdate = NOW();
  
  saveRoutingState();
}

/**
 * Create default health for a venue
 */
function createDefaultVenueHealth(venueId) {
  return {
    id: venueId,
    name: venueId,
    enabled: true,
    weight: 1.0,
    latency: [],
    errors: 0,
    successes: 0,
    totalRequests: 0,
    fillQuality: [],
    adverseSelection: [],
    depthSamples: [],
    lastUpdate: 0,
    healthScore: 1.0,
    status: 'unknown',
  };
}

/**
 * Update venue health score based on metrics
 */
function updateVenueHealthScore(venueId) {
  const health = venueHealth[venueId];
  if (health.totalRequests < 5) return; // need minimum samples
  
  const errorRate = health.errors / health.totalRequests;
  const avgLatency = health.latency.length > 0 
    ? health.latency.reduce((a, b) => a + b, 0) / health.latency.length 
    : MAX_LATENCY_MS;
  const avgSlippage = health.fillQuality.length > 0
    ? health.fillQuality.reduce((a, b) => a + b, 0) / health.fillQuality.length
    : 0;
  const avgDepth = health.depthSamples.length > 0
    ? health.depthSamples.reduce((a, b) => a + b, 0) / health.depthSamples.length
    : 0;
  
  // Score components (0-1 each)
  const latencyScore = Math.max(0, 1 - (avgLatency - MIN_LATENCY_MS) / (MAX_LATENCY_MS - MIN_LATENCY_MS));
  const errorScore = Math.max(0, 1 - errorRate / MAX_ERROR_RATE);
  const slippageScore = Math.max(0, 1 - avgSlippage / (CFG.maxSlippageBps || 100));
  const depthScore = Math.min(1, avgDepth / 100000); // normalize depth
  
  // Weighted health score
  health.healthScore = (
    latencyScore * 0.3 +
    errorScore * 0.3 +
    slippageScore * 0.25 +
    depthScore * 0.15
  );
  
  // Update dynamic weight based on health
  health.weight = Math.max(0.1, Math.min(2.0, health.healthScore * health.enabled ? 1 : 0));
  
  // Status
  if (errorRate > MAX_ERROR_RATE || avgLatency > MAX_LATENCY_MS) {
    health.status = 'degraded';
  } else if (health.healthScore > 0.8) {
    health.status = 'healthy';
  } else if (health.healthScore > 0.5) {
    health.status = 'fair';
  } else {
    health.status = 'poor';
  }
  
  routingState.venueStats[venueId] = {
    errorRate: +errorRate.toFixed(4),
    avgLatency: +avgLatency.toFixed(0),
    avgSlippage: +avgSlippage.toFixed(1),
    avgDepth: +avgDepth.toFixed(0),
    healthScore: +health.healthScore.toFixed(3),
    weight: +health.weight.toFixed(3),
    status: health.status,
    totalRequests: health.totalRequests,
  };
}

/**
 * Check for toxic flow (adverse selection)
 */
function checkToxicFlow(venueId) {
  const health = venueHealth[venueId];
  if (health.adverseSelection.length < 10) return;
  
  const recentAdverse = health.adverseSelection.slice(-20);
  const adverseRate = recentAdverse.filter(a => a > TOXIC_THRESHOLD * 10000).length / recentAdverse.length;
  
  if (adverseRate > 0.3) { // 30% of fills show adverse selection
    routingState.toxicVenues.add(venueId);
    health.enabled = false;
    logJsonl('smart_routing.jsonl', { 
      t: NOW(), 
      type: 'toxic_detected', 
      venue: venueId, 
      adverseRate: +adverseRate.toFixed(3),
      action: 'disabled',
    });
  }
}

/**
 * Get best venue for a given order
 * Returns venue ID with highest weighted score
 */
export function getBestVenue(side, amountUsdc, amountSol) {
  if (!CFG.smartRoutingEnabled) return 'jupiter';
  
  const enabledVenues = Object.entries(venueHealth)
    .filter(([id, h]) => h.enabled && !routingState.toxicVenues.has(id))
    .map(([id, h]) => ({ id, ...h }));
  
  if (enabledVenues.length === 0) {
    logJsonl('smart_routing.jsonl', { t: NOW(), type: 'fallback', reason: 'no_healthy_venues', fallback: 'jupiter' });
    return 'jupiter'; // fallback
  }
  
  // Score venues based on health score, weight, and order size suitability
  const scored = enabledVenues.map(v => {
    let score = v.healthScore * v.weight;
    
    // Prefer Jupiter Ultra for larger orders (better aggregation)
    if (v.id === 'jupiter_ultra' && (amountUsdc > 50 || amountSol > 0.5)) {
      score *= 1.2;
    }
    
    // Penalize venues with recent latency spikes
    const recentLatency = v.latency.slice(-5);
    if (recentLatency.length > 0) {
      const avgRecent = recentLatency.reduce((a, b) => a + b, 0) / recentLatency.length;
      if (avgRecent > 2000) score *= 0.5;
    }
    
    return { id: v.id, score, healthScore: v.healthScore, weight: v.weight };
  });
  
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].id;
  
  logJsonl('smart_routing.jsonl', { 
    t: NOW(), 
    type: 'venue_selected', 
    best, 
    scores: Object.fromEntries(scored.map(s => [s.id, +s.score.toFixed(3)])),
    side,
    amountUsdc,
    amountSol,
  });
  
  return best;
}

/**
 * Get quote from specific venue (to be implemented per venue)
 * This is a placeholder - actual implementation calls venue-specific APIs
 */
export async function getVenueQuote(venueId, { side, amountUsdc, amountSol, slippageBps }) {
  const startTime = Date.now();
  
  try {
    let quote;
    
    switch (venueId) {
      case 'jupiter':
      case 'jupiter_ultra':
        quote = await getJupiterQuoteInternal(side, amountUsdc, amountSol, slippageBps, venueId === 'jupiter_ultra');
        break;
      default:
        throw new Error(`Venue ${venueId} not implemented`);
    }
    
    const latency = Date.now() - startTime;
    recordQuoteResult(venueId, { latencyMs: latency, success: true, ...quote });
    return quote;
  } catch (error) {
    const latency = Date.now() - startTime;
    recordQuoteResult(venueId, { latencyMs: latency, success: false, error: String(error) });
    throw error;
  }
}

/**
 * Internal Jupiter quote fetch (extracted from shadow-quote.mjs)
 */
async function getJupiterQuoteInternal(side, amountUsdc, amountSol, slippageBps, ultra = false) {
  const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const usdcMint = CFG.usdcMint || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const solMint = CFG.solMint || 'So11111111111111111111111111111111111111112';
  
  const params = new URLSearchParams({
    inputMint: side === 'BUY' ? usdcMint : solMint,
    outputMint: side === 'BUY' ? solMint : usdcMint,
    amount: String(side === 'BUY' ? Math.floor(amountUsdc * 1e6) : Math.floor(amountSol * 1e9)),
    slippageBps: String(slippageBps || CFG.maxSlippageBps || 100),
  });
  
  // Use ultra endpoint if requested
  const baseUrl = ultra ? 'https://lite-api.jup.ag/ultra/v1/order' : 'https://lite-api.jup.ag/ultra/v1/order';
  const url = `${baseUrl}?${params}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    return {
      quotedPrice: data.outAmount ? (side === 'BUY' ? amountUsdc / (data.outAmount / 1e9) : (data.outAmount / 1e6) / amountSol) : null,
      priceImpactPct: data.priceImpactPct,
      outAmount: data.outAmount,
      inAmount: data.inAmount,
      venue: venueId,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Get routing statistics for monitoring
 */
export function getRoutingStats() {
  return {
    venues: Object.fromEntries(
      Object.entries(venueHealth).map(([id, h]) => [
        id,
        routingState.venueStats[id] || { healthScore: h.healthScore, status: h.status, enabled: h.enabled }
      ])
    ),
    toxicVenues: Array.from(routingState.toxicVenues),
    totalQuotes: routingState.totalQuotes,
    lastUpdate: routingState.lastUpdate,
  };
}

/**
 * Save routing state to disk
 */
function saveRoutingState() {
  const stateFile = fileInState('smart_routing_state.json');
  const serializable = {
    ...routingState,
    toxicVenues: Array.from(routingState.toxicVenues),
  };
  saveJson(stateFile, serializable);
}

/**
 * Load routing state from disk
 */
export function loadRoutingState() {
  const stateFile = fileInState('smart_routing_state.json');
  const saved = loadJson(stateFile, null);
  if (saved) {
    routingState = {
      ...saved,
      toxicVenues: new Set(saved.toxicVenues || []),
    };
    // Restore venue health scores
    for (const [id, stats] of Object.entries(saved.venueStats || {})) {
      if (venueHealth[id]) {
        venueHealth[id].healthScore = stats.healthScore;
        venueHealth[id].weight = stats.weight;
        venueHealth[id].status = stats.status;
      }
    }
  }
  return routingState;
}

/**
 * Reset routing state
 */
export function resetRoutingState() {
  initSmartRouting();
}

/**
 * Strategy registry pattern
 */
export const smartRoutingStrategy = {
  name: 'smart_routing',
  version: '1.0.0',
  enabledFlag: 'smartRoutingEnabled',
  init: initSmartRouting,
  getBestVenue,
  getVenueQuote,
  recordQuoteResult,
  getStats: getRoutingStats,
  loadState: loadRoutingState,
  reset: resetRoutingState,
  DEFAULT_VENUES,
};

export default smartRoutingStrategy;