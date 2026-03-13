import { spawn } from 'node:child_process';
import { logJsonl, NOW } from './common.mjs';

const dryRun = process.argv.includes('--dry-run');
const env = { ...process.env };
if (dryRun) env.DRY_RUN = '1';

const entries = [
  ['EXEC', 'src/executor.mjs'],
  ['BULL', 'src/bot-bull.mjs'],
  ['BEAR', 'src/bot-bear.mjs'],
  ['SWEEP', 'src/sweeper.mjs'],
];

const childrenState = new Map();
let exiting = false;

function startOne(name, file) {
  const state = childrenState.get(name) || { attempt: 0, lastExit: null };
  state.attempt += 1;

  if (state.attempt > 5) {
    console.error(`[${name}] max restart attempts (5) exceeded, shutting down`);
    logJsonl('all.jsonl', { t: NOW(), type: 'max_restarts', name });
    shutdown(1);
    return;
  }

  const child = spawn(process.execPath, [file], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  state.child = child;
  state.pid = child.pid;
  childrenState.set(name, state);

  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on('exit', (code) => {
    state.lastExit = { code, time: Date.now() };
    if (!exiting) {
      if (code !== 0) {
        const waitMs = Math.min(30000, Math.pow(2, state.attempt) * 1000);
        console.error(`[${name}] exited with code ${code}, restart in ${waitMs}ms (attempt ${state.attempt})`);
        logJsonl('all.jsonl', { t: NOW(), type: 'restart', name, code, attempt: state.attempt, waitMs });
        setTimeout(() => startOne(name, file), waitMs);
      }
    }
  });
}

function shutdown(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const [name, state] of childrenState) {
    try { state.child?.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => process.exit(code), 250);
}

for (const [name, file] of entries) startOne(name, file);
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
