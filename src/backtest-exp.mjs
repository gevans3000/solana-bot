#!/usr/bin/env node
// Backtester v5 — profit target, dual-EMA regime filter, RSI-scaled sizing,
//                  PT cooldown bypass, EMA warmup guard, ATR, stop-loss, walk-forward
//
// Usage:
//   node src/backtest.mjs                          # all files in backtest/data/
//   node src/backtest.mjs --data <file>
//   node src/backtest.mjs --sweep                  # grid-search
//   node src/backtest.mjs --sweep --walk-forward   # 70/30 walk-forward
//   node src/backtest.mjs --compare                # baseline vs all features
//   node src/backtest.mjs --json

import fs    from 'node:fs';
import path  from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CFG } from './common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---- params ------------------------------------------------------------------
export function paramsFromCfg(cfg = CFG) {
  return {
    bullDipPct: cfg.bullDipPct, bullRipPct: cfg.bullRipPct,
    bullBuyUsdc: cfg.bullBuyUsdc, bullSellSol: cfg.bullSellSol,
    bearDipPct: cfg.bearDipPct, bearRipPct: cfg.bearRipPct,
    bearBuyUsdc: cfg.bearBuyUsdc, bearSellSol: cfg.bearSellSol,
    minExpectedEdgeBps: cfg.minExpectedEdgeBps,
    minTradeUsdc: cfg.minTradeUsdc, maxNotionalUsdc: cfg.maxNotionalUsdc,
    dailyNotionalLimitUsdc: cfg.dailyNotionalLimitUsdc,
    maxTradesPerDay: cfg.maxTradesPerDay,
    minSolReserve: cfg.minSolReserve, maxSolAllocationPct: cfg.maxSolAllocationPct,
    signalMinSec: cfg.signalMinSec, cooldownSec: cfg.cooldownSec,
    decisionWindowSec: cfg.decisionWindowSec, staleSignalSec: cfg.staleSignalSec,
    simStartUsdc: cfg.simStartUsdc, simStartSol: cfg.simStartSol,
    simFeeBps: cfg.simFeeBps, simSlippageBps: cfg.simSlippageBps,
    trendFilterEnabled: cfg.trendFilterEnabled, emaPeriod: cfg.emaPeriod,
    regimeFilterEnabled: cfg.regimeFilterEnabled, regimeEmaSlow: cfg.regimeEmaSlow,
    useAtrThresholds: cfg.useAtrThresholds, atrPeriod: cfg.atrPeriod,
    atrDipMult: cfg.atrDipMult, atrRipMult: cfg.atrRipMult,
    atrMinDipPct: cfg.atrMinDipPct, atrMinRipPct: cfg.atrMinRipPct,
    rsiEnabled: cfg.rsiEnabled, rsiPeriod: cfg.rsiPeriod,
    rsiOversold: cfg.rsiOversold, rsiOverbought: cfg.rsiOverbought,
    rsiScaleBuyEnabled: cfg.rsiScaleBuyEnabled, rsiScaleMaxMult: cfg.rsiScaleMaxMult,
    profitTargetEnabled: cfg.profitTargetEnabled, profitTargetPct: cfg.profitTargetPct,
    profitTargetBypassCooldown: cfg.profitTargetBypassCooldown,
    stopLossEnabled: cfg.stopLossEnabled, stopLossPct: cfg.stopLossPct,
    trailPtEnabled: process.env.TRAIL_PT === '1',
    trailArmPct: +(process.env.TRAIL_ARM_PCT ?? 2.0),
    trailGivePct: +(process.env.TRAIL_GIVE_PCT ?? 1.0),
    partialPtEnabled: process.env.PARTIAL_PT === '1',
    partialFrac: +(process.env.PARTIAL_FRAC ?? 0.5),
    anchorCooldownBars: +(process.env.ANCHOR_COOLDOWN_BARS ?? 0),
    trailRegimeOnly: process.env.TRAIL_REGIME_ONLY === '1',
    intrabarStops: process.env.INTRABAR_STOPS === '1',
  };
}

