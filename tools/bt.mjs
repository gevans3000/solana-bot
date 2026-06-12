#!/usr/bin/env node
// tools/bt.mjs — fast backtest sweep runner.
// Usage:
//   node tools/bt.mjs [key=val ...] [--data name1,name2] [--thirds] [--json] [--git <rev>]
// Keys are paramsFromCfg() fields (e.g. bullDipPct=0.6 bearRsiMax=30 cooldownSec=300).
// --data takes short names (1d, 1h-540d, 15m-60d, 5m-30d, 1m-7d, 1d-5yr, 1d-full, 1d-bull).
// --thirds runs each dataset in 3 equal time segments (walk-forward check).
// --git <rev> loads datasets from that git commit instead of the working tree —
//   TWO-WINDOW VALIDATION: every knob change must hold the bar on the current data AND
//   on the previous window (e.g. --git HEAD~1 or the last data-refresh commit), because
//   single-window optima have been shown not to transfer (2026-06-12: trail=14 scored
//   bear 8.49 on the prior window — below the 9.0 floor it was fitted to restore).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { paramsFromCfg, runBacktest, loadSeries } from '../src/backtest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let DATA = path.resolve(__dirname, '..', 'backtest', 'data');

const DEFAULT_SETS = ['1d', '1h-540d', '15m-60d', '5m-30d', '1m-7d', '1d-5yr', '1d-full', '1d-bull'];

const args = process.argv.slice(2);
const overrides = {};
let sets = DEFAULT_SETS, thirds = false, asJson = false, gitRev = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--data') { sets = args[++i].split(','); }
  else if (a === '--thirds') thirds = true;
  else if (a === '--json') asJson = true;
  else if (a === '--git') gitRev = args[++i];
  else if (a.includes('=')) {
    const [k, v] = a.split('=');
    overrides[k] = v === 'true' ? true : v === 'false' ? false : +v;
  }
}

if (gitRev) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-git-'));
  for (const s of sets) {
    const blob = execFileSync('git', ['show', `${gitRev}:backtest/data/sol-usd-${s}.json`],
      { cwd: path.resolve(__dirname, '..'), maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(path.join(tmp, `sol-usd-${s}.json`), blob);
  }
  DATA = tmp;
  console.log(`(datasets from git ${gitRev})`);
}

const P = { ...paramsFromCfg(), ...overrides };
const out = [];
for (const s of sets) {
  const series = loadSeries(path.join(DATA, `sol-usd-${s}.json`));
  if (thirds) {
    const n = Math.floor(series.length / 3);
    for (let t = 0; t < 3; t++) {
      const seg = series.slice(t * n, t === 2 ? series.length : (t + 1) * n);
      const r = runBacktest(seg, P);
      out.push({ set: `${s}#${t + 1}`, ret: +r.returnPct.toFixed(2), trades: r.trades,
        win: +r.winRatePct.toFixed(0), vsHold: +r.vsHoldMixPct.toFixed(2) });
    }
  } else {
    const r = runBacktest(series, P);
    out.push({ set: s, ret: +r.returnPct.toFixed(2), trades: r.trades,
      win: +r.winRatePct.toFixed(0), vsHold: +r.vsHoldMixPct.toFixed(2) });
  }
}
if (asJson) console.log(JSON.stringify(out));
else for (const o of out) console.log(
  `${o.set.padEnd(12)} ret ${String(o.ret).padStart(8)}%  trades ${String(o.trades).padStart(4)}  win ${String(o.win).padStart(3)}%  vsHold ${String(o.vsHold).padStart(8)}`);
