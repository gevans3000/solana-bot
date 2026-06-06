// Test isolation bootstrap. Imported FIRST by selftest.mjs and unit.mjs (before
// common.mjs is evaluated) so STATE_DIR/LOG_DIR point at a throwaway temp dir.
// Without this, tests wrote price-cache.json (price 150) into the live state/ dir
// and that fake price leaked into real signal generation.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'solbot-test-'));
const stateDir = path.join(base, 'state');
const logDir   = path.join(base, 'logs');
fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(logDir,   { recursive: true });

// validateConfig() (runs at common.mjs import) requires a wallet file for real
// EXECUTION_MODE. Copy the real wallet into the isolated dir so config validates
// exactly as it would live, without the tests touching live state/ for anything else.
try {
  const realWallet = path.join(process.cwd(), 'state', 'generated-wallet.json');
  if (fs.existsSync(realWallet)) {
    fs.copyFileSync(realWallet, path.join(stateDir, 'generated-wallet.json'));
  }
} catch { /* best effort; if absent, simulated mode still validates */ }

process.env.SOLBOT_STATE_DIR = stateDir;
process.env.SOLBOT_LOG_DIR   = logDir;
