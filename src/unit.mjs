#!/usr/bin/env node
// unit.mjs — fast, deterministic unit tests for pure logic and feature contracts.
// Usage: node src/unit.mjs   (exit 0 = all pass, exit 1 = failure)
// Complements selftest.mjs (regression gate). Run both via: npm run test:all

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './_test-env.mjs'; // MUST precede common/backtest imports (test state isolation)
import { runBacktest, loadSeries, paramsFromCfg } from './backtest.mjs';
import { CFG, circuitBreakerTripped, effectiveMaxNotionalUsdc, loadPortfolio, fileInState } from './common.mjs';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0;
function assert(name, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); passed++; }
  else { console.error(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

// helper: synthetic constant-growth candle series
function trend(days, dailyPct, start = 100) {
  const out = []; let p = start; const m = 1 + dailyPct / 100;
  for (let d = 0; d < days; d++) {
    out.push({ t: Date.now() - (days - d) * 86400000, price: p, high: p * 1.005, low: p * 0.995 });
    p *= m;
  }
  return out;
}
const regimeStrength = (fast, slow) => ((fast - slow) / slow) * 100;

// ── Group 1: circuit-breaker predicate (pure) ────────────────────────────────
console.log('\nUnit 1: circuitBreakerTripped boundaries');
assert('below limit → false', circuitBreakerTripped(2.99, 3) === false);
assert('exactly at limit → true', circuitBreakerTripped(3, 3) === true);
assert('above limit → true', circuitBreakerTripped(10, 3) === true);
assert('limit 0 disables', circuitBreakerTripped(999, 0) === false);
assert('negative/undefined loss → false', circuitBreakerTripped(undefined, 3) === false);

// ── Group 2: regimeStrength formula ──────────────────────────────────────────
console.log('\nUnit 2: regimeStrength formula');
assert('flat EMAs → 0%', regimeStrength(100, 100) === 0);
assert('fast 10% above slow → +10%', Math.abs(regimeStrength(110, 100) - 10) < 1e-9);
assert('fast below slow → negative', regimeStrength(95, 100) < 0);

// ── Group 3: determinism (same input → same output) ──────────────────────────
console.log('\nUnit 3: runBacktest determinism');
{
  const P = paramsFromCfg(CFG);
  const s = trend(120, 0.5);
  const a = runBacktest(s, P).returnPct, b = runBacktest(s, P).returnPct;
  assert('two identical runs match exactly', a === b, `${a} vs ${b}`);
}

// ── Group 4: Task 1 contract — bull overlay helps in a strong uptrend ─────────
console.log('\nUnit 4: bull-regime overlay raises return in strong uptrend');
{
  const base = paramsFromCfg(CFG);
  const bull = trend(180, 0.9); // strong sustained uptrend
  const on  = runBacktest(bull, { ...base, botSpecializationEnabled: true }).returnPct;
  const off = runBacktest(bull, { ...base, botSpecializationEnabled: false }).returnPct;
  assert('overlay ON ≥ OFF in strong bull', on >= off, `on ${on.toFixed(2)} vs off ${off.toFixed(2)}`);
}

// ── Group 5: Task 4 contract — regime sizing preserves the bear floor ─────────
console.log('\nUnit 5: regime sizing keeps real bear baseline ≥ 8.5%');
{
  const base = paramsFromCfg(CFG);
  const bear = loadSeries(path.join(ROOT, 'backtest/data/sol-usd-1d.json'));
  const withSizing = runBacktest(bear, { ...base, regimeSizeEnabled: true }).returnPct;
  assert('bear ≥ 8.5% with sizing on', withSizing >= 8.5, `got ${withSizing.toFixed(2)}%`);
}

// ── Group 6: effectiveMaxNotionalUsdc — Wealth-V4 gated cap + REAL-money safety ────────────────
console.log('\nUnit 6: effectiveMaxNotionalUsdc gate + real-money safety invariant');
{
  const cfg = { realMaxNotionalUsdc: 25, maxNotionalUsdc: 8, bullStrongRegimePct: 10, bullMaxNotionalUsdc: 30 };
  const f = (isReal, rs) => effectiveMaxNotionalUsdc({ isReal, regimeStrengthPct: rs, cfg });
  // SAFETY INVARIANT: real mode is NEVER widened, no matter how strong the regime or how big bullMax.
  assert('REAL + extreme regime → realMaxNotionalUsdc (never widened)', f(true, 99999) === 25, `got ${f(true,99999)}`);
  assert('REAL + weak regime → realMaxNotionalUsdc', f(true, 0) === 25, `got ${f(true,0)}`);
  assert('REAL ignores huge bullMax', effectiveMaxNotionalUsdc({ isReal: true, regimeStrengthPct: 99999, cfg: { ...cfg, bullMaxNotionalUsdc: 1e9 } }) === 25);
  // SIM/dry/shadow gating
  assert('SIM + weak regime → base cap', f(false, 9.99) === 8, `got ${f(false,9.99)}`);
  assert('SIM + at-threshold regime → widened', f(false, 10) === 30, `got ${f(false,10)}`);
  assert('SIM + strong regime → widened', f(false, 50) === 30, `got ${f(false,50)}`);
  assert('SIM widening never shrinks below base', effectiveMaxNotionalUsdc({ isReal: false, regimeStrengthPct: 50, cfg: { ...cfg, bullMaxNotionalUsdc: 3 } }) === 8);
  // edge: missing/NaN regime (e.g. regime.json absent at boot) must NOT widen — defaults to base
  assert('SIM + NaN regime → base cap (no widen)', f(false, NaN) === 8, `got ${f(false, NaN)}`);
  assert('SIM + undefined regime → base cap', effectiveMaxNotionalUsdc({ isReal: false, regimeStrengthPct: undefined, cfg }) === 8);
  // live CFG sanity: real cap stays within the hard ceiling
  assert('CFG.realMaxNotionalUsdc ≤ 100 (hard ceiling)', CFG.realMaxNotionalUsdc <= 100, `got ${CFG.realMaxNotionalUsdc}`);
}

console.log(`\n${'─'.repeat(50)}`);
// ── Group N: loadPortfolio corrupt-file handling ─────────────────────────────
console.log('\nUnit: loadPortfolio corrupt portfolio.json');
{
  const pf = fileInState('portfolio.json');
  fs.writeFileSync(pf, '{ this is not json');
  // not live (test env inherits dryRun/sim semantics) → falls back, no throw
  let fellBack = false;
  try { const port = loadPortfolio(); fellBack = port.usdc === CFG.simStartUsdc; }
  catch { fellBack = false; }
  const live = CFG.executionMode === 'real' && !CFG.dryRun;
  if (live) {
    let threw = false;
    try { loadPortfolio(); } catch { threw = true; }
    assert('corrupt portfolio.json throws when LIVE (fail-closed)', threw);
  } else {
    assert('corrupt portfolio.json falls back when not live', fellBack);
  }
  // valid file still merges over fallback
  fs.writeFileSync(pf, JSON.stringify({ usdc: 42.5, sol: 1.25 }));
  const merged = loadPortfolio();
  assert('valid portfolio.json merges over fallback', merged.usdc === 42.5 && merged.sol === 1.25);
  fs.rmSync(pf, { force: true });
}

console.log(`Unit results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('UNIT TESTS FAILED'); process.exit(1); }
console.log('UNIT TESTS PASSED');
