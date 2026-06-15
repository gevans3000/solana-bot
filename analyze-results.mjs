import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('backtest/moderate-sweep-results.json', 'utf8'));
const results = data.allResults;

// Show top 30 with unique parameter combos (group by key params)
const seen = new Set();
const unique = [];
for (const r of results) {
  const key = `${r.signalMinSec}-${r.cooldownSec}-${r.maxTradesPerDay}-${r.dailyNotionalLimitUsdc}-${r.bullDipPct}-${r.bullRipPct}-${r.stopLossPct}-${r.profitTargetPct}`;
  if (!seen.has(key)) {
    seen.add(key);
    unique.push(r);
  }
}
console.log('Unique top 30 by Sharpe proxy:');
console.log('sigMin cool maxTrd dailyNot bDip bRip SL% PT% trades ret% vsH% maxDD% win% sharpe');
for (const r of unique.slice(0, 30)) {
  console.log(`${String(r.signalMinSec).padStart(6)} ${String(r.cooldownSec).padStart(4)} ${String(r.maxTradesPerDay).padStart(6)} ${String(r.dailyNotionalLimitUsdc).padStart(8)} ${r.bullDipPct.toFixed(1).padStart(4)} ${r.bullRipPct.toFixed(1).padStart(4)} ${String(r.stopLossPct).padStart(3)} ${r.profitTargetPct.toFixed(1).padStart(3)} ${String(r.trades).padStart(6)} ${r.returnPct.toFixed(1).padStart(6)} ${r.vsHoldPct.toFixed(1).padStart(6)} ${r.maxDrawdownPct.toFixed(1).padStart(7)} ${r.winRatePct.toFixed(1).padStart(5)} ${r.sharpeProxy.toFixed(2).padStart(6)}`);
}

// Also show best by return
const byReturn = [...results].sort((a,b) => b.returnPct - a.returnPct);
console.log('\n\nTop 10 by Return:');
console.log('sigMin cool maxTrd dailyNot bDip bRip SL% PT% trades ret% vsH% maxDD% win% sharpe');
for (const r of byReturn.slice(0, 10)) {
  console.log(`${String(r.signalMinSec).padStart(6)} ${String(r.cooldownSec).padStart(4)} ${String(r.maxTradesPerDay).padStart(6)} ${String(r.dailyNotionalLimitUsdc).padStart(8)} ${r.bullDipPct.toFixed(1).padStart(4)} ${r.bullRipPct.toFixed(1).padStart(4)} ${String(r.stopLossPct).padStart(3)} ${r.profitTargetPct.toFixed(1).padStart(3)} ${String(r.trades).padStart(6)} ${r.returnPct.toFixed(1).padStart(6)} ${r.vsHoldPct.toFixed(1).padStart(6)} ${r.maxDrawdownPct.toFixed(1).padStart(7)} ${r.winRatePct.toFixed(1).padStart(5)} ${r.sharpeProxy.toFixed(2).padStart(6)}`);
}

// Best vsHold
const byVsHold = [...results].sort((a,b) => b.vsHoldPct - a.vsHoldPct);
console.log('\n\nTop 10 by vsHold:');
console.log('sigMin cool maxTrd dailyNot bDip bRip SL% PT% trades ret% vsH% maxDD% win% sharpe');
for (const r of byVsHold.slice(0, 10)) {
  console.log(`${String(r.signalMinSec).padStart(6)} ${String(r.cooldownSec).padStart(4)} ${String(r.maxTradesPerDay).padStart(6)} ${String(r.dailyNotionalLimitUsdc).padStart(8)} ${r.bullDipPct.toFixed(1).padStart(4)} ${r.bullRipPct.toFixed(1).padStart(4)} ${String(r.stopLossPct).padStart(3)} ${r.profitTargetPct.toFixed(1).padStart(3)} ${String(r.trades).padStart(6)} ${r.returnPct.toFixed(1).padStart(6)} ${r.vsHoldPct.toFixed(1).padStart(6)} ${r.maxDrawdownPct.toFixed(1).padStart(7)} ${r.winRatePct.toFixed(1).padStart(5)} ${r.sharpeProxy.toFixed(2).padStart(6)}`);
}