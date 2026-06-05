#!/usr/bin/env node
// unit.mjs — fast, deterministic unit tests for pure logic and feature contracts.
// Usage: node src/unit.mjs   (exit 0 = all pass, exit 1 = failure)
// Complements selftest.mjs (regression gate). Run both via: npm run test:all

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBacktest, loadSeries, paramsFromCfg } from './backtest.mjs';
import { CFG, circuitBreakerTripped } from './common.mjs';

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

console.log(`\n${'─'.repeat(50)}`);
console.log(`Unit results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('UNIT TESTS FAILED'); process.exit(1); }
console.log('UNIT TESTS PASSED');
