#!/usr/bin/env node
// backtest/walkforward.mjs
// Fit TRAIL_GIVE_PCT on first 70% of real bear data, evaluate on last 30%.
// Confirms the 8-12 plateau and reports OOS numbers.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBacktest, loadSeries, paramsFromCfg } from '../src/backtest.mjs';
import { CFG } from '../src/common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const bearFile = path.join(ROOT, 'backtest/data/sol-usd-1d.json');

const series = loadSeries(bearFile);
const split  = Math.floor(series.length * 0.70);
const train  = series.slice(0, split);
const test   = series.slice(split);

const trainDays = ((train[train.length-1].t - train[0].t) / 86400000).toFixed(0);
const testDays  = ((test[test.length-1].t  - test[0].t)  / 86400000).toFixed(0);

console.log(`\nWalk-Forward: TRAIL_GIVE_PCT sensitivity`);
console.log(`Total ${series.length} candles | Train ${split} (${trainDays}d) / Test ${series.length - split} (${testDays}d)`);
console.log(`\n${'give%'.padStart(6)}  ${'TRAIN ret%'.padStart(10)}  ${'TRAIN DD%'.padStart(9)}  ${'TEST ret%'.padStart(9)}  ${'TEST DD%'.padStart(8)}`);
console.log('─'.repeat(55));

const candidates = [4, 6, 8, 10, 12, 15, 20];
let bestTrainRet = -Infinity, bestGive = null;

const results = candidates.map(give => {
  const P = paramsFromCfg(CFG);
  P.trailGivePct = give;
  const tr = runBacktest(train, P);
  const te = runBacktest(test,  P);
  if (tr.returnPct > bestTrainRet) { bestTrainRet = tr.returnPct; bestGive = give; }
  return { give, tr, te };
});

results.forEach(({ give, tr, te }) => {
  const marker = give === bestGive ? ' ← best train' : '';
  console.log(
    `${String(give).padStart(6)}  ` +
    `${tr.returnPct.toFixed(2).padStart(10)}  ` +
    `${tr.maxDrawdownPct.toFixed(2).padStart(9)}  ` +
    `${te.returnPct.toFixed(2).padStart(9)}  ` +
    `${te.maxDrawdownPct.toFixed(2).padStart(8)}${marker}`
  );
});

const chosen = results.find(r => r.give === bestGive);
console.log(`\nBest train give=${bestGive}%: train ${chosen.tr.returnPct.toFixed(2)}% / OOS test ${chosen.te.returnPct.toFixed(2)}%`);
console.log(`Current default (give=10): train ${results.find(r=>r.give===10).tr.returnPct.toFixed(2)}% / OOS ${results.find(r=>r.give===10).te.returnPct.toFixed(2)}%`);

const plateau = results.filter(r => [8,10,12].includes(r.give));
const allPos  = plateau.every(r => r.te.returnPct > 0);
console.log(`\nPlateau [8,10,12] OOS all positive: ${allPos ? 'YES ✓' : 'NO ✗'}`);
plateau.forEach(r => console.log(`  give=${r.give}%  OOS ${r.te.returnPct.toFixed(2)}%`));
