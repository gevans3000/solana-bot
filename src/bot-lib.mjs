import { CFG, NOW, isDisabled, logJsonl, loadJson, saveJson, makeSignalId, fileInState, safeReadJsonFile } from './common.mjs';
import { getSolUsdPrice } from './price-source.mjs';
import { getBalances } from './portfolio.mjs';

function emaAlpha(period) { return 2 / (period + 1); }
function updateEma(prev, price, alpha) { return prev == null ? price : alpha * price + (1 - alpha) * prev; }

function computeRsiFromBuffer(buf, period) {
  if (buf.length < period + 1) return null;
  const alpha = 1 / period;
  let avgG = null, avgL = null;
  for (let i = 1; i < buf.length; i++) {
    const d = buf[i] - buf[i-1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgG = avgG == null ? g : alpha * g + (1 - alpha) * avgG;
    avgL = avgL == null ? l : alpha * l + (1 - alpha) * avgL;
  }
  if (avgG == null) return null;
  const rs = avgL === 0 ? Infinity : avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function canEmit(lastSignalAt) {
  if (!lastSignalAt) return true;
  return (Date.now() - new Date(lastSignalAt).getTime()) >= CFG.signalMinSec * 1000;
}

export async function botTick({ bot, dipPct, ripPct, buyUsdc, sellSol }) {
  // dipPct/ripPct may be scaled below by the bull-regime overlay
  if (isDisabled()) {
    logJsonl(`${bot.toLowerCase()}.jsonl`, { t: NOW(), bot, type: 'disabled' });
    return;
  }

  const cache = safeReadJsonFile(fileInState('price-cache.json'));
  const priceCacheStale = cache?.timestamp
    && (Date.now() - new Date(cache.timestamp).getTime()) >= CFG.stalePriceSec * 1000;

  const stateFile = `state-${bot}.json`;
  const state = loadJson(stateFile, {
    anchor: null, lastSignalAt: null, lastPrice: null, prevPrice: null,
    emaFast: null, prevEmaFast: null,
    emaSlow: null,
    priceBuf: [],
  });

  const price    = await getSolUsdPrice();
  const balances = await getBalances(price);
  if (!state.anchor) state.anchor = price;

  // Update EMAs
  const fastAlpha = emaAlpha(CFG.emaPeriod);
  const slowAlpha = emaAlpha(CFG.regimeEmaSlow);
  const prevFast  = state.emaFast;
  state.emaFast   = updateEma(state.emaFast, price, fastAlpha);
  state.emaSlow   = updateEma(state.emaSlow, price, slowAlpha);
  state.prevEmaFast = prevFast;

  // Update RSI buffer
  state.priceBuf = [...(state.priceBuf || []), price].slice(-(CFG.rsiPeriod + 1));
  const rsiVal = CFG.rsiEnabled ? computeRsiFromBuffer(state.priceBuf, CFG.rsiPeriod) : null;

  // Signal gates
  const emaRising     = !CFG.trendFilterEnabled  || prevFast == null || state.emaFast >= prevFast;
  const regimeOk      = !CFG.regimeFilterEnabled || state.emaFast == null || state.emaSlow == null || state.emaFast >= state.emaSlow;
  const rsiOversold   = CFG.rsiEnabled && rsiVal != null && rsiVal < CFG.rsiOversold;
  const rsiOverbought = CFG.rsiEnabled && rsiVal != null && rsiVal > CFG.rsiOverbought;
  let   buyAllowed    = (emaRising && regimeOk) || rsiOversold;

  // Bot specialization (parity with backtester): BEAR = defensive mean-reversion
  // (only deep RSI flushes), BULL = trend-follower (only in confirmed uptrend).
  if (CFG.botSpecializationEnabled) {
    const uptrend = state.emaFast != null && state.emaSlow != null && state.emaFast > state.emaSlow;
    if (bot === 'BEAR')      buyAllowed = CFG.rsiEnabled && rsiVal != null && rsiVal < CFG.bearRsiMax;
    else if (bot === 'BULL') buyAllowed = uptrend && emaRising;
  }

  // Anchor cooldown: block a fresh BUY within anchorCooldownBars ticks of the last buy.
  state.tickCount = (state.tickCount || 0) + 1;
  const anchorCdOk = !CFG.anchorCooldownBars || (state.tickCount - (state.lastBuyTick ?? -1e9)) >= CFG.anchorCooldownBars;

  // Persist regime for the executor's regime-conditional take-profit.
  saveJson('regime.json', { t: NOW(), emaFast: state.emaFast, emaSlow: state.emaSlow, bot });

  // BULL-REGIME OVERLAY (parity with backtester): in a strong CONFIRMED uptrend
  // (regimeStrength > BULL_REGIME_THRESHOLD), the BULL trend-follower accumulates on
  // momentum (no dip gate) and widens its rip so winners run; the trailing take-profit
  // in executor.mjs governs the exit. Other regimes use the proven anchor dip/rip.
  const regimeStrength = (state.emaFast != null && state.emaSlow != null && state.emaSlow > 0)
    ? ((state.emaFast - state.emaSlow) / state.emaSlow) * 100 : 0;
  const inBull = CFG.botSpecializationEnabled && bot === 'BULL' && regimeStrength > CFG.bullRegimeThreshold;
  if (inBull) { dipPct = -1e6; ripPct = ripPct * CFG.bullDipScale; }

  const buyTrigger  = state.anchor * (1 - dipPct / 100);
  const sellTrigger = state.anchor * (1 + ripPct / 100);
  const eligible    = canEmit(state.lastSignalAt);

  if (priceCacheStale) {
    logJsonl(`${bot.toLowerCase()}.jsonl`, { t: NOW(), bot, type: 'skip_stale_price', price });
    saveJson(stateFile, state);
    return;
  }

  let signal = null;

  // Regime-aware position sizing (parity with backtester): larger buys in a
  // confirmed-uptrend oversold dip; smaller in a confirmed downtrend. The RSI>high
  // reduction is disabled by default (REGIME_SIZE_HIGH_RSI=100) because it conflicts
  // with the bull momentum overlay.
  let sizeMult = 1.0;
  if (CFG.regimeSizeEnabled && CFG.botSpecializationEnabled && state.emaFast != null && state.emaSlow != null) {
    const upTrend = state.emaFast > state.emaSlow, downTrend = state.emaFast < state.emaSlow;
    if (upTrend && rsiVal != null && rsiVal < CFG.rsiOversold) sizeMult = CFG.regimeSizeUpMult;
    else if (downTrend || (rsiVal != null && rsiVal > CFG.regimeSizeHighRsi)) sizeMult = CFG.regimeSizeDownMult;
  }
  // Proportional sizing: BULL bot deploys % of USDC in confirmed strong bull regime.
  // BEAR bot keeps fixed sizing (capital-preservation). Requires regime strength >= threshold.
  let sizedBuyUsdc = buyUsdc * sizeMult;
  if (CFG.bullBuyPctOfUsdc > 0 && bot === 'BULL' &&
      state.emaFast != null && state.emaSlow != null && state.emaFast > state.emaSlow) {
    const regimeStrengthPct = (state.emaFast - state.emaSlow) / state.emaSlow * 100;
    if (regimeStrengthPct >= CFG.bullRegimeThreshold) { // configurable bull gate (CFG.bullRegimeThreshold)
      const pctBuy = balances.usdc * CFG.bullBuyPctOfUsdc;
      sizedBuyUsdc = Math.max(sizedBuyUsdc, pctBuy);
    }
  }
    sizedBuyUsdc = Math.min(sizedBuyUsdc, balances.usdc); // never exceed available USDC

  const bounceOk = !CFG.entryBounceConfirm || state.prevPrice == null || price > state.prevPrice;
  if (eligible && anchorCdOk && price <= buyTrigger && balances.usdc >= sizedBuyUsdc && sizedBuyUsdc >= CFG.minTradeUsdc && buyAllowed && bounceOk) {
    signal = {
      t: NOW(), bot, side: 'BUY',
      amount: +sizedBuyUsdc.toFixed(6), amountUnit: 'USDC', price, anchor: state.anchor,
      edgeBps: Math.round(((state.anchor - price) / state.anchor) * 10000),
      reason: rsiOversold ? `RSI oversold (${rsiVal?.toFixed(1)})` : `price<=anchor*(1-${dipPct}%)`,
      emaFast: +state.emaFast.toFixed(4), emaSlow: +state.emaSlow.toFixed(4),
      rsi: rsiVal != null ? +rsiVal.toFixed(1) : null,
      regimeOk, buyAllowed,
    };
  } else {
    // Option A parity: BULL rips sell the SOL amount last bought (symmetry) in strong bull.
    const strongUp = state.emaFast != null && state.emaSlow != null && state.emaSlow > 0
      && ((state.emaFast - state.emaSlow) / state.emaSlow) * 100 >= CFG.bullStrongRegimePct;
    // Notional floor parity with backtest.mjs: keep sells >= minTradeUsdc*mult (gated, 0 = legacy).
    const effSell = Math.max(sellSol,
      CFG.minSellNotionalMult > 0 ? (CFG.minTradeUsdc * CFG.minSellNotionalMult) / price : 0);
    const propSell = (CFG.bullProportionalSells && bot === 'BULL' && strongUp && (state.lastBuyAmountSol || 0) > 0)
      ? state.lastBuyAmountSol : effSell;
    const ripSellAmt = +Math.min(propSell, balances.sol - CFG.minSolReserve).toFixed(6);
    if (eligible && ripSellAmt >= effSell && balances.sol >= ripSellAmt + CFG.minSolReserve &&
        (price >= sellTrigger || (rsiOverbought && price > state.anchor))) {
    signal = {
      t: NOW(), bot, side: 'SELL',
      amount: ripSellAmt, amountUnit: 'SOL', price, anchor: state.anchor,
      edgeBps: Math.round(((price - state.anchor) / state.anchor) * 10000),
      reason: rsiOverbought && price > state.anchor ? `RSI overbought (${rsiVal?.toFixed(1)})` : `price>=anchor*(1+${ripPct}%)`,
      emaFast: +state.emaFast.toFixed(4), emaSlow: +state.emaSlow.toFixed(4),
      rsi: rsiVal != null ? +rsiVal.toFixed(1) : null,
    };
    }
  }

  logJsonl(`${bot.toLowerCase()}.jsonl`, {
    t: NOW(), bot, type: 'tick', price, anchor: state.anchor,
    buyTrigger, sellTrigger,
    emaFast: +state.emaFast.toFixed(4), emaSlow: +state.emaSlow.toFixed(4),
    emaRising, regimeOk, buyAllowed,
    rsi: rsiVal != null ? +rsiVal.toFixed(1) : null, rsiOversold, rsiOverbought,
    balances, eligible, emitted: Boolean(signal),
  });

  if (signal) {
    if (signal.side === 'BUY') state.lastBuyAmountSol = signal.amount / price;
    signal.signalId = makeSignalId(signal);
    logJsonl('signals.jsonl', signal);
    state.lastSignalAt = NOW();
    state.anchor = price;
    if (signal.side === 'BUY') state.lastBuyTick = state.tickCount;
  } else {
    state.lastPrice = price;
  }
  state.prevPrice = price;
  saveJson(stateFile, state);
}