function makeSignalId(sig) {
  return crypto.createHash('sha256').update(JSON.stringify(sig)).digest('hex').slice(0, 16);
}
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---- EMA --------------------------------------------------------------------
function emaAlpha(period) { return 2 / (period + 1); }
function updateEma(prev, price, alpha) {
  return prev == null ? price : alpha * price + (1 - alpha) * prev;
}

// ---- RSI --------------------------------------------------------------------
function computeRsi(series, period) {
  const alpha = 1 / period;
  const rsi = new Array(series.length).fill(null);
  let prev = series[0].price, avgG = null, avgL = null;
  for (let i = 1; i < series.length; i++) {
    const d = series[i].price - prev;
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgG = avgG == null ? g : alpha * g + (1 - alpha) * avgG;
    avgL = avgL == null ? l : alpha * l + (1 - alpha) * avgL;
    if (i >= period) {
      const rs = avgL === 0 ? Infinity : avgG / avgL;
      rsi[i] = 100 - 100 / (1 + rs);
    }
    prev = series[i].price;
  }
  return rsi;
}

// ---- ATR --------------------------------------------------------------------
function computeAtr(series, period) {
  const alpha = emaAlpha(period);
  const atr = new Array(series.length).fill(null);
  let prevClose = series[0].price, prevAtr = null;
  for (let i = 1; i < series.length; i++) {
    const { price: c, high: h = c, low: l = c } = series[i];
    const tr = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
    prevAtr = updateEma(prevAtr, tr, alpha);
    atr[i] = prevAtr; prevClose = c;
  }
  atr[0] = atr[1] ?? null;
  return atr;
}

// ---- RSI buy size scaler ----------------------------------------------------
// More oversold = buy more. Returns multiplier 1.0–rsiScaleMaxMult.
function rsiBuyMult(rsiVal, rsiOversold, maxMult) {
  if (rsiVal == null || rsiVal >= rsiOversold) return 1.0;
  // linear scale: at rsiOversold -> 1x, at 0 -> maxMult
  return 1.0 + (rsiOversold - rsiVal) / rsiOversold * (maxMult - 1.0);
}

// ---- signal generation -------------------------------------------------------
function botTick(botState, price, nowMs, balances, emaFast, prevEmaFast, emaSlow, rsiVal, dipPct, ripPct, P, bar) {
  if (botState.anchor == null) botState.anchor = price;
  const eligible = botState.lastSignalAt == null
    || (nowMs - botState.lastSignalAt) >= botState.signalMinSec * 1000;
  const buyTrigger  = botState.anchor * (1 - dipPct / 100);
  const sellTrigger = botState.anchor * (1 + ripPct / 100);

  const rsiOversold   = P.rsiEnabled && rsiVal != null && rsiVal < P.rsiOversold;
  const rsiOverbought = P.rsiEnabled && rsiVal != null && rsiVal > P.rsiOverbought;
  const emaRising  = !P.trendFilterEnabled  || emaFast == null || prevEmaFast == null || emaFast >= prevEmaFast;
  // Regime filter only applies after warmup (regimeEmaSlow candles)
    const regimeOk   = !P.regimeFilterEnabled  || emaFast == null || emaSlow == null || emaFast >= emaSlow;
  const buyAllowed = (emaRising && regimeOk) || rsiOversold;

  // RSI-scaled buy amount
  const buyMult = (P.rsiScaleBuyEnabled && rsiOversold)
    ? rsiBuyMult(rsiVal, P.rsiOversold, P.rsiScaleMaxMult) : 1.0;
  const scaledBuy = Math.min(botState.buyUsdc * buyMult, balances.usdc);

  const anchorCdOk = !P.anchorCooldownBars || (bar - botState.lastBuyBar) >= P.anchorCooldownBars;
  let signal = null;
  if (eligible && anchorCdOk && price <= buyTrigger && scaledBuy >= P.minTradeUsdc && buyAllowed) {
    signal = { t: new Date(nowMs).toISOString(), bot: botState.name, side: 'BUY',
      amount: +scaledBuy.toFixed(6), price, anchor: botState.anchor,
      edgeBps: Math.round(((botState.anchor - price) / botState.anchor) * 10000),
      rsi: rsiVal != null ? +rsiVal.toFixed(1) : null,
      buyMult: +buyMult.toFixed(2) };
  } else if (eligible && balances.sol >= botState.sellSol + botState.minSolReserve &&
      (price >= sellTrigger || (rsiOverbought && price > botState.anchor))) {
    signal = { t: new Date(nowMs).toISOString(), bot: botState.name, side: 'SELL',
      amount: botState.sellSol, price, anchor: botState.anchor,
      edgeBps: Math.round(((price - botState.anchor) / botState.anchor) * 10000),
      rsi: rsiVal != null ? +rsiVal.toFixed(1) : null };
  }
  if (signal) { signal.signalId = makeSignalId(signal); botState.lastSignalAt = nowMs; botState.anchor = price; if (signal.side==='BUY') botState.lastBuyBar = bar; }
  return signal;
}

