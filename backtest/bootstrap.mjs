#!/usr/bin/env node
/**
 * Bootstrap Validation — ULTIMATE Backtesting Suite
 * Block bootstrap (5-day blocks to preserve autocorrelation)
 * 5,000 resamples for confidence intervals on all metrics
 * Test: is Sharpe > 0 statistically significant? (p < 0.05)
 * Output: CI bands, p-values, statistical significance
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
  'sol-usd-6h.json',
  'sol-usd-6h-bull.json',      // 183 days 6h bull
  'sol-usd-6h-recent.json',    // recent chop
  'sol-usd-15m-60d.json',      // 60 days 15m
  'sol-usd-5m-30d.json',       // 30 days 5m
  'sol-usd-1m-7d.json',        // 7 days 1m
];

// ============================================================================
// BLOCK BOOTSTRAP
// ============================================================================
function createDailyBlocks(series, blockDays = 5) {
  const dayMap = new Map();
  for (const candle of series) {
    const day = new Date(candle.t).toISOString().split('T')[0];
    if (!dayMap.has(day)) dayMap.set(day, []);
    dayMap.get(day).push(candle);
  }
  const days = Array.from(dayMap.values());
  const blocks = [];
  for (let i = 0; i < days.length; i += blockDays) {
    const block = [];
    for (let j = 0; j < blockDays && i + j < days.length; j++) {
      block.push(...days[i + j]);
    }
    if (block.length > 0) blocks.push(block);
  }
  return blocks;
}

function resampleBlocks(blocks, nBlocks) {
  const resampled = [];
  for (let i = 0; i < nBlocks; i++) {
    const idx = Math.floor(Math.random() * blocks.length);
    resampled.push(blocks[idx]);
  }
  const flat = resampled.flat().sort((a, b) => a.t - b.t);
  let baseTime = flat[0].t;
  return flat.map((c, i) => ({ ...c, t: baseTime + i * (c.t - flat[Math.max(0, i-1)].t || 86400000) }));
}

function computeMetrics(result) {
  const sharpe = result.maxDrawdownPct > 0 ? result.returnPct / result.maxDrawdownPct : 0;
  const calmar = result.maxDrawdownPct > 0 ? result.returnPct / result.maxDrawdownPct : 0;
  return {
    returnPct: result.returnPct, maxDrawdownPct: result.maxDrawdownPct,
    sharpeProxy: sharpe, calmarProxy: calmar,
    winRatePct: result.winRatePct, trades: result.trades,
    vsHoldPct: result.vsHoldMixPct,
    profitTargetFires: result.profitTargetFires, stopFires: result.stopFires,
  };
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function std(arr) { const m = mean(arr); return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1 || 1)); }
function pValuePositive(arr) { return arr.filter(x => x <= 0).length / arr.length; }
function normalInv(p) {
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [0, 2.515517, 0.802853, 0.010328]; const b = [1, 1.432788, 0.189269, 0.001308];
  const t = Math.sqrt(-2 * Math.log(p < 0.5 ? p : 1 - p));
  let z = t - ((a[3]*t + a[2])*t + a[1])*t / (((b[3]*t + b[2])*t + b[1])*t + 1);
  return p < 0.5 ? -z : z;
}

async function runBootstrap(series, baseParams, nResamples = 5000, blockDays = 5) {
  console.log(`  Creating ${blockDays}-day blocks...`);
  const blocks = createDailyBlocks(series, blockDays);
  console.log(`  ${blocks.length} blocks created. Running ${nResamples} resamples...`);

  const origResult = runBacktest(series, baseParams);
  const origMetrics = computeMetrics(origResult);

  const bootstrapMetrics = { returnPct: [], maxDrawdownPct: [], sharpeProxy: [], calmarProxy: [], winRatePct: [], trades: [], vsHoldPct: [] };

  for (let i = 0; i < nResamples; i++) {
    if (i % 1000 === 0 && i > 0) console.log(`    ${i}/${nResamples}...`);
    const resampled = resampleBlocks(blocks, blocks.length);
    const result = runBacktest(resampled, baseParams);
    const m = computeMetrics(result);
    for (const k of Object.keys(bootstrapMetrics)) bootstrapMetrics[k].push(m[k]);
  }

  const results = {};
  for (const [metric, values] of Object.entries(bootstrapMetrics)) {
    const sorted = [...values].sort((a, b) => a - b);
    const orig = origMetrics[metric];
    const ci95 = [percentile(sorted, 0.025), percentile(sorted, 0.975)];
    const ci90 = [percentile(sorted, 0.05), percentile(sorted, 0.95)];
    const ci99 = [percentile(sorted, 0.005), percentile(sorted, 0.995)];
    const bias = mean(values) - orig;
    const biasPct = orig !== 0 ? (bias / Math.abs(orig)) * 100 : 0;
    const pVal = pValuePositive(values);
    const se = std(values);

    results[metric] = {
      original: orig, mean: mean(values).toFixed(4), std: se.toFixed(4),
      bias: bias.toFixed(4), biasPct: biasPct.toFixed(2),
      ci90: ci90.map(v => v.toFixed(2)), ci95: ci95.map(v => v.toFixed(2)), ci99: ci99.map(v => v.toFixed(2)),
      pValue: pVal.toFixed(6), significant: pVal < 0.05,
      percentiles: { p1: percentile(sorted, 0.01).toFixed(2), p5: percentile(sorted, 0.05).toFixed(2), p10: percentile(sorted, 0.10).toFixed(2), p25: percentile(sorted, 0.25).toFixed(2), p50: percentile(sorted, 0.50).toFixed(2), p75: percentile(sorted, 0.75).toFixed(2), p90: percentile(sorted, 0.90).toFixed(2), p95: percentile(sorted, 0.95).toFixed(2), p99: percentile(sorted, 0.99).toFixed(2) },
    };
  }
  return { original: origMetrics, bootstrap: results, nResamples, blockDays, nBlocks: blocks.length };
}

async function runBootstrapValidation() {
  console.log('📊 BOOTSTRAP VALIDATION');
  console.log('═'.repeat(70));
  console.log('Method: Block bootstrap (5-day blocks, preserves autocorrelation)');
  console.log('Resamples: 5,000 per dataset');
  console.log('Test: H0: Sharpe ≤ 0 vs H1: Sharpe > 0 (α = 0.05)');
  console.log('Datasets: All 11 available');
  console.log('');

  const baseParams = getBaseParams();
  const allResults = {};

  for (const file of DATASETS) {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) { console.log(`\n⚠️  Skipping ${file} (not found)`); continue; }
    console.log(`\n📊 ${file}`);
    const series = loadSeries(filePath);
    const totalDays = (series[series.length - 1].t - series[0].t) / 86400000;
    if (totalDays < 30) { console.log(`  ⚠️  Insufficient data (${totalDays.toFixed(0)}d < 30d min)`); allResults[file] = { skipped: true, reason: 'Insufficient data', days: totalDays }; continue; }
    const result = await runBootstrap(series, baseParams, 5000, 5);
    allResults[file] = result;
    const b = result.bootstrap;
    console.log(`  Return: ${b.returnPct.original.toFixed(2)}% [95% CI: ${b.returnPct.ci95.join(', ')}%] p=${b.returnPct.pValue}`);
    console.log(`  Sharpe~: ${b.sharpeProxy.original.toFixed(3)} [95% CI: ${b.sharpeProxy.ci95.join(', ')}] p=${b.sharpeProxy.pValue} ${b.sharpeProxy.significant ? '✅' : '❌'}`);
    console.log(`  Max DD: ${b.maxDrawdownPct.original.toFixed(2)}% [95% CI: ${b.maxDrawdownPct.ci95.join(', ')}%]`);
    console.log(`  Win Rate: ${b.winRatePct.original.toFixed(1)}% [95% CI: ${b.winRatePct.ci95.join(', ')}%]`);
  }

  const summary = computeCrossDatasetSummary(allResults);
  const output = { metadata: { timestamp: new Date().toISOString(), baseParams, datasets: DATASETS, method: 'Block bootstrap (5-day blocks)', nResamples: 5000, blockDays: 5, test: 'H0: metric ≤ 0 vs H1: metric > 0 (one-sided, α=0.05)' }, results: allResults, crossDatasetSummary: summary };
  const jsonPath = path.join(OUTPUT_DIR, 'bootstrap.json');
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log(`\n✅ JSON saved to: ${jsonPath}`);
  const mdPath = path.join(OUTPUT_DIR, 'bootstrap.md');
  fs.writeFileSync(mdPath, generateMarkdownReport(output));
  console.log(`✅ Markdown saved to: ${mdPath}`);
  printConsoleSummary(output);
}

function computeCrossDatasetSummary(allResults) {
  const summary = {};
  for (const [file, data] of Object.entries(allResults)) {
    if (data.skipped) continue;
    const b = data.bootstrap;
    summary[file] = { return: { orig: b.returnPct.original, ci95: b.returnPct.ci95, p: b.returnPct.pValue, sig: b.returnPct.significant }, sharpe: { orig: b.sharpeProxy.original, ci95: b.sharpeProxy.ci95, p: b.sharpeProxy.pValue, sig: b.sharpeProxy.significant }, maxDD: { orig: b.maxDrawdownPct.original, ci95: b.maxDrawdownPct.ci95 }, winRate: { orig: b.winRatePct.original, ci95: b.winRatePct.ci95 }, vsHold: { orig: b.vsHoldPct.original, ci95: b.vsHoldPct.ci95, p: b.vsHoldPct.pValue, sig: b.vsHoldPct.significant } };
  }
  return summary;
}

function generateMarkdownReport(o) {
  const summary = o.crossDatasetSummary;
  let md = `# Bootstrap Validation Report\n\n**Generated:** ${o.metadata.timestamp}\n**Method:** ${o.metadata.method}\n**Resamples:** ${o.metadata.nResamples.toLocaleString()}\n**Block Size:** ${o.metadata.blockDays} days\n**Hypothesis Test:** ${o.metadata.test}\n**Base Config:** Config C (Tier 2)\n\n---\n\n## 📊 Cross-Dataset Summary\n\n| Dataset | Return (95% CI) | p-value | Sharpe~ (95% CI) | p-value | Sig? | Max DD (95% CI) | Win Rate (95% CI) |\n|---------|-----------------|---------|------------------|---------|------|-----------------|-------------------|\n`;
  for (const [file, s] of Object.entries(summary)) {
    md += `| ${file} | ${s.return.orig.toFixed(2)}% [${s.return.ci95.join(', ')}%] | ${s.return.p} | ${s.sharpe.orig.toFixed(3)} [${s.sharpe.ci95.join(', ')}] | ${s.sharpe.p} | ${s.sharpe.sig ? '✅' : '❌'} | ${s.maxDD.orig.toFixed(2)}% [${s.maxDD.ci95.join(', ')}%] | ${s.winRate.orig.toFixed(1)}% [${s.winRate.ci95.join(', ')}%] |\n`;
  }
  md += `\n---\n\n## 📈 Detailed Results by Dataset\n\n`;
  for (const [file, data] of Object.entries(o.results)) {
    if (data.skipped) { md += `### ${file} ⚠️ SKIPPED: ${data.reason}\n\n`; continue; }
    const b = data.bootstrap;
    md += `### ${file}\n\n| Metric | Original | Bootstrap Mean | Bias | Bias% | Std Err | 90% CI | 95% CI | 99% CI | p-value | Significant |\n|--------|----------|----------------|------|-------|---------|--------|--------|--------|---------|-------------|\n`;
    const metricsOrder = ['returnPct', 'sharpeProxy', 'maxDrawdownPct', 'calmarProxy', 'winRatePct', 'trades', 'vsHoldPct'];
    const metricLabels = { returnPct: 'Return (%)', sharpeProxy: 'Sharpe Proxy', maxDrawdownPct: 'Max DD (%)', calmarProxy: 'Calmar Proxy', winRatePct: 'Win Rate (%)', trades: 'Trades', vsHoldPct: 'vs Hold (%)' };
    for (const key of metricsOrder) {
      const m = b[key];
      md += `| ${metricLabels[key]} | ${m.original.toFixed(2)} | ${m.mean} | ${m.bias} | ${m.biasPct}% | ${m.std} | [${m.ci90.join(', ')}] | [${m.ci95.join(', ')}] | [${m.ci99.join(', ')}] | ${m.pValue} | ${m.significant ? '✅' : '❌'} |\n`;
    }
    md += `\n**Percentiles (Sharpe Proxy):**\n\n| P1 | P5 | P10 | P25 | P50 | P75 | P90 | P95 | P99 |\n|----|----|-----|-----|-----|-----|-----|-----|-----|\n`;
    const p = b.sharpeProxy.percentiles;
    md += `| ${p.p1} | ${p.p5} | ${p.p10} | ${p.p25} | ${p.p50} | ${p.p75} | ${p.p90} | ${p.p95} | ${p.p99} |\n\n---\n\n`;
  }
  md += `## 🎯 Statistical Conclusions\n\n`;
  const sigCount = Object.values(summary).filter(s => s.sharpe.sig).length;
  const totalCount = Object.keys(summary).length;
  const avgSharpe = mean(Object.values(summary).map(s => s.sharpe.orig));
  const avgReturn = mean(Object.values(summary).map(s => s.return.orig));
  md += `- **Sharpe > 0 significant in ${sigCount}/${totalCount} datasets** (${((sigCount/totalCount)*100).toFixed(0)}%)\n- **Average Sharpe Proxy:** ${avgSharpe.toFixed(3)}\n- **Average Return:** ${avgReturn.toFixed(2)}%\n\n`;
  if (sigCount === totalCount) md += `✅ **Strong evidence**: Strategy has statistically significant positive risk-adjusted returns across all tested regimes.\n`;
  else if (sigCount > totalCount / 2) md += `⚠️ **Mixed evidence**: Significant in majority but not all regimes. Consider regime-specific deployment.\n`;
  else md += `❌ **Weak evidence**: Fails significance in most regimes. Strategy may not generalize.\n`;
  md += `\n---\n\n## 📋 Recommendations\n\n1. **Deploy with confidence** in regimes where p < 0.05 for Sharpe\n2. **Monitor** max DD 95% CI upper bound for risk limits\n3. **Retest** quarterly with new data to validate persistence\n4. **Consider** Bayesian updating of prior as more data accumulates\n\n*Generated by Ultimate Backtesting Suite — Bootstrap Validation*\n`;
  return md;
}

function printConsoleSummary(o) {
  console.log('\n' + '═'.repeat(70));
  console.log('📊 BOOTSTRAP VALIDATION SUMMARY');
  console.log('═'.repeat(70));
  for (const [file, data] of Object.entries(o.results)) {
    if (data.skipped) { console.log(`  ${file}: SKIPPED (${data.reason})`); continue; }
    const b = data.bootstrap;
    const sig = b.sharpeProxy.significant ? '✅' : '❌';
    console.log(`  ${file}: Sharpe~ ${b.sharpeProxy.original.toFixed(3)} [${b.sharpeProxy.ci95.join(', ')}] p=${b.sharpeProxy.pValue} ${sig}`);
  }
  const sigCount = Object.values(o.crossDatasetSummary).filter(s => s.sharpe.sig).length;
  const total = Object.keys(o.crossDatasetSummary).length;
  console.log(`\n  Sharpe > 0 significant: ${sigCount}/${total} datasets`);
  console.log(`\n✅ Full results in backtest/results/bootstrap.{json,md}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBootstrapValidation().catch(console.error);
}
export { runBootstrapValidation, createDailyBlocks, resampleBlocks, computeMetrics };