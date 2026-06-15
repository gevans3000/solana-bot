import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env');
const EXAMPLE_ENV_PATH = path.join(ROOT, '.env.example');

/**
 * Loads environment variables from a .env file into process.env.
 * Only sets variables that are not already defined in process.env.
 * Supports quoted values (both single and double quotes).
 * @param {string} targetPath - Path to the .env file
 * @returns {void}
 */
function loadEnvFile(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  const text = fs.readFileSync(targetPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(ENV_PATH);
loadEnvFile(EXAMPLE_ENV_PATH);

export { ROOT };
export const LOG_DIR   = process.env.SOLBOT_LOG_DIR   || path.join(ROOT, 'logs');
export const STATE_DIR = process.env.SOLBOT_STATE_DIR || path.join(ROOT, 'state');
export const NOW = () => new Date().toISOString();

// ============================================================================
// MULTI-RPC FAILOVER SUPPORT
// ============================================================================

/**
 * Parses RPC URLs from environment variable.
 * Supports comma-separated URLs: RPC_URLS="https://a.com,https://b.com"
 * Falls back to single RPC_URL for backward compatibility.
 * @returns {string[]} Array of RPC endpoint URLs
 */
function parseRpcUrls() {
  const urlsEnv = process.env.RPC_URLS || '';
  if (urlsEnv.trim()) {
    return urlsEnv.split(',').map(u => u.trim()).filter(Boolean);
  }
  // Backward compatibility: single RPC_URL
  const single = process.env.RPC_URL || 'https://api.devnet.solana.com';
  return [single];
}

/**
 * RPC endpoint state for failover tracking.
 * @typedef {Object} RpcEndpointState
 * @property {string} url - The RPC endpoint URL
 * @property {boolean} healthy - Whether the endpoint is currently healthy
 * @property {number} failures - Consecutive failure count
 * @property {number} lastFailure - Timestamp of last failure
 * @property {number} lastSuccess - Timestamp of last success
 */
const RPC_ENDPOINTS = parseRpcUrls().map(url => ({
  url,
  healthy: true,
  failures: 0,
  lastFailure: 0,
  lastSuccess: 0,
}));

let RPC_CURRENT_INDEX = 0;

/**
 * Gets the current healthy RPC endpoint, rotating on failure.
 * @returns {string} Current RPC URL to use
 */
export function getCurrentRpcUrl() {
  return RPC_ENDPOINTS[RPC_CURRENT_INDEX]?.url || 'https://api.devnet.solana.com';
}

/**
 * Gets all RPC endpoints for health checks.
 * @returns {Array<RpcEndpointState>} Copy of endpoints array
 */
export function getRpcEndpoints() {
  return RPC_ENDPOINTS.map(e => ({ ...e }));
}

/**
 * Marks an RPC endpoint as failed, triggers failover if threshold exceeded.
 * @param {string} url - The URL that failed
 * @param {Error} error - The error that occurred
 */
export function markRpcFailure(url, error) {
  const idx = RPC_ENDPOINTS.findIndex(e => e.url === url);
  if (idx === -1) return;
  
  const endpoint = RPC_ENDPOINTS[idx];
  endpoint.failures++;
  endpoint.lastFailure = Date.now();
  
  // Mark unhealthy after 3 consecutive failures
  if (endpoint.failures >= 3) {
    endpoint.healthy = false;
    console.warn(`[RPC] ${url} marked unhealthy after ${endpoint.failures} failures: ${error.message}`);
    
    // Trigger failover if this was the current endpoint
    if (idx === RPC_CURRENT_INDEX) {
      failoverToNextHealthy();
    }
  }
}

/**
 * Marks an RPC endpoint as successful, resets failure count.
 * @param {string} url - The URL that succeeded
 */
export function markRpcSuccess(url) {
  const idx = RPC_ENDPOINTS.findIndex(e => e.url === url);
  if (idx === -1) return;
  
  const endpoint = RPC_ENDPOINTS[idx];
  endpoint.healthy = true;
  endpoint.failures = 0;
  endpoint.lastSuccess = Date.now();
}

/**
 * Fails over to the next healthy RPC endpoint.
 * @returns {boolean} True if failover occurred, false if no healthy endpoints available
 */
export function failoverToNextHealthy() {
  const total = RPC_ENDPOINTS.length;
  let nextIdx = (RPC_CURRENT_INDEX + 1) % total;
  let attempts = 0;
  
  while (attempts < total) {
    if (RPC_ENDPOINTS[nextIdx].healthy) {
      const oldUrl = RPC_ENDPOINTS[RPC_CURRENT_INDEX]?.url;
      RPC_CURRENT_INDEX = nextIdx;
      const newUrl = RPC_ENDPOINTS[nextIdx].url;
      console.warn(`[RPC] FAILOVER: ${oldUrl} -> ${newUrl}`);
      return true;
    }
    nextIdx = (nextIdx + 1) % total;
    attempts++;
  }
  
  console.error('[RPC] CRITICAL: No healthy RPC endpoints available!');
  return false;
}

/**
 * Performs a health check on all RPC endpoints.
 * Returns the first healthy one, or null if all are down.
 * @returns {Promise<string|null>} Healthy RPC URL or null
 */
export async function checkRpcHealth() {
  for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
    const endpoint = RPC_ENDPOINTS[i];
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      if (res.ok) {
        const json = await res.json();
        if (!json.error && json.result === 'ok') {
          if (!endpoint.healthy) {
            endpoint.healthy = true;
            endpoint.failures = 0;
            console.log(`[RPC] ${endpoint.url} recovered`);
            // If this is not current, consider failover back
            if (i !== RPC_CURRENT_INDEX) {
              console.log(`[RPC] Recovered endpoint available: ${endpoint.url}`);
            }
          }
          return endpoint.url;
        }
      }
    } catch {
      // Ignore, try next
    }
  }
  return null; // All down
}

