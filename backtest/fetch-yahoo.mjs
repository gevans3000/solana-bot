#!/usr/bin/env node
// fetch-yahoo.mjs — fetch SOL/USD OHLCV from Yahoo Finance
// Node 18+ built-in fetch. Run: node backtest/fetch-yahoo.mjs
// Outputs to backtest/data/  (no auth required, no rate limits for small requests)

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchYahoo(interval, range, period1, period2) {
  const base = 'https://query1.finance.yahoo.com/v8/finance/chart/SOL-USD';
  const qs = range
    ? `interval=${interval}&range=${range}&includePrePost=false`
    : `interval=${interval}&period1=${period1}&period2=${period2}&includePrePost=false`;
  const url = `${base}?${qs}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${interval}`);
  const d = await r.json();
  const res = d?.chart?.result?.[0];
  if (!res?.timestamp) throw new Error(`No data for ${interval}: ${JSON.stringify(d?.chart?.error)}`);
  const ts = res.timestamp;
  const q  = res.indicators.quote[0];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close[i];
    if (c == null || c <= 0) continue;
    out.push([ts[i],
      +((q.open[i]  || c).toFixed(4)),
      +((q.high[i]  || c).toFixed(4)),
      +((q.low[i]   || c).toFixed(4)),
      +(c.toFixed(4)),
      (q.volume[i] | 0)
    ]);
  }
  return out;
}

// Paginated hourly fetch (Yahoo caps at ~750 candles per 1h request)
async function fetchHourly(totalDays) {
  const now   = Math.floor(Date.now() / 1000);
  const start = now - totalDays * 86400;
  const all   = [];
  const seen  = new Set();
  let cursor  = start;
  while (cursor < now) {
    const end   = Math.min(cursor + 90 * 86400, now);
    const chunk = await fetchYahoo('1h', null, cursor, end);
    for (const c of chunk) {
      if (!seen.has(c[0])) { seen.add(c[0]); all.push(c); }
    }
    console.log(`  1h chunk: ${chunk.length} candles (total ${all.length})`);
    cursor = end + 3601;
    await sleep(250);
  }
  all.sort((a, b) => a[0] - b[0]);
  return all;
}

const datasets = [
  // [label, outputFile, fetchFn]
  ['5yr Daily',    'sol-usd-1d-5yr.json',   () => fetchYahoo('1d',  null, Math.floor(Date.now()/1000)-5*365*86400, Math.floor(Date.now()/1000))],
  ['540d Hourly',  'sol-usd-1h-540d.json',  () => fetchHourly(540)],
  ['60d 15-min',   'sol-usd-15m-60d.json',  () => fetchYahoo('15m', '60d')],
  ['30d 5-min',    'sol-usd-5m-30d.json',   () => fetchYahoo('5m',  '30d')],
  ['7d 1-min',     'sol-usd-1m-7d.json',    () => fetchYahoo('1m',  '7d')],
];

console.log('Fetching SOL/USD historical data from Yahoo Finance...\n');
for (const [label, file, fn] of datasets) {
  try {
    console.log(`[${label}]`);
    const candles = await fn();
    const outPath = path.join(DATA_DIR, file);
    fs.writeFileSync(outPath, JSON.stringify(candles));
    const span  = ((candles.at(-1)[0] - candles[0][0]) / 86400).toFixed(0);
    const lo    = Math.min(...candles.map(c => c[4])).toFixed(2);
    const hi    = Math.max(...candles.map(c => c[4])).toFixed(2);
    const chg   = ((candles.at(-1)[4] / candles[0][4] - 1) * 100).toFixed(1);
    console.log(`  ✓ ${candles.length} candles | ${span} days | $${lo}–$${hi} | ${chg}%`);
    console.log(`  → ${outPath}\n`);
    await sleep(300);
  } catch (e) {
    console.error(`  ✗ ${label}: ${e.message}\n`);
  }
}
console.log('Done. Run: node src/backtest.mjs --data backtest/data/<file>');
