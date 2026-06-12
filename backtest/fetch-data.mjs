#!/usr/bin/env node
// fetch-data.mjs — refresh SOL/USD OHLCV datasets in backtest/data/.
//
// PROVIDERS (tried in order, per run):
//   1. Coinbase Exchange  GET /products/SOL-USD/candles  (US-accessible, keyless,
//      300 candles/req, granularities 60/300/900/3600/21600/86400; rows come back
//      DESCENDING as [timeSec, low, high, open, close, volume] — the exact array
//      schema loadSeries() already parses, so files are written in that shape.)
//   2. Binance global /api/v3/klines (HTTP 451 geo-block from US IPs)
//   3. Binance.US    /api/v3/klines (thin volume but same format)
// Coinbase public rate limit ~10 req/s — we send 1 per 200ms. A full refresh is
// ~145 requests (~40s). 429 → wait and retry the chunk.
//
// HISTORY PRESERVATION: Coinbase lists SOL-USD only from mid-2021. If a fetched
// series starts AFTER the requested window start and the existing file has older
// candles (original Yahoo-era history), those old rows are prepended so long sets
// (1d-full, 1d-5yr) never lose depth on refresh.
//
// Windows (semantics must not drift between refreshes):
//   sol-usd-1d.json       rolling: last 311 daily candles  (THE BEAR FLOOR SET)
//   sol-usd-1d-bull.json  fixed:   2023-10-01 -> 2024-04-01
//   sol-usd-1d-full.json  fixed start 2021-01-01 -> now
//   sol-usd-1d-5yr.json   rolling: now-5y -> now
//   sol-usd-1h-540d.json  rolling: now-540d -> now
//   sol-usd-15m-60d.json  rolling: now-60d -> now
//   sol-usd-5m-30d.json   rolling: now-30d -> now
//   sol-usd-1m-7d.json    rolling: now-7d  -> now

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = { 'User-Agent': 'solana-bot-backtest/2.0' };

// ── Provider: Coinbase Exchange ───────────────────────────────────────────
const CB_GRAN = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '6h': 21600, '1d': 86400 };
async function cbChunk(interval, startMs, endMs) {
  const g = CB_GRAN[interval];
  const url = `https://api.exchange.coinbase.com/products/SOL-USD/candles` +
    `?granularity=${g}&start=${new Date(startMs).toISOString()}&end=${new Date(endMs).toISOString()}`;
  const res = await fetch(url, { headers: UA });
  if (res.status === 429) { await sleep(2000); return cbChunk(interval, startMs, endMs); }
  if (!res.ok) throw new Error(`Coinbase HTTP ${res.status}`);
  const rows = await res.json();             // descending [sec, low, high, open, close, vol]
  return rows.reverse();
}
async function cbRange(interval, startMs, endMs) {
  const g = CB_GRAN[interval] * 1000;
  const all = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const chunkEnd = Math.min(cursor + 300 * g, endMs);
    const rows = await cbChunk(interval, cursor, chunkEnd);
    for (const r of rows) if (!all.length || r[0] * 1000 > all[all.length - 1][0] * 1000) all.push(r);
    cursor = chunkEnd + 1;                   // empty chunk (pre-listing) just advances
    await sleep(200);
  }
  return all;                                // ascending [sec, low, high, open, close, vol]
}

// ── Provider: Binance-style klines (global, then .US) ────────────────────
async function bnRange(base, symbol, interval, startMs, endMs) {
  const all = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url = `${base}/api/v3/klines?symbol=${symbol}&interval=${interval}` +
      `&startTime=${cursor}&endTime=${endMs}&limit=1000`;
    const res = await fetch(url, { headers: UA });
    if (res.status === 429 || res.status === 418) { await sleep(60000); continue; }
    if (!res.ok) throw new Error(`Binance(${base}) HTTP ${res.status}`);
    const chunk = await res.json();
    if (!Array.isArray(chunk) || !chunk.length) break;
    // emit in the same array schema loadSeries parses: [sec, low, high, open, close, vol]
    for (const k of chunk) all.push([Math.floor(k[0] / 1000), +k[3], +k[2], +k[1], +k[4], +k[5]]);
    cursor = chunk[chunk.length - 1][0] + 1;
    if (chunk.length < 1000) break;
    await sleep(600);
  }
  return all;
}

