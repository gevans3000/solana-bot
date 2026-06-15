#!/usr/bin/env node
/**
 * Custom Walk-Forward Validation (70/30) for specified configs
 * Tests: current moderate config + sweep variant configs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CFG } from './src/common.mjs';
import { runBacktest, loadSeries, paramsFromCfg } from './src/backtest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const dataFile = 'C:\\Users\\lovel\\Claude\\Projects\\Solana bot\\backtest\\data\\sol-usd-1d-full.json';

const series = loadSeries(dataFile);
const split = Math.floor(series.length * 0.70);
const train = series.slice(0, split);
const test = series.slice(split);

const trainDays = ((train[train.length-1].t - train[0].t) / 86400000).toFixed(0);
const testDays = ((test[test.length-1].t - test[0].t) / 86400000).toFixed(0);

console.log(`\n=== WALK-FORWARD VALIDATION (70/30) ===`);
console.log(`Data: sol-usd-1d-full.json`);
console.log(`Total: ${series.length} candles | Train: ${split} (${trainDays}d) / Test: ${series.length - split} (${testDays}d)`);
console.log('');

function fmt(n, d = 2) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function runWF(config, label) {
  const P = { ...paramsFromCfg(CFG), ...config };
  
  const tr = runBacktest(train, P);
  const te = runBacktest(test, P);
  
  const overfitGap = tr.returnPct - te.returnPct;
  
  return {
    label,
    config,
    train: {
      returnPct: tr.returnPct,
      vsHoldPct: tr.vsHoldMixPct,
      maxDrawdownPct: tr.maxDrawdownPct,
      trades: tr.trades,
      wins: tr.wins,
      losses: tr.losses,
      winRatePct: tr.winRatePct,
      profitTargetFires: tr.profitTargetFires,
      stopFires: tr.stopFires,
    },
    test: {
      returnPct: te.returnPct,
      vsHoldPct: te.vsHoldMixPct,
      maxDrawdownPct: te.maxDrawdownPct,
      trades: te.trades,
      wins: te.wins,
      losses: te.losses,
      winRatePct: te.winRatePct,
      profitTargetFires: te.profitTargetFires,
      stopFires: te.stopFires,
    },
    overfitGap,
  };
}

function printResult(r) {
  console.log(`\n--- ${r.label} ---`);
  console.log(`Config: bullDip ${r.config.bullDipPct}% rip ${r.config.bullRipPct}% | bearDip ${r.config.bearDipPct}% rip ${r.config.bearRipPct}%`);
  console.log(`        SL ${r.config.stopLossPct}% PT ${r.config.profitTargetPct}% | RSI OS ${r.config.rsiOversold}`);
  console.log(`        signalMin ${r.config.signalMinSec}s cool ${r.config.cooldownSec}s maxTrades/day ${r.config.maxTradesPerDay}`);
  console.log('');
  console.log(`  TRAIN (${trainDays}d):  ret=${fmt(r.train.returnPct)}%  vsHold=${fmt(r.train.vsHoldPct)}%  maxDD=${fmt(r.train.maxDrawdownPct)}%  trades=${r.train.trades}  winRate=${fmt(r.train.winRatePct,1)}% (${r.train.wins}W/${r.train.losses}L)`);
  console.log(`  TEST  (${testDays}d):  ret=${fmt(r.test.returnPct)}%  vsHold=${fmt(r.test.vsHoldPct)}%  maxDD=${fmt(r.test.maxDrawdownPct)}%  trades=${r.test.trades}  winRate=${fmt(r.test.winRatePct,1)}% (${r.test.wins}W/${r.test.losses}L)`);
  console.log(`  OVERFIT GAP: ${fmt(r.overfitGap)}pp (train - test return)`);
  console.log(`  TEST vs HOLD: ${fmt(r.test.vsHoldPct)}pp`);
}

console.log('════════════════════════════════════════════════════════════════════════');
console.log('CONFIG 1: CURRENT MODERATE (from .env specification)');
console.log('════════════════════════════════════════════════════════════════════════');

const currentModerate = {
  bullDipPct: 0.5,
  bullRipPct: 1.2,
  bearDipPct: 0.5,
  bearRipPct: 1.0,
  stopLossPct: 12,
  profitTargetPct: 3.0,
  rsiOversold: 35,
  signalMinSec: 120,
  cooldownSec: 300,
  maxTradesPerDay: 20,
};

const r1 = runWF(currentModerate, 'CURRENT MODERATE');
printResult(r1);

console.log('\n════════════════════════════════════════════════════════════════════════');
console.log('CONFIG 2: SWEEP BEST (signalMin=60, cooldown=60, maxTrades=20, dailyNotional=200)');
console.log('════════════════════════════════════════════════════════════════════════');

// From sweep results top entries
const sweepBest1 = {
  bullDipPct: 0.5,
  bullRipPct: 1.0,
  bearDipPct: 0.8,  // 0.5 * 1.6
  bearRipPct: 0.8,
  stopLossPct: 10,
  profitTargetPct: 2.0,
  rsiOversold: 30,
  signalMinSec: 60,
  cooldownSec: 60,
  maxTradesPerDay: 20,
  dailyNotionalLimitUsdc: 200,
};

const r2 = runWF(sweepBest1, 'SWEEP BEST #1 (top result)');
printResult(r2);

console.log('\n════════════════════════════════════════════════════════════════════════');
console.log('CONFIG 3: SWEEP BEST VARIANT (bullRip=1.2, bearRip=1.0)');
console.log('════════════════════════════════════════════════════════════════════════');

const sweepBest2 = {
  bullDipPct: 0.5,
  bullRipPct: 1.2,
  bearDipPct: 0.8,
  bearRipPct: 1.0,
  stopLossPct: 10,
  profitTargetPct: 2.0,
  rsiOversold: 30,
  signalMinSec: 60,
  cooldownSec: 60,
  maxTradesPerDay: 20,
  dailyNotionalLimitUsdc: 200,
};

const r3 = runWF(sweepBest2, 'SWEEP BEST #2 (bullRip=1.2)');
printResult(r3);

console.log('\n════════════════════════════════════════════════════════════════════════');
console.log('CONFIG 4: SWEEP BEST VARIANT (profitTarget=3%, stopLoss=12%)');
console.log('════════════════════════════════════════════════════════════════════════');

const sweepBest3 = {
  bullDipPct: 0.5,
  bullRipPct: 1.0,
  bearDipPct: 0.8,
  bearRipPct: 1.0,
  stopLossPct: 12,
  profitTargetPct: 3.0,
  rsiOversold: 35,
  signalMinSec: 60,
  cooldownSec: 60,
  maxTradesPerDay: 20,
  dailyNotionalLimitUsdc: 200,
};

const r4 = runWF(sweepBest3, 'SWEEP BEST #3 (PT=3%, SL=12%)');
printResult(r4);

console.log('\n════════════════════════════════════════════════════════════════════════');
console.log('CONFIG 5: MODERATE-LIKE (signalMin=120, cooldown=300, sweep params)');
console.log('════════════════════════════════════════════════════════════════════════');

const moderateLike = {
  bullDipPct: 0.5,
  bullRipPct: 1.0,
  bearDipPct: 0.8,
  bearRipPct: 0.8,
  stopLossPct: 10,
  profitTargetPct: 2.0,
  rsiOversold: 30,
  signalMinSec: 120,
  cooldownSec: 300,
  maxTradesPerDay: 20,
  dailyNotionalLimitUsdc: 200,
};

const r5 = runWF(moderateLike, 'MODERATE-LIKE (120/300)');
printResult(r5);

console.log('\n════════════════════════════════════════════════════════════════════════');
console.log('SUMMARY TABLE');
console.log('════════════════════════════════════════════════════════════════════════');
console.log('Config                          | TRAIN ret%  TEST ret%  TEST vsH%  OVRFT%  trDD%  teDD%  TRtrd  TEtrd  TRwr%  TEwr%');
console.log('----------------------------------------------------------------------------------------------------------------');

const allResults = [r1, r2, r3, r4, r5];
for (const r of allResults) {
  const name = r.label.padEnd(32);
  console.log(
    `${name} | ` +
    `${fmt(r.train.returnPct).padStart(8)}  ` +
    `${fmt(r.test.returnPct).padStart(8)}  ` +
    `${fmt(r.test.vsHoldPct).padStart(9)}  ` +
    `${fmt(r.overfitGap).padStart(7)}  ` +
    `${fmt(r.train.maxDrawdownPct).padStart(5)}  ` +
    `${fmt(r.test.maxDrawdownPct).padStart(5)}  ` +
    `${String(r.train.trades).padStart(5)}  ` +
    `${String(r.test.trades).padStart(5)}  ` +
    `${fmt(r.train.winRatePct,1).padStart(6)}  ` +
    `${fmt(r.test.winRatePct,1).padStart(6)}`
  );
}

console.log('\nDone.');