/**
 * Manual failover trigger (can be called from monitoring/alerting).
 * @returns {Promise<boolean>} True if failover occurred
 */
export async function manualRpcFailover() {
  const healthy = await checkRpcHealth();
  if (healthy && healthy !== getCurrentRpcUrl()) {
    return failoverToNextHealthy();
  }
  return false;
}

/**
 * Retrieves and parses a numeric environment variable.
 * @param {string} name - Environment variable name
 * @param {number} fallback - Default value if not set or invalid
 * @returns {number} Parsed number or fallback
 * @throws {Error} If the value is set but not a finite number
 */
export function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${name}: ${raw}`);
  return n;
}

/**
 * Retrieves and parses a boolean environment variable.
 * Recognizes '1', 'true', 'yes', 'y', 'on' (case-insensitive) as true.
 * @param {string} name - Environment variable name
 * @param {boolean} [fallback=false] - Default value if not set
 * @returns {boolean} Parsed boolean or fallback
 */
export function bool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(raw).toLowerCase());
}

/**
 * Global configuration object populated from environment variables.
 * All numeric values are validated for finiteness on startup.
 * @typedef {Object} Config
 * @property {string} networkLabel - Network identifier (e.g., 'devnet', 'mainnet-beta')
 * @property {string} rpcUrl - Solana RPC endpoint URL (must start with http)
 * @property {string} executionMode - 'simulated', 'real', or 'shadow'
 * @property {boolean} dryRun - If true, blocks all real execution (safety)
 * @property {number} uiPort - HTTP UI server port
 * @property {number} loopSec - Main loop interval in seconds (min 5)
 * @property {number} signalMinSec - Minimum seconds between signals from same bot (min 5)
 * @property {number} cooldownSec - Seconds to wait after a trade before next (min 5)
 * @property {number} decisionWindowSec - Time window for one-trade-per-window rule (min 10)
 * @property {number} maxTradesPerDay - Max trades per UTC day in sim mode (min 1)
 * @property {number} staleSignalSec - Seconds after which a signal is considered stale (min 10)
 * @property {number} minExpectedEdgeBps - Minimum signal edge in basis points to consider a trade (min 0)
 * @property {number} minNetEdgeBps - Minimum net edge (signal edge - price impact) in bps; 0 = block only negative net edge
 * @property {number} minTradeUsdc - Minimum trade notional in USDC (min 1)
 * @property {number} maxNotionalUsdc - Maximum per-trade notional in USDC for sim/shadow (min 1)
 * @property {number} dailyNotionalLimitUsdc - Daily notional limit in USDC for sim/shadow (min 1)
 * @property {number} minSolReserve - Minimum SOL to keep in reserve, never sold (min 0)
 * @property {number} maxSolAllocationPct - Maximum SOL allocation as % of total equity (10-100)
 * @property {boolean} trendFilterEnabled - Enable EMA trend filter for entries
 * @property {number} emaPeriod - Fast EMA period for trend filter (min 2)
 * @property {boolean} regimeFilterEnabled - Enable dual-EMA regime filter (fast > slow)
 * @property {number} regimeEmaSlow - Slow EMA period for regime filter (min 5)
 * @property {boolean} useAtrThresholds - Use ATR-based dynamic dip/rip thresholds
 * @property {number} atrPeriod - ATR period (min 2)
 * @property {number} atrDipMult - ATR multiplier for dip threshold
 * @property {number} atrRipMult - ATR multiplier for rip threshold
 * @property {number} atrMinDipPct - Minimum dip % floor when using ATR (min 0.01)
 * @property {number} atrMinRipPct - Minimum rip % floor when using ATR (min 0.01)
 * @property {boolean} rsiEnabled - Enable RSI indicator
 * @property {number} rsiPeriod - RSI period (min 2)
 * @property {number} rsiOversold - RSI oversold threshold (1-49)
 * @property {number} rsiOverbought - RSI overbought threshold (51-99)
 * @property {boolean} profitTargetEnabled - Enable profit target / trailing exit
 * @property {number} profitTargetPct - Fixed profit target % (min 0.5)
 * @property {boolean} profitTargetBypassCooldown - Skip cooldown after PT exit
 * @property {boolean} rsiScaleBuyEnabled - Scale buy size by RSI oversold depth
 * @property {number} rsiScaleMaxMult - Maximum RSI scale multiplier (min 1.0)
 * @property {boolean} stopLossEnabled - Enable stop-loss exit
 * @property {number} stopLossPct - Stop-loss % from avg entry (min 1)
 * @property {boolean} trailInUptrend - Use trailing exit in confirmed uptrends
 * @property {number} trailArmPct - Gain % to arm trailing exit (min 0.5)
 * @property {number} trailGivePct - Give-back % from peak to trigger trailing exit (min 0.2)
 * @property {number} bullTrailGivePct - Widened trailing give-back in strong bull (min 0.2)
 * @property {number} bullMinSolHold - Core SOL floor held through strong bull trend (min 0)
 * @property {boolean} bullProportionalSells - Sell the amount last bought (symmetry) in strong bull
 * @property {number} bullStrongRegimePct - Regime strength % gate for bull sell-side fixes (min 0)
 * @property {number} bullMaxNotionalUsdc - Per-trade notional cap in strong bull (sim/shadow only)
 * @property {boolean} intrabarStops - Use candle low for stop-loss trigger (honest fill at stop level)
 * @property {number} anchorCooldownBars - Bars to block fresh BUY after last buy (min 0)
 * @property {boolean} entryBounceConfirm - Require price > prevClose for BUY entry
 * @property {boolean} conflictEdgeResolution - On BULL/BEAR conflict, pick larger |edgeBps| instead of NO_TRADE
 * @property {boolean} botSpecializationEnabled - Enable BULL (trend) / BEAR (mean-reversion) specialization
 * @property {number} bearRsiMax - Max RSI for BEAR bot buys (min 1)
 * @property {number} bullRegimeThreshold - Regime strength % for bull overlay (min 0)
 * @property {number} bullDipScale - Dip/rip multiplier in strong bull (min 1.0)
 * @property {boolean} regimeSizeEnabled - Enable regime-aware position sizing
 * @property {number} regimeSizeUpMult - Size multiplier in confirmed uptrend oversold dip (min 1.0)
 * @property {number} regimeSizeDownMult - Size multiplier in downtrend/high RSI (0.1-1.0)
 * @property {number} regimeSizeHighRsi - RSI threshold for downsizing (50-100)
 * @property {number} bullDipPct - BULL bot dip % threshold (min 0.01)
 * @property {number} bullRipPct - BULL bot rip % threshold (min 0.01)
 * @property {number} bullBuyUsdc - BULL bot fixed buy amount USDC (min 1)
 * @property {number} bullSellSol - BULL bot fixed sell amount SOL (min 0.001)
 * @property {number} bearDipPct - BEAR bot dip % threshold (min 0.01)
 * @property {number} bearRipPct - BEAR bot rip % threshold (min 0.01)
 * @property {number} bearBuyUsdc - BEAR bot fixed buy amount USDC (min 1)
 * @property {number} bearSellSol - BEAR bot fixed sell amount SOL (min 0.001)
 * @property {number} minSellNotionalMult - Floor SELL notional to minTradeUsdc * mult (0 = off)
 * @property {number} mockStartPrice - Starting SOL price for mock price source
 * @property {number} mockDriftBps - Drift per bar in bps for mock price
 * @property {number} mockVolBps - Volatility per bar in bps for mock price
 * @property {number} simStartUsdc - Starting USDC for simulated portfolio
 * @property {number} simStartSol - Starting SOL for simulated portfolio
 * @property {number} simFeeBps - Simulated fee in basis points
 * @property {number} simSlippageBps - Simulated slippage in basis points
 * @property {number} usdcReserve - USDC reserve for sweep logic
 * @property {number} usdcProfitMin - Minimum profit USDC to trigger sweep
 * @property {number} profitSweepPct - % of profit to sweep (0-1)
 * @property {number} sweepEverySec - Seconds between sweep checks (min 30)
 * @property {number} minSolForSweep - Minimum SOL to consider for sweep
 * @property {string} profitWallet - Destination wallet for profit sweeps
 * @property {boolean} runOnce - Run loop once and exit (for testing)
 * @property {string} priceMode - Price source mode ('auto', 'jupiter', 'mock', etc.)
 * @property {boolean} airdropOnWallet - Request airdrop on wallet creation (devnet)
 * @property {number} airdropSol - SOL amount for airdrop (min 0.1)
 * @property {string} solMint - SOL token mint address
 * @property {string} usdcMint - USDC token mint address
 * @property {boolean} shadowMode - Enable shadow mode (parallel simulated execution)
 * @property {boolean} shadowQuoteOnTrade - Fetch Jupiter quote before every trade for net-edge gate
 * @property {number} stalePriceSec - Seconds after which price cache is stale (min 10)
 * @property {string} alertWebhookUrl - Webhook URL for alerts
 * @property {boolean} alertOnTrade - Send alert on every trade
 * @property {boolean} alertOnError - Send alert on errors
 * @property {boolean} alertOnBreaker - Send alert on circuit breaker trigger
 * @property {number} bullBuyPctOfUsdc - BULL bot buys as % of available USDC in strong bull
 * @property {number} maxSlippageBps - Maximum acceptable slippage in bps for Jupiter quotes (min 10)
 * @property {number} priorityFeeLamports - Priority fee in lamports for real transactions
 * @property {number} realMaxTradesPerDay - Max trades per day in REAL mode (min 1)
 * @property {number} realMaxNotionalUsdc - Max per-trade notional in USDC for REAL mode (min 1, max 100)
 * @property {number} realDailyNotionalLimitUsdc - Daily notional limit for REAL mode (min 1, max 500)
 * @property {number} dailyLossLimitUsdc - Daily realized loss limit for circuit breaker (0 = disabled)
 * @property {string} privateKey - Base58/JSON private key for real execution
 */

/** @type {Config} */
export const CFG = {
  networkLabel:    process.env.NETWORK_LABEL || 'devnet',
  rpcUrl:          process.env.RPC_URL || 'https://api.devnet.solana.com',
  executionMode:   process.env.EXECUTION_MODE || 'simulated',
  dryRun:          bool('DRY_RUN', true),
  uiPort:          num('UI_PORT', 8787),
  loopSec:         Math.max(5,  num('LOOP_SEC', 15)),
  signalMinSec:    Math.max(5,  num('SIGNAL_MIN_SEC', 300)),
  cooldownSec:     Math.max(5,  num('COOLDOWN_SEC', 900)),
  decisionWindowSec: Math.max(10, num('DECISION_WINDOW_SEC', 60)),
  maxTradesPerDay: Math.max(1,  num('MAX_TRADES_PER_DAY', 8)),
  staleSignalSec:  Math.max(10, num('STALE_SIGNAL_SEC', 180)),
  minExpectedEdgeBps: Math.max(0, num('MIN_EXPECTED_EDGE_BPS', 20)),
  minNetEdgeBps:   num('MIN_NET_EDGE_BPS', 0),   // #3: refuse to trade when post-quote net edge (signal edge - price impact) falls below this (bps). 0 = block only negative net edge.
  minTradeUsdc:    Math.max(1,  num('MIN_TRADE_USDC', 10)),
  maxNotionalUsdc: Math.max(1,  num('MAX_NOTIONAL_USDC', 75)),
  dailyNotionalLimitUsdc: Math.max(1, num('DAILY_NOTIONAL_LIMIT_USDC', 400)),
  minSolReserve:   Math.max(0,  num('MIN_SOL_RESERVE', 0.05)),
  maxSolAllocationPct: Math.max(10, Math.min(100, num('MAX_SOL_ALLOCATION_PCT', 60))),
  trendFilterEnabled: bool('TREND_FILTER_ENABLED', true),
  emaPeriod:       Math.max(2,  num('EMA_PERIOD', 20)),
  regimeFilterEnabled: bool('REGIME_FILTER_ENABLED', true),
  regimeEmaSlow:   Math.max(5,  num('REGIME_EMA_SLOW', 50)),
  useAtrThresholds: bool('USE_ATR_THRESHOLDS', false),
  atrPeriod:       Math.max(2,  num('ATR_PERIOD', 14)),
  atrDipMult:      Math.max(0.1, num('ATR_DIP_MULT', 1.0)),
  atrRipMult:      Math.max(0.1, num('ATR_RIP_MULT', 0.7)),
  atrMinDipPct:    Math.max(0.01, num('ATR_MIN_DIP_PCT', 0.1)),
  atrMinRipPct:    Math.max(0.01, num('ATR_MIN_RIP_PCT', 0.1)),
  rsiEnabled:      bool('RSI_ENABLED', true),
  rsiPeriod:       Math.max(2,  num('RSI_PERIOD', 14)),
  rsiOversold:     Math.max(1,  Math.min(49, num('RSI_OVERSOLD', 40))),
  rsiOverbought:   Math.max(51, Math.min(99, num('RSI_OVERBOUGHT', 70))),
  profitTargetEnabled: bool("PROFIT_TARGET_ENABLED", true),
  profitTargetPct: Math.max(0.5, num("PROFIT_TARGET_PCT", 3.0)),
  profitTargetBypassCooldown: bool("PROFIT_TARGET_BYPASS_COOLDOWN", false),
  rsiScaleBuyEnabled: bool("RSI_SCALE_BUY_ENABLED", false),
  rsiScaleMaxMult: Math.max(1.0, num("RSI_SCALE_MAX_MULT", 2.0)),
  stopLossEnabled: bool('STOP_LOSS_ENABLED', true),
  stopLossPct:     Math.max(1,  num('STOP_LOSS_PCT', 12)),
  trailInUptrend:  bool('TRAIL_IN_UPTREND', true),
  trailArmPct:     Math.max(0.5, num('TRAIL_ARM_PCT', 2.0)),
  trailGivePct:    Math.max(0.2, num('TRAIL_GIVE_PCT', 10)),
  // Wealth-V2 sell-side fixes (gated on strong bull regime, regimeStrengthPct >= 7.0)
  bullTrailGivePct: Math.max(0.2, num('BULL_TRAIL_GIVE_PCT', 25)),   // Option C: wider trailing give-back in strong bull
  bullMinSolHold:   Math.max(0,   num('BULL_MIN_SOL_HOLD', 0)),    // Option B: core SOL floor held through the trend
  bullProportionalSells: bool('BULL_PROPORTIONAL_SELLS', false),       // Option A: rip-sell the amount last bought, not fixed sellSol
  bullStrongRegimePct: Math.max(0, num('BULL_STRONG_REGIME_PCT', 10)),  // regime-strength gate (%) above which the sell-side fixes activate
  bullMaxNotionalUsdc: Math.max(1, num('BULL_MAX_NOTIONAL_USDC', 8)),   // Wealth-V4: per-trade notional cap allowed ONLY in strong bull (sim/dry/shadow); REAL mode stays capped at realMaxNotionalUsdc
  intrabarStops:   bool('INTRABAR_STOPS', true),
  anchorCooldownBars: Math.max(0, num('ANCHOR_COOLDOWN_BARS', 2)),
  entryBounceConfirm: bool('ENTRY_BOUNCE_CONFIRM', false),
  conflictEdgeResolution: bool('CONFLICT_EDGE_RESOLUTION', false), // #3: on BULL/BEAR conflict, pick signal with larger |edgeBps| instead of NO_TRADE
  botSpecializationEnabled: bool('BOT_SPECIALIZATION_ENABLED', true),
  bearRsiMax:      Math.max(1, num('BEAR_RSI_MAX', 35)),
  bullRegimeThreshold: Math.max(0, num('BULL_REGIME_THRESHOLD', 7.0)),
  bullDipScale:    Math.max(1.0, num('BULL_DIP_SCALE', 3.0)),
  regimeSizeEnabled: bool('REGIME_SIZE_ENABLED', true),
  regimeSizeUpMult:  Math.max(1.0, num('REGIME_SIZE_UP_MULT', 2.0)),
  regimeSizeDownMult: Math.max(0.1, Math.min(1.0, num('REGIME_SIZE_DOWN_MULT', 0.75))),
  regimeSizeHighRsi: Math.max(50, num('REGIME_SIZE_HIGH_RSI', 100)),
  bullDipPct:      Math.max(0.01, num('BULL_DIP_PCT', 0.5)),
  bullRipPct:      Math.max(0.01, num('BULL_RIP_PCT', 1.5)),
  bullBuyUsdc:     Math.max(1,    num('BULL_BUY_USDC', 25)),
  bullSellSol:     Math.max(0.001, num('BULL_SELL_SOL', 0.15)),
  bearDipPct:      Math.max(0.01, num('BEAR_DIP_PCT', 1.5)),
  bearRipPct:      Math.max(0.01, num('BEAR_RIP_PCT', 0.5)),
  bearBuyUsdc:     Math.max(1,    num('BEAR_BUY_USDC', 15)),
  bearSellSol:     Math.max(0.001, num('BEAR_SELL_SOL', 0.15)),
  // Floor SELL sizes so notional >= minTradeUsdc*mult (0 = off). Fixes 0.01-SOL sells
  // being forever below MIN_TRADE_USDC at low SOL prices (found 2026-06-12: every live
  // sell signal was $0.67 and auto-skipped).
  minSellNotionalMult: Math.max(0, num('MIN_SELL_NOTIONAL_MULT', 0)),
  mockStartPrice:  Math.max(1,    num('MOCK_START_PRICE', 180)),
  mockDriftBps:    num('MOCK_DRIFT_BPS', 18),
  mockVolBps:      num('MOCK_VOL_BPS', 45),
  simStartUsdc:    Math.max(0,    num('SIM_START_USDC', 1000)),
  simStartSol:     Math.max(0,    num('SIM_START_SOL', 5)),
  simFeeBps:       Math.max(0,    num('SIM_FEE_BPS', 30)),
  simSlippageBps:  Math.max(0,    num('SIM_SLIPPAGE_BPS', 8)),
  usdcReserve:     Math.max(0,    num('USDC_RESERVE', 300)),
  usdcProfitMin:   Math.max(0,    num('USDC_PROFIT_MIN', 25)),
  profitSweepPct:  Math.max(0, Math.min(1, num('PROFIT_SWEEP_PCT', 0.5))),
  sweepEverySec:   Math.max(30,   num('SWEEP_EVERY_SEC', 600)),
  minSolForSweep:  Math.max(0,    num('MIN_SOL_FOR_SWEEP', 0.05)),
  profitWallet:    process.env.PROFIT_WALLET || '',
  runOnce:         bool('RUN_ONCE', false),
  priceMode:       process.env.PRICE_MODE || 'auto',
  airdropOnWallet: bool('AIRDROP_ON_WALLET', false),
  airdropSol:      Math.max(0.1,  num('AIRDROP_SOL', 1)),
  solMint:         process.env.SOL_MINT  || 'So11111111111111111111111111111111111111112',
  usdcMint:        process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  shadowMode:      bool('SHADOW_MODE', false),
  shadowQuoteOnTrade: bool('SHADOW_QUOTE_ON_TRADE', true),
  stalePriceSec:   Math.max(10,   num('STALE_PRICE_SEC', 60)),
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || '',
  alertOnTrade:    bool('ALERT_ON_TRADE', false),
  alertOnError:    bool('ALERT_ON_ERROR', false),
  alertOnBreaker:  bool('ALERT_ON_BREAKER', true),
  bullBuyPctOfUsdc: Math.max(0, num('BULL_BUY_PCT_OF_USDC', 0.15)),
  maxSlippageBps:  Math.max(10, num('MAX_SLIPPAGE_BPS', 100)),
  priorityFeeLamports: Math.max(0, num('PRIORITY_FEE_LAMPORTS', 5000)),
  realMaxTradesPerDay: Math.max(1, num('REAL_MAX_TRADES_PER_DAY', 5)),
  realMaxNotionalUsdc: Math.max(1, num('REAL_MAX_NOTIONAL_USDC', 25)),
  realDailyNotionalLimitUsdc: Math.max(1, num('REAL_DAILY_NOTIONAL_LIMIT_USDC', 50)),
  dailyLossLimitUsdc: Math.max(0, num('DAILY_LOSS_LIMIT_USDC', 3.0)),
  privateKey:      process.env.PRIVATE_KEY || '',
};

function validateConfig() {
  if (!CFG.rpcUrl.startsWith('http')) throw new Error('RPC_URL must start with http');
  const numericFields = [
    'loopSec','signalMinSec','cooldownSec','decisionWindowSec','maxTradesPerDay',
    'staleSignalSec','minExpectedEdgeBps','minTradeUsdc','maxNotionalUsdc',
    'dailyNotionalLimitUsdc','minSolReserve','bullDipPct','bullRipPct','bullBuyUsdc',
    'bullSellSol','bearDipPct','bearRipPct','bearBuyUsdc','bearSellSol','mockStartPrice',
    'mockDriftBps','mockVolBps','simStartUsdc','simStartSol','simFeeBps','simSlippageBps',
    'usdcReserve','usdcProfitMin','profitSweepPct','sweepEverySec','minSolForSweep',
    'stalePriceSec','realMaxTradesPerDay','realMaxNotionalUsdc','realDailyNotionalLimitUsdc',
  ];
  for (const field of numericFields) {
    if (!Number.isFinite(CFG[field])) throw new Error(`${field} must be a finite number`);
  }
  if (CFG.executionMode === 'real') {
    if (CFG.rpcUrl.includes('devnet')) throw new Error('RPC_URL must not contain devnet when executionMode is real');
    const hasKey = CFG.privateKey || fs.existsSync(path.join(STATE_DIR, 'generated-wallet.json'));
    if (!hasKey) throw new Error('Either PRIVATE_KEY env or state/generated-wallet.json must exist for real execution');
    if (CFG.realMaxNotionalUsdc > 100) throw new Error('realMaxNotionalUsdc must be <= 100 for real execution');
    if (CFG.realDailyNotionalLimitUsdc > 500) throw new Error('realDailyNotionalLimitUsdc must be <= 500 for real execution');
    if (!CFG.profitWallet || CFG.profitWallet.trim() === '') throw new Error('PROFIT_WALLET must be set for real execution');
  }
}

validateConfig();

// Daily-loss circuit breaker predicate (pure; shared by executor + selftest).
/**
 * Checks if the daily realized loss has exceeded the configured limit.
 * Pure function with no side effects — shared by executor (live) and selftest (backtest parity).
 * A limit of 0 or non-finite disables the breaker.
 * @param {number} realizedLossTodayUsdc - Accumulated realized loss today (positive number)
 * @param {number} [limit=CFG.dailyLossLimitUsdc] - Daily loss limit in USDC (0 = disabled)
 * @returns {boolean} True if the breaker should trip (halt all trading for the UTC day)
 */
export function circuitBreakerTripped(realizedLossTodayUsdc, limit = CFG.dailyLossLimitUsdc) {
  const loss = Number(realizedLossTodayUsdc) || 0;
  const cap  = Number(limit);
  if (!Number.isFinite(cap) || cap <= 0) return false; // 0/unset disables the breaker
  return loss >= cap;
}

// Single source of truth for the per-trade notional cap (Wealth-V4). Pure + testable.
/**
 * Returns the effective per-trade notional cap in USDC.
 * SAFETY INVARIANT: In REAL execution the cap is ALWAYS realMaxNotionalUsdc —
 * the strong-bull widening (bullMaxNotionalUsdc) can NEVER apply to real money,
 * regardless of regime strength.
 * Used by both executor.mjs (live) and backtest.mjs (sim) so the gate can't drift out of parity.
 * @param {Object} params
 * @param {boolean} params.isReal - True if running in REAL execution mode
 * @param {number} params.regimeStrengthPct - Current regime strength percentage (EMA fast vs slow spread)
 * @param {Config} [params.cfg=CFG] - Configuration object (allows injection for testing)
 * @returns {number} Maximum allowed notional for a single trade in USDC
 */
export function effectiveMaxNotionalUsdc({ isReal, regimeStrengthPct, cfg = CFG }) {
  if (isReal) return cfg.realMaxNotionalUsdc;            // real money: never widened, full stop
  const base = cfg.maxNotionalUsdc;
  const strongBull = Number(regimeStrengthPct) >= cfg.bullStrongRegimePct;
  return strongBull ? Math.max(base, cfg.bullMaxNotionalUsdc) : base;
}

/**
 * Ensures the log and state directories exist.
 * Called automatically by fileInState/fileInLogs/logJsonl/loadJson/saveJson.
 * @returns {void}
 */
export function ensureDirs() {
  for (const dir of [LOG_DIR, STATE_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Returns the absolute path to a file in the state directory.
 * @param {string} name - Filename
 * @returns {string} Absolute path (STATE_DIR/name)
 */
export function fileInState(name) { ensureDirs(); return path.join(STATE_DIR, name); }

/**
 * Returns the absolute path to a file in the logs directory.
 * @param {string} name - Filename
 * @returns {string} Absolute path (LOG_DIR/name)
 */
export function fileInLogs(name)  { ensureDirs(); return path.join(LOG_DIR,   name); }

/**
 * Appends a JSON object as a line to a JSONL log file in LOG_DIR.
 * Rotates the file if it exceeds 5MB (renames with timestamp suffix).
 * @param {string} file - Log filename (e.g., 'executor.jsonl')
 * @param {Object} obj - Object to serialize and append
 * @returns {void}
 */
export function logJsonl(file, obj) {
  ensureDirs();
  const filePath = fileInLogs(file);
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 5 * 1024 * 1024) {
    const date = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const rotated = path.join(path.dirname(filePath), path.basename(file).replace(/\.jsonl$/, `.${date}.jsonl`));
    fs.renameSync(filePath, rotated);
  }
  fs.appendFileSync(filePath, JSON.stringify(obj) + '\n');
}

/**
 * Loads and parses a JSON file from the state directory.
 * Returns fallback if file doesn't exist or contains invalid JSON.
 * @param {string} file - Filename in STATE_DIR
 * @param {any} fallback - Value to return on missing/invalid file
 * @returns {any} Parsed JSON or fallback
 */
export function loadJson(file, fallback) {
  const p = fileInState(file);
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

/**
 * Saves a value as pretty-printed JSON to a file in the state directory.
 * @param {string} file - Filename in STATE_DIR
 * @param {any} value - Value to serialize
 * @returns {void}
 */
export function saveJson(file, value) {
  fs.writeFileSync(fileInState(file), JSON.stringify(value, null, 2));
}

/**
 * Checks if the global disable file exists (ROOT/DISABLED).
 * When present, the executor skips all trading activity.
 * @returns {boolean} True if DISABLED file exists
 */
export function isDisabled() { return fs.existsSync(path.join(ROOT, 'DISABLED')); }

/**
 * Sleeps for the specified number of milliseconds.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>} Resolves after ms milliseconds
 */
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Runs an async tick function repeatedly at a fixed interval.
 * Exits early if CFG.runOnce is true (used for testing).
 * @param {Function} tick - Async function to call on each iteration
 * @param {number} intervalSec - Interval between ticks in seconds
 * @returns {Promise<void>} Never resolves unless CFG.runOnce is true
 */
export async function runLoop(tick, intervalSec) {
  while (true) {
    await tick();
    if (CFG.runOnce) return;
    await sleep(intervalSec * 1000);
  }
}

/**
 * Generates a deterministic 16-char signal ID from a signal object.
 * Uses SHA-256 hash of the JSON-serialized signal for consistency.
 * @param {Object} signal - Signal object to hash
 * @returns {string} 16-character hex string
 */
export function makeSignalId(signal) {
  return crypto.createHash('sha256').update(JSON.stringify(signal)).digest('hex').slice(0, 16);
}

/**
 * Returns the current decision window index based on timestamp.
 * Decision windows are fixed time buckets of CFG.decisionWindowSec seconds.
 * Used to enforce one-trade-per-window rule.
 * @param {number} [ts=Date.now()] - Timestamp in milliseconds
 * @returns {number} Window index (floor division)
 */
export function getDecisionWindow(ts = Date.now()) {
  return Math.floor(ts / (CFG.decisionWindowSec * 1000));
}

/**
 * Returns the current UTC day as YYYY-MM-DD string.
 * Used for daily counters reset (trades, notional, loss).
 * @returns {string} Current UTC date in ISO format (date portion only)
 */
export function freshDay() { return new Date().toISOString().slice(0, 10); }

/**
 * Loads the portfolio state from disk (state/portfolio.json).
 * In REAL mode with live execution (non-dry-run), fails CLOSED if the file exists
 * but cannot be parsed — silently resetting would wipe realizedPnlUsdc and blind
 * the daily-loss circuit breaker. In sim/dry-run modes, returns a safe fallback.
 * @returns {Object} Portfolio state
 * @property {string} portfolio.mode - Execution mode ('simulated'|'real')
 * @property {number} portfolio.usdc - USDC balance
 * @property {number} portfolio.sol - SOL balance
 * @property {number} portfolio.avgEntryPrice - Average entry price of SOL position
 * @property {number} portfolio.realizedPnlUsdc - Cumulative realized PnL in USDC
 * @property {number} portfolio.sweptUsdc - Total USDC swept to profit wallet
 * @property {string} portfolio.lastUpdatedAt - ISO timestamp of last update
 */
export function loadPortfolio() {
  const fallback = {
    mode: CFG.executionMode, usdc: CFG.simStartUsdc, sol: CFG.simStartSol,
    avgEntryPrice: 0, realizedPnlUsdc: 0, sweptUsdc: 0, lastUpdatedAt: NOW(),
  };
  // Fail CLOSED if a portfolio file exists but cannot be parsed while live:
  // silently resetting would wipe realizedPnlUsdc and blind the daily-loss circuit breaker.
  const p = fileInState('portfolio.json');
  if (fs.existsSync(p)) {
    try { return { ...fallback, ...JSON.parse(fs.readFileSync(p, 'utf8')) }; }
    catch (e) {
      if (CFG.executionMode === 'real' && !CFG.dryRun) {
        throw new Error(`portfolio.json exists but is corrupt — refusing to reset live PnL tracking (fix or restore state/portfolio.json): ${e.message}`);
      }
      return fallback;
    }
  }
  return fallback;
}

/**
 * Saves the portfolio state to disk (state/portfolio.json).
 * Updates the lastUpdatedAt timestamp to NOW().
 * @param {Object} portfolio - Portfolio state object
 * @returns {void}
 */
export function savePortfolio(portfolio) {
  saveJson('portfolio.json', { ...portfolio, lastUpdatedAt: NOW() });
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encodes a Uint8Array/Buffer to Base58 (Bitcoin alphabet, no 0/O/I/l).
 * Used for Solana address encoding (ed25519 public keys).
 * @param {Uint8Array|Buffer} buffer - Bytes to encode
 * @returns {string} Base58 encoded string
 */
export function base58Encode(buffer) {
  if (!buffer.length) return '';
  const digits = [0];
  for (const byte of buffer) {
    let carry = byte;
    for (let j = 0; j < digits.length; ++j) {
      const x = digits[j] * 256 + carry;
      digits[j] = x % 58;
      carry = Math.floor(x / 58);
    }
    while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let result = '';
  for (const byte of buffer) { if (byte === 0) result += '1'; else break; }
  for (let q = digits.length - 1; q >= 0; --q) result += ALPHABET[digits[q]];
  return result;
}

/**
 * Generates a new ed25519 keypair and returns a wallet record.
 * The address is derived from the SPKI public key (last 32 bytes, base58 encoded).
 * Private key is exported as PKCS#8 base64, public key as SPKI base64.
 * @returns {Object} Wallet record
 * @property {string} address - Base58 Solana address
 * @property {string} publicKeySpkiBase64 - SPKI public key in base64
 * @property {string} privateKeyPkcs8Base64 - PKCS#8 private key in base64
 * @property {string} createdAt - ISO timestamp
 */
export function generateWalletRecord() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spki  = publicKey.export({ format: 'der', type: 'spki' });
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  return {
    address:               base58Encode(spki.subarray(spki.length - 32)),
    publicKeySpkiBase64:   spki.toString('base64'),
    privateKeyPkcs8Base64: pkcs8.toString('base64'),
    createdAt:             NOW(),
  };
}

/**
 * Returns the absolute path to the generated wallet file (state/generated-wallet.json).
 * @returns {string} Absolute file path
 */
export function walletFilePath() { return fileInState('generated-wallet.json'); }

/**
 * Saves a wallet record to disk (state/generated-wallet.json).
 * @param {Object} record - Wallet record from generateWalletRecord()
 * @returns {void}
 */
export function saveGeneratedWallet(r) { fs.writeFileSync(walletFilePath(), JSON.stringify(r, null, 2)); }

/**
 * Loads the generated wallet from disk, optionally creating a new one if missing.
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.createIfMissing=false] - Generate new wallet if not found
 * @returns {Object} Wallet record
 * @throws {Error} If wallet not found and createIfMissing is false
 */
export function loadWallet({ createIfMissing = false } = {}) {
  const p = walletFilePath();
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!createIfMissing) throw new Error('No generated wallet found. Run: npm run wallet:new');
  const record = generateWalletRecord();
  saveGeneratedWallet(record);
  return record;
}

/**
 * Makes a JSON-RPC request with multi-RPC failover support.
 * Includes 15-second timeout, automatic failover on failure, and health tracking.
 * @param {string} method - RPC method name (e.g., 'getBalance', 'getAccountInfo')
 * @param {Array} [params=[]] - RPC parameters array
 * @returns {Promise<any>} RPC result field
 * @throws {Error} On all endpoints failing, HTTP error, RPC error, timeout, or parse failure
 */
export async function rpcRequest(method, params = []) {
  const maxRetries = RPC_ENDPOINTS.length;
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const url = getCurrentRpcUrl();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      if (!res.ok) throw new Error(`RPC HTTP ${res.status} ${res.statusText}`);
      const json = await res.json();
      if (json.error) throw new Error(`RPC ${method} error: ${JSON.stringify(json.error)}`);
      
      markRpcSuccess(url);
      return json.result;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        lastError = new Error(`RPC ${method} timed out after 15s`);
      } else {
        lastError = error;
      }
      
      markRpcFailure(url, lastError);
      
      // If there are more endpoints to try, failover and continue
      if (attempt < maxRetries - 1) {
        console.warn(`[RPC] Attempt ${attempt + 1}/${maxRetries} failed for ${method}: ${lastError.message}. Trying next endpoint...`);
        continue;
      }
    }
  }
  
  // All endpoints failed
  throw lastError || new Error(`RPC ${method}: All ${maxRetries} endpoints failed`);
}

/**
 * Queries the SOL balance of a Solana address via RPC.
 * Returns 0 on any error (network, parse, etc.) — never throws.
 * @param {string} address - Base58 Solana address
 * @returns {Promise<number>} Balance in SOL (lamports / 1e9)
 */
export async function getWalletBalance(address) {
  try {
    const result = await rpcRequest('getBalance', [address]);
    return Number(result?.value || 0) / 1_000_000_000;
  } catch { return 0; }
}

/**
 * Requests a SOL airdrop to the given address (devnet/testnet only).
 * @param {string} address - Base58 Solana address
 * @param {number} solAmount - Amount in SOL
 * @returns {Promise<string>} Transaction signature
 */
export async function requestAirdrop(address, solAmount) {
  return rpcRequest('requestAirdrop', [address, Math.floor(solAmount * 1_000_000_000)]);
}

/**
 * Acquires a file-based mutex lock and executes the provided async function.
 * Implements stale-lock detection and automatic recovery (locks older than
 * max(loopSec * 4000, 120000) ms are considered abandoned).
 * Lock release never throws — on Windows/filesystem issues, unlink errors are
 * swallowed and stale-detection reclaims the lock later.
 * @param {string} lockName - Name of the lock file (without extension)
 * @param {Function} fn - Async function to execute while holding the lock
 * @returns {Promise<{locked: boolean} | any>} Result of fn(), or {locked: false} if lock couldn't be acquired
 */
export async function withLock(lockName, fn) {
  ensureDirs();
  const lockPath = fileInState(lockName);
  const staleMs  = Math.max(CFG.loopSec * 4000, 120000);
  // Releasing the lock must never throw: on some filesystems (Windows AV / OneDrive sync /
  // restricted mounts) unlink can fail with EPERM. A throw in finally would mask fn()'s result
  // and crash the loop; instead we swallow it and let stale-detection reclaim the lock later.
  const releaseLock = () => { try { fs.rmSync(lockPath, { force: true }); } catch { /* unlink blocked; stale-detection reclaims */ } };
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: NOW() }));
    fs.closeSync(fd);
  } catch {
    if (fs.existsSync(lockPath)) {
      const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (ageMs > staleMs) {
        try { fs.rmSync(lockPath, { force: true }); } catch { return { locked: false }; }
        return withLock(lockName, fn);
      }
    }
    return { locked: false };
  }
  try { return await fn(); }
  finally { releaseLock(); }
}

/**
 * Fetches JSON from a URL with timeout and abort support.
 * @param {string} url - URL to fetch
 * @param {Object} [options={}] - Fetch options (headers, method, etc.)
 * @param {number} [options.timeoutMs=15000] - Request timeout in milliseconds
 * @returns {Promise<any>} Parsed JSON response
 * @throws {Error} On HTTP error, timeout, or parse failure
 */
export async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}: ${text.slice(0, 250)}`);
    }
    return res.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error(`Request to ${url} timed out`);
    throw error;
  }
}

/**
 * Safely reads and parses a JSON file, returning a fallback on any error.
 * Never throws — returns fallback if file doesn't exist, is empty, or contains invalid JSON.
 * @param {string} filePath - Absolute path to the JSON file
 * @param {any} [fallback=null] - Value to return on error/missing file
 * @returns {any} Parsed JSON or fallback
 */
export function safeReadJsonFile(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}
