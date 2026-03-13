import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const files = ['src/bot-bull.mjs', 'src/bot-bear.mjs', 'src/executor.mjs', 'src/sweeper.mjs'];
const env = { ...process.env, RUN_ONCE: '1', DRY_RUN: '1', PRICE_MODE: 'mock', PROFIT_WALLET: process.env.PROFIT_WALLET || 'SimulatedProfitWallet11111111111111111111111' };

for (const file of files) {
  const result = spawnSync(process.execPath, [file], { cwd: process.cwd(), env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

const requiredLogs = ['logs/bull.jsonl', 'logs/bear.jsonl', 'logs/executor.jsonl', 'logs/sweeper.jsonl'];
for (const log of requiredLogs) {
  if (!fs.existsSync(log) || !fs.readFileSync(log, 'utf8').trim()) {
    console.error(`Missing or empty log: ${log}`);
    process.exit(1);
  }
}
console.log('Smoke test OK');
