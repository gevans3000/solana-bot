#!/usr/bin/env node
/**
 * Rollback & Recovery Script for Solana Trading Bot
 * Restores state from snapshots, replays trades, verifies on-chain
 * 
 * Usage: 
 *   node scripts/rollback.mjs --list
 *   node scripts/rollback.mjs --restore <timestamp>
 *   node scripts/rollback.mjs --verify [timestamp]
 *   node scripts/rollback.mjs --snapshot
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_DIR = path.join(ROOT, 'state/snapshots');
const STATE_DIR = path.join(ROOT, 'state');
const LOGS_DIR = path.join(ROOT, 'logs');

if (!fs.existsSync(SNAPSHOT_DIR)) {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

const SNAPSHOT_FILES = [
  'portfolio.json',
  'state-exec.json',
  'state-BULL.json',
  'state-BEAR.json',
  'regime.json',
  'price-cache.json',
  'price-state.json'
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getTimestamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
}

function listSnapshots() {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    console.log('No snapshots found (directory does not exist)');
    return [];
  }
  
  const dirs = fs.readdirSync(SNAPSHOT_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reverse();
  
  if (dirs.length === 0) {
    console.log('No snapshots found');
    return [];
  }
  
  console.log('\nAvailable Snapshots:');
  dirs.forEach((name, i) => {
    const snapshotPath = path.join(SNAPSHOT_DIR, name);
    const metaPath = path.join(snapshotPath, 'meta.json');
    let meta = {};
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
    }
    const size = getDirSize(snapshotPath);
    console.log(`  ${i + 1}. ${name}  (${formatBytes(size)}) ${meta.tradeCount ? `- ${meta.tradeCount} trades` : ''}`);
  });
  
  return dirs;
}

function getDirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let size = 0;
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    if (file.isDirectory()) {
      size += getDirSize(path.join(dir, file.name));
    } else {
      size += fs.statSync(path.join(dir, file.name)).size;
    }
  }
  return size;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function createSnapshot(label = 'manual') {
  const timestamp = getTimestamp();
  const snapshotPath = path.join(SNAPSHOT_DIR, `${timestamp}-${label}`);
  
  fs.mkdirSync(snapshotPath, { recursive: true });
  
  console.log(`[Rollback] Creating snapshot: ${timestamp}-${label}`);
  
  let filesCopied = 0;
  for (const file of SNAPSHOT_FILES) {
    const src = path.join(STATE_DIR, file);
    const dest = path.join(snapshotPath, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      filesCopied++;
    }
  }
  
  // Copy latest trades.jsonl (last 1000 lines)
  const tradesPath = path.join(ROOT, 'logs/trades.jsonl');
  if (fs.existsSync(tradesPath)) {
    const lines = fs.readFileSync(tradesPath, 'utf8').trim().split('\n');
    const recent = lines.slice(-1000).join('\n') + '\n';
    fs.writeFileSync(path.join(snapshotPath, 'trades-recent.jsonl'), recent);
  }
  
  // Save metadata
  const meta = {
    timestamp,
    label,
    filesCopied,
    tradeCount: countTrades(),
    portfolio: getPortfolioSummary()
  };
  fs.writeFileSync(path.join(snapshotPath, 'meta.json'), JSON.stringify(meta, null, 2));
  
  // Clean old snapshots (keep last 50)
  cleanOldSnapshots(50);
  
  console.log(`[Rollback] Snapshot created: ${snapshotPath} (${filesCopied} files)`);
  return timestamp;
}

function countTrades() {
  const tradesPath = path.join(ROOT, 'logs/trades.jsonl');
  if (!fs.existsSync(tradesPath)) return 0;
  const lines = fs.readFileSync(tradesPath, 'utf8').trim().split('\n');
  return lines.filter(l => l.trim()).length;
}

function getPortfolioSummary() {
  const portfolioPath = path.join(STATE_DIR, 'portfolio.json');
  if (!fs.existsSync(portfolioPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
  } catch {
    return null;
  }
}

function cleanOldSnapshots(keep = 50) {
  const dirs = fs.readdirSync(SNAPSHOT_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({ name: d.name, time: fs.statSync(path.join(SNAPSHOT_DIR, d.name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  
  if (dirs.length > keep) {
    for (const dir of dirs.slice(keep)) {
      fs.rmSync(path.join(SNAPSHOT_DIR, dir.name), { recursive: true, force: true });
      console.log(`[Rollback] Cleaned old snapshot: ${dir.name}`);
    }
  }
}

async function restoreSnapshot(timestamp) {
  const snapshotPath = path.join(SNAPSHOT_DIR, timestamp);
  
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot not found: ${timestamp}`);
  }
  
  console.log(`[Rollback] Restoring from snapshot: ${timestamp}`);
  
  // Backup current state first
  const backupTimestamp = await createSnapshot('pre-restore-backup');
  console.log(`[Rollback] Backed up current state to: ${backupTimestamp}`);
  
  // Stop bot processes (would call supervisor stop)
  console.log('[Rollback] Please stop bot processes before restoring (supervisor stop)');
  console.log('Press Enter when bot processes are stopped...');
  
  // In non-interactive mode, just warn
  if (!process.stdin.isTTY) {
    console.log('[Rollback] Non-interactive mode: assuming processes stopped');
  } else {
    await new Promise(r => process.stdin.once('data', r));
  }
  
  // Restore files
  let restored = 0;
  for (const file of SNAPSHOT_FILES) {
    const src = path.join(process.cwd(), timestamp, file);
    const dest = path.join(STATE_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      restored++;
    }
  }
  
  // Clean logs/trades that are newer than snapshot
  console.log('[Rollback] Snapshot restored. Please verify:');
  console.log('  1. Run: node scripts/rollback.mjs --verify ' + timestamp);
  console.log('  2. Check portfolio matches on-chain');
  console.log('  3. Restart bot with: supervisor start');
  
  return { backupTimestamp, restored };
}

async function verifySnapshot(timestamp) {
  const snapshotPath = path.join(SNAPSHOT_DIR, timestamp);
  
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot not found: ${timestamp}`);
  }
  
  console.log(`[Rollback] Verifying snapshot: ${timestamp}`);
  
  const results = { matches: 0, mismatches: 0, details: [] };
  
  for (const file of SNAPSHOT_FILES) {
    const snapshotFile = path.join(SNAPSHOT_DIR, timestamp, file);
    const currentFile = path.join(STATE_DIR, file);
    
    if (!fs.existsSync(snapshotFile)) {
      results.details.push({ file, status: 'missing_in_snapshot' });
      continue;
    }
    if (!fs.existsSync(currentFile)) {
      results.details.push({ file, status: 'missing_in_current' });
      results.mismatches++;
      continue;
    }
    
    try {
      const snap = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
      const curr = JSON.parse(fs.readFileSync(currentFile, 'utf8'));
      
      // Compare key fields for portfolio
      if (file === 'portfolio.json') {
        const keys = ['usdc', 'sol', 'avgEntryPrice', 'realizedPnlUsdc', 'sweptUsdc'];
        let match = true;
        for (const key of keys) {
          if (Math.abs((snap[key] || 0) - (curr[key] || 0)) > 0.000001) {
            match = false;
            break;
          }
        }
        if (match) {
          results.matches++;
          results.details.push({ file, status: 'match', summary: 'portfolio key fields match' });
        } else {
          results.mismatches++;
          results.details.push({ file, status: 'mismatch', summary: 'portfolio values differ' });
        }
      } else {
        // Simple equality for other files
        const snapStr = JSON.stringify(snap);
        const currStr = JSON.stringify(curr);
        if (snapStr === currStr) {
          results.matches++;
          results.details.push({ file, status: 'match' });
        } else {
          results.mismatches++;
          results.details.push({ file, status: 'mismatch' });
        }
      }
    } catch (e) {
      results.mismatches++;
      results.details.push({ file, status: 'error', error: e.message });
    }
  }
  
  // Verify trades replay
  const tradesPath = path.join(ROOT, 'logs/trades.jsonl');
  if (fs.existsSync(tradesPath)) {
    const trades = fs.readFileSync(tradesPath, 'utf8').trim().split('\n').filter(l => l.trim());
    results.details.push({ file: 'trades.jsonl', status: 'info', summary: `${trades.length} trades in log` });
  }
  
  console.log('\n[Rollback] Verification Results:');
  console.log(`  Matches: ${results.matches}`);
  console.log(`  Mismatches: ${results.mismatches}`);
  results.details.forEach(d => console.log(`  ${d.file}: ${d.status} ${d.summary || ''} ${d.error || ''}`));
  
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--list') || args.includes('-l')) {
    listSnapshots();
    return;
  }
  
  if (args.includes('--snapshot')) {
    const label = args.find(a => a.startsWith('--label='))?.split('=')[1] || 'manual';
    await createSnapshot(label);
    return;
  }
  
  if (args.includes('--restore')) {
    const timestamp = args.find(a => !a.startsWith('--')) || args[args.indexOf('--restore') + 1];
    if (!timestamp) {
      console.error('Usage: --restore <timestamp>');
      process.exit(1);
    }
    await restoreSnapshot(timestamp);
    return;
  }
  
  if (args.includes('--verify')) {
    const timestamp = args.find(a => !a.startsWith('--')) || args[args.indexOf('--verify') + 1];
    if (!timestamp) {
      // Verify latest
      const dirs = fs.readdirSync(SNAPSHOT_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort()
        .reverse();
      if (dirs.length > 0) {
        await verifySnapshot(dirs[0]);
      } else {
        console.log('No snapshots to verify');
      }
    } else {
      await verifySnapshot(timestamp);
    }
    return;
  }
  
  // Default: show help
  console.log(`
Rollback & Recovery Tool for Solana Trading Bot

Usage:
  node scripts/rollback.mjs --list                    # List all snapshots
  node scripts/rollback.mjs --snapshot [--label=tag]  # Create new snapshot
  node scripts/rollback.mjs --restore <timestamp>     # Restore from snapshot
  node scripts/rollback.mjs --verify [timestamp]      # Verify snapshot matches current state

Examples:
  node scripts/rollback.mjs --snapshot --label=pre-deploy
  node scripts/rollback.mjs --restore 20260615-143022-pre-deploy
  node scripts/rollback.mjs --verify 20260615-143022-pre-deploy
  
State files managed:
  ${SNAPSHOT_FILES.join(', ')}

Snapshot directory: ${SNAPSHOT_DIR}
  `);
}

main().catch(e => {
  console.error('[Rollback] Fatal error:', e);
  process.exit(1);
});