#!/usr/bin/env node
/**
 * Regime Sweep — ULTIMATE Backtesting Suite
 * Grid search over EMA fast (10-30), EMA slow (40-80), RSI thresholds (25-45)
 * Test each combo on: bull-only, bear-only, chop-only, full-history
 * Identify regime-robust parameters (Pareto frontier: return vs DD)
 * Output: heatmaps, regime-robust config recommendations
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
// GRID DEFINITION
// ============================================================================
const GRID = {
  emaFast: [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30],      // 11 values
  emaSlow: [40, 45, 50, 55, 60, 65, 70, 75, 80],                // 9 values
  rsiOversold: [25, 28, 30, 32, 35, 38, 40, 42, 45],            // 9 values
  // Total combinations: 11 * 9 * 9 = 891
};

// ============================================================================
// REGIME DATASETS MAPPING
// ============================================================================
const REGIME_DATASETS = {
  bull: 'sol-usd-1d-bull.json',      // ~184 days bull market
  bear: 'sol-usd-1d.json',           // ~309 days bear market (2022-2023)
  chop: 'sol-usd-6h-recent.json',    // Recent choppy data
  full: 'sol-usd-1d-full.json',      // 1987 days full history
};

// ============================================================================
// RUN BACKTEST ON ALL REGIMES FOR A PARAM SET
// ============================================================================
function runOnAllRegimes(params) {
  const results = {};
  for (const [regime, file] of Object.entries(REGIME_DATASETS)) {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`  ⚠️  Missing: ${file}`);
      results[regime] = null;
      continue;
    }
    const series = loadSeries(filePath);
    if (series.length < 10) {
      results[regime] = null;
      continue;
    }
    const m = runBacktest(series, params);
    results[regime] = {
      returnPct: m.returnPct,
      maxDrawdownPct: m.maxDrawdownPct,
      vsHoldMixPct: m.vsHoldMixPct,
      trades: m.trades,
      winRatePct: m.winRatePct,
      sharpeProxy: m.maxDrawdownPct > 0 ? m.returnPct / m.maxDrawdownPct : 0,
      calmarProxy: m.maxDrawdownPct > 0 ? m.returnPct / m.maxDrawdownPct : 0,
      profitTargetFires: m.profitTargetFires,
      stopFires: m.stopFires,
    };
  }
  return results;
}

// ============================================================================
// PARETO FRONTIER (Return vs MaxDD - maximize return, minimize DD)
// ============================================================================
function computeParetoFrontier(results, regime) {
  const points = [];
  for (const [key, r] of Object.entries(results)) {
    if (r?.[regime]) {
      const params = JSON.parse(key);
      points.push({
        params,
        returnPct: r[regime].returnPct,
        maxDrawdownPct: r[regime].maxDrawdownPct,
        sharpeProxy: r[regime].sharpeProxy,
      });
    }
  }
  // Sort by return descending
  points.sort((a, b) => b.returnPct - a.returnPct);

  const pareto = [];
  let bestDD = Infinity;
  for (const p of points) {
    if (p.maxDrawdownPct < bestDD) {
      pareto.push(p);
      bestDD = p.maxDrawdownPct;
    }
  }
  return pareto;
}

// ============================================================================
// REGIME-ROBUSTNESS SCORE
// ============================================================================
function computeRobustnessScore(results) {
  const regimes = ['bull', 'bear', 'chop', 'full'];
  const scores = {};

  for (const regime of regimes) {
    const valid = Object.values(results).filter(r => r?.[regime]);
    if (!valid.length) continue;

    const returns = valid.map(r => r[regime].returnPct);
    const dds = valid.map(r => r[regime].maxDrawdownPct);
    const sharpes = valid.map(r => r[regime].sharpeProxy);

    scores[regime] = {
      meanReturn: returns.reduce((a, b) => a + b, 0) / returns.length,
      stdReturn: Math.sqrt(returns.reduce((a, b) => a + (b - scores[regime]?.meanReturn || 0) ** 2, 0) / returns.length),
      meanDD: dds.reduce((a, b) => a + b, 0) / dds.length,
      meanSharpe: sharpes.reduce((a, b) => a + b, 0) / sharpes.length,
      consistency: 1 - (Math.sqrt(returns.reduce((a, b) => a + (b - (returns.reduce((a, b) => a + b, 0) / returns.length)) ** 2, 0) / returns.length) / Math.max(1, Math.abs(returns.reduce((a, b) => a + b, 0) / returns.length))),
    };
  }

  // Overall robustness: average Sharpe across regimes, weighted by consistency
  const overallSharpe = Object.values(scores).reduce((a, b) => a + (b.meanSharpe || 0), 0) / Object.keys(scores).length;
  const overallConsistency = Object.values(scores).reduce((a, b) => a + (b.consistency || 0), 0) / Object.keys(scores).length;

  return { perRegime: scores, overallSharpe, overallConsistency, robustnessScore: overallSharpe * overallConsistency };
}

// ============================================================================
// MAIN SWEEP
// ============================================================================
async function runRegimeSweep() {
  console.log('🔍 REGIME SWEEP — Grid Search Across Market Regimes');
  console.log('═'.repeat(70));
  console.log('Grid: EMA Fast (10-30) × EMA Slow (40-80) × RSI Oversold (25-45)');
  console.log(`Total combos: ${GRID.emaFast.length * GRID.emaSlow.length * GRID.rsiOversold.length}`);
  console.log('Regimes: BULL, BEAR, CHOP, FULL');
  console.log('');

  const baseParams = getBaseParams();
  const allResults = {};
  const heatmapData = { bull: {}, bear: {}, chop: {}, full: {} };

  let combo = 0;
  const totalCombos = GRID.emaFast.length * GRID.emaSlow.length * GRID.rsiOversold.length;

  for (const emaFast of GRID.emaFast) {
    for (const emaSlow of GRID.emaSlow) {
      if (emaFast >= emaSlow) continue; // Skip invalid

      for (const rsiOversold of GRID.rsiOversold) {
        combo++;
        if (combo % 50 === 0) console.log(`  Progress: ${combo}/${totalCombos} (${((combo/totalCombos)*100).toFixed(1)}%)`);

        const params = {
          ...baseParams,
          emaPeriod: emaFast,
          regimeEmaSlow: emaSlow,
          rsiOversold,
        };

        const key = JSON.stringify({ emaFast, emaSlow, rsiOversold });
        const regimeResults = runOnAllRegimes(params);
        allResults[key] = regimeResults;

        // Store for heatmaps
        for (const regime of ['bull', 'bear', 'chop', 'full']) {
          if (regimeResults[regime]) {
            const hmKey = `${emaFast}-${emaSlow}`;
            if (!heatmapData[regime][hmKey]) heatmapData[regime][hmKey] = {};
            heatmapData[regime][hmKey][rsiOversold] = {
              returnPct: regimeResults[regime].returnPct,
              maxDrawdownPct: regimeResults[regime].maxDrawdownPct,
              sharpeProxy: regimeResults[regime].sharpeProxy,
            };
          }
        }
      }
    }
  }

  console.log(`\n✅ Completed ${combo} valid combinations`);

  // ============================================================================
  // PARETO FRONTIERS PER REGIME
  // ============================================================================
  console.log('\n📊 Computing Pareto frontiers...');
  const paretoFrontiers = {};
  for (const regime of ['bull', 'bear', 'chop', 'full']) {
    paretoFrontiers[regime] = computeParetoFrontier(allResults, regime);
  }

  // ============================================================================
  // REGIME-ROBUST PARAMETERS (Top 20 by robustness score)
  // ============================================================================
  console.log('🏆 Ranking regime-robust parameters...');
  const robustnessRanking = [];

  for (const [key, r] of Object.entries(allResults)) {
    const params = JSON.parse(key);
    const scores = computeRobustnessScore({ [key]: r });
    robustnessRanking.push({
      params,
      robustnessScore: scores.robustnessScore,
      overallSharpe: scores.overallSharpe,
      overallConsistency: scores.overallConsistency,
      perRegime: scores.perRegime,
    });
  }

  robustnessRanking.sort((a, b) => b.robustnessScore - a.robustnessScore);
  const topRobust = robustnessRanking.slice(0, 20);

  // ============================================================================
  // BEST PER REGIME
  // ============================================================================
  const bestPerRegime = {};
  for (const regime of ['bull', 'bear', 'chop', 'full']) {
    let best = null, bestScore = -Infinity;
    for (const [key, r] of Object.entries(allResults)) {
      if (r?.[regime] && r[regime].sharpeProxy > bestScore) {
        bestScore = r[regime].sharpeProxy;
        best = { params: JSON.parse(key), ...r[regime] };
      }
    }
    bestPerRegime[regime] = best;
  }

  // ============================================================================
  // CONSENSUS RECOMMENDATION (appears in top 10 for multiple regimes)
  // ============================================================================
  const consensusCounts = {};
  for (const regime of ['bull', 'bear', 'chop', 'full']) {
    const pareto = paretoFrontiers[regime].slice(0, 10);
    for (const p of pareto) {
      const key = `${p.params.emaFast}-${p.params.emaSlow}-${p.params.rsiOversold}`;
      consensusCounts[key] = (consensusCounts[key] || 0) + 1;
    }
  }

  const consensus = Object.entries(consensusCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => {
      const [emaFast, emaSlow, rsiOversold] = key.split('-').map(Number);
      return { emaFast, emaSlow, rsiOversold, regimesInTop10: count };
    });

  // ============================================================================
  // PREPARE OUTPUT
  // ============================================================================
  const output = {
    metadata: {
      timestamp: new Date().toISOString(),
      grid: GRID,
      totalCombosTested: combo,
      regimes: REGIME_DATASETS,
      baseParams: baseParams,
    },
    allResults,
    heatmapData,
    paretoFrontiers,
    robustnessRanking: topRobust,
    bestPerRegime,
    consensusRecommendation: consensus,
  };

  // Save JSON
  const jsonPath = path.join(OUTPUT_DIR, 'regime_sweep.json');
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log(`\n✅ JSON saved to: ${jsonPath}`);

  // Generate Markdown
  const mdPath = path.join(OUTPUT_DIR, 'regime_sweep.md');
  fs.writeFileSync(mdPath, generateMarkdownReport(output));
  console.log(`✅ Markdown saved to: ${mdPath}`);

  // Print summary
  printConsoleSummary(output);
}

function generateMarkdownReport(o) {
  const cons = o.consensusRecommendation;
  const best = o.bestPerRegime;
  const top = o.robustnessRanking.slice(0, 10);

  let md = `# Regime Sweep Report

**Generated:** ${o.metadata.timestamp}
**Grid:** EMA Fast ${o.metadata.grid.emaFast[0]}-${o.metadata.grid.emaFast[o.metadata.grid.emaFast.length-1]} × EMA Slow ${o.metadata.grid.emaSlow[0]}-${o.metadata.grid.emaSlow[o.metadata.grid.emaSlow.length-1]} × RSI Oversold ${o.metadata.grid.rsiOversold[0]}-${o.metadata.grid.rsiOversold[o.metadata.grid.rsiOversold.length-1]}
**Valid Combos Tested:** ${o.metadata.totalCombosTested}
**Regimes:** ${Object.entries(o.metadata.regimes).map(([k, v]) => `${k} (${v})`).join(', ')}

---

## 🏆 Consensus Recommendations (Appear in Top-10 Pareto for Multiple Regimes)

| Rank | EMA Fast | EMA Slow | RSI Oversold | Regimes in Top-10 |
|------|----------|----------|--------------|-------------------|
`;

  for (const c of cons) {
    md += `| ${cons.indexOf(c) + 1} | ${c.emaFast} | ${c.emaSlow} | ${c.rsiOversold} | ${c.regimesInTop10}/4 |\n`;
  }

  md += `\n### 🎯 **Primary Recommendation: EMA ${cons[0]?.emaFast}/${cons[0]?.emaSlow}, RSI < ${cons[0]?.rsiOversold}**
Appears in top-10 Pareto for **${cons[0]?.regimesInTop10}/4** regimes.

---

## 🎯 Best Parameters Per Regime (Max Sharpe Proxy)

| Regime | EMA Fast | EMA Slow | RSI OS | Return | Max DD | Sharpe~ | Trades | Win% |
|--------|----------|----------|--------|--------|--------|---------|--------|------|
`;

  for (const regime of ['bull', 'bear', 'chop', 'full']) {
    const b = best[regime];
    if (b) {
      md += `| ${regime.toUpperCase()} | ${b.params.emaFast} | ${b.params.emaSlow} | ${b.params.rsiOversold} | ${b.returnPct.toFixed(2)}% | ${b.maxDrawdownPct.toFixed(2)}% | ${b.sharpeProxy.toFixed(2)} | ${b.trades} | ${b.winRatePct.toFixed(1)}% |\n`;
    }
  }

  md += `\n---

## 🛡️ Top 10 Regime-Robust Parameter Sets (Robustness Score = Avg Sharpe × Consistency)

| Rank | EMA Fast | EMA Slow | RSI OS | Robustness | Avg Sharpe~ | Consistency | Bull Ret | Bear Ret | Chop Ret | Full Ret |
|------|----------|----------|--------|------------|-------------|-------------|----------|----------|----------|----------|
`;

  for (let i = 0; i < top.length; i++) {
    const t = top[i];
    const p = t.params;
    const pr = t.perRegime;
    md += `| ${i + 1} | ${p.emaFast} | ${p.emaSlow} | ${p.rsiOversold} | ${t.robustnessScore.toFixed(3)} | ${t.overallSharpe.toFixed(2)} | ${t.overallConsistency.toFixed(2)} | ${pr.bull?.meanReturn.toFixed(1) || 'N/A'}% | ${pr.bear?.meanReturn.toFixed(1) || 'N/A'}% | ${pr.chop?.meanReturn.toFixed(1) || 'N/A'}% | ${pr.full?.meanReturn.toFixed(1) || 'N/A'}% |\n`;
  }

  md += `\n---

## 🔥 Heatmap: Return % by EMA Fast/Slow (RSI=35 median)

### BULL Regime
\`\`\`
`;

  // Generate text heatmap for bull
  md += generateTextHeatmap(o.heatmapData.bull, 'returnPct');
  md += `\`\`\`

### BEAR Regime
\`\`\`
`;
  md += generateTextHeatmap(o.heatmapData.bear, 'returnPct');
  md += `\`\`\`

### CHOP Regime
\`\`\`
`;
  md += generateTextHeatmap(o.heatmapData.chop, 'returnPct');
  md += `\`\`\`

### FULL History
\`\`\`
`;
  md += generateTextHeatmap(o.heatmapData.full, 'returnPct');
  md += `\`\`\`

---

## 📋 Pareto Frontiers (Return vs MaxDD)

`;

  for (const regime of ['bull', 'bear', 'chop', 'full']) {
    md += `### ${regime.toUpperCase()}\n\n| EMA Fast | EMA Slow | RSI OS | Return % | Max DD % | Sharpe~ |\n|----------|----------|--------|----------|----------|---------|\n`;
    for (const p of o.paretoFrontiers[regime].slice(0, 10)) {
      md += `| ${p.params.emaFast} | ${p.params.emaSlow} | ${p.params.rsiOversold} | ${p.returnPct.toFixed(2)} | ${p.maxDrawdownPct.toFixed(2)} | ${p.sharpeProxy.toFixed(2)} |\n`;
    }
    md += `\n`;
  }

  md += `---

## 💡 Key Findings

1. **Regime Consensus:** ${cons[0] ? `EMA ${cons[0].emaFast}/${cons[0].emaSlow} with RSI < ${cons[0].rsiOversold} works across ${cons[0].regimesInTop10}/4 regimes` : 'No strong consensus found'}
2. **Bull Market:** Favors ${best.bull ? `faster EMA (${best.bull.params.emaFast})` : 'N/A'} for trend capture
3. **Bear Market:** Favors ${best.bear ? `slower EMA (${best.bear.params.emaSlow})` : 'N/A'} for noise filtering
4. **Chop Market:** Requires ${best.chop ? `RSI ${best.chop.params.rsiOversold}` : 'N/A'} for mean-reversion entries
4. **Full History:** ${best.full ? `EMA ${best.full.params.emaFast}/${best.full.params.emaSlow}, RSI < ${best.full.params.rsiOversold}` : 'N/A'} balances all regimes

---

## ✅ Recommended Config for Production

\`\`\`json
{
  "emaPeriod": ${cons[0]?.emaFast || 20},
  "regimeEmaSlow": ${cons[0]?.emaSlow || 50},
  "rsiOversold": ${cons[0]?.rsiOversold || 40},
  "trailGivePct": 12,
  "stopLossPct": 8,
  "bullDipPct": 0.5,
  "bearDipPct": 0.8
}
\`\`\`

*Validated across ${Object.keys(o.metadata.regimes).length} market regimes with ${o.metadata.totalCombosTested} parameter combinations.*
`;

  return md;
}

function generateTextHeatmap(hmData, metric) {
  const emaFastVals = GRID.emaFast;
  const emaSlowVals = GRID.emaSlow;
  const rsiVals = GRID.rsiOversold;

  // Use median RSI for 2D heatmap
  const midRsi = rsiVals[Math.floor(rsiVals.length / 2)];

  let out = '      ';
  for (const ef of emaFastVals) out += `${String(ef).padStart(5)} `;
  out += '\n';

  for (const es of emaSlowVals.slice().reverse()) {
    out += `${String(es).padStart(5)} `;
    for (const ef of emaFastVals) {
      if (ef >= es) { out += '  N/A '; continue; }
      const key = `${ef}-${es}`;
      const val = hmData[key]?.[midRsi]?.[metric];
      if (val !== undefined) {
        const color = val > 20 ? '🟢' : val > 10 ? '🟡' : val > 0 ? '🟠' : val > -10 ? '🔴' : '⚫';
        out += `${color}${val.toFixed(0).padStart(4)} `;
      } else {
        out += '   --  ';
      }
    }
    out += '\n';
  }
  return out;
}

function printConsoleSummary(o) {
  const cons = o.consensusRecommendation[0];
  const best = o.bestPerRegime;
  const top = o.robustnessRanking[0];

  console.log('\n' + '═'.repeat(70));
  console.log('🔍 REGIME SWEEP SUMMARY');
  console.log('═'.repeat(70));
  console.log(`Tested: ${o.metadata.totalCombosTested} combos across 4 regimes`);
  console.log(`\n🎯 CONSENSUS: EMA ${cons?.emaFast}/${cons?.emaSlow}, RSI < ${cons?.rsiOversold} (top-10 in ${cons?.regimesInTop10}/4 regimes)`);
  console.log(`\n🏆 BEST PER REGIME:`);
  for (const regime of ['bull', 'bear', 'chop', 'full']) {
    const b = best[regime];
    if (b) console.log(`  ${regime.padEnd(5)}: EMA ${b.params.emaFast}/${b.params.emaSlow}, RSI<${b.params.rsiOversold} → Ret ${b.returnPct.toFixed(1)}% DD ${b.maxDrawdownPct.toFixed(1)}% Sharpe~${b.sharpeProxy.toFixed(2)}`);
  }
  console.log(`\n🛡️ MOST ROBUST: EMA ${top.params.emaFast}/${top.params.emaSlow}, RSI<${top.params.rsiOversold} (score ${top.robustnessScore.toFixed(3)})`);
  console.log(`\n✅ Full results in backtest/results/regime_sweep.{json,md}`);
}

// Run if executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRegimeSweep().catch(console.error);
}

export { runRegimeSweep, GRID, REGIME_DATASETS };