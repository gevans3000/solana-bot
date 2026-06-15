#!/usr/bin/env node
/**
 * Custom walk-forward validation with specific parameters
 */
import { loadSeries, runBacktest, paramsFromCfg } from './backtest.mjs';
import { CFG } from './common.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const base = paramsFromCfg(CFG);

// Override with the specific parameters from the best sweep config
const customParams = {
  ...base,
  bullDipPct: 0.5,
  bullRipPct: 1.2,
  bearDipPct: 0.5 * 1.6,  // 0.8%
  bearRipPct: 1.2 * 0.7,  // 0.84%
  emaPeriod: 20,
  rsiOversold: 30,
  profitTargetPct: 2.0,
  stopLossPct: 20,
};

const dataFile = path.join(ROOT, 'backtest', 'data', 'sol-usd-1d-full.json');
const series = loadSeries(dataFile);

console.log('=== WALK-FORWARD VALIDATION (70/30) ===');
console.log('Custom Config: bullDip 0.5% rip 1.2% | bearDip 0.8% rip 0.84%');
console.log(`Flags: EMA(${customParams.emaPeriod}) | RSI OS<${customParams.rsiOversold} | PT${customParams.profitTargetPct}% | SL${customParams.stopLossPct}%`);
console.log(`Data: ${series.length} candles (${((series[series.length-1].t - series[0].t) / 86400000).toFixed(1)} days)\n`);

// 70/30 split
const splitIdx = Math.floor(series.length * 0.70);
const train = series.slice(0, splitIdx);
const test = series.slice(splitIdx);

const trainDays = (train[train.length-1].t - train[0].t) / 86400000;
const testDays = (test[test.length-1].t - test[0].t) / 86400000;

console.log(`Train: ${train.length} candles (${trainDays.toFixed(1)} days)`);
console.log(`Test:  ${test.length} candles (${testDays.toFixed(1)} days)\n`);

// Run on train
const trainResult = runBacktest(train, customParams);

// Run on test
const testResult = runBacktest(test, customParams);

// Report
function fmt(n, d=2) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }

console.log('=== TRAIN RESULTS ===');
console.log(`Return: ${fmt(trainResult.returnPct)}%`);
console.log(`Max DD: ${fmt(trainResult.maxDrawdownPct)}%`);
console.log(`Trades: ${trainResult.trades} (buys ${trainResult.buys}, sells ${trainResult.sells})`);
console.log(`Win Rate: ${fmt(trainResult.winRatePct,1)}%`);
console.log(`PT Fires: ${trainResult.profitTargetFires} | SL Fires: ${trainResult.stopFires}`);
console.log(`vs Hold: ${fmt(trainResult.vsHoldMixPct)}%`);

console.log('\n=== TEST RESULTS ===');
console.log(`Return: ${fmt(testResult.returnPct)}%`);
console.log(`Max DD: ${fmt(testResult.maxDrawdownPct)}%`);
console.log(`Trades: ${testResult.trades} (buys ${testResult.buys}, sells ${testResult.sells})`);
console.log(`Win Rate: ${fmt(testResult.winRatePct,1)}%`);
console.log(`PT Fires: ${testResult.profitTargetFires} | SL Fires: ${testResult.stopFires}`);
console.log(`vs Hold: ${fmt(testResult.vsHoldMixPct)}%`);

console.log('\n=== WALK-FORWARD ANALYSIS ===');
const overfitGap = trainResult.returnPct - testResult.returnPct;
console.log(`Train Return: ${fmt(trainResult.returnPct)}%`);
console.log(`Test Return:  ${fmt(testResult.returnPct)}%`);
console.log(`Overfit Gap:  ${fmt(overfitGap)}% (train - test)`);
console.log(`Test vs Hold: ${fmt(testResult.vsHoldMixPct)}%`);
console.log(`Max DD Train: ${fmt(trainResult.maxDrawdownPct)}%`);
console.log(`Max DD Test:  ${fmt(testResult.maxDrawdownPct)}%`);
console.log(`Trades Train: ${trainResult.trades}`);
console.log(`Trades Test:  ${testResult.trades}`);
console.log(`Win Rate Train: ${fmt(trainResult.winRatePct,1)}%`);
console.log(`Win Rate Test:  ${fmt(testResult.winRatePct,1)}%`);