// ---- executor decision -------------------------------------------------------
function decide(signals, minEdgeBps) {
  if (!signals.length) return { action: 'NO_TRADE', reason: 'no signals' };
  const map = new Map();
  for (const s of signals) map.set(s.bot, s);
  const bull = map.get('BULL') || null, bear = map.get('BEAR') || null;
  if (bull && bear && bull.side !== bear.side) return { action: 'NO_TRADE', reason: 'bot conflict' };
  const chosen = bear || bull;
  if (!chosen) return { action: 'NO_TRADE', reason: 'no usable signal' };
  if (chosen.edgeBps == null || chosen.edgeBps < minEdgeBps) return { action: 'NO_TRADE', reason: 'edge below minimum' };
  return { action: 'TRADE', chosen };
}

// ---- fill -------------------------------------------------------------------
function fill(port, side, amount, price, P) {
  const fee = P.simFeeBps / 10000, slip = P.simSlippageBps / 10000;
  let pnl = 0;
  if (side === 'BUY') {
    const ep = price * (1 + slip), feeUsdc = amount * fee;
    if (port.usdc < amount + feeUsdc) return null;
    const sol = amount / ep, newSol = port.sol + sol;
    const newCost = port.sol * (port.avgEntryPrice || 0) + amount + feeUsdc;
    port.usdc -= (amount + feeUsdc); port.sol = newSol;
    port.avgEntryPrice = newSol > 0 ? newCost / newSol : 0;
  } else {
    const ep = price * (1 - slip);
    if (port.sol < amount) return null;
    const gross = amount * ep, feeUsdc = gross * fee;
    pnl = (ep - (port.avgEntryPrice || 0)) * amount - feeUsdc;
    port.usdc += gross - feeUsdc; port.sol -= amount;
    port.realizedPnlUsdc += pnl;
    if (port.sol <= 1e-9) port.avgEntryPrice = 0;
  }
  return { side, pnl };
}

