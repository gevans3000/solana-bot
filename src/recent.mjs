import fs from 'node:fs';
import { fileInLogs, loadJson, loadPortfolio } from './common.mjs';

function tailJson(file, count = Infinity) {
  const p = fileInLogs(file);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-count).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

// Normalise a trade log entry to a flat shape regardless of nesting
function normaliseTrade(t) {
  const side = t.signal?.side ?? t.execution?.side ?? t.side;
  const amount = t.signal?.amount ?? t.execution?.amount ?? t.amount;
  const price = t.signal?.price ?? t.execution?.price ?? t.price;
  const realizedPnlUsdc = t.execution?.realizedPnlUsdc ?? t.realizedPnlUsdc ?? 0;
  return { ...t, side, amount, price, realizedPnlUsdc };
}

const executor = tailJson('executor.jsonl', 500);
const signals = tailJson('signals.jsonl', 500);

const trades = executor
  .filter(e => e.type === 'trade' || e.type === 'dry_run_trade')
  .map(normaliseTrade);

const portfolio = loadPortfolio();

const today = new Date().toISOString().slice(0, 10);
const todaysTrades = trades.filter(t => new Date(t.t).toISOString().slice(0, 10) === today);

const wins = trades.filter(t => (t.realizedPnlUsdc || 0) > 0).length;
const losses = trades.filter(t => (t.realizedPnlUsdc || 0) < 0).length;
const breaks = trades.filter(t => (t.realizedPnlUsdc || 0) === 0).length;

const skipReasons = {};
for (const log of executor) {
  if (log.type === 'skip' && log.reason) {
    skipReasons[log.reason] = (skipReasons[log.reason] || 0) + 1;
  }
}

const topSkips = Object.entries(skipReasons)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5);

const lastTrade = trades.length > 0 ? trades[trades.length - 1] : null;

const rows = [];
rows.push('📊 Solana SOL/USDC Agent - Recent Summary');
rows.push('='.repeat(50));
rows.push('');

rows.push('📈 Trade Activity');
rows.push('-'.repeat(50));
rows.push(`Total trades:        ${trades.length}`);
rows.push(`Today:               ${todaysTrades.length}`);
rows.push(`Wins:                ${wins} | Losses: ${losses} | Breaks: ${breaks}`);
if (trades.length > 0) {
  const winRate = ((wins / trades.length) * 100).toFixed(1);
  rows.push(`Win rate:            ${winRate}%`);
}
rows.push('');

rows.push('💰 Profitability');
rows.push('-'.repeat(50));
rows.push(`Realized PnL:        $${portfolio.realizedPnlUsdc?.toFixed(2) || '0.00'}`);
const cachedPrice = loadJson('price-cache.json', null)?.price || 0;
const unrealizedPnl = portfolio.sol && portfolio.avgEntryPrice && cachedPrice
  ? (cachedPrice - portfolio.avgEntryPrice) * portfolio.sol
  : 0;
rows.push(`Unrealized PnL:      $${unrealizedPnl.toFixed(2)}`);
rows.push(`Swept to wallet:     $${portfolio.sweptUsdc?.toFixed(2) || '0.00'}`);
rows.push('');

rows.push('💼 Current Portfolio');
rows.push('-'.repeat(50));
rows.push(`SOL:                 ${portfolio.sol?.toFixed(6) || '0.000000'}`);
rows.push(`USDC:                $${portfolio.usdc?.toFixed(2) || '0.00'}`);
if (portfolio.avgEntryPrice) {
  rows.push(`Avg Entry Price:     $${portfolio.avgEntryPrice.toFixed(2)}`);
}
rows.push('');

if (topSkips.length > 0) {
  rows.push('⏭️  Top Skip Reasons');
  rows.push('-'.repeat(50));
  for (const [reason, count] of topSkips) {
    rows.push(`${reason.padEnd(30)} ${count}`);
  }
  rows.push('');
}

if (lastTrade) {
  rows.push('⏱️  Last Trade');
  rows.push('-'.repeat(50));
  const ago = Math.round((Date.now() - new Date(lastTrade.t).getTime()) / 1000);
  rows.push(`Time:                ${new Date(lastTrade.t).toISOString()}`);
  rows.push(`Ago:                 ${ago} seconds`);
  rows.push(`Side:                ${lastTrade.side}`);
  rows.push(`Amount:              ${lastTrade.amount?.toFixed(4) || '-'}`);
  rows.push(`Price:               $${lastTrade.price?.toFixed(2) || '-'}`);
  if (lastTrade.realizedPnlUsdc) {
    rows.push(`PnL:                 $${lastTrade.realizedPnlUsdc.toFixed(2)}`);
  }
  rows.push('');
}

// Shadow mode stats if available
const shadowFile = fileInLogs('shadow.jsonl');
if (fs.existsSync(shadowFile)) {
  const shadowLogs = tailJson('shadow.jsonl', 100);
  const preTradeQuotes = shadowLogs.filter(l => l.type === 'pre_trade');
  const quoteErrors = shadowLogs.filter(l => l.type === 'quote_error');

  rows.push('👤 Shadow Mode Stats');
  rows.push('-'.repeat(50));
  rows.push(`Pre-trade quotes:    ${preTradeQuotes.length}`);
  rows.push(`Quote errors:        ${quoteErrors.length}`);
  rows.push('');
}

rows.push('Last updated: ' + new Date().toISOString());

console.log(rows.join('\n'));
