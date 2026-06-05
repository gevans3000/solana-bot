import fs from 'node:fs';
import {
  CFG,
  NOW,
  fileInLogs,
  loadJson,
  saveJson,
  logJsonl,
  isDisabled,
  getDecisionWindow,
  freshDay,
  withLock,
  runLoop,
  fileInState,
  safeReadJsonFile,
  loadPortfolio,
  circuitBreakerTripped,
} from './common.mjs';
import { getBalances, executeTrade } from './portfolio.mjs';
import { getSolUsdPrice } from './price-source.mjs';
import { getJupiterQuote } from './shadow-quote.mjs';
import { getOnChainBalances } from './on-chain-balance.mjs';
import { sendAlert } from './alerts.mjs';
import { loadKeypair, getWalletPublicKey } from './solana-signer.mjs';

function readSignals(state) {
  const p = fileInLogs('signals.jsonl');
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf8').trim();
  if (!raw) return [];
  const lines = raw.split('\n').filter(Boolean);
  const from = state.signalIndex || 0;
  const slice = lines.slice(from);
  state.signalIndex = lines.length;
  return slice.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function bumpDaily(state) {
  const day = freshDay();
  if (state.day !== day) {
    state.day = day;
    state.tradesToday = 0;
    state.notionalTodayUsdc = 0;
    state.realizedLossTodayUsdc = 0;
  }
}

function activeSignals(signals) {
  const cutoff = Date.now() - CFG.staleSignalSec * 1000;
  return signals.filter((signal) => new Date(signal.t).getTime() >= cutoff);
}

function decide(signals) {
  if (!signals.length) return { action: 'NO_TRADE', reason: 'no signals' };
  const latestByBot = new Map();
  for (const signal of signals) latestByBot.set(signal.bot, signal);

  // Manual override priority
  const manual = latestByBot.get('MANUAL') || null;
  if (manual) {
    return { action: 'TRADE', chosen: manual, manual: true };
  }

  const bull = latestByBot.get('BULL') || null;
  const bear = latestByBot.get('BEAR') || null;

  if (bull && bear && bull.side !== bear.side) {
    return { action: 'NO_TRADE', reason: 'bot conflict', bull, bear };
  }

  const chosen = bear || bull;
  if (!chosen) return { action: 'NO_TRADE', reason: 'no usable signal' };
  if (chosen.edgeBps == null || chosen.edgeBps < CFG.minExpectedEdgeBps) {
    return { action: 'NO_TRADE', reason: 'edge below minimum', chosen };
  }
  return { action: 'TRADE', chosen, bull, bear };
}

function recordRealizedLoss(state, execution) {
  const pnl = Number(execution?.realizedPnlUsdc);
  if (Number.isFinite(pnl) && pnl < 0) {
    state.realizedLossTodayUsdc = (state.realizedLossTodayUsdc || 0) + (-pnl);
  }
}

async function tick() {
  if (isDisabled()) {
    logJsonl('executor.jsonl', { t: NOW(), type: 'disabled' });
    return;
  }

  const result = await withLock('executor.lock', async () => {
    const state = loadJson('state-exec.json', {
      signalIndex: 0,
      lastTradeAt: null,
      lastTradeWindow: null,
      lastSignalId: null,
      tradesToday: 0,
      notionalTodayUsdc: 0,
      realizedLossTodayUsdc: 0,
      day: null,
    });
    bumpDaily(state);

    // ---- DAILY-LOSS CIRCUIT BREAKER: halt ALL trading for the rest of the UTC day ----
    if (circuitBreakerTripped(state.realizedLossTodayUsdc || 0, CFG.dailyLossLimitUsdc)) {
      logJsonl('executor.jsonl', { type: 'circuit_breaker', reason: 'daily_loss_limit',
        t: NOW(), realizedLossTodayUsdc: +(state.realizedLossTodayUsdc || 0).toFixed(4),
        limitUsdc: CFG.dailyLossLimitUsdc, day: state.day });
      saveJson('state-exec.json', state);
      return;
    }

    const price = await getSolUsdPrice();

    // Check if price cache is stale
    const cacheFile = fileInState('price-cache.json');
    let priceCacheStale = false;
    const cache = safeReadJsonFile(cacheFile);
    if (cache && cache.timestamp) {
      const cacheAgeMs = Date.now() - new Date(cache.timestamp).getTime();
      priceCacheStale = cacheAgeMs >= CFG.stalePriceSec * 1000;
    }

    const balances = await getBalances(price);

    // ---- PROFIT TARGET (regime-conditional: trail in confirmed uptrend, fixed in chop) ----
    // Validated in backtest: a wide trailing give-back lets winners run in uptrends and
    // captures bear-market relief rallies, while the fixed target protects chop/downtrend.
    if (CFG.profitTargetEnabled && balances.sol > CFG.minSolReserve) {
      const portfolio = loadPortfolio();
      if (portfolio.avgEntryPrice > 0) {
        const gainPct = ((price - portfolio.avgEntryPrice) / portfolio.avgEntryPrice) * 100;
        // Track running peak since entry (reset on exit / when flat).
        state.peakSinceEntry = Math.max(state.peakSinceEntry || 0, price);
        const giveBackPct = state.peakSinceEntry > 0
          ? ((state.peakSinceEntry - price) / state.peakSinceEntry) * 100 : 0;
        const regime = safeReadJsonFile(fileInState('regime.json')) || {};
        const regimeUp = regime.emaFast != null && regime.emaSlow != null && regime.emaFast > regime.emaSlow;

        let exit = false, kind = 'profit_target';
        if (CFG.trailInUptrend && regimeUp) {
          if (gainPct >= CFG.trailArmPct && giveBackPct >= CFG.trailGivePct) { exit = true; kind = 'trail_exit'; }
        } else if (gainPct >= CFG.profitTargetPct) {
          exit = true;
        }

        if (exit) {
          logJsonl('executor.jsonl', { t: NOW(), type: kind, price, avgEntry: portfolio.avgEntryPrice, gainPct: +gainPct.toFixed(2), giveBackPct: +giveBackPct.toFixed(2), regimeUp, peak: state.peakSinceEntry });
          try {
            const walletKeypair = CFG.executionMode === 'real' ? loadKeypair() : null;
            const sellAmt = +(balances.sol - CFG.minSolReserve).toFixed(6);
            if (sellAmt > 0) {
              const ptExec = await executeTrade({ side: 'SELL', amount: sellAmt, price, signalId: `pt-${Date.now()}`, walletKeypair });
              recordRealizedLoss(state, ptExec);
              state.lastTradeAt = NOW();
              state.peakSinceEntry = 0;
              saveJson('state-exec.json', state);
              return;
            }
          } catch (err) {
            logJsonl('executor.jsonl', { t: NOW(), type: 'error', reason: 'profit_target_sell_failed', error: String(err) });
          }
        }
      } else {
        state.peakSinceEntry = 0; // flat: reset peak
      }
    }

    // ---- STOP-LOSS: exit position when unrealized loss >= threshold ----
    if (CFG.stopLossEnabled && balances.sol > CFG.minSolReserve) {
      const portfolio = loadPortfolio();
      if (portfolio.avgEntryPrice > 0) {
        const unrealizedPct = ((price - portfolio.avgEntryPrice) / portfolio.avgEntryPrice) * 100;
        if (unrealizedPct <= -CFG.stopLossPct) {
          logJsonl('executor.jsonl', { t: NOW(), type: 'stop_loss', price, avgEntry: portfolio.avgEntryPrice, unrealizedPct: +unrealizedPct.toFixed(2) });
          try {
            const walletKeypair = CFG.executionMode === 'real' ? loadKeypair() : null;
            const sellAmt = +(balances.sol - CFG.minSolReserve).toFixed(6);
            if (sellAmt > 0) {
              const slExec = await executeTrade({ side: 'SELL', amount: sellAmt, price, signalId: `sl-${Date.now()}`, walletKeypair });
              recordRealizedLoss(state, slExec);
              state.lastTradeAt = NOW();
              state.peakSinceEntry = 0;
              saveJson('state-exec.json', state);
              return;
            }
          } catch (err) {
            logJsonl('executor.jsonl', { t: NOW(), type: 'error', reason: 'stop_loss_sell_failed', error: String(err) });
          }
        }
      }
    }

    const freshSignals = activeSignals(readSignals(state));
    const decision = decide(freshSignals);

    if (state.lastTradeAt && !decision.manual) {
      const elapsed = (Date.now() - new Date(state.lastTradeAt).getTime()) / 1000;
      if (elapsed < CFG.cooldownSec) {
        logJsonl('executor.jsonl', {
          t: NOW(),
          type: 'skip',
          reason: 'cooldown',
          remainingSec: Math.ceil(CFG.cooldownSec - elapsed),
          balances,
        });
        saveJson('state-exec.json', state);
        return;
      }
    }

    const maxTradesPerDay = CFG.executionMode === 'real' ? CFG.realMaxTradesPerDay : CFG.maxTradesPerDay;
    const dailyNotionalLimit = CFG.executionMode === 'real' ? CFG.realDailyNotionalLimitUsdc : CFG.dailyNotionalLimitUsdc;

    if (!decision.manual && state.tradesToday >= maxTradesPerDay) {
      logJsonl('executor.jsonl', { t: NOW(), type: 'skip', reason: 'max trades/day', balances });
      saveJson('state-exec.json', state);
      return;
    }

    if (!decision.manual && state.notionalTodayUsdc >= dailyNotionalLimit) {
      logJsonl('executor.jsonl', { t: NOW(), type: 'skip', reason: 'daily notional limit', balances });
      saveJson('state-exec.json', state);
      return;
    }

    if (CFG.executionMode === 'real' && CFG.dryRun) {
      logJsonl('executor.jsonl', { t: NOW(), type: 'skip', reason: 'DRY_RUN is on for real execution', balances });
      saveJson('state-exec.json', state);
      return;
    }

    const currentWindow = getDecisionWindow();

    logJsonl('executor.jsonl', {
      t: NOW(),
      type: 'tick',
      price,
      balances,
      freshSignals: freshSignals.length,
      decision,
      dryRun: CFG.dryRun,
      executionMode: CFG.executionMode,
    });

    if (decision.action !== 'TRADE') {
      saveJson('state-exec.json', state);
      return;
    }

    const signal = decision.chosen;
    if (state.lastTradeWindow === currentWindow) {
      logJsonl('executor.jsonl', { t: NOW(), type: 'skip', reason: 'one-trade-per-window', signal });
      saveJson('state-exec.json', state);
      return;
    }

    if (state.lastSignalId === signal.signalId) {
      logJsonl('executor.jsonl', { t: NOW(), type: 'skip', reason: 'duplicate signal', signalId: signal.signalId });
      saveJson('state-exec.json', state);
      return;
    }

    const maxNotional = CFG.executionMode === 'real' ? CFG.realMaxNotionalUsdc : CFG.maxNotionalUsdc;
    const notionalUsdc = signal.side === 'BUY' ? signal.amount : signal.amount * price;
    if (notionalUsdc < CFG.minTradeUsdc) {
      logJsonl('executor.jsonl', { t: NOW(), type: 'skip', reason: 'below min trade size', signal, notionalUsdc });
      saveJson('state-exec.json', state);
      return;
    }
    if (notionalUsdc > maxNotional) {
      logJsonl('executor.jsonl', { t: NOW(), type: 'skip', reason: 'above max trade size', signal, notionalUsdc });
      saveJson('state-exec.json', state);
      return;
    }

    if (signal.side === 'BUY' && balances.usdc < signal.amount) {
      logJsonl('executor.jsonl', { t: NOW(), type: 'skip', reason: 'insufficient USDC', signal, balances });
      saveJson('state-exec.json', state);
      return;
    }
    if (signal.side === 'BUY') {
      const solVal = balances.sol * price;
      const total = balances.usdc + solVal;
      const solAllocPct = total > 0 ? (solVal / total) * 100 : 0;
      if (solAllocPct >= CFG.maxSolAllocationPct) {
        logJsonl('executor.jsonl', { t: NOW(), type: 'skip', reason: 'inventory cap', solAllocPct: +solAllocPct.toFixed(1), maxSolAllocationPct: CFG.maxSolAllocationPct, signal, balances });
        saveJson('state-exec.json', state);
        return;
      }
    }
    if (signal.side === 'SELL' && balances.sol < signal.amount + CFG.minSolReserve) {
      logJsonl('executor.jsonl', { t: NOW(), type: 'skip', reason: 'insufficient SOL', signal, balances });
      saveJson('state-exec.json', state);
      return;
    }

    // Shadow mode: fetch quote and on-chain balances before execution
    if (CFG.shadowMode && CFG.shadowQuoteOnTrade) {
      try {
        const walletAddress = CFG.executionMode === 'real' ? getWalletPublicKey() : 'SimulatedWallet';
        const shadowQuote = await getJupiterQuote({
          side: signal.side,
          amountUsdc: signal.side === 'BUY' ? signal.amount : 0,
          amountSol: signal.side === 'SELL' ? signal.amount : 0,
          walletAddress,
        });

        const shadowBalances = CFG.executionMode === 'real' ? await getOnChainBalances(walletAddress) : null;

        logJsonl('shadow.jsonl', {
          t: NOW(),
          type: 'pre_trade',
          signal,
          shadowQuote,
          shadowBalances,
        });
      } catch (error) {
        logJsonl('shadow.jsonl', {
          t: NOW(),
          type: 'quote_error',
          signal,
          error: String(error),
        });
      }
    }

    let execution;
    try {
      const walletKeypair = CFG.executionMode === 'real' ? loadKeypair() : null;
      execution = await executeTrade({ side: signal.side, amount: signal.amount, price, signalId: signal.signalId, walletKeypair });
    } catch (error) {
      logJsonl('executor.jsonl', { t: NOW(), type: 'error', signal, error: String(error?.stack || error) });
      if (CFG.alertOnError) await sendAlert({ type: 'error', message: `Trade error: ${error?.message}`, data: { signal } });
      if (CFG.runOnce) throw error;
      saveJson('state-exec.json', state);
      return;
    }

    recordRealizedLoss(state, execution);

    if (CFG.alertOnTrade && execution.success) {
      await sendAlert({ type: 'trade', message: `${signal.side} ${signal.amount}`, data: { price, execution } });
    }

    state.lastTradeAt = NOW();
    state.lastTradeWindow = currentWindow;
    state.lastSignalId = signal.signalId;
    if (!CFG.dryRun) {
      state.tradesToday += 1;
      state.notionalTodayUsdc += notionalUsdc;
    }
    saveJson('state-exec.json', state);

    logJsonl('executor.jsonl', {
      t: NOW(),
      type: CFG.dryRun ? 'dry_run_trade' : 'trade',
      signal,
      notionalUsdc,
      execution,
    });
  });

  if (result?.locked === false) {
    logJsonl('executor.jsonl', { t: NOW(), type: 'skip', reason: 'executor lock busy' });
  }
}

runLoop(async () => {
  try {
    await tick();
  } catch (error) {
    logJsonl('executor.jsonl', { t: NOW(), type: 'error', error: String(error?.stack || error) });
    if (CFG.runOnce) throw error;
  }
}, CFG.loopSec).catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