// ---- full replay ------------------------------------------------------------
export function runBacktest(series, P) {
  const port = { usdc: P.simStartUsdc, sol: P.simStartSol, avgEntryPrice: 0, realizedPnlUsdc: 0, peakSinceEntry: 0, partialDone: false };
  const mkBot = (name, dip, rip, buyUsdc, sellSol) => ({
    name, anchor: null, lastSignalAt: null, dip, rip, buyUsdc, sellSol,
    minSolReserve: P.minSolReserve, signalMinSec: P.signalMinSec,
    lastBuyBar: -1e9,
  });
  const bots = {
    BULL: mkBot('BULL', P.bullDipPct, P.bullRipPct, P.bullBuyUsdc, P.bullSellSol),
    BEAR: mkBot('BEAR', P.bearDipPct, P.bearRipPct, P.bearBuyUsdc, P.bearSellSol),
  };
  const exec = { lastTradeAt: null, lastTradeWindow: null, lastSignalId: null,
    tradesToday: 0, notionalTodayUsdc: 0, day: null };

  // Precompute indicators
  const fastAlpha = emaAlpha(P.emaPeriod), slowAlpha = emaAlpha(P.regimeEmaSlow);
  const emaFastArr = [], emaSlowArr = [];
  let ef = null, es = null;
  for (const { price } of series) {
    ef = updateEma(ef, price, fastAlpha); emaFastArr.push(ef);
    es = updateEma(es, price, slowAlpha); emaSlowArr.push(es);
  }
  const rsiArr = P.rsiEnabled ? computeRsi(series, P.rsiPeriod) : null;
  const atrArr = P.useAtrThresholds ? computeAtr(series, P.atrPeriod) : null;

  let recentSignals = [];
  let trades = 0, buys = 0, sells = 0, wins = 0, losses = 0, grossFees = 0;
  let stopFires = 0, profitTargetFires = 0;
  const skip = {};
  const note = (r) => { skip[r] = (skip[r] || 0) + 1; };

  const startPrice  = series[0].price;
  const startEquity = port.usdc + port.sol * startPrice;
  let peakEquity = startEquity, maxDD = 0;

  for (let i = 0; i < series.length; i++) {
    const { t: nowMs, price, low = price, high = price } = series[i];
    const emaFast  = emaFastArr[i], prevFast = i > 0 ? emaFastArr[i-1] : null;
    const emaSlow  = emaSlowArr[i];
    const rsiVal   = rsiArr ? rsiArr[i] : null;
    const atr      = atrArr ? atrArr[i] : null;
    // Regime filter only trustworthy after slow EMA has seen enough candles
    

    const dynDip = (P.useAtrThresholds && atr) ? Math.max(P.atrMinDipPct, (atr/price)*100*P.atrDipMult) : null;
    const dynRip = (P.useAtrThresholds && atr) ? Math.max(P.atrMinRipPct, (atr/price)*100*P.atrRipMult) : null;
    const bullDip = dynDip ?? bots.BULL.dip, bullRip = dynRip ?? bots.BULL.rip;
    const bearDip = dynDip != null ? Math.max(P.atrMinDipPct, dynDip*1.6) : bots.BEAR.dip;
    const bearRip = dynRip != null ? Math.max(P.atrMinRipPct, dynRip*0.7) : bots.BEAR.rip;

    const day = utcDay(nowMs);
    if (exec.day !== day) { exec.day = day; exec.tradesToday = 0; exec.notionalTodayUsdc = 0; }

    // ---- PROFIT TARGET (trailing / partial aware) ----
    if (P.profitTargetEnabled && port.sol > P.minSolReserve && port.avgEntryPrice > 0) {
      const pct = ((price - port.avgEntryPrice) / port.avgEntryPrice) * 100;
      if (price > port.peakSinceEntry) port.peakSinceEntry = price;
      const giveBackPct = port.peakSinceEntry > 0 ? ((port.peakSinceEntry - price) / port.peakSinceEntry) * 100 : 0;

      // Partial scale-out: sell partialFrac of bag the first time we hit arm level, let rest run
      if (P.partialPtEnabled && !port.partialDone && pct >= P.trailArmPct) {
        const sellAmt = +((port.sol - P.minSolReserve) * P.partialFrac).toFixed(6);
        if (sellAmt > 0) {
          const res = fill(port, 'SELL', sellAmt, price, P);
          if (res) { trades++; sells++; if (res.pnl>0) wins++; else losses++;
            grossFees += sellAmt*price*(P.simFeeBps/10000); profitTargetFires++;
            port.partialDone = true;
            exec.lastTradeAt = nowMs; exec.lastTradeWindow = Math.floor(nowMs/(P.decisionWindowSec*1000)); }
        }
      }

      let exitWhole = false;
      const regimeUp = emaFast != null && emaSlow != null && emaFast > emaSlow;
      const useTrail = P.trailPtEnabled && (!P.trailRegimeOnly || regimeUp);
      if (useTrail) {
        // arm once gain >= trailArmPct, then exit when price gives back trailGivePct from peak
        if (pct >= P.trailArmPct && giveBackPct >= P.trailGivePct) exitWhole = true;
      } else if (pct >= P.profitTargetPct) {
        exitWhole = true;
      }

      if (exitWhole) {
        const sellAmt = +(port.sol - P.minSolReserve).toFixed(6);
        if (sellAmt > 0) {
          const res = fill(port, 'SELL', sellAmt, price, P);
          if (res) {
            trades++; sells++; if (res.pnl>0) wins++; else losses++;
            grossFees += sellAmt * price * (P.simFeeBps / 10000);
            profitTargetFires++;
            port.peakSinceEntry = 0; port.partialDone = false;
            exec.lastTradeAt = P.profitTargetBypassCooldown ? null : nowMs;
            exec.lastTradeWindow = Math.floor(nowMs / (P.decisionWindowSec * 1000));
            for (const b of Object.values(bots)) b.anchor = price;
          }
        }
      }
    }

    // ---- STOP-LOSS ----
    if (P.stopLossEnabled && port.sol > P.minSolReserve && port.avgEntryPrice > 0) {
      const triggerPx = P.intrabarStops ? low : price;
      const pct = ((triggerPx - port.avgEntryPrice) / port.avgEntryPrice) * 100;
      if (pct <= -P.stopLossPct) {
        const sellAmt = +(port.sol - P.minSolReserve).toFixed(6);
        if (sellAmt > 0) {
          const res = fill(port, 'SELL', sellAmt, price, P);
          if (res) {
            trades++; sells++; losses++;
            grossFees += sellAmt * price * (P.simFeeBps / 10000);
            stopFires++; port.peakSinceEntry = 0; port.partialDone = false;
            exec.lastTradeAt = nowMs;
            exec.lastTradeWindow = Math.floor(nowMs / (P.decisionWindowSec * 1000));
            for (const b of Object.values(bots)) b.anchor = price;
          }
        }
      }
    }

    // ---- SIGNAL GENERATION ----
    const bal = { usdc: port.usdc, sol: port.sol };
    const sBull = botTick(bots.BULL, price, nowMs, bal, emaFast, prevFast, emaSlow, rsiVal, bullDip, bullRip, P, i);
    const sBear = botTick(bots.BEAR, price, nowMs, bal, emaFast, prevFast, emaSlow, rsiVal, bearDip, bearRip, P, i);
    for (const s of [sBull, sBear]) if (s) recentSignals.push(s);

    const cutoff = nowMs - P.staleSignalSec * 1000;
    recentSignals = recentSignals.filter(s => new Date(s.t).getTime() >= cutoff);
    const dec = decide(recentSignals, P.minExpectedEdgeBps);

    if (dec.action === 'TRADE') {
      const sig = dec.chosen;
      const notional = sig.side === 'BUY' ? sig.amount : sig.amount * price;
      let blocked = null;
      if (exec.lastTradeAt && (nowMs - exec.lastTradeAt)/1000 < P.cooldownSec)            blocked = 'cooldown';
      else if (exec.tradesToday >= P.maxTradesPerDay)                                      blocked = 'max trades/day';
      else if (exec.notionalTodayUsdc >= P.dailyNotionalLimitUsdc)                         blocked = 'daily notional limit';
      else if (exec.lastTradeWindow === Math.floor(nowMs/(P.decisionWindowSec*1000)))      blocked = 'one-per-window';
      else if (exec.lastSignalId === sig.signalId)                                         blocked = 'duplicate signal';
      else if (notional < P.minTradeUsdc)                                                  blocked = 'below min trade';
      else if (notional > P.maxNotionalUsdc)                                               blocked = 'above max trade';
      else if (sig.side === 'BUY'  && port.usdc < sig.amount)                             blocked = 'insufficient USDC';
      else if (sig.side === 'SELL' && port.sol  < sig.amount + P.minSolReserve)           blocked = 'insufficient SOL';
      else if (sig.side === 'BUY' && (() => {
        const sv = port.sol * price, tot = port.usdc + sv;
        return tot > 0 && (sv/tot)*100 >= P.maxSolAllocationPct;
      })())                                                                                 blocked = 'inventory cap';

      if (blocked) { note(blocked); }
      else {
        const res = fill(port, sig.side, sig.amount, price, P);
        if (res) {
          trades++; if (sig.side === 'BUY') buys++;
          else { sells++; if (res.pnl > 0) wins++; else losses++; }
          grossFees += notional * (P.simFeeBps / 10000);
          exec.lastTradeAt = nowMs;
          exec.lastTradeWindow = Math.floor(nowMs/(P.decisionWindowSec*1000));
          exec.lastSignalId = sig.signalId;
          exec.tradesToday++; exec.notionalTodayUsdc += notional;
        } else note('fill rejected');
      }
    } else { note(dec.reason); }

    const eq = port.usdc + port.sol * price;
    if (eq > peakEquity) peakEquity = eq;
    const dd = peakEquity > 0 ? (peakEquity - eq) / peakEquity : 0;
    if (dd > maxDD) maxDD = dd;
  }

  const lastPrice = series[series.length-1].price;
  const endEquity = port.usdc + port.sol * lastPrice;
  const holdMix   = P.simStartUsdc + P.simStartSol * lastPrice;
  const holdSol   = (startEquity / startPrice) * lastPrice;
  const days = (series[series.length-1].t - series[0].t) / 86400000;

  return {
    days, candles: series.length, startPrice, lastPrice,
    priceChangePct: ((lastPrice-startPrice)/startPrice)*100,
    startEquity, endEquity,
    returnPct: ((endEquity-startEquity)/startEquity)*100,
    realizedPnlUsdc: port.realizedPnlUsdc,
    grossFees, trades, buys, sells, wins, losses,
    winRatePct: sells ? (wins/sells)*100 : 0,
    maxDrawdownPct: maxDD * 100,
    holdMixEquity: holdMix, holdMixReturnPct: ((holdMix-startEquity)/startEquity)*100,
    holdAllSolEquity: holdSol, holdAllSolReturnPct: ((holdSol-startEquity)/startEquity)*100,
    vsHoldMixPct: ((endEquity-holdMix)/startEquity)*100,
    finalPortfolio: { usdc: port.usdc, sol: port.sol },
    skipReasons: skip, stopFires, profitTargetFires,
  };
}

