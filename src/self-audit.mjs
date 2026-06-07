#!/usr/bin/env node
// self-audit.mjs — autonomous strategy self-improvement loop.
//
// Each run: (optionally) refresh data, grid-search the SAFE tuning knobs, and
// compare the best candidate against the live config across every dataset.
// Policy (chosen by the operator):
//   * Auto-apply a candidate ONLY if ALL hold:
//       - bear baseline (sol-usd-1d) stays >= BEAR_FLOOR (9.0%, matches selftest)
//       - mean upside return improves by >= MIN_GAIN_PP
//       - `npm test` stays green after the change
//       - the bot is NOT currently live (EXECUTION_MODE=real AND DRY_RUN=0)
//   * Otherwise: report only (recommend), never touching the running bot.
//
// Only tunes knobs gated on bot specialization (BULL_REGIME_THRESHOLD,
// REGIME_SIZE_UP_MULT, REGIME_SIZE_DOWN_MULT) so the legacy regression test and
// the proven dip/rip core are never disturbed.
//
// Flags: --report-only (never write/commit)  --no-fetch (skip data refresh)
// Usage: node src/self-audit.mjs [--report-only] [--no-fetch]

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runBacktest, loadSeries, paramsFromCfg } from './backtest.mjs';
import { CFG } from './common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'backtest', 'data');
const REPORT_DIR = path.join(ROOT, 'logs', 'self-audit');
const TUNING_LOG = path.join(ROOT, 'TUNING-LOG.md');

const BEAR_FILE = 'sol-usd-1d.json';
const HONEST_FILE = 'sol-usd-1h-540d.json'; // must not regress; primary live-expectation guard
// Intraday files whose mean must not regress (daily-candle dominance guard)
const INTRADAY_FILES = ['sol-usd-1h-540d.json', 'sol-usd-15m-60d.json', 'sol-usd-5m-30d.json', 'sol-usd-1m-7d.json'];
const BEAR_FLOOR = 9.0;     // must stay >= this (also what selftest enforces)
const MIN_GAIN_PP = 0.5;    // min mean-upside improvement to act on

const args = process.argv.slice(2);
const REPORT_ONLY = args.includes('--report-only');
const NO_FETCH = args.includes('--no-fetch');
const nowIso = new Date().toISOString();
const day = nowIso.slice(0, 10);

function log(...a) { console.log(...a); }

// ---- optional data refresh (best-effort) ------------------------------------
if (!NO_FETCH && !REPORT_ONLY) {
  try {
    log('Refreshing market data...');
    execSync('node backtest/fetch-data.mjs', { cwd: ROOT, stdio: 'pipe', timeout: 120000 });
    log('  data refresh OK');
  } catch (e) {
    log('  data refresh skipped (', String(e.message || e).slice(0, 80), ')');
  }
}

// ---- load datasets ----------------------------------------------------------
const files = fs.existsSync(DATA_DIR)
  ? fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')) : [];
const series = {};
for (const f of files) {
  try { const s = loadSeries(path.join(DATA_DIR, f)); if (s.length >= 50) series[f] = s; }
  catch {}
}
if (!series[BEAR_FILE]) { console.error('No bear dataset; aborting.'); process.exit(1); }
const upsideFiles = Object.keys(series).filter(f => f !== BEAR_FILE && f !== 'sol-usd-1m.json');

function evalParams(P) {
  const out = {};
  for (const [f, s] of Object.entries(series)) out[f] = runBacktest(s, P).returnPct;
  return out;
}
const meanUpside = (m) => upsideFiles.length
  ? upsideFiles.reduce((a, f) => a + (m[f] ?? 0), 0) / upsideFiles.length : 0;

// ---- baseline ---------------------------------------------------------------
const base = paramsFromCfg(CFG);
const baseM = evalParams(base);
const baseBear = baseM[BEAR_FILE];
const baseUp = meanUpside(baseM);
const base1h = baseM[HONEST_FILE] ?? 0;
const intradayMean = (m) => { const avail = INTRADAY_FILES.filter(f => f in m); return avail.length ? avail.reduce((a,f) => a + m[f], 0) / avail.length : 0; };
const baseIntraday = intradayMean(baseM);

