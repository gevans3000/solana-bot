import { CFG, NOW, isDisabled, logJsonl, loadJson, saveJson, makeSignalId, fileInState, safeReadJsonFile } from './common.mjs';
import { getSolUsdPrice } from './price-source.mjs';
import { getBalances } from './portfolio.mjs';
import fs from 'node:fs';

function canEmit(lastSignalAt) {
  if (!lastSignalAt) return true;
  const elapsedMs = Date.now() - new Date(lastSignalAt).getTime();
  return elapsedMs >= CFG.signalMinSec * 1000;
}

export async function botTick({ bot, dipPct, ripPct, buyUsdc, sellSol }) {
  if (isDisabled()) {
    logJsonl(`${bot.toLowerCase()}.jsonl`, { t: NOW(), bot, type: 'disabled' });
    return;
  }

  // Check if price cache is stale
  const cacheFile = fileInState('price-cache.json');
  let priceCacheStale = false;
  const cache = safeReadJsonFile(cacheFile);
  if (cache && cache.timestamp) {
    const cacheAgeMs = Date.now() - new Date(cache.timestamp).getTime();
    priceCacheStale = cacheAgeMs >= CFG.stalePriceSec * 1000;
  }

  const stateFile = `state-${bot}.json`;
  const state = loadJson(stateFile, { anchor: null, lastSignalAt: null, lastPrice: null });
  const price = await getSolUsdPrice();
  const balances = await getBalances(price);
  if (!state.anchor) state.anchor = price;

  const buyTrigger = state.anchor * (1 - dipPct / 100);
  const sellTrigger = state.anchor * (1 + ripPct / 100);
  const eligible = canEmit(state.lastSignalAt);

  let signal = null;

  if (priceCacheStale) {
    logJsonl(`${bot.toLowerCase()}.jsonl`, {
      t: NOW(),
      bot,
      type: 'skip_stale_price',
      price,
      reason: `price cache is stale (>${CFG.stalePriceSec}s)`,
    });
    saveJson(stateFile, state);
    return;
  }
  if (eligible && price <= buyTrigger && balances.usdc >= buyUsdc) {
    signal = {
      t: NOW(),
      bot,
      side: 'BUY',
      amount: buyUsdc,
      amountUnit: 'USDC',
      price,
      anchor: state.anchor,
      edgeBps: Math.round(((state.anchor - price) / state.anchor) * 10000),
      reason: `price<=anchor*(1-${dipPct}%)`,
    };
  } else if (eligible && price >= sellTrigger && balances.sol >= sellSol + CFG.minSolReserve) {
    signal = {
      t: NOW(),
      bot,
      side: 'SELL',
      amount: sellSol,
      amountUnit: 'SOL',
      price,
      anchor: state.anchor,
      edgeBps: Math.round(((price - state.anchor) / state.anchor) * 10000),
      reason: `price>=anchor*(1+${ripPct}%)`,
    };
  }

  logJsonl(`${bot.toLowerCase()}.jsonl`, {
    t: NOW(),
    bot,
    type: 'tick',
    price,
    anchor: state.anchor,
    buyTrigger,
    sellTrigger,
    balances,
    eligible,
    emitted: Boolean(signal),
  });

  if (signal) {
    signal.signalId = makeSignalId(signal);
    logJsonl('signals.jsonl', signal);
    state.lastSignalAt = NOW();
    state.anchor = price;
  } else {
    state.lastPrice = price;
  }
  saveJson(stateFile, state);
}
