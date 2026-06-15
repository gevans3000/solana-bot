#!/usr/bin/env node
/**
 * Walk-Forward Validation Matrix (70/30) for 4 Configs on sol-usd-1d-full.json
 * Outputs: backtest/walkforward-matrix-results.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CFG } from './src/common.mjs';
import { loadSeries, runBacktest, paramsFromCfg } from './src/backtest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname);
const dataFile = path.join(ROOT, 'backtest', 'data', 'sol-usd-1d-full.json');
const outputFile = path.join(ROOT, 'backtest', 'walkforward-matrix-results.json');

const series = loadSeries(dataFile);
const split = Math.floor(series.length * 0.70);
const train = series.slice(0, split);
const test = series.slice(split);

const trainDays = (train[train.length-1].t - train[0].t) / 86400000;
const testDays = (test[test.length-1].t - test[0].t) / 86400000;

console.log(`\n=== WALK-FORWARD VALIDATION MATRIX (70/30) ===`);
console.log(`Data: sol-usd-1d-full.json`);
console.log(`Total: ${series.length} candles | Train: ${split} (${trainDays.toFixed(1)}d) / Test: ${series.length - split} (${testDays.toFixed(1)}d)`);
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
    config: {
      signalMinSec: P.signalMinSec,
      cooldownSec: P.cooldownSec,
      conflictEdgeResolution: P.conflictEdgeResolution,
      bullDipPct: P.bullDipPct,
      bearDipPct: P.bearDipPct,
      bullRipPct: P.bullRipPct,
      bearRipPct: P.bearRipPct,
      stopLossPct: P.stopLossPct,
      profitTargetPct: P.profitTargetPct,
      rsiOversold: P.rsiOversold,
      regimeEmaSlow: P.regimeEmaSlow,
    },
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
  const c = r.config;
  console.log(`Config: signalMin=${c.signalMinSec}s cool=${c.cooldownSec}s conflictEdge=${c.conflictEdgeResolution}`);
  console.log(`        bullDip=${c.bullDipPct}% bearDip=${c.bearDipPct}% | bullRip=${c.bullRipPct}% bearRip=${c.bearRipPct}%`);
  console.log(`        SL=${c.stopLossPct}% PT=${c.profitTargetPct}% | RSI OS=${c.rsiOversold} | regimeEmaSlow=${c.regimeEmaSlow}`);
  console.log('');
  console.log(`  TRAIN (${trainDays.toFixed(1)}d): ret=${fmt(r.train.returnPct)}% vsHold=${fmt(r.train.vsHoldPct)}% maxDD=${fmt(r.train.maxDrawdownPct)}% trades=${r.train.trades} winRate=${fmt(r.train.winRatePct,1)}% PT=${r.train.profitTargetFires} SL=${r.train.stopFires}`);
  console.log(`  TEST  (${testDays.toFixed(1)}d): ret=${fmt(r.test.returnPct)}% vsHold=${fmt(r.test.vsHoldPct)}% maxDD=${fmt(r.test.maxDrawdownPct)}% trades=${r.test.trades} winRate=${fmt(r.test.winRatePct,1)}% PT=${r.test.profitTargetFires} SL=${r.test.stopFires}`);
  console.log(`  OVERFIT GAP: ${fmt(r.overfitGap)}pp (train - test return)`);
  console.log(`  TEST vs HOLD: ${fmt(r.test.vsHoldPct)}pp`);
}

// CONFIG A - ORIGINAL
console.log('════════════════════════════════════════════════════════════════════════');
console.log('CONFIG A: ORIGINAL');
console.log('════════════════════════════════════════════════════════════════════════');

const configA = {
  signalMinSec: 120,
  cooldownSec: 300,
  conflictEdgeResolution: false,
  bullDipPct: 0.8,
  bearDipPct: 0.5,
  bullRipPct: 1.2,
  bearRipPct: 1.0,
  stopLossPct: 12,
  profitTargetPct: 3.0,
  rsiOversold: 35,
  regimeEmaSlow: 45,
};

const rA = runWF(configA, 'CONFIG A - ORIGINAL');
printResult(rA);

// CONFIG B - 3 ZERO-RISK
console.log('\n════════════════════════════════════════════════════════════════════════');
console.log('CONFIG B: 3 ZERO-RISK');
console.log('════════════════════════════════════════════════════════════════════════');

const configB = {
  signalMinSec: 60,
  cooldownSec: 60,
  conflictEdgeResolution: true,
  bullDipPct: 0.8,
  bearDipPct: 0.5,
  bullRipPct: 1.2,
  bearRipPct: 1.0,
  stopLossPct: 12,
  profitTargetPct: 3.0,
  rsiOversold: 35,
  regimeEmaSlow: 45,
};

const rB = runWF(configB, 'CONFIG B - 3 ZERO-RISK');
printResult(rB);

// CONFIG C - TIER 2
console.log('\n════════════════════════════════════════════════════════════════════════');
console.log('CONFIG C: TIER 2');
console.log('════════════════════════════════════════════════════════════════════════');

const configC = {
  signalMinSec: 60,
  cooldownSec: 60,
  conflictEdgeResolution: true,
  bullDipPct: 0.5,
  bearDipPct: 0.8,
  bullRipPct: 1.2,
  bearRipPct: 1.0,
  stopLossPct: 12,
  profitTargetPct: 3.0,
  rsiOversold: 35,
  regimeEmaSlow: 50,
};

const rC = runWF(configC, 'CONFIG C - TIER 2');
printResult(rC);

// CONFIG D - SWEEP BEST
console.log('\n════════════════════════════════════════════════════════════════════════');
console.log('CONFIG D: SWEEP BEST');
console.log('════════════════════════════════════════════════════════════════════════');

const configD = {
  signalMinSec: 60,
  cooldownSec: 60,
  conflictEdgeResolution: true,
  bullDipPct: 0.5,
  bearDipPct: 0.8,
  bullRipPct: 1.0,
  bearRipPct: 0.8,
  stopLossPct: 10,
  profitTargetPct: 2.0,
  rsiOversold: 30,
  regimeEmaSlow: 50,
};

const rD = runWF(configD, 'CONFIG D - SWEEP BEST');
printResult(rD);

// Summary table
console.log('\n════════════════════════════════════════════════════════════════════════');
console.log('SUMMARY TABLE');
console.log('════════════════════════════════════════════════════════════════════════');
console.log('Config         | TRAIN ret%  TEST ret%  TEST vsH%  OVRFT%  trDD%  teDD%  TRtrd  TEtrd  TRwr%  TEwr%  TRpt  TRsl  TEpt  TEsl');
console.log('------------------------------------------------------------------------------------------------------------------------------------');

const allResults = [rA, rB, rC, rD];
for (const r of allResults) {
  const name = r.label.padEnd(14);
  console.log(
    `${name} | ` +
    `${fmt(r.train.returnPct).padStart(9)}  ` +
    `${fmt(r.test.returnPct).padStart(9)}  ` +
    `${fmt(r.test.vsHoldPct).padStart(9)}  ` +
    `${fmt(r.overfitGap).padStart(7)}  ` +
    `${fmt(r.train.maxDrawdownPct).padStart(5)}  ` +
    `${fmt(r.test.maxDrawdownPct).padStart(5)}  ` +
    `${String(r.train.trades).padStart(5)}  ` +
    `${String(r.test.trades).padStart(5)}  ` +
    `${fmt(r.train.winRatePct,1).padStart(6)}  ` +
    `${fmt(r.test.winRatePct,1).padStart(6)}  ` +
    `${String(r.train.profitTargetFires).padStart(4)}  ` +
    `${String(r.train.stopFires).padStart(4)}  ` +
    `${String(r.test.profitTargetFires).padStart(4)}  ` +
    `${String(r.test.stopFires).padStart(4)}`
  );
}

// Prepare output JSON
const output = {
  timestamp: new Date().toISOString(),
  dataFile: 'sol-usd-1d-full.json',
  split: '70/30',
  trainCandles: train.length,
  testCandles: test.length,
  trainDays: trainDays,
  testDays: testDays,
  configs: allResults.map(r => ({
    label: r.label,
    config: r.config,
    train: r.train,
    test: r.test,
    overfitGap: r.overfitGap,
    testVsHoldPct: r.test.vsHoldPct,
  })),
};

fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
console.log(`\nResults saved to: ${outputFile}`);
console.log('Done.');