// ---- data loader ------------------------------------------------------------
export function loadSeries(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = Array.isArray(raw) ? raw : (raw.candles || raw.data || []);
  const series = rows.map(r => {
    if (!Array.isArray(r)) return { t: r.t, price: r.price??r.close, high: r.high??r.price??r.close, low: r.low??r.price??r.close };
    if (r.length >= 6) return { t: r[0]*1000, price: r[4], high: r[2], low: r[1] };
    return { t: r[0]*1000, price: r[1], high: r[1], low: r[1] };
  })
  .filter(r => Number.isFinite(r.t) && Number.isFinite(r.price) && r.price > 0)
  .sort((a,b) => a.t - b.t);
  const out = [];
  for (const r of series) {
    if (out.length && out[out.length-1].t === r.t) out[out.length-1] = r;
    else out.push(r);
  }
  return out;
}

function fmt(n, d=2) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }

function printReport(name, m, label) {
  const verdict = m.endEquity > m.startEquity
    ? (m.endEquity >= m.holdMixEquity ? 'PROFIT (beats hold)' : 'PROFIT (under hold)') : 'LOSS';
  const tag = label ? ` [${label}]` : '';
  console.log(`\n=== ${name}${tag} ===`);
  console.log(`Span: ${fmt(m.days,1)} days | SOL ${fmt(m.startPrice)} -> ${fmt(m.lastPrice)} (${fmt(m.priceChangePct)}%)`);
  console.log(`Start: $${fmt(m.startEquity)}  ->  End: $${fmt(m.endEquity)}  [${fmt(m.returnPct)}%]  ${verdict}`);
  console.log(`Realized PnL: $${fmt(m.realizedPnlUsdc)} | Fees: $${fmt(m.grossFees)} | Max DD: ${fmt(m.maxDrawdownPct)}%`);
  console.log(`Trades: ${m.trades} (buys ${m.buys}, sells ${m.sells}) | Win: ${fmt(m.winRatePct,1)}% | PT: ${m.profitTargetFires} | SL: ${m.stopFires}`);
  console.log(`Hold: $${fmt(m.holdMixEquity)} [${fmt(m.holdMixReturnPct)}%] | Strategy vs hold: ${fmt(m.vsHoldMixPct)}%`);
  console.log(`End: ${fmt(m.finalPortfolio.sol,4)} SOL + $${fmt(m.finalPortfolio.usdc)} USDC`);
  const top = Object.entries(m.skipReasons).sort((a,b)=>b[1]-a[1]).slice(0,3);
  if (top.length) console.log(`Skip: ${top.map(([r,c])=>`${r}(${c})`).join(', ')}`);
}

