#!/usr/bin/env node
/**
 * Comparison runner: runs backtest on ALL datasets with TWO configs
 * 1. CURRENT config (from .env.example): BULL_DIP=0.8, BULL_RIP=1.5, BEAR_DIP=1.5, BEAR_RIP=0.5, EMA=20, RSI_OS=40, SL=8, PT=3, SIGNAL_MIN=300, COOLDOWN=900, MAX_TRADES=8
 * 2. OPTIMIZED config (from sweep): BULL_DIP=0.5, BULL_RIP=1.2, BEAR_DIP=0.5, BEAR_RIP=1.2, EMA=20, RSI_OS=30, SL=20, PT=2, SIGNAL_MIN=60, COOLDOWN=60, MAX_TRADES=50
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSeries, runBacktest } from './backtest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'backtest', 'data');

function fmt(n, d = 2) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// Config 1: CURRENT (from .env.example)
const CURRENT_CONFIG = {
  bullDipPct: 0.8, bullRipPct: 1.5,
  bearDipPct: 1.5, bearRipPct: 0.5,
  bullBuyUsdc: 1, bullSellSol: 0.01,
  bearBuyUsdc: 1, bearSellSol: 0.01,
  minExpectedEdgeBps: 20,
  minTradeUsdc: 1, maxNotionalUsdc: 8,
  dailyNotionalLimitUsdc: 50,
  maxTradesPerDay: 8,
  minSolReserve: 0.01, maxSolAllocationPct: 60,
  signalMinSec: 300, cooldownSec: 900,
  decisionWindowSec: 60, staleSignalSec: 180,
  simStartUsdc: 1000, simStartSol: 5,
  simFeeBps: 30, simSlippageBps: 8,
  trendFilterEnabled: true, emaPeriod: 20,
  regimeFilterEnabled: true, regimeEmaSlow: 45,
  useAtrThresholds: false, atrPeriod: 14, atrDipMult: 1.0, atrRipMult: 0.7, atrMinDipPct: 0.1, atrMinRipPct: 0.1,
  rsiEnabled: true, rsiPeriod: 14, rsiOversold: 40, rsiOverbought: 70,
  rsiScaleBuyEnabled: false, rsiScaleMaxMult: 2.0,
  profitTargetEnabled: true, profitTargetPct: 3.0,
  profitTargetBypassCooldown: false,
  stopLossEnabled: true, stopLossPct: 8,
  trailInUptrend: true, trailArmPct: 2.0, trailGivePct: 10,
  intrabarStops: true,
  anchorCooldownBars: 2,
  entryBounceConfirm: false,
  botSpecializationEnabled: true, bearRsiMax: 30,
  bullRegimeThreshold: 7.0, bullDipScale: 3.0,
  regimeSizeEnabled: true, regimeSizeUpMult: 2.0, regimeSizeDownMult: 0.75, regimeSizeHighRsi: 100,
  bullBuyPctOfUsdc: 0.15,
  bullTrailGivePct: 25, bullMinSolHold: 0, bullProportionalSells: false,
  bullStrongRegimePct: 10, bullMaxNotionalUsdc: 25,
  minSellNotionalMult: 0,
  conflictEdgeResolution: false,
};

// Config 2: OPTIMIZED (from sweep)
const OPTIMIZED_CONFIG = {
  bullDipPct: 0.5, bullRipPct: 1.2,
  bearDipPct: 0.5, bearRipPct: 1.2,
  bullBuyUsdc: 1, bullSellSol: 0.01,
  bearBuyUsdc: 1, bearSellSol: 0.01,
  minExpectedEdgeBps: 20,
  minTradeUsdc: 1, maxNotionalUsdc: 8,
  dailyNotionalLimitUsdc: 50,
  maxTradesPerDay: 50,
  minSolReserve: 0.01, maxSolAllocationPct: 60,
  signalMinSec: 60, cooldownSec: 60,
  decisionWindowSec: 60, staleSignalSec: 180,
  simStartUsdc: 1000, simStartSol: 5,
  simFeeBps: 30, simSlippageBps: 8,
  trendFilterEnabled: true, emaPeriod: 20,
  regimeFilterEnabled: true, regimeEmaSlow: 45,
  useAtrThresholds: false, atrPeriod: 14, atrDipMult: 1.0, atrRipMult: 0.7, atrMinDipPct: 0.1, atrMinRipPct: 0.1,
  rsiEnabled: true, rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70,
  rsiScaleBuyEnabled: false, rsiScaleMaxMult: 2.0,
  profitTargetEnabled: true, profitTargetPct: 2.0,
  profitTargetBypassCooldown: false,
  stopLossEnabled: true, stopLossPct: 20,
  trailInUptrend: true, trailArmPct: 2.0, trailGivePct: 10,
  intrabarStops: true,
  anchorCooldownBars: 2,
  entryBounceConfirm: false,
  botSpecializationEnabled: true, bearRsiMax: 30,
  bullRegimeThreshold: 7.0, bullDipScale: 3.0,
  regimeSizeEnabled: true, regimeSizeUpMult: 2.0, regimeSizeDownMult: 0.75, regimeSizeHighRsi: 100,
  bullBuyPctOfUsdc: 0.15,
  bullTrailGivePct: 25, bullMinSolHold: 0, bullProportionalSells: false,
  bullStrongRegimePct: 10, bullMaxNotionalUsdc: 25,
  minSellNotionalMult: 0,
  conflictEdgeResolution: false,
};

function runAll(files, config, label) {
  const results = {};
  for (const f of files.sort()) {
    const series = loadSeries(f);
    if (series.length < 2) {
      console.log(`Skipped ${path.basename(f)}: <2 points`);
      continue;
    }
    const m = runBacktest(series, config);
    results[path.basename(f)] = m;
    console.log(`${label} | ${path.basename(f)}: equity=${fmt(m.endEquity)} ret=${fmt(m.returnPct)}% vsHold=${fmt(m.vsHoldMixPct)}% DD=${fmt(m.maxDrawdownPct)}% trades=${m.trades} win=${fmt(m.winRatePct,1)}% PT=${m.profitTargetFires} SL=${m.stopFires}`);
  }
  return results;
}

function main() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).map(f => path.join(DATA_DIR, f));
  
  console.log('=== DATASETS ===');
  console.log(files.map(f => path.basename(f)).join(', '));
  console.log(`Total: ${files.length} datasets\n`);
  
  console.log('=== RUNNING CURRENT CONFIG ===');
  const currentResults = runAll(files, CURRENT_CONFIG, 'CURRENT');
  
  console.log('\n=== RUNNING OPTIMIZED CONFIG ===');
  const optimizedResults = runAll(files, OPTIMIZED_CONFIG, 'OPTIMIZED');
  
  // Print comparison table
  console.log('\n' + '='.repeat(140));
  console.log('COMPARISON TABLE: CURRENT vs OPTIMIZED');
  console.log('='.repeat(140));
  
  const headers = ['Dataset', 'CurRet%', 'OptRet%', 'ΔRet', 'CurVsH%', 'OptVsH%', 'ΔVsH', 'CurDD%', 'OptDD%', 'ΔDD', 'CurTrd', 'OptTrd', 'CurWr%', 'OptWr%', 'CurPT', 'OptPT', 'CurSL', 'OptSL'];
  console.log(headers.map(h => h.padStart(h === 'Dataset' ? 22 : 8)).join(' '));
  console.log('-'.repeat(140));
  
  const summary = [];
  for (const dataset of files.map(f => path.basename(f)).sort()) {
    const c = currentResults[dataset];
    const o = optimizedResults[dataset];
    if (!c || !o) continue;
    
    const row = [
      dataset.padEnd(22),
      fmt(c.returnPct).padStart(8),
      fmt(o.returnPct).padStart(8),
      fmt(o.returnPct - c.returnPct).padStart(8),
      fmt(c.vsHoldMixPct).padStart(8),
      fmt(o.vsHoldMixPct).padStart(8),
      fmt(o.vsHoldMixPct - c.vsHoldMixPct).padStart(8),
      fmt(c.maxDrawdownPct).padStart(8),
      fmt(o.maxDrawdownPct).padStart(8),
      fmt(o.maxDrawdownPct - c.maxDrawdownPct).padStart(8),
      String(c.trades).padStart(8),
      String(o.trades).padStart(8),
      fmt(c.winRatePct, 1).padStart(8),
      fmt(o.winRatePct, 1).padStart(8),
      String(c.profitTargetFires).padStart(8),
      String(o.profitTargetFires).padStart(8),
      String(c.stopFires).padStart(8),
      String(o.stopFires).padStart(8),
    ];
    console.log(row.join(' '));
    summary.push({ dataset, current: c, optimized: o });
  }
  
  // Aggregate stats
  console.log('\n' + '='.repeat(140));
  console.log('AGGREGATE SUMMARY');
  console.log('='.repeat(140));
  
  const n = summary.length;
  const avg = (arr, fn) => arr.reduce((a, b) => a + fn(b), 0) / n;
  
  console.log(`Datasets tested: ${n}`);
  console.log(`Avg Return:      Current ${fmt(avg(summary, s => s.current.returnPct))}%  Optimized ${fmt(avg(summary, s => s.optimized.returnPct))}%  Δ ${fmt(avg(summary, s => s.optimized.returnPct - s.current.returnPct))}%`);
  console.log(`Avg vs Hold:     Current ${fmt(avg(summary, s => s.current.vsHoldMixPct))}%  Optimized ${fmt(avg(summary, s => s.optimized.vsHoldMixPct))}%  Δ ${fmt(avg(summary, s => s.optimized.vsHoldMixPct - s.current.vsHoldMixPct))}%`);
  console.log(`Avg Max DD:      Current ${fmt(avg(summary, s => s.current.maxDrawdownPct))}%  Optimized ${fmt(avg(summary, s => s.optimized.maxDrawdownPct))}%  Δ ${fmt(avg(summary, s => s.optimized.maxDrawdownPct - s.current.maxDrawdownPct))}%`);
  console.log(`Avg Trades:      Current ${fmt(avg(summary, s => s.current.trades))}  Optimized ${fmt(avg(summary, s => s.optimized.trades))}`);
  console.log(`Avg Win Rate:    Current ${fmt(avg(summary, s => s.current.winRatePct), 1)}%  Optimized ${fmt(avg(summary, s => s.optimized.winRatePct), 1)}%`);
  console.log(`Total PT fires:  Current ${summary.reduce((a, s) => a + s.current.profitTargetFires, 0)}  Optimized ${summary.reduce((a, s) => a + s.optimized.profitTargetFires, 0)}`);
  console.log(`Total SL fires:  Current ${summary.reduce((a, s) => a + s.current.stopFires, 0)}  Optimized ${summary.reduce((a, s) => a + s.optimized.stopFires, 0)}`);
  
  // Better on how many datasets
  let betterRet = 0, betterVsH = 0, betterDD = 0, betterTrades = 0;
  for (const s of summary) {
    if (s.optimized.returnPct > s.current.returnPct) betterRet++;
    if (s.optimized.vsHoldMixPct > s.current.vsHoldMixPct) betterVsH++;
    if (s.optimized.maxDrawdownPct < s.current.maxDrawdownPct) betterDD++;
    if (s.optimized.trades > s.current.trades) betterTrades++;
  }
  console.log(`\nOptimized better on: Return ${betterRet}/${n} | vsHold ${betterVsH}/${n} | MaxDD ${betterDD}/${n} | Trades ${betterTrades}/${n}`);
  
  // Save results
  const output = {
    timestamp: new Date().toISOString(),
    configs: {
      current: CURRENT_CONFIG,
      optimized: OPTIMIZED_CONFIG
    },
    results: {
      current: currentResults,
      optimized: optimizedResults
    },
    summary: {
      datasets: n,
      avgReturnCurrent: avg(summary, s => s.current.returnPct),
      avgReturnOptimized: avg(summary, s => s.optimized.returnPct),
      avgVsHoldCurrent: avg(summary, s => s.current.vsHoldMixPct),
      avgVsHoldOptimized: avg(summary, s => s.optimized.vsHoldMixPct),
      avgMaxDDCurrent: avg(summary, s => s.current.maxDrawdownPct),
      avgMaxDDOptimized: avg(summary, s => s.optimized.maxDrawdownPct),
      betterReturn: betterRet,
      betterVsHold: betterVsH,
      betterMaxDD: betterDD,
      betterTrades: betterTrades
    }
  };
  
  const outputPath = path.join(ROOT, 'backtest', 'config-comparison-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);
}

main();