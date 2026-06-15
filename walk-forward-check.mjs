import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CFG } from './src/common.mjs';
import { loadSeries, runBacktest, paramsFromCfg } from './src/backtest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname);  // Already at project root

const base = paramsFromCfg(CFG);
const file = path.join(ROOT, 'backtest', 'data', 'sol-usd-1d-full.json');
const series = loadSeries(file);

const splitIdx = Math.floor(series.length * 0.70);
const train = series.slice(0, splitIdx);
const test = series.slice(splitIdx);

console.log('=== WALK-FORWARD VALIDATION (70/30) ===');
console.log('Total candles:', series.length);
console.log('Train:', train.length, 'candles,', ((train[train.length-1].t - train[0].t) / 86400000).toFixed(1), 'days');
console.log('Test:', test.length, 'candles,', ((test[test.length-1].t - test[0].t) / 86400000).toFixed(1), 'days');

const tr = runBacktest(train, base);
const te = runBacktest(test, base);

console.log('\n--- TRAIN (first 70%) ---');
console.log('Return:', tr.returnPct.toFixed(2), '%');
console.log('vs Hold:', tr.vsHoldMixPct.toFixed(2), 'pp');
console.log('Max DD:', tr.maxDrawdownPct.toFixed(2), '%');
console.log('Trades:', tr.trades, '| Win Rate:', tr.winRatePct.toFixed(1), '%');
console.log('PT fires:', tr.profitTargetFires, '| SL fires:', tr.stopFires);

console.log('\n--- TEST (last 30%) ---');
console.log('Return:', te.returnPct.toFixed(2), '%');
console.log('vs Hold:', te.vsHoldMixPct.toFixed(2), 'pp');
console.log('Max DD:', te.maxDrawdownPct.toFixed(2), '%');
console.log('Trades:', te.trades, '| Win Rate:', te.winRatePct.toFixed(1), '%');
console.log('PT fires:', te.profitTargetFires, '| SL fires:', te.stopFires);

console.log('\n--- VALIDATION BAR ---');
const trainVsHold = tr.vsHoldMixPct;
const testVsHold = te.vsHoldMixPct;
const overfitGap = trainVsHold - testVsHold;
console.log('Train vs Hold:', trainVsHold.toFixed(2), 'pp');
console.log('Test vs Hold:', testVsHold.toFixed(2), 'pp');
console.log('Overfit gap (train - test vs hold):', overfitGap.toFixed(2), 'pp');
console.log('Test beats hold:', testVsHold > 0 ? 'YES' : 'NO');
console.log('');

const passes = testVsHold > 0 && overfitGap < 20;
console.log('PASSES VALIDATION:', passes ? 'YES' : 'NO');
console.log('  - Test beats hold:', testVsHold > 0 ? 'PASS' : 'FAIL');
console.log('  - Overfit gap < 20pp:', overfitGap < 20 ? 'PASS' : 'FAIL');