// ---- compare ----------------------------------------------------------------
function compareMode(series, base) {
  const off = { ...base, trendFilterEnabled:false, regimeFilterEnabled:false,
    rsiEnabled:false, profitTargetEnabled:false, stopLossEnabled:false, rsiScaleBuyEnabled:false };
  const mOff = runBacktest(series, off);
  const mOn  = runBacktest(series, base);
  console.log('\n=== FEATURE COMPARISON (all OFF vs all ON) ===');
  printReport('Baseline (all OFF)', mOff);
  printReport('Full v5 (all ON)', mOn);
  console.log(`\nDelta: return ${fmt(mOn.returnPct-mOff.returnPct)}pp  vsHold ${fmt(mOn.vsHoldMixPct-mOff.vsHoldMixPct)}pp  maxDD ${fmt(mOn.maxDrawdownPct-mOff.maxDrawdownPct)}pp`);
  console.log(`PT fires: ${mOn.profitTargetFires}  SL fires: ${mOn.stopFires}`);
}

// ---- sweep ------------------------------------------------------------------
function sweep(series, base, walkForward) {
  const dips  = [0.5, 1.2, 2.0, 3.0];
  const rips  = [0.15, 1.2, 2.0, 3.0];
  const emas  = [10, 20];
  const rsiOS = [30, 40];
  const ptPct = [2.0, 3.0, 5.0];
  const slPct = [8, 12, 20];

  const splitIdx = walkForward ? Math.floor(series.length * 0.70) : series.length;
  const train = series.slice(0, splitIdx);
  const test  = walkForward && series.length > splitIdx ? series.slice(splitIdx) : null;

  const results = [];
  for (const dip of dips) for (const rip of rips) for (const ema of emas)
  for (const os of rsiOS) for (const pt of ptPct) for (const sl of slPct) {
    const P = { ...base,
      bullDipPct: dip, bullRipPct: rip, bearDipPct: dip*1.6, bearRipPct: rip*0.7,
      emaPeriod: ema, rsiOversold: os, profitTargetPct: pt, stopLossPct: sl };
    const tr = runBacktest(train, P);
    const te = test && test.length >= 2 ? runBacktest(test, P) : null;
    results.push({ dip, rip, ema, os, pt, sl, tr, te });
  }
  results.sort((a,b) => b.tr.endEquity - a.tr.endEquity);

  if (walkForward) {
    const td = fmt((train[train.length-1].t-train[0].t)/86400000,0);
    const vd = test ? fmt((test[test.length-1].t-test[0].t)/86400000,0) : '0';
    console.log(`\n=== WALK-FORWARD SWEEP — train ${td}d / test ${vd}d (top 15) ===`);
    console.log('dip  rip   ema os  pt%  sl%   TRAIN: trd ret%  vsH%  DD% ptF slF   TEST: trd ret%  vsH%  DD%');
    for (const r of results.slice(0,15)) {
      const {tr,te} = r;
      const ts = te
        ? `${String(te.trades).padStart(3)} ${fmt(te.returnPct).padStart(6)} ${fmt(te.vsHoldMixPct).padStart(6)} ${fmt(te.maxDrawdownPct,1).padStart(5)}`
        : '  -      -      -      -';
      console.log(`${fmt(r.dip,1).padStart(4)} ${fmt(r.rip,1).padStart(4)} ${String(r.ema).padStart(4)} ${String(r.os).padStart(3)} ${fmt(r.pt,1).padStart(4)} ${String(r.sl).padStart(4)}  ${String(tr.trades).padStart(4)} ${fmt(tr.returnPct).padStart(6)} ${fmt(tr.vsHoldMixPct).padStart(6)} ${fmt(tr.maxDrawdownPct,1).padStart(5)} ${String(tr.profitTargetFires).padStart(3)} ${String(tr.stopFires).padStart(3)}   ${ts}`);
    }
  } else {
    console.log(`\n=== PARAMETER SWEEP — ${fmt((series[series.length-1].t-series[0].t)/86400000,0)} days (top 15) ===`);
    console.log('dip  rip   ema os  pt%  sl%  trades  return%  vsHold%  maxDD%  ptF  slF');
    for (const r of results.slice(0,15)) {
      const m = r.tr;
      console.log(`${fmt(r.dip,1).padStart(4)} ${fmt(r.rip,1).padStart(4)} ${String(r.ema).padStart(4)} ${String(r.os).padStart(3)} ${fmt(r.pt,1).padStart(4)} ${String(r.sl).padStart(4)}  ${String(m.trades).padStart(6)}  ${fmt(m.returnPct).padStart(7)}  ${fmt(m.vsHoldMixPct).padStart(7)}  ${fmt(m.maxDrawdownPct,1).padStart(6)}  ${String(m.profitTargetFires).padStart(3)}  ${String(m.stopFires).padStart(3)}`);
    }
  }
  return results;
}

