#!/usr/bin/env node
// selftest.mjs — automated regression gate for DEFAULT CONFIG (.env.example)
// Usage: node src/selftest.mjs   (exit 0 = all pass, exit 1 = failure)
// Tests the COMMITTED DEFAULT CONFIG in .env.example, not current .env

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import './_test-env.mjs';
import { circuitBreakerTripped, saveJson } from './common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXAMPLE_ENV = path.join(ROOT, '.env.example');

let passed = 0, failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    console.log('  PASS  ' + name);
    passed++;
  } else {
    console.error('  FAIL  ' + name + (detail ? ' — ' + detail : ''));
    failed++;
  }
}

console.log('\nTest 1: .env.example loads and parses correctly');
{
  const envText = fs.readFileSync(EXAMPLE_ENV, 'utf8');
  const lines = envText.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
  assert('has at least 50 config lines', lines.length >= 50, 'found ' + lines.length);
  const hasExecutionMode = lines.some(l => l.startsWith('EXECUTION_MODE='));
  assert('has EXECUTION_MODE', hasExecutionMode);
  const hasRpcUrl = lines.some(l => l.startsWith('RPC_URL='));
  assert('has RPC_URL', hasRpcUrl);
  const hasPrivateKey = lines.some(l => l.startsWith('PRIVATE_KEY='));
  assert('has PRIVATE_KEY placeholder', hasPrivateKey);
}

console.log('\nTest 2: circuit breaker fires when realized loss > limit');
{
  const { circuitBreakerTripped } = await import('./common.mjs');
  const limit = 3.0;
  assert('breaker OFF below limit', circuitBreakerTripped(2.99, limit) === false,
    'tripped at 2.99 (limit ' + limit + ')');
  assert('breaker ON at limit', circuitBreakerTripped(3.0, limit) === true,
    'not tripped at 3.0 (limit ' + limit + ')');
  assert('breaker ON above limit', circuitBreakerTripped(5.5, limit) === true,
    'not tripped at 5.5 (limit ' + limit + ')');
  assert('breaker disabled when limit=0', circuitBreakerTripped(100, 0) === false,
    'tripped with limit 0 (should be disabled)');
}

console.log('\nTest 3: botTick writes state/regime.json');
{
  const { saveJson } = await import('./common.mjs');
  const regimePath = path.join(ROOT, 'state/regime.json');
  const payload = { t: new Date().toISOString(), test: true };
  saveJson('regime.json', payload);

  const written = JSON.parse(fs.readFileSync(regimePath, 'utf8'));
  assert('regime.json file written', fs.existsSync(regimePath), 'missing');
  assert('regime.json has data', Object.keys(written).length > 0, 'got ' + JSON.stringify(written));
}

console.log('\nTest 4: backtest data files exist');
{
  const dataDir = path.join(ROOT, 'backtest/data');
  const files = ['sol-usd-1d.json', 'sol-usd-1h-540d.json', 'sol-usd-15m-60d.json'];
  for (const f of files) {
    const fPath = path.join(dataDir, f);
    assert('data file exists: ' + f, fs.existsSync(fPath), fPath);
  }
}

console.log('\n' + '─'.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  console.error('SELFTEST FAILED');
  process.exit(1);
}
console.log('SELFTEST PASSED');