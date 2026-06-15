#!/usr/bin/env node
/**
 * Moderate Frequency Parameter Sweep
 * Tests specific parameter ranges for optimal frequency/performance balance
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CFG } from './common.mjs';
import { runBacktest, paramsFromCfg, loadSeries } from './backtest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function fmt(n, d = 2) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

async function main() {
  // Parameter ranges to test
  const signalMinSecs = [60, 120, 300];
  const cooldownSecs = [60, 180, 300];
  const maxTradesPerDay = [20, 50];
  const dailyNotionalLimitUsdc = [200, 500];
  const bullDipPcts = [0.5, 0.8];           // bearDipPct = bullDipPct * 1.6
  const bullRipPcts = [1.0, 1.2, 1.5];
  const bearRipPcts = [0.8, 1.0, 1.2];
  const stopLossPcts = [8, 10, 12, 14];
  const profitTargetPcts = [2.0, 3.0];
  const rsiOversolds = [30, 35, 40];

  // Generate all combinations
  const allCombos = [];
  for (const sigMin of signalMinSecs) {
    for (const cool of cooldownSecs) {
      for (const maxTrades of maxTradesPerDay) {
        for (const dailyNotional of dailyNotionalLimitUsdc) {
          for (const bullDip of bullDipPcts) {
            for (const bullRip of bullRipPcts) {
              for (const bearRip of bearRipPcts) {
                for (const sl of stopLossPcts) {
                  for (const pt of profitTargetPcts) {
                    for (const rsiOS of rsiOversolds) {
                      allCombos.push({
                        signalMinSec: sigMin,
                        cooldownSec: cool,
                        maxTradesPerDay: maxTrades,
                        dailyNotionalLimitUsdc: dailyNotional,
                        bullDipPct: bullDip,
                        bullRipPct: bullRip,
                        bearDipPct: bullDip * 1.6,
                        bearRipPct: bearRip,
                        stopLossPct: sl,
                        profitTargetPct: pt,
                        rsiOversold: rsiOS
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  const total = allCombos.length;
  console.log(`Total combinations: ${total}`);

  // Load data
  const dataFile = path.join(ROOT, 'backtest', 'data', 'sol-usd-1d-full.json');
  const series = loadSeries(dataFile);
  const days = (series[series.length - 1].t - series[0].t) / 86400000;
  console.log(`Data span: ${fmt(days, 1)} days, ${series.length} candles`);

  // Base config from CFG
  const base = paramsFromCfg(CFG);
  console.log(`Base config loaded`);

  // Load existing results if any
  const outputPath = path.join(ROOT, 'backtest', 'moderate-sweep-results.json');
  let allResults = [];
  if (fs.existsSync(outputPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      allResults = existing.allResults || [];
      console.log(`Loaded ${allResults.length} previous results.`);
    } catch (e) {
      console.log('No previous results found, starting fresh.');
    }
  }

  // Run sweep (skip already tested combinations)
  const testedKeys = new Set(allResults.map(r => JSON.stringify({
    signalMinSec: r.signalMinSec,
    cooldownSec: r.cooldownSec,
    maxTradesPerDay: r.maxTradesPerDay,
    dailyNotionalLimitUsdc: r.dailyNotionalLimitUsdc,
    bullDipPct: r.bullDipPct,
    bullRipPct: r.bullRipPct,
    bearDipPct: r.bearDipPct,
    bearRipPct: r.bearRipPct,
    stopLossPct: r.stopLossPct,
    profitTargetPct: r.profitTargetPct,
    rsiOversold: r.rsiOversold
  })));

  let newCount = 0;
  for (let i = 0; i < allCombos.length; i++) {
    const c = allCombos[i];
    const key = JSON.stringify(c);
    if (testedKeys.has(key)) continue;

    if ((newCount + 1) % 100 === 0) {
      console.log(`  Progress: ${newCount + 1}/${total - allResults.length} new (total tested: ${allResults.length + newCount})`);
    }

    const P = { ...base, ...c };
    const tr = runBacktest(series, P);
    const sharpeProxy = tr.maxDrawdownPct > 0 ? tr.returnPct / tr.maxDrawdownPct : 0;

    allResults.push({
      ...c,
      returnPct: tr.returnPct,
      vsHoldPct: tr.vsHoldMixPct,
      maxDrawdownPct: tr.maxDrawdownPct,
      trades: tr.trades,
      winRatePct: tr.winRatePct,
      sharpeProxy: sharpeProxy,
      profitTargetFires: tr.profitTargetFires,
      stopFires: tr.stopFires,
      endEquity: tr.endEquity
    });

    newCount++;

    // Save every 200 new results using temp file + rename for atomicity on Windows
    if (newCount % 200 === 0) {
      allResults.sort((a, b) => b.sharpeProxy - a.sharpeProxy || b.returnPct - a.returnPct);
      const outputData = {
        timestamp: new Date().toISOString(),
        dataFile: 'sol-usd-1d-full.json',
        totalCombinations: total,
        days: days,
        top20: allResults.slice(0, 20).map(r => ({
          signalMinSec: r.signalMinSec,
          cooldownSec: r.cooldownSec,
          maxTradesPerDay: r.maxTradesPerDay,
          dailyNotionalLimitUsdc: r.dailyNotionalLimitUsdc,
          bullDipPct: r.bullDipPct,
          bullRipPct: r.bullRipPct,
          bearDipPct: r.bearDipPct,
          bearRipPct: r.bearRipPct,
          stopLossPct: r.stopLossPct,
          profitTargetPct: r.profitTargetPct,
          rsiOversold: r.rsiOversold,
          returnPct: r.returnPct,
          vsHoldPct: r.vsHoldPct,
          maxDrawdownPct: r.maxDrawdownPct,
          trades: r.trades,
          winRatePct: r.winRatePct,
          sharpeProxy: r.sharpeProxy,
          profitTargetFires: r.profitTargetFires,
          stopFires: r.stopFires,
          endEquity: r.endEquity
        })),
        allResults: allResults
      };
      // Atomic write: write to temp file then rename
      const tempPath = outputPath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(outputData, null, 2));
      fs.renameSync(tempPath, outputPath);
    }
  }

  // Final sort and save
  allResults.sort((a, b) => b.sharpeProxy - a.sharpeProxy || b.returnPct - a.returnPct);

  const outputData = {
    timestamp: new Date().toISOString(),
    dataFile: 'sol-usd-1d-full.json',
    totalCombinations: total,
    days: days,
    top20: allResults.slice(0, 20).map(r => ({
      signalMinSec: r.signalMinSec,
      cooldownSec: r.cooldownSec,
      maxTradesPerDay: r.maxTradesPerDay,
      dailyNotionalLimitUsdc: r.dailyNotionalLimitUsdc,
      bullDipPct: r.bullDipPct,
      bullRipPct: r.bullRipPct,
      bearDipPct: r.bearDipPct,
      bearRipPct: r.bearRipPct,
      stopLossPct: r.stopLossPct,
      profitTargetPct: r.profitTargetPct,
      rsiOversold: r.rsiOversold,
      returnPct: r.returnPct,
      vsHoldPct: r.vsHoldPct,
      maxDrawdownPct: r.maxDrawdownPct,
      trades: r.trades,
      winRatePct: r.winRatePct,
      sharpeProxy: r.sharpeProxy,
      profitTargetFires: r.profitTargetFires,
      stopFires: r.stopFires,
      endEquity: r.endEquity
    })),
    allResults: allResults
  };
  // Atomic write
  const tempPath = outputPath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(outputData, null, 2));
  fs.renameSync(tempPath, outputPath);

  // Print top 20
  console.log(`\n=== MODERATE SWEEP TOP 20 (by Sharpe Proxy = return/maxDD) ===`);
  console.log('sigMin  cool  maxTrd  dailyNot  bDip  bRip  bDDip  bDRip  SL%  PT%  RSI  trades  ret%   vsH%   maxDD%  win%  sharpe');
  for (const r of allResults.slice(0, 20)) {
    console.log(
      `${String(r.signalMinSec).padStart(6)}  ${String(r.cooldownSec).padStart(4)}  ${String(r.maxTradesPerDay).padStart(5)}  ` +
      `${String(r.dailyNotionalLimitUsdc).padStart(8)}  ${fmt(r.bullDipPct,1).padStart(4)}  ${fmt(r.bullRipPct,1).padStart(4)}  ` +
      `${fmt(r.bearDipPct,1).padStart(5)}  ${fmt(r.bearRipPct,1).padStart(5)}  ${String(r.stopLossPct).padStart(3)}  ` +
      `${fmt(r.profitTargetPct,1).padStart(3)}  ${String(r.rsiOversold).padStart(3)}  ` +
      `${String(r.trades).padStart(6)}  ${fmt(r.returnPct,1).padStart(7)}  ${fmt(r.vsHoldPct,1).padStart(7)}  ` +
      `${fmt(r.maxDrawdownPct,1).padStart(7)}  ${fmt(r.winRatePct,1).padStart(5)}  ${fmt(r.sharpeProxy,2).padStart(6)}`
    );
  }
  console.log(`\nResults saved to: ${outputPath}`);
  console.log(`Total results: ${allResults.length}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});