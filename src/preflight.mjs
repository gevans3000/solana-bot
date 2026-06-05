#!/usr/bin/env node
// src/preflight.mjs — pre-live safety checklist
// Usage: node src/preflight.mjs
// Prints PASS/FAIL for each check. Does NOT trade.

import fs   from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const STATE_DIR = path.join(ROOT, 'state');

let pass = 0, fail = 0;
const results = [];

function check(name, ok, detail = '') {
  const label = ok ? 'PASS' : 'FAIL';
  results.push({ label, name, detail });
  if (ok) pass++; else fail++;
}

// ── 1. Config valid (validateConfig doesn't throw) ───────────────────────────
try {
  await import('./common.mjs');
  check('Config valid (validateConfig)', true);
} catch (e) {
  check('Config valid (validateConfig)', false, e.message);
}

// ── 2. Bear backtest data present and non-empty ──────────────────────────────
const bearData = path.join(ROOT, 'backtest/data/sol-usd-1d.json');
try {
  const raw = JSON.parse(fs.readFileSync(bearData, 'utf8'));
  const rows = Array.isArray(raw) ? raw : (raw.candles || raw.data || []);
  check('Bear backtest data present', rows.length > 100, `${rows.length} candles`);
} catch (e) {
  check('Bear backtest data present', false, e.message);
}

// ── 3. npm test green ────────────────────────────────────────────────────────
try {
  execSync('node src/selftest.mjs', { cwd: ROOT, stdio: 'pipe' });
  check('npm test (selftest) green', true);
} catch (e) {
  const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
  const failLine = out.split('\n').find(l => l.includes('FAIL')) || 'selftest failed';
  check('npm test (selftest) green', false, failLine.trim());
}

// ── 4. Wallet / private key present ─────────────────────────────────────────
const genWallet = path.join(STATE_DIR, 'generated-wallet.json');
const hasKey    = !!process.env.PRIVATE_KEY || fs.existsSync(genWallet);
check('Wallet present (PRIVATE_KEY or generated-wallet.json)', hasKey,
  hasKey ? (fs.existsSync(genWallet) ? 'generated-wallet.json found' : 'PRIVATE_KEY env set')
         : 'neither PRIVATE_KEY env nor state/generated-wallet.json found');

// ── 5. PROFIT_WALLET set ─────────────────────────────────────────────────────
const profitWallet = process.env.PROFIT_WALLET || '';
check('PROFIT_WALLET set', profitWallet.trim() !== '' && !profitWallet.includes('<'),
  profitWallet.trim() !== '' ? profitWallet : 'not set — required before going real');

// ── 6. Execution mode + dry-run flags ────────────────────────────────────────
const execMode = process.env.EXECUTION_MODE || 'simulated';
const dryRun   = process.env.DRY_RUN !== '0';
check('DRY_RUN is on (safe)', dryRun, `DRY_RUN=${process.env.DRY_RUN ?? '(default=1)'}`);
check('EXECUTION_MODE current value', true, `EXECUTION_MODE=${execMode} (set to real only when ready)`);

// ── 7. RPC not devnet ────────────────────────────────────────────────────────
const rpcUrl = process.env.RPC_URL || '';
if (execMode === 'real') {
  check('RPC not devnet (real mode)', !rpcUrl.includes('devnet'), `RPC_URL=${rpcUrl}`);
} else {
  check('RPC not devnet (skipped — not real mode)', true, `EXECUTION_MODE=${execMode}`);
}

// ── 8. Simulated dry-run tick (does not send tx) ──────────────────────────────
try {
  const { runBacktest, loadSeries, paramsFromCfg } = await import('./backtest.mjs');
  const { CFG } = await import('./common.mjs');
  const series = loadSeries(bearData);
  const P = paramsFromCfg(CFG);
  const m = runBacktest(series.slice(0, 30), P); // short slice, fast
  check('Simulated dry tick (backtest 30-bar slice)', m.candles === 30,
    `returnPct ${m.returnPct.toFixed(2)}%, no tx sent`);
} catch (e) {
  check('Simulated dry tick (backtest 30-bar slice)', false, e.message);
}

// ── 8b. Daily-loss circuit breaker configured (warn if unset) ────────────────
const dll = process.env.DAILY_LOSS_LIMIT_USDC;
const dllSet = dll !== undefined && dll !== '' && Number(dll) > 0;
check('DAILY_LOSS_LIMIT_USDC (circuit breaker)', true,
  dllSet ? `set to ${dll} USDC` : 'WARN: not set — daily-loss circuit breaker disabled');

// ── Print results ─────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════');
console.log('  PREFLIGHT CHECKLIST');
console.log('══════════════════════════════════════════════');
const w = Math.max(...results.map(r => r.name.length));
for (const { label, name, detail } of results) {
  const line = `  [${label}]  ${name.padEnd(w)}  ${detail}`;
  if (label === 'FAIL') console.error(line);
  else console.log(line);
}
console.log('══════════════════════════════════════════════');
console.log(`  ${pass} passed, ${fail} failed`);
console.log('══════════════════════════════════════════════\n');

if (fail > 0) {
  console.error('PREFLIGHT FAILED — fix the items above before going live.');
  process.exit(1);
}
console.log('PREFLIGHT PASSED — safe to proceed with go-live steps.');
