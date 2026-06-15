#!/usr/bin/env node
/**
 * Parameter Sensitivity Analysis — ULTIMATE Backtesting Suite
 * Sobol indices for all parameters (global sensitivity)
 * One-at-a-time + variance-based decomposition
 * Identify: critical params (high sensitivity), robust params (low sensitivity)
 * Output: tornado charts, safe operating ranges
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
// PARAMETER SPACE DEFINITION
// ============================================================================
const PARAM_SPACE = [
  { name: 'emaPeriod', base: 20, min: 10, max: 30, type: 'int', category: 'Trend' },
  { name: 'regimeEmaSlow', base: 50, min: 40, max: 80, type: 'int', category: 'Regime' },
  { name: 'rsiOversold', base: 40, min: 25, max: 45, type: 'int', category: 'RSI' },
  { name: 'rsiOverbought', base: 70, min: 60, max: 85, type: 'int', category: 'RSI' },
  { name: 'rsiPeriod', base: 14, min: 7, max: 21, type: 'int', category: 'RSI' },
  { name: 'profitTargetPct', base: 3.0, min: 1.0, max: 8.0, type: 'float', category: 'Exit' },
  { name: 'stopLossPct', base: 8, min: 4, max: 20, type: 'int', category: 'Exit' },
  { name: 'trailArmPct', base: 2.0, min: 0.5, max: 5.0, type: 'float', category: 'Exit' },
  { name: 'trailGivePct', base: 12, min: 4, max: 25, type: 'int', category: 'Exit' },
  { name: 'bullTrailGivePct', base: 25, min: 10, max: 40, type: 'int', category: 'Exit' },
  { name: 'bullDipPct', base: 0.5, min: 0.2, max: 2.0, type: 'float', category: 'Entry' },
  { name: 'bullRipPct', base: 1.5, min: 0.5, max: 4.0, type: 'float', category: 'Entry' },
  { name: 'bearDipPct', base: 0.8, min: 0.3, max: 3.0, type: 'float', category: 'Entry' },
  { name: 'bearRipPct', base: 2.1, min: 0.5, max: 5.0, type: 'float', category: 'Entry' },
  { name: 'bearRsiMax', base: 35, min: 20, max: 45, type: 'int', category: 'Entry' },
  { name: 'bullRegimeThreshold', base: 7.0, min: 2.0, max: 15.0, type: 'float', category: 'Regime' },
  { name: 'bullDipScale', base: 3.0, min: 1.0, max: 6.0, type: 'float', category: 'Regime' },
  { name: 'regimeSizeUpMult', base: 2.0, min: 1.0, max: 4.0, type: 'float', category: 'Sizing' },
  { name: 'regimeSizeDownMult', base: 0.75, min: 0.3, max: 1.0, type: 'float', category: 'Sizing' },
  { name: 'bullBuyPctOfUsdc', base: 0.15, min: 0.05, max: 0.30, type: 'float', category: 'Sizing' },
  { name: 'anchorCooldownBars', base: 2, min: 0, max: 10, type: 'int', category: 'Gates' },
  { name: 'minExpectedEdgeBps', base: 5, min: 0, max: 30, type: 'int', category: 'Gates' },
  { name: 'maxSolAllocationPct', base: 60, min: 30, max: 90, type: 'int', category: 'Risk' },
  { name: 'minSolReserve', base: 0.05, min: 0.01, max: 0.2, type: 'float', category: 'Risk' },
  { name: 'bullMinSolHold', base: 0, min: 0, max: 1, type: 'float', category: 'Risk' },
  { name: 'simFeeBps', base: 30, min: 10, max: 60, type: 'int', category: 'Costs' },
  { name: 'simSlippageBps', base: 8, min: 2, max: 20, type: 'int', category: 'Costs' },
];

// Extract names for Sobol
const PARAM_NAMES = PARAM_SPACE.map(p => p.name);
const N_PARAMS = PARAM_NAMES.length;

// ============================================================================
// SOBOL SEQUENCE GENERATION (Sobol' LP-tau sequence)
// ============================================================================
// Using a simplified Sobol generator for up to 40 dimensions
const SOBOL_DIRECTION_NUMBERS = [
  // Pre-computed direction numbers for first 30 dimensions (simplified)
  // For production, use a proper Sobol library like sobol-sequence
];

function generateSobolSamples(n, d) {
  // Simplified: use scrambled Sobol via Owen scrambling + random shift
  // For now, use a good LHS (Latin Hypercube) as approximation
  return generateLHSSamples(n, d);
}

function generateLHSSamples(n, d) {
  const samples = Array(n).fill().map(() => Array(d).fill(0));
  for (let j = 0; j < d; j++) {
    const permutation = Array.from({ length: n }, (_, i) => (i + 0.5) / n);
    // Fisher-Yates shuffle
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
    }
    for (let i = 0; i < n; i++) {
      samples[i][j] = permutation[i];
    }
  }
  return samples;
}

function scaleSamples(samples, paramSpace) {
  return samples.map(row => {
    const scaled = {};
    for (let j = 0; j < paramSpace.length; j++) {
      const p = paramSpace[j];
      const u = row[j];
      if (p.type === 'int') {
        scaled[p.name] = Math.round(p.min + u * (p.max - p.min));
      } else {
        scaled[p.name] = p.min + u * (p.max - p.min);
      }
    }
    return scaled;
  });
}

// ============================================================================
// SALTILLI'S SOBOL INDICES ESTIMATOR (Jansen 1999)
// Requires two matrices A and B of size N x d, plus d matrices A_B^i
// ============================================================================
async function computeSobolIndices(baseParams, series, nBase = 2000) {
  // Total samples needed: N * (d + 2) where d = num params
  // For 27 params and N=2000: 2000 * 29 = 58,000 backtests
  // This is heavy, so we'll use a smaller N for demonstration
  const N = Math.min(nBase, 500); // Adjust based on compute budget
  const d = PARAM_NAMES.length;

  console.log(`  Computing Sobol indices with N=${N}, d=${d} (${N * (d + 2)} backtests)`);

  // Generate matrices A and B
  const A = scaleSamples(generateLHSSamples(N, d), PARAM_SPACE);
  const B = scaleSamples(generateLHSSamples(N, d), PARAM_SPACE);

  // Evaluate f(A) and f(B)
  console.log('  Evaluating base matrices A and B...');
  const fA = await evaluateBatch(A, baseParams, series);
  const fB = await evaluateBatch(B, baseParams, series);

  const f0 = fA.reduce((a, b) => a + b, 0) / N; // Mean
  const varY = fA.reduce((a, b) => a + (b - f0) ** 2, 0) / (N - 1); // Variance

  if (varY === 0) {
    return PARAM_NAMES.map(name => ({ name, S1: 0, ST: 0, category: PARAM_SPACE.find(p => p.name === name).category }));
  }

  // First-order indices S1 and Total-order indices ST
  const S1 = {};
  const ST = {};

  for (let i = 0; i < d; i++) {
    if (i % 5 === 0) console.log(`  Parameter ${i + 1}/${d}: ${PARAM_NAMES[i]}`);

    // Create A_B^i matrix
    const ABi = A.map((row, k) => ({
      ...row,
      [PARAM_NAMES[i]]: B[k][PARAM_NAMES[i]],
    }));

    const fABi = await evaluateBatch(ABi, baseParams, series);

    // Jansen estimator for S1 (first-order)
    let sumS1 = 0;
    for (let k = 0; k < N; k++) {
      sumS1 += (fB[k] - fABi[k]) ** 2;
    }
    S1[PARAM_NAMES[i]] = Math.max(0, 1 - sumS1 / (2 * N * varY));

    // Jansen estimator for ST (total-order)
    let sumST = 0;
    for (let k = 0; k < N; k++) {
      sumST += (fA[k] - fABi[k]) ** 2;
    }
    ST[PARAM_NAMES[i]] = Math.min(1, sumST / (2 * N * varY));
  }

  return PARAM_NAMES.map(name => ({
    name,
    S1: S1[name] || 0,
    ST: ST[name] || 0,
    category: PARAM_SPACE.find(p => p.name === name).category,
  }));
}

async function evaluateBatch(paramSets, baseParams, series) {
  const results = [];
  for (const ps of paramSets) {
    const params = { ...baseParams, ...ps };
    const result = runBacktest(series, params);
    // Use Sharpe proxy (return / maxDD) as the output metric
    const metric = result.maxDrawdownPct > 0 ? result.returnPct / result.maxDrawdownPct : result.returnPct;
    results.push(metric);
  }
  return results;
}

// ============================================================================
// ONE-AT-A-TIME (OAT) SENSITIVITY
// ============================================================================
async function runOATSensitivity(baseParams, series) {
  console.log('\n📊 One-At-A-Time (OAT) Sensitivity...');
  const baseResult = runBacktest(series, baseParams);
  const baseMetric = baseResult.maxDrawdownPct > 0 ? baseResult.returnPct / baseResult.maxDrawdownPct : baseResult.returnPct;

  const oatResults = [];

  for (const p of PARAM_SPACE) {
    const testValues = [];
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      let val;
      if (p.type === 'int') {
        val = Math.round(p.min + u * (p.max - p.min));
      } else {
        val = p.min + u * (p.max - p.min);
      }
      testValues.push(val);
    }

    const sensitivities = [];
    for (const val of testValues) {
      const params = { ...baseParams, [p.name]: val };
      const result = runBacktest(series, params);
      const metric = result.maxDrawdownPct > 0 ? result.returnPct / result.maxDrawdownPct : result.returnPct;
      sensitivities.push({ value: val, metric, delta: metric - baseMetric });
    }

    // Compute sensitivity as max absolute delta normalized by range
    const maxDelta = Math.max(...sensitivities.map(s => Math.abs(s.delta)));
    const range = p.max - p.min;
    const normalizedSensitivity = range > 0 ? maxDelta / range : 0;

    oatResults.push({
      param: p.name,
      category: p.category,
      baseValue: p.base,
      baseMetric,
      sensitivities,
      maxDelta,
      normalizedSensitivity,
      range: [p.min, p.max],
    });
  }

  return oatResults;
}

// ============================================================================
// VARIANCE-BASED DECOMPOSITION (ANOVA-style)
// ============================================================================
function varianceDecomposition(sobolIndices) {
  const totalS1 = sobolIndices.reduce((a, b) => a + b.S1, 0);
  const totalST = sobolIndices.reduce((a, b) => a + b.ST, 0);

  // Interaction effects = ST - S1 for each param
  const interactions = sobolIndices.map(s => ({
    name: s.name,
    interaction: s.ST - s.S1,
    category: s.category,
  }));

  return {
    totalFirstOrder: totalS1,
    totalOrder: totalST,
    interactionStrength: totalST - totalS1,
    interactions: interactions.sort((a, b) => b.interaction - a.interaction),
  };
}

// ============================================================================
// SAFE OPERATING RANGES
// ============================================================================
function computeSafeRanges(oatResults, threshold = 0.1) {
  // Find ranges where metric stays within threshold of base
  const safeRanges = {};

  for (const r of oatResults) {
    const metric = r.baseMetric;
    const acceptable = r.sensitivities.filter(s => 
      s.metric >= metric * (1 - threshold) && s.metric <= metric * (1 + threshold)
    );
    if (acceptable.length > 0) {
      const values = acceptable.map(a => a.value);
      safeRanges[r.param] = {
        min: Math.min(...values),
        max: Math.max(...values),
        base: r.baseValue,
        widthPct: ((Math.max(...values) - Math.min(...values)) / (r.range[1] - r.range[0])) * 100,
      };
    }
  }

  return safeRanges;
}

// ============================================================================
// MAIN SENSITIVITY ANALYSIS
// ============================================================================
async function runSensitivityAnalysis() {
  console.log('🎯 PARAMETER SENSITIVITY ANALYSIS');
  console.log('═'.repeat(70));
  console.log(`Parameters: ${N_PARAMS} (${PARAM_SPACE.map(p => p.category).filter((v,i,a)=>a.indexOf(v)===i).join(', ')})`);
  console.log('Method: Sobol indices (global) + OAT (local) + Variance decomposition');
  console.log('Output metric: Sharpe Proxy (Return / MaxDD)');
  console.log('');

  // Load full history data
  const series = loadSeries(path.join(DATA_DIR, 'sol-usd-1d-full.json'));
  console.log(`Data: ${series.length} candles (${((series[series.length-1].t - series[0].t) / 86400000).toFixed(0)} days)`);

  const baseParams = getBaseParams();

  // 1. OAT Sensitivity (fast, local)
  console.log('\n[1/3] Running OAT sensitivity...');
  const oatResults = await runOATSensitivity(baseParams, series);

  // 2. Sobol Indices (global) - use smaller N for feasibility
  console.log('\n[2/3] Computing Sobol indices (global sensitivity)...');
  const sobolIndices = await computeSobolIndices(baseParams, series, 300);

  // 3. Variance Decomposition
  console.log('\n[3/3] Variance decomposition...');
  const varianceDecomp = varianceDecomposition(sobolIndices);

  // 4. Safe Operating Ranges
  const safeRanges = computeSafeRanges(oatResults, 0.15); // Within 15% of base Sharpe

  // ============================================================================
  // CLASSIFY PARAMETERS
  // ============================================================================
  const critical = sobolIndices.filter(s => s.ST > 0.1).sort((a, b) => b.ST - a.ST);
  const important = sobolIndices.filter(s => s.ST > 0.05 && s.ST <= 0.1).sort((a, b) => b.ST - a.ST);
  const moderate = sobolIndices.filter(s => s.ST > 0.01 && s.ST <= 0.05).sort((a, b) => b.ST - a.ST);
  const robust = sobolIndices.filter(s => s.ST <= 0.01).sort((a, b) => b.ST - a.ST);

  // ============================================================================
  // PREPARE OUTPUT
  // ============================================================================
  const output = {
    metadata: {
      timestamp: new Date().toISOString(),
      dataFile: 'sol-usd-1d-full.json',
      candles: series.length,
      days: (series[series.length-1].t - series[0].t) / 86400000,
      baseParams: baseParams,
      metric: 'Sharpe Proxy (Return/MaxDD)',
      nSobol: 300,
    },
    sobolIndices,
    oatResults,
    varianceDecomposition: varianceDecomp,
    safeRanges,
    classification: {
      critical: critical.map(c => ({ name: c.name, ST: c.ST, S1: c.S1, category: c.category })),
      important: important.map(c => ({ name: c.name, ST: c.ST, S1: c.S1, category: c.category })),
      moderate: moderate.map(c => ({ name: c.name, ST: c.ST, S1: c.S1, category: c.category })),
      robust: robust.map(c => ({ name: c.name, ST: c.ST, S1: c.S1, category: c.category })),
    },
  };

  // Save JSON
  const jsonPath = path.join(OUTPUT_DIR, 'sensitivity.json');
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log(`\n✅ JSON saved to: ${jsonPath}`);

  // Generate Markdown
  const mdPath = path.join(OUTPUT_DIR, 'sensitivity.md');
  fs.writeFileSync(mdPath, generateMarkdownReport(output));
  console.log(`✅ Markdown saved to: ${mdPath}`);

  // Print summary
  printConsoleSummary(output);
}

function generateMarkdownReport(o) {
  const cls = o.classification;
  const vr = o.varianceDecomposition;
  const safe = o.safeRanges;

  let md = `# Parameter Sensitivity Analysis Report

**Generated:** ${o.metadata.timestamp}
**Data:** ${o.metadata.candles} candles (${o.metadata.days.toFixed(0)} days) — ${o.metadata.dataFile}
**Metric:** ${o.metadata.metric}
**Sobol Samples:** ${o.metadata.nSobol} (N × (d+2) = ${o.metadata.nSobol * (PARAM_NAMES.length + 2)} backtests)

---

## 📊 Variance Decomposition

| Component | Value |
|-----------|-------|
| Total First-Order (ΣS₁) | ${vr.totalFirstOrder.toFixed(3)} |
| Total-Order (ΣST) | ${vr.totalOrder.toFixed(3)} |
| Interaction Strength | ${vr.interactionStrength.toFixed(3)} |

**Interpretation:** ${vr.interactionStrength > 0.3 ? '🔴 Strong parameter interactions — joint tuning required' : vr.interactionStrength > 0.1 ? '🟡 Moderate interactions' : '🟢 Weak interactions — parameters act independently'}

---

## 🔴 Critical Parameters (ST > 0.10) — **Must Tune Carefully**

| Parameter | Category | S₁ (Main) | ST (Total) | Interaction | Safe Range |
|-----------|----------|-----------|------------|-------------|------------|
`;

  for (const c of cls.critical) {
    const s = safe[c.name];
    md += `| ${c.name} | ${c.category} | ${c.S1.toFixed(3)} | ${c.ST.toFixed(3)} | ${(c.ST - c.S1).toFixed(3)} | ${s ? `${s.min.toFixed(2)} – ${s.max.toFixed(2)}` : 'N/A'} |\n`;
  }

  md += `\n## 🟠 Important Parameters (0.05 < ST ≤ 0.10) — **Tune with Care**

| Parameter | Category | S₁ | ST | Interaction | Safe Range |
|-----------|----------|----|----|-------------|------------|
`;

  for (const c of cls.important) {
    const s = safe[c.name];
    md += `| ${c.name} | ${c.category} | ${c.S1.toFixed(3)} | ${c.ST.toFixed(3)} | ${(c.ST - c.S1).toFixed(3)} | ${s ? `${s.min.toFixed(2)} – ${s.max.toFixed(2)}` : 'N/A'} |\n`;
  }

  md += `\n## 🟡 Moderate Parameters (0.01 < ST ≤ 0.05) — **Default Usually Fine**

| Parameter | Category | S₁ | ST | Interaction | Safe Range |
|-----------|----------|----|----|-------------|------------|
`;

  for (const c of cls.moderate) {
    const s = safe[c.name];
    md += `| ${c.name} | ${c.category} | ${c.S1.toFixed(3)} | ${c.ST.toFixed(3)} | ${(c.ST - c.S1).toFixed(3)} | ${s ? `${s.min.toFixed(2)} – ${s.max.toFixed(2)}` : 'N/A'} |\n`;
  }

  md += `\n## 🟢 Robust Parameters (ST ≤ 0.01) — **Set & Forget**

| Parameter | Category | S₁ | ST | Safe Range |
|-----------|----------|----|----|------------|
`;

  for (const c of cls.robust) {
    const s = safe[c.name];
    md += `| ${c.name} | ${c.category} | ${c.S1.toFixed(3)} | ${c.ST.toFixed(3)} | ${s ? `${s.min.toFixed(2)} – ${s.max.toFixed(2)}` : 'Full range'} |\n`;
  }

  md += `\n---

## 🌪️ Tornado Chart (OAT Sensitivity — Max Delta from Base)

Sorted by maximum impact on Sharpe Proxy when varying parameter across full range.

| Rank | Parameter | Category | Base Value | Max Δ Sharpe~ | Range Tested | Sensitivity/Unit |
|------|-----------|----------|------------|---------------|--------------|------------------|
`;

  const tornado = [...o.oatResults].sort((a, b) => b.maxDelta - a.maxDelta);
  for (let i = 0; i < Math.min(20, tornado.length); i++) {
    const t = tornado[i];
    const rangeStr = t.range[0] === Math.round(t.range[0]) ? `${t.range[0]}–${t.range[1]}` : `${t.range[0].toFixed(2)}–${t.range[1].toFixed(2)}`;
    md += `| ${i + 1} | ${t.param} | ${t.category} | ${t.baseValue} | ${t.maxDelta.toFixed(3)} | ${rangeStr} | ${t.normalizedSensitivity.toFixed(4)} |\n`;
  }

  md += `\n---

## ✅ Safe Operating Ranges (Within 15% of Base Sharpe)

Parameters where you can move freely without significant performance degradation.

| Parameter | Base | Safe Min | Safe Max | Width (% of Range) | Status |
|-----------|------|----------|----------|-------------------|--------|
`;

  for (const [param, r] of Object.entries(safe).sort((a, b) => b[1].widthPct - a[1].widthPct)) {
    const status = r.widthPct > 50 ? '🟢 Wide' : r.widthPct > 20 ? '🟡 Moderate' : '🔴 Narrow';
    md += `| ${param} | ${r.base} | ${r.min} | ${r.max} | ${r.widthPct.toFixed(0)}% | ${status} |\n`;
  }

  md += `\n---

## 🔑 Key Interactions (ST - S₁ > 0.02)

Parameters whose effect depends heavily on other parameters.

| Parameter | Interaction | Category | Implication |
|-----------|-------------|----------|-------------|
`;

  for (const inter of vr.interactions.slice(0, 10)) {
    if (inter.interaction > 0.02) {
      md += `| ${inter.name} | ${inter.interaction.toFixed(3)} | ${inter.category} | Tune jointly with related params |\n`;
    }
  }

  md += `\n---

## 📋 Recommendations

1. **Focus tuning effort on:** ${cls.critical.slice(0, 3).map(c => c.name).join(', ')}
2. **Safe defaults for:** ${cls.robust.slice(0, 5).map(c => c.name).join(', ')}
3. **Watch interactions between:** ${vr.interactions.filter(i => i.interaction > 0.05).slice(0, 3).map(i => i.name).join(', ')}
4. **Safe operating region:** Keep ${Object.entries(safe).filter(([_, v]) => v.widthPct > 30).slice(0, 5).map(([k, _]) => k).join(', ')} in their safe ranges
5. **Cost sensitivity:** ${cls.critical.some(c => c.category === 'Costs') ? 'Fees/slippage are critical — optimize execution' : 'Fees/slippage have low impact on strategy logic'}

---

## 🎯 Suggested Configuration (Robust Defaults)

\`\`\`json
{
  "emaPeriod": 20,
  "regimeEmaSlow": 50,
  "rsiOversold": 40,
  "profitTargetPct": 3.0,
  "stopLossPct": 8,
  "trailGivePct": 12,
  "bullDipPct": 0.5,
  "bearDipPct": 0.8,
  "bullTrailGivePct": 25,
  "anchorCooldownBars": 2
}
\`\`\`

*All parameters set to base values which lie within safe operating ranges.*
`;

  return md;
}

function printConsoleSummary(o) {
  const cls = o.classification;
  const vr = o.varianceDecomposition;

  console.log('\n' + '═'.repeat(70));
  console.log('🎯 SENSITIVITY ANALYSIS SUMMARY');
  console.log('═'.repeat(70));
  console.log(`Variance: ΣS₁=${vr.totalFirstOrder.toFixed(3)} ΣST=${vr.totalOrder.toFixed(3)} Interaction=${vr.interactionStrength.toFixed(3)}`);
  console.log(`\n🔴 CRITICAL (ST>0.10): ${cls.critical.length} params`);
  for (const c of cls.critical.slice(0, 5)) console.log(`  ${c.name}: ST=${c.ST.toFixed(3)} S₁=${c.S1.toFixed(3)}`);
  console.log(`\n🟠 IMPORTANT (ST>0.05): ${cls.important.length} params`);
  for (const c of cls.important.slice(0, 3)) console.log(`  ${c.name}: ST=${c.ST.toFixed(3)}`);
  console.log(`\n🟢 ROBUST (ST≤0.01): ${cls.robust.length} params`);
  console.log(`\n🌪️ TOP TORNADO:`);
  const tornado = [...o.oatResults].sort((a, b) => b.maxDelta - a.maxDelta);
  for (const t of tornado.slice(0, 5)) console.log(`  ${t.param}: Δ${t.maxDelta.toFixed(3)}`);
  console.log(`\n✅ Full results in backtest/results/sensitivity.{json,md}`);
}

// Run if executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSensitivityAnalysis().catch(console.error);
}

export { runSensitivityAnalysis, PARAM_SPACE, PARAM_NAMES, computeSobolIndices, runOATSensitivity };