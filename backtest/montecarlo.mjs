#!/usr/bin/env node
// Monte-Carlo regime stress test.
// We have only one real bear path. To check that the strategy generalizes to regimes
// absent from our sample (bull, sideways), we generate many synthetic OHLC paths per
// regime with a seeded RNG and compare LEGACY (fixed 2% cap) vs NEW (regime-conditional
// trail + intrabar stops + anchor cooldown + bot specialization) on identical paths.
//
// This is not "proof by history" (impossible without real bull data) — it is a
// structural robustness test: does the new exit logic capture trend upside that the
// fixed cap leaves on the table, without breaking the downside?

import { runBacktest, paramsFromCfg } from '../src/backtest.mjs';
import { CFG } from '../src/common.mjs';

// ---- seeded RNG (mulberry32) ----
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) { // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Generate `days` daily OHLC candles. dailyDriftPct = mean daily log return (%),
// dailyVolPct = daily vol (%), intradayPct = typical wick size (%).
function genPath(seed, days, startPrice, dailyDriftPct, dailyVolPct, intradayPct) {
  const r = rng(seed);
  const out = [];
  let close = startPrice;
  let t = Math.floor(Date.UTC(2023, 0, 1) / 1000);
  for (let i = 0; i < days; i++) {
    const open = close;
    const ret = (dailyDriftPct / 100) + (dailyVolPct / 100) * gauss(r);
    close = Math.max(0.5, open * (1 + ret));
    const hi = Math.max(open, close) * (1 + Math.abs(gauss(r)) * intradayPct / 100);
    const lo = Math.min(open, close) * (1 - Math.abs(gauss(r)) * intradayPct / 100);
    // data format: [timeSec, low, high, open, close, vol]
    out.push([t, lo, hi, open, close, 1000]);
    t += 86400;
  }
  return out;
}

// loadSeries-equivalent (avoid file IO): map raw OHLC to {t,price,high,low}
function toSeries(rows) {
  return rows.map(r => ({ t: r[0] * 1000, price: r[4], high: r[2], low: r[1] }));
}

const CHAMP = {
  BULL_DIP_PCT: 0.5, BULL_RIP_PCT: 3.0, BEAR_DIP_PCT: 0.8, BEAR_RIP_PCT: 2.1,
  EMA_PERIOD: 20, REGIME_EMA_SLOW: 50, RSI_OVERSOLD: 40,
  PROFIT_TARGET_PCT: 2.0, STOP_LOSS_PCT: 8, MIN_EXPECTED_EDGE_BPS: 5,
};
function paramsWith(overrides) {
  const saved = {};
  for (const k of Object.keys(overrides)) { saved[k] = process.env[k]; process.env[k] = String(overrides[k]); }
  // rebuild a CFG-like object by re-reading env through the same coercion CFG uses
  // simplest: mutate a clone of CFG with the champion + feature flags
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  return overrides;
}

// Build param objects directly (don't rely on env round-trip): start from champion CFG.
function baseParams() {
  const p = paramsFromCfg(CFG);
  p.bullDipPct = 0.5; p.bullRipPct = 3.0; p.bearDipPct = 0.8; p.bearRipPct = 2.1;
  p.emaPeriod = 20; p.regimeEmaSlow = 50; p.rsiOversold = 40;
  p.profitTargetPct = 2.0; p.stopLossPct = 8; p.minExpectedEdgeBps = 5;
  // recompute EMA arrays depend on emaPeriod/regimeEmaSlow inside runBacktest — fine.
  return p;
}
const LEGACY = () => {
  const p = baseParams();
  p.trailInUptrend = false; p.intrabarStops = false; p.anchorCooldownBars = 0;
  p.botSpecializationEnabled = false;
  return p;
};
const NEW = () => {
  const p = baseParams();
  p.trailInUptrend = true; p.trailArmPct = 2.0; p.trailGivePct = 12;
  p.intrabarStops = true; p.anchorCooldownBars = 2;
  p.botSpecializationEnabled = true; p.bearRsiMax = 35;
  return p;
};

const regimes = [
  // name, days, drift%/day, vol%/day, intraday%   (calibrated to SOL-like behavior)
  ['STRONG BULL  (~+0.9%/d)', 180, 0.9, 4.5, 3.0],
  ['STEADY BULL  (~+0.4%/d)', 180, 0.4, 3.5, 2.5],
  ['SIDEWAYS CHOP (~0%/d)',   180, 0.0, 3.5, 2.5],
  ['MILD BEAR    (~-0.3%/d)', 180, -0.3, 4.0, 3.0],
  ['CRASH BEAR   (~-0.6%/d)', 180, -0.6, 5.5, 4.0],
];

const PATHS = 40;
console.log(`Monte-Carlo regime test — ${PATHS} paths each, start $100, 180 days`);
console.log('Each cell = mean strategy return % (and mean vs buy&hold %) across paths\n');
console.log('Regime'.padEnd(26) + 'LEGACY ret  (vsHold)   NEW ret   (vsHold)   NEW-LEGACY   hold%');
console.log('-'.repeat(94));

let aggLegacy = 0, aggNew = 0, n = 0;
for (const [name, days, drift, vol, intra] of regimes) {
  let lSum = 0, lVs = 0, nSum = 0, nVs = 0, holdSum = 0;
  for (let s = 1; s <= PATHS; s++) {
    const rows = genPath(s * 7919 + days, days, 100, drift, vol, intra);
    const series = toSeries(rows);
    const mL = runBacktest(series, LEGACY());
    const mN = runBacktest(series, NEW());
    lSum += mL.returnPct; lVs += mL.vsHoldMixPct;
    nSum += mN.returnPct; nVs += mN.vsHoldMixPct;
    holdSum += mL.holdMixReturnPct;
  }
  const lAvg = lSum / PATHS, nAvg = nSum / PATHS;
  const lVsAvg = lVs / PATHS, nVsAvg = nVs / PATHS, holdAvg = holdSum / PATHS;
  aggLegacy += lAvg; aggNew += nAvg; n++;
  const f = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
  console.log(
    name.padEnd(26) +
    `${f(lAvg).padStart(7)}  (${f(lVsAvg).padStart(6)})  ` +
    `${f(nAvg).padStart(7)}  (${f(nVsAvg).padStart(6)})  ` +
    `${f(nAvg - lAvg).padStart(8)}   ${f(holdAvg).padStart(7)}`
  );
}
console.log('-'.repeat(94));
console.log(`MEAN across regimes:`.padEnd(26) + `${(aggLegacy/n>=0?'+':'')+(aggLegacy/n).toFixed(2)}%`.padStart(7) + `              ${(aggNew/n>=0?'+':'')+(aggNew/n).toFixed(2)}%`.padStart(7) + `       ${((aggNew-aggLegacy)/n>=0?'+':'')+((aggNew-aggLegacy)/n).toFixed(2)}pp`);
