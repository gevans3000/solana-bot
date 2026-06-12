#!/usr/bin/env node
// tools/sweep.mjs — one-knob-at-a-time grid sweep, all datasets loaded once.
// Usage: node tools/sweep.mjs knob=v1,v2,v3 [knob2=v1,v2] ...
// Prints per-value: each dataset's return delta vs current-config baseline,
// plus 1h trades and the intraday mean delta. Bear floor flagged at < 9.0.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paramsFromCfg, runBacktest, loadSeries } from '../src/backtest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '..', 'backtest', 'data');
const SETS = ['1d', '1h-540d', '15m-60d', '5m-30d', '1m-7d', '1d-5yr', '1d-full', '1d-bull'];
const INTRADAY = ['1h-540d', '15m-60d', '5m-30d', '1m-7d'];

const series = {};
for (const s of SETS) series[s] = loadSeries(path.join(DATA, `sol-usd-${s}.json`));

const base = paramsFromCfg();
const run = (P) => {
  const res = {};
  for (const s of SETS) {
    const r = runBacktest(series[s], P);
    res[s] = { ret: r.returnPct, trades: r.trades, win: r.winRatePct };
  }
  res._intraday = INTRADAY.reduce((a, s) => a + res[s].ret, 0) / INTRADAY.length;
  return res;
};
const B = run(base);
console.log(`BASELINE  1h ${B['1h-540d'].ret.toFixed(2)}% (${B['1h-540d'].trades} tr, win ${B['1h-540d'].win.toFixed(0)}%)  intraday ${B._intraday.toFixed(2)}  bear ${B['1d'].ret.toFixed(2)}`);

const parse = (v) => v === 'true' ? true : v === 'false' ? false : +v;
for (const arg of process.argv.slice(2)) {
  const [knob, vals] = arg.split('=');
  console.log(`\n=== ${knob} (current ${base[knob]}) ===`);
  for (const vs of vals.split(',')) {
    const v = parse(vs);
    if (v === base[knob]) { console.log(`  ${vs}: (baseline)`); continue; }
    const R = run({ ...base, [knob]: v });
    const d = (s) => (R[s].ret - B[s].ret).toFixed(2).padStart(7);
    const bearFlag = R['1d'].ret < 9.0 ? ' BEAR-BREAK' : '';
    console.log(`  ${String(vs).padEnd(6)} 1h ${d('1h-540d')} (${String(R['1h-540d'].trades).padStart(3)} tr, win ${R['1h-540d'].win.toFixed(0)}%)` +
      ` | intra ${(R._intraday - B._intraday).toFixed(2).padStart(6)} | bear ${R['1d'].ret.toFixed(2)}${bearFlag}` +
      ` | 15m ${d('15m-60d')} 5m ${d('5m-30d')} 1m ${d('1m-7d')} | 5yr ${d('1d-5yr')} full ${d('1d-full')} bull ${d('1d-bull')}`);
  }
}