// ---- grid search over SAFE knobs --------------------------------------------
const grid = { bullRegimeThreshold: [5, 6, 7, 8, 9], regimeSizeUpMult: [1.5, 2.0, 2.5, 3.0], regimeSizeDownMult: [0.5, 0.75] };
let best = null;
for (const th of grid.bullRegimeThreshold)
for (const up of grid.regimeSizeUpMult)
for (const dn of grid.regimeSizeDownMult) {
  const P = { ...base, bullRegimeThreshold: th, regimeSizeUpMult: up, regimeSizeDownMult: dn };
  const m = evalParams(P);
  if (m[BEAR_FILE] < BEAR_FLOOR) continue;               // bear floor
  if (m[BEAR_FILE] < baseBear - 0.05) continue;          // no bear regression
  if ((m[HONEST_FILE] ?? 0) < base1h - 0.01) continue;  // 1h-540d must not regress
  if (intradayMean(m) < baseIntraday - 0.05) continue;  // intraday mean must not regress (daily-candle dominance guard)
  const up_ = meanUpside(m);
  if (!best || up_ > best.upMean) best = { th, up, dn, m, upMean: up_, bear: m[BEAR_FILE] };
}

// Require improvement in intraday mean, not just overall mean — prevents daily-candle dominance from triggering apply
const bestIntraday0 = best ? intradayMean(best.m) : 0;
const candidateBetter = best && (bestIntraday0 - baseIntraday) >= MIN_GAIN_PP
  && (best.th !== base.bullRegimeThreshold || best.up !== base.regimeSizeUpMult || best.dn !== base.regimeSizeDownMult);

const isLive = (process.env.EXECUTION_MODE || CFG.executionMode) === 'real'
  && !(process.env.DRY_RUN === '1' || CFG.dryRun);

// ---- decide + act -----------------------------------------------------------
let action = 'no_change', detail = '';
if (!candidateBetter) {
  action = 'no_change';
  if (!best) detail = 'no safe candidate (all candidates failed bear floor or 1h-540d guard)';
  else detail = `best candidate intraday +${(bestIntraday0 - baseIntraday).toFixed(2)}pp < ${MIN_GAIN_PP}pp threshold (overall +${(best.upMean - baseUp).toFixed(2)}pp is daily-candle-driven, not actionable)`;
} else if (REPORT_ONLY) {
  action = 'recommend'; detail = 'report-only flag set';
} else if (isLive) {
  action = 'recommend'; detail = 'bot is LIVE — auto-apply suppressed, recommending only';
} else {
  // attempt auto-apply
  const updates = {
    BULL_REGIME_THRESHOLD: best.th, REGIME_SIZE_UP_MULT: best.up, REGIME_SIZE_DOWN_MULT: best.dn,
  };
  const envPath = path.join(ROOT, '.env');
  const backup = envPath + '.audit-bak';
  try {
    fs.copyFileSync(envPath, backup);
    let env = fs.readFileSync(envPath, 'utf8');
    for (const [k, v] of Object.entries(updates)) {
      const re = new RegExp(`^${k}=.*$`, 'm');
      if (re.test(env)) env = env.replace(re, `${k}=${v}`);
      else env += `\n${k}=${v}\n`;
    }
    fs.writeFileSync(envPath, env);
    execSync('node src/selftest.mjs', { cwd: ROOT, stdio: 'pipe', timeout: 120000 });
    action = 'applied'; detail = 'tests green after apply';
    try { fs.rmSync(backup, { force: true }); } catch { /* this mount cannot unlink; harmless leftover */ }
    try {
      const msg = `self-audit: apply BULL_REGIME_THRESHOLD=${best.th} REGIME_SIZE_UP_MULT=${best.up} REGIME_SIZE_DOWN_MULT=${best.dn} (+${(best.upMean - baseUp).toFixed(2)}pp upside, bear ${best.bear.toFixed(2)}%)`;
      execSync('git add TUNING-LOG.md', { cwd: ROOT, stdio: 'pipe' });
      execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: ROOT, stdio: 'pipe' });
    } catch { /* commit best-effort */ }
  } catch (e) {
    if (fs.existsSync(backup)) { fs.copyFileSync(backup, envPath); try { fs.rmSync(backup, { force: true }); } catch {} }
    action = 'apply_failed_reverted'; detail = String(e.message || e).slice(0, 120);
  }
}

