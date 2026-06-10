import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate state/logs in a temp dir so mock prices NEVER leak into live state/
// (same hazard _test-env.mjs fixes for unit/selftest: a cached mock price like
// $65 would otherwise be read by the live/shadow runner).
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'solbot-smoke-'));
const stateDir = path.join(base, 'state');
const logDir = path.join(base, 'logs');
fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
// real EXECUTION_MODE validates wallet presence — copy it in like _test-env does
try {
  const realWallet = path.join(process.cwd(), 'state', 'generated-wallet.json');
  if (fs.existsSync(realWallet)) fs.copyFileSync(realWallet, path.join(stateDir, 'generated-wallet.json'));
} catch {}

const files = ['src/bot-bull.mjs', 'src/bot-bear.mjs', 'src/executor.mjs', 'src/sweeper.mjs'];
const env = {
  ...process.env, RUN_ONCE: '1', DRY_RUN: '1', PRICE_MODE: 'mock',
  SOLBOT_STATE_DIR: stateDir, SOLBOT_LOG_DIR: logDir,
  PROFIT_WALLET: process.env.PROFIT_WALLET || 'SimulatedProfitWallet11111111111111111111111',
};

for (const file of files) {
  const result = spawnSync(process.execPath, [file], { cwd: process.cwd(), env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

const requiredLogs = ['bull.jsonl', 'bear.jsonl', 'executor.jsonl', 'sweeper.jsonl'].map(f => path.join(logDir, f));
for (const log of requiredLogs) {
  if (!fs.existsSync(log) || !fs.readFileSync(log, 'utf8').trim()) {
    console.error(`Missing or empty log: ${log}`);
    process.exit(1);
  }
}
console.log('Smoke test OK (isolated state)');
