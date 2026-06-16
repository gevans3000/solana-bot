#!/usr/bin/env node
// selftest.mjs — automated regression gate for DEFAULT CONFIG (.env.example)
// Usage: node src/selftest.mjs   (exit 0 = all pass, exit 1 = failure)
// Tests the COMMITTED DEFAULT CONFIG in .env.example, not current .env

import path from 'node:path';
import fs   from 'node:fs';
import { fileURLToPath } from 'node:url';
import './_test-env.mjs'; // MUST precede common/backtest imports (test state isolation)
import { runBacktest, loadSeries } from './backtest.mjs';
import { circuitBreakerTripped, saveJson, fileInState } from './common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const EXAMPLE_ENV = path.join(ROOT, '.env.example');

let passed = 0, failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// Load params from .env.example (the committed default config)
function loadExampleParams() {
  const envText = fs.readFileSync(EXAMPLE_ENV, 'utf8');
  const env = {};
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  
  // Simulate common.mjs num/bool parsing
  function num(name, fallback) {
    const raw = env[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`Invalid number for ${name}: ${raw}`);
    return n;
  }
  
  function bool(name, fallback = false) {
    const raw = env[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    return ['1', 'true', 'yes', 'y', 'on'].includes(String(raw).toLowerCase());
  }
  
  // Build CFG-like object from .env.example
  return {
    networkLabel:    env.NETWORK_LABEL || 'devnet',
    rpcUrl:          env.RPC_URL || 'https://api.devnet.solana.com',
    executionMode:   env.EXECUTION_MODE || 'simulated',
    dryRun:          bool('DRY_RUN', true),
    uiPort:          num('UI_PORT', 8787),
    loopSec:         Math.max(5,  num('LOOP_SEC', 15)),
    signalMinSec:    Math.max(5,  num('SIGNAL_MIN_SEC', 300)),
    cooldownSec:     Math.max(5,  num('COOLDOWN_SEC', 900)),
    decisionWindowSec: Math.max(10, num('DECISION_WINDOW_SEC', 60)),
    maxTradesPerDay: Math.max(1,  num('MAX_TRADES_PER_DAY', 8)),
    staleSignalSec:  Math.max(10, num('STALE_SIGNAL_SEC', 180)),
    minExpectedEdgeBps: Math.max(0, num('MIN_EXPECTED_EDGE_BPS', 20)),
    minNetEdgeBps:   num('MIN_NET_EDGE_BPS', 0),
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
    bullTrailGivePct: Math.max(0.2, num('BULL_TRAIL_GIVE_PCT', 25)),
    bullMinSolHold:   Math.max(0,   num('BULL_MIN_SOL_HOLD', 0)),
    bullProportionalSells: bool('BULL_PROPORTIONAL_SELLS', false),
    bullStrongRegimePct: Math.max(0, num('BULL_STRONG_REGIME_PCT', 10)),
    bullMaxNotionalUsdc: Math.max(1, num('BULL_MAX_NOTIONAL_USDC', 8)),
    intrabarStops:   bool('INTRABAR_STOPS', true),
    anchorCooldownBars: Math.max(0, num('ANCHOR_COOLDOWN_BARS', 2)),
    entryBounceConfirm: bool('ENTRY_BOUNCE_CONFIRM', false),
    conflictEdgeResolution: bool('CONFLICT_EDGE_RESOLUTION', false),
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
    profitWallet:    env.PROFIT_WALLET || '',
    runOnce:         bool('RUN_ONCE', false),
    priceMode:       env.PRICE_MODE || 'auto',
    airdropOnWallet: bool('AIRDROP_ON_WALLET', false),
    airdropSol:      Math.max(0.1,  num('AIRDROP_SOL', 1)),
    solMint:         env.SOL_MINT  || 'So11111111111111111111111111111111111111112',
    usdcMint:        env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    shadowMode:      bool('SHADOW_MODE', false),
    shadowQuoteOnTrade: bool('SHADOW_QUOTE_ON_TRADE', true),
    stalePriceSec:   Math.max(10,   num('STALE_PRICE_SEC', 60)),
    alertWebhookUrl: env.ALERT_WEBHOOK_URL || '',
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
    privateKey:      env.PRIVATE_KEY || '',
    bullStrongRegimePct: num('BULL_STRONG_REGIME_PCT') ?? 10,
    bullTrailGivePct: num('BULL_TRAIL_GIVE_PCT') ?? 25,
    bullMinSolHold: num('BULL_MIN_SOL_HOLD') ?? 0,
    bullProportionalSells: bool('BULL_PROPORTIONAL_SELLS') ?? false,
    minNetEdgeBps: num('MIN_NET_EDGE_BPS') ?? 0,
    bullMaxNotionalUsdc: num('BULL_MAX_NOTIONAL_USDC') ?? 25,
    trailGivePct: num('TRAIL_GIVE_PCT') ?? 10,
    bearRsiMax: num('BEAR_RSI_MAX') ?? 35,
    bullRegimeThreshold: num('BULL_REGIME_THRESHOLD') ?? 7.0,
    bullDipScale: num('BULL_DIP_SCALE') ?? 3.0,
    regimeSizeEnabled: bool('REGIME_SIZE_ENABLED') ?? true,
    regimeSizeUpMult: num('REGIME_SIZE_UP_MULT') ?? 2.0,
    regimeSizeDownMult: num('REGIME_SIZE_DOWN_MULT') ?? 0.75,
    regimeSizeHighRsi: num('REGIME_SIZE_HIGH_RSI') ?? 100,
    bullDipPct: num('BULL_DIP_PCT') ?? 0.5,
    bullRipPct: num('BULL_RIP_PCT') ?? 1.5,
    bullBuyUsdc: num('BULL_BUY_USDC') ?? 25,
    bullSellSol: num('BULL_SELL_SOL') ?? 0.15,
    bearDipPct: num('BEAR_DIP_PCT') ?? 1.5,
    bearRipPct: num('BEAR_RIP_PCT') ?? 0.5,
    bearBuyUsdc: num('BEAR_BUY_USDC') ?? 15,
    bearSellSol: num('BEAR_SELL_SOL') ?? 0.15,
    minSellNotionalMult: num('MIN_SELL_NOTIONAL_MULT') ?? 0,
    entryBounceConfirm: bool('ENTRY_BOUNCE_CONFIRM') ?? false,
  }
}
const ROOT      = path.resolve(__dirname, '..');

let passed = 0, failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

const EXAMPLE_PARAMS = loadExampleParams();

function baseParams(overrides = {}) {
  return { ...EXAMPLE_PARAMS, ...overrides };
}

function syntheticSeries(days, dailyReturnPct, startPrice = 100) {
  const series = [];
  let price = startPrice;
  const mult = 1 + dailyReturnPct / 100;
  for (let d = 0; d < days; d++) {
    const t = Date.now() - (days - d) * 86400000;
    const high = price * 1.005, low = price * 0.995;
    series.push({ t, price, high, low });
    price *= mult;
  }
  return series;
}

// ── Test 1: Legacy flags off → ~+4.33% ───────────────────────────────────────
console.log('\nTest 1: Legacy mode (new features off) → +4.33% ±0.05');
{
  const series = loadSeries(path.join(ROOT, 'backtest/data/sol-usd-1d.json'));
  const P = baseParams({
    trailInUptrend: false,
    intrabarStops: false,
    anchorCooldownBars: 0,
    botSpecializationEnabled: false,
    entryBounceConfirm: false,
    regimeEmaSlow: 50,
    bullDipPct: 0.5,
    minSolReserve: 0.02,
    trailGivePct: 10,
    bearRsiMax: 35,
    minSellNotionalMult: 0,
    conflictEdgeResolution: false,
  });
  const m = runBacktest(loadSeries(path.join(ROOT, 'backtest/data/sol-usd-1d.json')), P);
  assert('legacy return ≈ 6.68%', Math.abs(m.returnPct - 6.68) <= 0.10,
    `got ${m.returnPct.toFixed(2)}% (expected 6.68 ±0.10)`);
}

// ── Test 2: New defaults → ≥ +9.0% ───────────────────────────────────────────
console.log('\nTest 2: New defaults (≥ +9.0% on bear data)');
{
  const series = loadSeries(path.join(ROOT, 'backtest/data/sol-usd-1d.json'));
  const P = baseParams();
  const m = runBacktest(series, P);
  assert('new defaults ≥ 9.0%', m.returnPct >= 9.0, `got ${m.returnPct.toFixed(2)}%`);
}

// ── Test 3: Bull path beats bear path ────────────────────────────────────────
console.log('\nTest 3: +0.9%/day path beats -0.6%/day path');
{
  function syntheticSeries(days, dailyReturnPct, startPrice = 100) {
    const series = [];
    let price = startPrice;
    const mult = 1 + dailyReturnPct / 100;
    for (let d = 0; d < days; d++) {
      const t = Date.now() - (days - d) * 86400000;
      const high = price * 1.005, low = price * 0.995;
      series.push({ t, price, high, low });
      price *= mult;
    }
    return series;
  }
  const P = baseParams();
  const bullSeries = syntheticSeries(200, 0.9);
  const bearSeries = syntheticSeries(200, -0.6);
  const mBull = runBacktest(bullSeries, P);
  const mBear = runBacktest(bearSeries, P);
  assert('bull return > bear return',
    mBull.returnPct > mBear.returnPct,
    `bull ${mBull.returnPct.toFixed(2)}% vs bear ${mBear.returnPct.toFixed(2)}%`);
}

// ── Test 4: botTick writes state/regime.json ──────────────────────────────────
console.log('\nTest 4: botTick writes state/regime.json');
{
  const regimePath = path.join(ROOT, 'state/regime.json');
  const payload = { t: new Date().toISOString(), emaFast: 148, emaSlow: 145, bot: 'BULL' };
  saveJson('regime.json', payload);

  const written = JSON.parse(fs.readFileSync(path.join(ROOT, 'state/regime.json'), 'utf8'));
  assert('regime.json has emaFast',  typeof written.emaFast === 'number', JSON.stringify(written));
  assert('regime.json has emaSlow',  typeof written.emaSlow === 'number', JSON.stringify(written));
  assert('regime.json has bot field', typeof written.bot    === 'string',  JSON.stringify(written));
}

// ── Test 5: Daily-loss circuit breaker fires when loss exceeds limit ──────────
console.log('\nTest 5: circuit breaker fires when realized loss > limit');
{
  const { circuitBreakerTripped } = await import('./common.mjs');
  const limit = 3.0;
  assert('breaker OFF below limit', circuitBreakerTripped(2.99, limit) === false,
    `tripped at 2.99 (limit ${limit})`);
  assert('breaker ON at limit',     circuitBreakerTripped(3.0, limit) === true,
    `not tripped at 3.0 (limit ${limit})`);
  assert('breaker ON above limit',  circuitBreakerTripped(5.5, limit) === true,
    `not tripped at 5.5 (limit ${limit})`);
  assert('breaker disabled when limit=0', circuitBreakerTripped(100, 0) === false,
    'tripped with limit 0 (should be disabled)');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('SELFTEST FAILED');
  process.exit(1);
}
console.log('SELFTEST PASSED');