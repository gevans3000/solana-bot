#!/usr/bin/env node
/**
 * Walk-Forward with Expanding Window — ULTIMATE Backtesting Suite
 * Expanding window: train=[0..i], test=[i+1..i+h], slide by h
 * Multiple horizons: 30d, 90d, 180d test windows
 * Metrics: OOS Sharpe, Calmar, max DD, turnover, hit rate
 * Output: stability metrics, parameter drift detection
 * Outputs: JSON + summary markdown
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBacktest, loadSeries, paramsFromCfg } from '../src/backtest.mjs';
import { CFG } from '../src/common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'backtest', 'data');
const OUTPUT_DIR = path.join(ROOT, 'backtest', 'results');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ============================================================================
// CHAMPION BASE PARAMS (Config C Tier 2)
// ============================================================================
function getBaseParams() {
  const P = paramsFromCfg(CFG);
  P.bullDipPct = 0.5; P.bullRipPct = 1.5; P.bearDipPct = 0.8; P.bearRipPct = 2.1;
  P.profitTargetPct = 3.0; P.stopLossPct = 8; P.minExpectedEdgeBps = 5;
  P.trailInUptrend = true; P.trailArmPct = 2.0; P.trailGivePct = 12;
  P.intrabarStops = true; P.anchorCooldownBars = 2;
  P.botSpecializationEnabled = true; P.bearRsiMax = 35;
  P.bullRegimeThreshold = 7.0; P.bullDipScale = 3.0;
  P.regimeSizeEnabled = true; P.regimeSizeUpMult = 2.0; P.regimeSizeDownMult = 0.75;
  P.bullBuyPctOfUsdc = 0.15; P.bullTrailGivePct = 25; P.bullMinSolHold = 0;
  P.bullProportionalSells = false; P.bullStrongRegimePct = 10;
  P.bullMaxNotionalUsdc = 8; P.minSellNotionalMult = 0;
  P.conflictEdgeResolution = false;
  P.rsiScaleBuyEnabled = false; P.rsiScaleMaxMult = 2.0;
  P.useAtrThresholds = false;
  return P;
}

// ============================================================================
// DATASETS TO TEST (all 11)
// ============================================================================
const DATASETS = [
  'sol-usd-1d-full.json',      // 1987 days - primary
  'sol-usd-1d-5yr.json',       // 1831 days
  'sol-usd-1d.json',           // 309 days (bear)
  'sol-usd-1d-bull.json',      // 184 days (bull)
  'sol-usd-1h-540d.json',      // 540 days hourly
  'sol-usd-6h.json',           // ~?
  'sol-usd-6h-bull.json',      // 183 days 6h bull
  'sol-usd-6h-recent.json',    // recent chop
  'sol-usd-15m-60d.json',      // 60 days 15m
  'sol-usd-5m-30d.json',       // 30 days 5m
  'sol-usd-1m-7d.json',        // 7 days 1m
];

// ============================================================================
// WALK-FORWARD ENGINE
// ============================================================================
function runWalkForward(series, baseParams, options = {}) {
  const {
    trainWindowDays = null,     // null = expanding from start
    testWindowDays = 90,        // test horizon
    stepDays = 90,              // slide by test window (no overlap)
    minTrainDays = 180,         // minimum train data before first test
    optimizeOnTrain = false,    // whether to optimize params on train
  } = options;

  const totalDays = (series[series.length - 1].t - series[0].t) / 86400000;
  const results = [];

  // Find first valid split point
  let trainEndIdx = 0;
  for (let i = 0; i < series.length; i++) {
    const trainDays = (series[i].t - series[0].t) / 86400000;
    if (trainDays >= minTrainDays) {
      trainEndIdx = i;
      break;
    }
  }

  if (trainEndIdx === 0) {
    console.log(`  ⚠️  Insufficient data: ${totalDays.toFixed(0)} days < ${minTrainDays} min train`);
    return [];
  }

  console.log(`  Total: ${totalDays.toFixed(0)}d | Train starts at ${minTrainDays}d | Test window: ${testWindowDays}d | Step: ${stepDays}d`);

  let fold = 0;
  while (true) {
    const testStartIdx = trainEndIdx + 1;
    const testEndTime = series[testStartIdx].t + testWindowDays * 86400000;

    // Find test end index
    let testEndIdx = testStartIdx;
    while (testEndIdx < series.length - 1 && series[testEndIdx + 1].t <= testEndTime) {
      testEndIdx++;
    }

    if (testEndIdx <= testStartIdx) break; // No test data

    const train = series.slice(0, trainEndIdx + 1);
    const test = series.slice(testStartIdx, testEndIdx + 1);

    const trainDays = (train[train.length - 1].t - train[0].t) / 86400000;
    const testDays = (test[test.length - 1].t - test[0].t) / 86400000;

    // Optionally optimize on train (grid search on key params)
    let bestParams = baseParams;
    if (optimizeOnTrain) {
      bestParams = optimizeParams(train, baseParams);
    }

    const trainResult = runBacktest(train, bestParams);
    const testResult = runBacktest(test, bestParams);

    // Stability metrics
    const oosSharpe = testResult.maxDrawdownPct > 0 ? testResult.returnPct / testResult.maxDrawdownPct : 0;
    const isSharpe = trainResult.maxDrawdownPct > 0 ? trainResult.returnPct / trainResult.maxDrawdownPct : 0;
    const calmar = testResult.maxDrawdownPct > 0 ? testResult.returnPct / testResult.maxDrawdownPct : 0;
    const turnover = testResult.trades > 0 ? testResult.trades / (testDays / 30) : 0; // trades per month
    const hitRate = testResult.winRatePct;

    // Parameter drift detection (compare IS vs OOS)
    const returnDrift = testResult.returnPct - trainResult.returnPct;
    const ddDrift = testResult.maxDrawdownPct - trainResult.maxDrawdownPct;
    const sharpeDrift = oosSharpe - isSharpe;

    results.push({
      fold: ++fold,
      trainStart: new Date(train[0].t).toISOString().split('T')[0],
      trainEnd: new Date(train[train.length - 1].t).toISOString().split('T')[0],
      testStart: new Date(test[0].t).toISOString().split('T')[0],
      testEnd: new Date(test[test.length - 1].t).toISOString().split('T')[0],
      trainDays: trainDays.toFixed(0),
      testDays: testDays.toFixed(0),
      params: { ...bestParams },
      inSample: {
        returnPct: trainResult.returnPct,
        maxDrawdownPct: trainResult.maxDrawdownPct,
        sharpeProxy: isSharpe,
        trades: trainResult.trades,
        winRatePct: trainResult.winRatePct,
        vsHoldPct: trainResult.vsHoldMixPct,
      },
      outOfSample: {
        returnPct: testResult.returnPct,
        maxDrawdownPct: testResult.maxDrawdownPct,
        sharpeProxy: oosSharpe,
        calmarProxy: calmar,
        trades: testResult.trades,
        winRatePct: hitRate,
        vsHoldPct: testResult.vsHoldMixPct,
        turnover: turnover.toFixed(2),
      },
      drift: {
        returnDrift: returnDrift.toFixed(2),
        ddDrift: ddDrift.toFixed(2),
        sharpeDrift: sharpeDrift.toFixed(3),
        consistent: returnDrift > -5 && ddDrift < 10 && sharpeDrift > -0.5,
      },
    });

    // Expanding window: train grows, test slides forward
    trainEndIdx = testEndIdx;

    // Break if not enough data for next test window
    if (trainEndIdx >= series.length - 10) break;
  }

  return results;
}

function optimizeParams(train, baseParams) {
  // Quick grid search on train for key params
  const emaFasts = [10, 20, 30];
  const emaSlows = [40, 50, 60];
  const rsiOS = [30, 40];
  const trailGives = [8, 12, 16];
  const stopLosses = [6, 8, 12];

  let best = baseParams, bestScore = -Infinity;

  for (const ef of emaFasts) {
    for (const es of emaSlows) {
      if (ef >= es) continue;
      for (const rsi of rsiOS) {
        for (const tg of trailGives) {
          for (const sl of stopLosses) {
            const params = { ...baseParams, emaPeriod: ef, regimeEmaSlow: es, rsiOversold: rsi, trailGivePct: tg, stopLossPct: sl };
            const r = runBacktest(train, params);
            const score = r.maxDrawdownPct > 0 ? r.returnPct / r.maxDrawdownPct : r.returnPct;
            if (score > bestScore) {
              bestScore = score;
              best = params;
            }
          }
        }
      }
    }
  }
  return best;
}

// ============================================================================
// STABILITY METRICS
// ============================================================================
function computeStabilityMetrics(folds) {
  if (!folds.length) return {};

  const oosReturns = folds.map(f => f.outOfSample.returnPct);
  const oosDDs = folds.map(f => f.outOfSample.maxDrawdownPct);
  const oosSharpes = folds.map(f => f.outOfSample.sharpeProxy);
  const oosCalmars = folds.map(f => f.outOfSample.calmarProxy);
  const oosWinRates = folds.map(f => f.outOfSample.winRatePct);
  const oosTurnovers = folds.map(f => f.outOfSample.turnover);
  const oosVsHold = folds.map(f => f.outOfSample.vsHoldPct);

  const consistentFolds = folds.filter(f => f.drift.consistent).length;

  return {
    nFolds: folds.length,
    consistencyRate: (consistentFolds / folds.length * 100).toFixed(1),

    // Return stability
    meanReturn: mean(oosReturns).toFixed(2),
    stdReturn: std(oosReturns).toFixed(2),
    minReturn: Math.min(...oosReturns).toFixed(2),
    maxReturn: Math.max(...oosReturns).toFixed(2),
    positiveFolds: oosReturns.filter(r => r > 0).length,
    probPositive: (oosReturns.filter(r => r > 0).length / oosReturns.length * 100).toFixed(1),

    // DD stability
    meanDD: mean(oosDDs).toFixed(2),
    maxDD: Math.max(...oosDDs).toFixed(2),
    dd95: percentile(oosDDs, 0.95).toFixed(2),

    // Sharpe stability
    meanSharpe: mean(oosSharpes).toFixed(2),
    stdSharpe: std(oosSharpes).toFixed(2),
    sharpeIR: (mean(oosSharpes) / (std(oosSharpes) || 1)).toFixed(2), // Information Ratio of Sharpe
    minSharpe: Math.min(...oosSharpes).toFixed(2),

    // Calmar stability
    meanCalmar: mean(oosCalmars).toFixed(2),

    // Win rate stability
    meanWinRate: mean(oosWinRates).toFixed(1),
    stdWinRate: std(oosWinRates).toFixed(1),

    // Turnover stability
    meanTurnover: mean(oosTurnovers).toFixed(2),

    // vs Hold
    meanVsHold: mean(oosVsHold).toFixed(2),
    beatHoldFolds: oosVsHold.filter(v => v > 0).length,

    // Drift
    meanReturnDrift: mean(folds.map(f => parseFloat(f.drift.returnDrift))).toFixed(2),
    meanDDDrift: mean(folds.map(f => parseFloat(f.drift.ddDrift))).toFixed(2),
    meanSharpeDrift: mean(folds.map(f => parseFloat(f.drift.sharpeDrift))).toFixed(3),
  };
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function std(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1 || 1));
}
function percentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

// ============================================================================
// PARAMETER DRIFT DETECTION
// ============================================================================
function detectParameterDrift(folds) {
  if (folds.length < 3) return { note: 'Need >2 folds for drift detection' };

  // Track how optimal parameters change over time
  const paramHistory = ['emaPeriod', 'regimeEmaSlow', 'rsiOversold', 'trailGivePct', 'stopLossPct']
    .map(p => ({ param: p, values: folds.map(f => f.params[p]) }));

  const driftDetected = paramHistory.map(ph => {
    const vals = ph.values;
    const slope = linearRegression(vals.map((v, i) => [i, v])).slope;
    const changed = Math.abs(slope) > 0.5; // Arbitrary threshold
    return {
      param: ph.param,
      values: vals,
      slope: slope.toFixed(3),
      driftDetected: changed,
      range: [Math.min(...vals), Math.max(...vals)],
    };
  });

  return { parameters: driftDetected };
}

function linearRegression(points) {
  const n = points.length;
  const sumX = points.reduce((a, [x]) => a + x, 0);
  const sumY = points.reduce((a, [, y]) => a + y, 0);
  const sumXY = points.reduce((a, [x, y]) => a + x * y, 0);
  const sumXX = points.reduce((a, [x]) => a + x * x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// ============================================================================
// MAIN WALK-FORWARD RUNNER
// ============================================================================
async function runWalkForwardExpanding() {
  console.log('📈 WALK-FORWARD EXPANDING WINDOW');
  console.log('═'.repeat(70));
  console.log('Method: Expanding train, rolling test windows');
  console.log('Horizons: 30d, 90d, 180d | Min train: 180d');
  console.log('Datasets: All 11 available');
  console.log('');

  const baseParams = getBaseParams();
  const horizons = [30, 90, 180];
  const allResults = {};

  for (const file of DATASETS) {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.log(`\n⚠️  Skipping ${file} (not found)`);
      continue;
    }

    console.log(`\n📊 ${file}`);
    const series = loadSeries(filePath);
    const totalDays = (series[series.length - 1].t - series[0].t) / 86400000;

    if (totalDays < 200) {
      console.log(`  ⚠️  Insufficient data (${totalDays.toFixed(0)}d < 200d min)`);
      allResults[file] = { skipped: true, reason: 'Insufficient data', days: totalDays };
      continue;
    }

    allResults[file] = { days: totalDays, candles: series.length, horizons: {} };

    for (const h of horizons) {
      console.log(`  Horizon: ${h}d test window...`);
      const folds = runWalkForward(series, baseParams, {
        testWindowDays: h,
        stepDays: h,
        minTrainDays: Math.max(180, h * 2),
      });

      if (!folds.length) {
        allResults[file].horizons[`${h}d`] = { skipped: true, reason: 'No valid folds' };
        continue;
      }

      const stability = computeStabilityMetrics(folds);
      const drift = detectParameterDrift(folds);

      allResults[file].horizons[`${h}d`] = { folds, stability, drift };

      console.log(`    Folds: ${folds.length} | OOS Return: ${stability.meanReturn}% | OOS Sharpe~: ${stability.meanSharpe} | Consistency: ${stability.consistencyRate}%`);
    }
  }

  // Cross-dataset summary
  const summary = computeCrossDatasetSummary(allResults);

  const output = {
    metadata: {
      timestamp: new Date().toISOString(),
      baseParams,
      datasets: DATASETS,
      horizons,
      method: 'Expanding window walk-forward',
    },
    results: allResults,
    crossDatasetSummary: summary,
  };

  // Save JSON
  const jsonPath = path.join(OUTPUT_DIR, 'walkforward_expanding.json');
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log(`\n✅ JSON saved to: ${jsonPath}`);

  // Generate Markdown
  const mdPath = path.join(OUTPUT_DIR, 'walkforward_expanding.md');
  fs.writeFileSync(mdPath, generateMarkdownReport(output));
  console.log(`✅ Markdown saved to: ${mdPath}`);

  // Print summary
  printConsoleSummary(output);
}

function computeCrossDatasetSummary(allResults) {
  const datasetSummaries = {};

  for (const [file, data] of Object.entries(allResults)) {
    if (data.skipped) continue;

    const horizons = Object.entries(data.horizons);
    const validHorizons = horizons.filter(([_, h]) => !h?.skipped);

    if (!validHorizons.length) continue;

    // Average across horizons
    const avgReturn = mean(validHorizons.map(([_, h]) => parseFloat(h.stability.meanReturn)));
    const avgSharpe = mean(validHorizons.map(([_, h]) => parseFloat(h.stability.meanSharpe)));
    const avgConsistency = mean(validHorizons.map(([_, h]) => parseFloat(h.stability.consistencyRate)));
    const avgMaxDD = Math.max(...validHorizons.map(([_, h]) => parseFloat(h.stability.maxDD)));

    datasetSummaries[file] = {
      days: data.days,
      avgReturn: avgReturn.toFixed(2),
      avgSharpe: avgSharpe.toFixed(2),
      avgConsistency: avgConsistency.toFixed(1),
      avgMaxDD: avgMaxDD.toFixed(2),
      nHorizons: validHorizons.length,
    };
  }

  return datasetSummaries;
}

function generateMarkdownReport(o) {
  const summary = o.crossDatasetSummary;

  let md = `# Walk-Forward Expanding Window Report

**Generated:** ${o.metadata.timestamp}
**Method:** Expanding train window, rolling test windows
**Horizons:** ${o.metadata.horizons.join(', ')} days
**Min Train:** 180 days (or 2× horizon)
**Base Config:** Config C (Tier 2)

---

## 📊 Cross-Dataset Summary

| Dataset | Days | Horizons | Avg OOS Return | Avg OOS Sharpe~ | Avg Consistency | Max DD |
|---------|------|----------|----------------|-----------------|-----------------|--------|
`;

  for (const [file, s] of Object.entries(summary)) {
    md += `| ${file} | ${s.days.toFixed(0)} | ${s.nHorizons} | ${s.avgReturn}% | ${s.avgSharpe} | ${s.avgConsistency}% | ${s.avgMaxDD}% |\n`;
  }

  md += `\n---

## 📈 Detailed Results by Dataset

`;

  for (const [file, data] of Object.entries(o.results)) {
    if (data.skipped) {
      md += `### ${file} ⚠️ SKIPPED: ${data.reason}\n\n`;
      continue;
    }

    md += `### ${file} (${data.days.toFixed(0)} days, ${data.candles} candles)\n\n`;

    for (const [horizon, h] of Object.entries(data.horizons)) {
      if (h.skipped) {
        md += `#### ${horizon} — SKIPPED: ${h.reason}\n\n`;
        continue;
      }

      const s = h.stability;
      const d = h.drift;

      md += `#### ${horizon} Test Window (${s.nFolds} folds)\n\n`;

      md += `| Metric | Value |\n|--------|-------|\n`;
      md += `| Consistency Rate | ${s.consistencyRate}% |\n`;
      md += `| OOS Return | ${s.meanReturn}% ± ${s.stdReturn}% (range: ${s.minReturn}% to ${s.maxReturn}%) |\n`;
      md += `| Prob(Positive) | ${s.probPositive}% |\n`;
      md += `| OOS Max DD | Mean ${s.meanDD}% | Max ${s.maxDD}% | 95th %ile ${s.dd95}% |\n`;
      md += `| OOS Sharpe~ | ${s.meanSharpe} ± ${s.stdSharpe} (IR: ${s.sharpeIR}) |\n`;
      md += `| OOS Calmar~ | ${s.meanCalmar} |\n`;
      md += `| Win Rate | ${s.meanWinRate}% ± ${s.stdWinRate}% |\n`;
      md += `| Turnover | ${s.meanTurnover} trades/month |\n`;
      md += `| vs Hold | ${s.meanVsHold}% (${s.beatHoldFolds}/${s.nFolds} folds beat hold) |\n`;
      md += `| Return Drift (IS→OOS) | ${s.meanReturnDrift}% |\n`;
      md += `| DD Drift | ${s.meanDDDrift}% |\n`;
      md += `| Sharpe Drift | ${s.meanSharpeDrift} |\n\n`;

      // Fold details
      md += `**Fold Details:**\n\n`;
      md += `| Fold | Train | Test | IS Return | OOS Return | IS DD | OOS DD | IS Sharpe~ | OOS Sharpe~ | Consistent |\n`;
      md += `|------|-------|------|-----------|------------|-------|--------|------------|-------------|------------|\n`;

      for (const f of h.folds) {
        md += `| ${f.fold} | ${f.trainDays}d | ${f.testDays}d | ${f.inSample.returnPct.toFixed(1)}% | ${f.outOfSample.returnPct.toFixed(1)}% | ${f.inSample.maxDrawdownPct.toFixed(1)}% | ${f.outOfSample.maxDrawdownPct.toFixed(1)}% | ${f.inSample.sharpeProxy.toFixed(2)} | ${f.outOfSample.sharpeProxy.toFixed(2)} | ${f.drift.consistent ? '✅' : '❌'} |\n`;
      }

      md += `\n`;

      // Parameter drift
      if (d.parameters) {
        md += `**Parameter Drift:**\n\n`;
        md += `| Parameter | Values | Slope | Drift? | Range |\n|-----------|--------|-------|--------|-------|\n`;
        for (const p of d.parameters) {
          md += `| ${p.param} | [${p.values.join(', ')}] | ${p.slope} | ${p.driftDetected ? '⚠️ YES' : '✅ Stable'} | ${p.range[0]}–${p.range[1]} |\n`;
        }
        md += `\n`;
      }
    }
  }

  md += `---

## 🎯 Stability Assessment

`;

  // Overall assessment
  const allReturns = [];
  const allSharpes = [];
  const allConsistencies = [];

  for (const [_, data] of Object.entries(o.results)) {
    if (data.skipped) continue;
    for (const [_, h] of Object.entries(data.horizons)) {
      if (!h.skipped) {
        allReturns.push(parseFloat(h.stability.meanReturn));
        allSharpes.push(parseFloat(h.stability.meanSharpe));
        allConsistencies.push(parseFloat(h.stability.consistencyRate));
      }
    }
  }

  const grandMeanReturn = mean(allReturns).toFixed(2);
  const grandMeanSharpe = mean(allSharpes).toFixed(2);
  const grandConsistency = mean(allConsistencies).toFixed(1);

  md += `| Overall Metric | Value | Assessment |\n|----------------|-------|------------|\n`;
  md += `| Grand Mean OOS Return | ${grandMeanReturn}% | ${grandMeanReturn > 5 ? '🟢 Strong' : grandMeanReturn > 0 ? '🟡 Positive' : '🔴 Negative'} |\n`;
  md += `| Grand Mean OOS Sharpe~ | ${grandMeanSharpe} | ${grandMeanSharpe > 1 ? '🟢 Excellent' : grandMeanSharpe > 0.5 ? '🟡 Good' : '🔴 Weak'} |\n`;
  md += `| Grand Consistency | ${grandConsistency}% | ${grandConsistency > 80 ? '🟢 Stable' : grandConsistency > 60 ? '🟡 Moderate' : '🔴 Unstable'} |\n`;

  md += `\n### 🔍 Key Findings\n\n`;

  if (grandMeanReturn > 0 && grandConsistency > 70) {
    md += `✅ **Strategy is OOS-robust**: Positive returns with high consistency across regimes and horizons.\n`;
  } else if (grandMeanReturn > 0) {
    md += `⚠️ **Positive but inconsistent**: Strategy works on average but has regime-dependent performance.\n`;
  } else {
    md += `❌ **Not OOS-robust**: Fails to generalize out-of-sample.\n`;
  }

  // Check parameter stability
  const driftingParams = [];
  for (const [_, data] of Object.entries(o.results)) {
    if (data.skipped) continue;
    for (const [_, h] of Object.entries(data.horizons)) {
      if (h.drift?.parameters) {
        for (const p of h.drift.parameters) {
          if (p.driftDetected && !driftingParams.includes(p.param)) {
            driftingParams.push(p.param);
          }
        }
      }
    }
  }

  if (driftingParams.length > 0) {
    md += `⚠️ **Parameter drift detected** in: ${driftingParams.join(', ')}. Consider regime-adaptive parameters.\n`;
  } else {
    md += `✅ **Parameters stable** across folds — no significant drift detected.\n`;
  }

  md += `\n---

## ✅ Recommendations

1. **Deploy with confidence** if consistency > 70% and mean return > 0
2. **Monitor drifting parameters**: ${driftingParams.join(', ') || 'None'}
3. **Retrain frequency**: Every ${allConsistencies.length > 0 ? '90' : 'N/A'} days (aligned with test horizon)
4. **Risk limits**: Max DD observed ${Math.max(...Object.values(summary).map(s => parseFloat(s.avgMaxDD))).toFixed(1)}% — set circuit breaker at 2× this level

---

*Generated by Ultimate Backtesting Suite — Walk-Forward Expanding Window*
`;

  return md;
}

function printConsoleSummary(o) {
  console.log('\n' + '═'.repeat(70));
  console.log('📈 WALK-FORWARD EXPANDING WINDOW SUMMARY');
  console.log('═'.repeat(70));

  for (const [file, data] of Object.entries(o.results)) {
    if (data.skipped) {
      console.log(`  ${file}: SKIPPED (${data.reason})`);
      continue;
    }
    for (const [h, hd] of Object.entries(data.horizons)) {
      if (hd.skipped) continue;
      const s = hd.stability;
      console.log(`  ${file} [${h}]: ${s.nFolds} folds | Ret ${s.meanReturn}% | Sharpe~ ${s.meanSharpe} | Cons ${s.consistencyRate}% | MaxDD ${s.maxDD}%`);
    }
  }

  console.log(`\n✅ Full results in backtest/results/walkforward_expanding.{json,md}`);
}

// Run if executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWalkForwardExpanding().catch(console.error);
}

export { runWalkForwardExpanding, runWalkForward, computeStabilityMetrics, detectParameterDrift };