// ── Provider chain (first one that returns data wins, sticky for the run) ──
const PROVIDERS = [
  { name: 'coinbase',   fn: (i, s, e) => cbRange(i, s, e) },
  { name: 'binance',    fn: (i, s, e) => bnRange('https://api.binance.com', 'SOLUSDT', i, s, e) },
  { name: 'binance.us', fn: (i, s, e) => bnRange('https://api.binance.us', 'SOLUSD', i, s, e) },
];
let active = null;
async function fetchSeries(interval, startMs, endMs) {
  if (active) return PROVIDERS[active.idx].fn(interval, startMs, endMs);
  let lastErr;
  for (let i = 0; i < PROVIDERS.length; i++) {
    try {
      const rows = await PROVIDERS[i].fn(interval, startMs, endMs);
      if (rows.length) { active = { idx: i }; console.log(`  (provider: ${PROVIDERS[i].name})`); return rows; }
    } catch (e) { lastErr = e; console.warn(`  ${PROVIDERS[i].name} failed: ${e.message}`); }
  }
  throw lastErr ?? new Error('all providers returned no data');
}

// ── existing-file reader (any historical schema) for history preservation ──
function readOldRows(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rows = Array.isArray(raw) ? raw : (raw.candles || raw.data || []);
    return rows.map(r => {
      if (Array.isArray(r)) return r.length >= 6 ? r : [r[0], r[1], r[1], r[1], r[1], 0];
      const sec = Math.floor((typeof r.t === 'string' ? new Date(r.t).getTime() : r.t) / 1000);
      const close = r.price ?? r.close;
      return [sec, r.low ?? close, r.high ?? close, r.open ?? close, close, r.volume ?? 0];
    }).filter(r => Number.isFinite(r[0]) && Number.isFinite(r[4]) && r[4] > 0)
      .sort((a, b) => a[0] - b[0]);
  } catch { return []; }
}

async function refresh(label, interval, startMs, endMs, outName) {
  const outFile = path.join(DATA_DIR, outName);
  console.log(`\n[${label}]`);
  const fresh = await fetchSeries(interval, startMs, endMs);
  if (!fresh.length) { console.warn(`  no data returned — keeping existing file`); return; }
  let rows = fresh;
  const firstFreshSec = fresh[0][0];
  if (firstFreshSec * 1000 > startMs + CB_GRAN[interval] * 2000) {     // window head missing
    const old = readOldRows(outFile).filter(r => r[0] < firstFreshSec);
    if (old.length) { rows = old.concat(fresh); console.log(`  prepended ${old.length} pre-listing candles from existing file`); }
  }
  fs.writeFileSync(outFile, JSON.stringify(rows));
  console.log(`  -> ${outName}: ${rows.length} candles ` +
    `${new Date(rows[0][0] * 1000).toISOString().slice(0, 10)} -> ${new Date(rows[rows.length - 1][0] * 1000).toISOString().slice(0, 10)}`);
}

const DAY = 86400000;
const NOW = Date.now();
await refresh('1d bear floor (rolling 311d)', '1d', NOW - 311 * DAY, NOW, 'sol-usd-1d.json');
await refresh('1d bull (fixed Oct23-Apr24)', '1d', Date.UTC(2023, 9, 1), Date.UTC(2024, 3, 1) + DAY, 'sol-usd-1d-bull.json');
await refresh('1d full (2021->now)', '1d', Date.UTC(2021, 0, 1), NOW, 'sol-usd-1d-full.json');
await refresh('1d 5yr (rolling)', '1d', NOW - 5 * 365 * DAY, NOW, 'sol-usd-1d-5yr.json');
await refresh('1h 540d (rolling, HONEST SET)', '1h', NOW - 540 * DAY, NOW, 'sol-usd-1h-540d.json');
await refresh('15m 60d (rolling)', '15m', NOW - 60 * DAY, NOW, 'sol-usd-15m-60d.json');
await refresh('5m 30d (rolling)', '5m', NOW - 30 * DAY, NOW, 'sol-usd-5m-30d.json');
await refresh('1m 7d (rolling)', '1m', NOW - 7 * DAY, NOW, 'sol-usd-1m-7d.json');
console.log('\nAll done. Re-baseline with: node tools/bt.mjs');