// ---- daily health check (regression + log scan) ----------------------------
const health = [];
try {
  execSync('node src/selftest.mjs', { cwd: ROOT, stdio: 'pipe', timeout: 120000 });
  health.push('tests: PASS');
} catch { health.push('tests: FAIL (investigate before trading)'); }
try {
  const since = Date.now() - 24 * 3600 * 1000;
  const logDir = path.join(ROOT, 'logs');
  let errors = 0, trades = 0, breakers = 0, dryTrades = 0;
  if (fs.existsSync(logDir)) {
    for (const lf of fs.readdirSync(logDir).filter(x => x.endsWith('.jsonl'))) {
      const txt = fs.readFileSync(path.join(logDir, lf), 'utf8').trim();
      if (!txt) continue;
      for (const line of txt.split('\n')) {
        let o; try { o = JSON.parse(line); } catch { continue; }
        const t = o.t ? new Date(o.t).getTime() : 0;
        if (t < since) continue;
        if (o.type === 'error') errors++;
        else if (o.type === 'trade') trades++;
        else if (o.type === 'dry_run_trade') dryTrades++;
        else if (o.type === 'circuit_breaker') breakers++;
      }
    }
  }
  health.push(`last 24h: ${trades} live trades, ${dryTrades} dry trades, ${errors} errors, ${breakers} circuit-breaker halts`);
  if (errors > 0) health.push('NOTE: errors logged — if RPC-related, a paid RPC endpoint is the top reliability fix.');
  if (breakers > 0) health.push('NOTE: circuit breaker tripped in last 24h — review losing trades before re-enabling.');
} catch (e) { health.push('log scan skipped: ' + String(e.message || e).slice(0, 60)); }

// ---- write report + tuning log ----------------------------------------------
function fmtRow(m) { return Object.entries(m).map(([f, v]) => `${f.replace('sol-usd-', '').replace('.json', '')} ${v.toFixed(2)}%`).join(' | '); }
const lines = [];
lines.push(`# Self-audit ${nowIso}`);
lines.push('');
lines.push(`Action: **${action.toUpperCase()}** — ${detail}`);
lines.push(`Live: ${isLive ? 'YES' : 'no'} | report-only: ${REPORT_ONLY}`);
lines.push('');
lines.push(`Current: bear ${baseBear.toFixed(2)}% | mean upside ${baseUp.toFixed(2)}% | intraday mean ${baseIntraday.toFixed(2)}%`);
lines.push(`  ${fmtRow(baseM)}`);
if (best) {
  const dpp = best.upMean - baseUp;
  lines.push('');
  lines.push(`Best safe candidate: BULL_REGIME_THRESHOLD=${best.th} REGIME_SIZE_UP_MULT=${best.up} REGIME_SIZE_DOWN_MULT=${best.dn}`);
  lines.push(`  bear ${best.bear.toFixed(2)}% | mean upside ${best.upMean.toFixed(2)}% (Δ ${dpp >= 0 ? '+' : ''}${dpp.toFixed(2)}pp) | intraday ${intradayMean(best.m).toFixed(2)}%`);
  lines.push(`  ${fmtRow(best.m)}`);
}
lines.push('');
lines.push('Daily health:');
for (const h of health) lines.push('  - ' + h);
const report = lines.join('\n') + '\n';

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(path.join(REPORT_DIR, `${day}.md`), report);
const summary = `- ${nowIso} — ${action.toUpperCase()} — bear ${baseBear.toFixed(2)}%→${best ? best.bear.toFixed(2) : baseBear.toFixed(2)}% upside ${baseUp.toFixed(2)}%→${best ? best.upMean.toFixed(2) : baseUp.toFixed(2)}% — ${detail}\n`;
if (!fs.existsSync(TUNING_LOG)) fs.writeFileSync(TUNING_LOG, '# Tuning log (self-audit history)\n\n');
fs.appendFileSync(TUNING_LOG, summary);

log('\n' + report);
log(`Report: logs/self-audit/${day}.md`);