// ---- CLI --------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const dataDir = path.join(ROOT, 'backtest', 'data');
  let files = [];
  const di = args.indexOf('--data');
  if (di !== -1 && args[di+1]) {
    files = [path.resolve(ROOT, args[di+1])];
  } else if (fs.existsSync(dataDir)) {
    files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json')).map(f => path.join(dataDir, f));
  }
  if (!files.length) { console.error('No data files. Run: npm run backtest:fetch'); process.exit(1); }

  const base = paramsFromCfg(CFG);

  if (args.includes('--json')) {
    const out = {};
    for (const f of files) out[path.basename(f)] = runBacktest(loadSeries(f), base);
    console.log(JSON.stringify(out, null, 2)); return;
  }

  const regime = base.regimeFilterEnabled ? `Regime(${base.emaPeriod}>${base.regimeEmaSlow})` : 'RegimeOFF';
  const pt = base.profitTargetEnabled ? `PT${base.profitTargetPct}%${base.profitTargetBypassCooldown?'+bypass':''}` : 'PTOFF';
  console.log(`Config: bullDip ${base.bullDipPct}% rip ${base.bullRipPct}% | bearDip ${base.bearDipPct}% rip ${base.bearRipPct}%`);
  console.log(`Flags: EMA(${base.emaPeriod}) | ${regime} | RSI OS<${base.rsiOversold}${base.rsiScaleBuyEnabled?` scale${base.rsiScaleMaxMult}x`:''} | ${pt} | SL${base.stopLossPct}% | invCap ${base.maxSolAllocationPct}%`);
  console.log(`Sim: fee ${base.simFeeBps}bps slip ${base.simSlippageBps}bps | Start $${base.simStartUsdc} + ${base.simStartSol} SOL`);

  if (args.includes('--compare')) {
    let longest = files[0], best = 0;
    for (const f of files) { const s = loadSeries(f); if (s.length > best && s.length > 50) { best = s.length; longest = f; } }
    compareMode(loadSeries(longest), base); return;
  }

  for (const f of files.sort()) {
    const s = loadSeries(f);
    if (s.length < 2) { console.log(`\n=== ${path.basename(f)} === (skipped: <2 points)`); continue; }
    printReport(path.basename(f), runBacktest(s, base));
  }

  if (args.includes('--sweep')) {
    let longest = files[0], best = 0;
    for (const f of files) { const s = loadSeries(f); if (s.length > best) { best = s.length; longest = f; } }
    sweep(loadSeries(longest), base, args.includes('--walk-forward'));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
