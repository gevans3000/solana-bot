#!/usr/bin/env node
// fetch-data.mjs — fetch SOL/USD OHLCV from Binance public API
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  RATE LIMIT KNOWLEDGE (hard-coded — do not exceed these):               │
// │  Binance REST API:                                                       │
// │    • Weight limit: 1200 per minute (rolling window)                     │
// │    • Each /klines request = 2 weight                                    │
// │    • Safe budget: 240 weight/min = 120 requests/min = 1 req/500ms       │
// │    • We enforce RATE_DELAY_MS=600 (2x safety margin)                    │
// │    • Max candles per request: 1000                                       │
// │    • 429 = rate limited (back off 60s), 418 = IP banned                 │
// │  This script uses ~8 requests total = 16 weight (well under 1200/min)   │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Cannot run in the sandbox (outbound blocked). Run via Chrome extension or
// from a machine with internet access. See README for instructions.
//
// Outputs (backtest/data/):
//   sol-usd-1d-bull.json    — daily, Oct 2023 → Apr 2024
//   sol-usd-1d-full.json    — daily, Jan 2021 → today
//   sol-usd-6h-bull.json    — 6h,    Oct 2023 → Apr 2024
//   sol-usd-6h-recent.json  — 6h,    last 90 days

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Rate limit config (Binance) ───────────────────────────────────────────
const RATE_DELAY_MS   = 600;   // ms between requests (enforces ~100 req/min, 10x under limit)
const MAX_PER_REQUEST = 1000;  // Binance max candles per klines call
const BINANCE_BASE    = 'https://api.binance.com/api/v3/klines';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchChunk(symbol, interval, startMs, endMs) {
  const url = `${BINANCE_BASE}?symbol=${symbol}&interval=${interval}` +
    `&startTime=${startMs}&endTime=${endMs}&limit=${MAX_PER_REQUEST}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'solana-bot-backtest/1.0' }
  });
  // Respect rate limit headers if present
  const weightUsed = parseInt(res.headers.get('x-mbx-used-weight-1m') || '0');
  if (weightUsed > 900) {
    console.warn(`  ⚠ Weight at ${weightUsed}/1200 — slowing down`);
    await sleep(5000);
  }
  if (res.status === 429 || res.status === 418) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '60');
    console.error(`  Rate limited (${res.status}). Waiting ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return fetchChunk(symbol, interval, startMs, endMs);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchRange(label, interval, startMs, endMs, outFile) {
  console.log(`\n[${label}]`);
  const all = [];
  let cursor = startMs;
  let reqCount = 0;

  while (cursor < endMs) {
    const chunk = await fetchChunk('SOLUSDT', interval, cursor, endMs);
    if (!Array.isArray(chunk) || !chunk.length) break;
    for (const k of chunk) {
      all.push({ t: k[0], open: +k[1], high: +k[2], low: +k[3], price: +k[4], volume: +k[5] });
    }
    cursor = chunk[chunk.length - 1][0] + 1;
    reqCount++;
    console.log(`  chunk ${reqCount}: ${chunk.length} candles (total ${all.length})`);
    if (chunk.length < MAX_PER_REQUEST) break;
    await sleep(RATE_DELAY_MS);
  }

  fs.writeFileSync(outFile, JSON.stringify(all));
  console.log(`  → ${outFile} (${all.length} candles)`);
  return all.length;
}

const OCT_2023 = 1696118400000;
const APR_2024 = 1711929600000;
const JAN_2021 = 1609459200000;
const NOW      = Date.now();
const D90_AGO  = NOW - 90 * 24 * 60 * 60 * 1000;

await fetchRange('daily bull (Oct23–Apr24)', '1d', OCT_2023, APR_2024,
  path.join(DATA_DIR, 'sol-usd-1d-bull.json'));
await sleep(RATE_DELAY_MS);

await fetchRange('daily full (2021–today)', '1d', JAN_2021, NOW,
  path.join(DATA_DIR, 'sol-usd-1d-full.json'));
await sleep(RATE_DELAY_MS);

await fetchRange('6h bull (Oct23–Apr24)', '6h', OCT_2023, APR_2024,
  path.join(DATA_DIR, 'sol-usd-6h-bull.json'));
await sleep(RATE_DELAY_MS);

await fetchRange('6h recent (last 90d)', '6h', D90_AGO, NOW,
  path.join(DATA_DIR, 'sol-usd-6h-recent.json'));

console.log('\nAll done. Run: npm run backtest');
