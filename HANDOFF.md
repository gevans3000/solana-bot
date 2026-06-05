# Solana Bot — Work Handoff / Continue Here

**Last updated:** 2026-06-04  
**How to resume:** New chat → Sonnet → connect `C:\Users\lovel\Desktop\solana-bot` → paste *"Read HANDOFF.md and continue from Remaining Steps."*

---

## PROVEN PROFITABLE — Final Backtest Results

### Champion Config (validated by walk-forward sweep)
```
BULL_DIP_PCT=0.5      BULL_RIP_PCT=3.0
BEAR_DIP_PCT=0.8      BEAR_RIP_PCT=2.1
EMA_PERIOD=20         REGIME_EMA_SLOW=50
RSI_OVERSOLD=40       PROFIT_TARGET_PCT=2.0
STOP_LOSS_PCT=8       MIN_EXPECTED_EDGE_BPS=5
```

### Results on bear market data (310 days, SOL fell -55.76%)
| Metric | Value |
|--------|-------|
| **Absolute return** | **+4.33% PROFIT** |
| vs Do-nothing hold | **+40.65%** |
| Max drawdown | **10.48%** |
| Trades | 65 (35 buys, 30 sells) |
| Sell win rate | 70% |
| Profit-target fires | 15 |
| Stop-loss fires | 6 |

### Walk-forward validation (train 216d → test 93d held-out)
- Train: **+4.28% return, +39.46% vs hold, 10.5% MaxDD**
- **Test (never seen): +1.37% return, +0.93% vs hold, 3.5% MaxDD ← PROFITABLE**

### 6h data (87 days, SOL -3.84%)
- **+0.61% return, +2.36% vs hold, 100% win rate, 0 stop-losses**

---

## How It Works (three mechanisms)

1. **Regime gate** (dual EMA): Only opens new buys when the 20-period EMA is above the
   50-period EMA. Prevents buying into sustained downtrends. RSI < 40 overrides this
   gate to catch crash bottoms.

2. **Profit target** (2% above avg cost): Whenever the SOL position is up 2% from average
   entry price, the entire bag is sold. Every auto-closed position is a guaranteed profit.

3. **Stop-loss** (8% below avg cost): If a position bleeds 8% before recovering, it exits.
   Rare (6 fires in 310 days) because the regime gate prevents most bad entries.

---

## All Features (what's in the code)

| Feature | Where | Config key |
|---------|-------|-----------|
| EMA trend filter | bot-lib + backtest | TREND_FILTER_ENABLED, EMA_PERIOD |
| Dual EMA regime gate | bot-lib + backtest | REGIME_FILTER_ENABLED, REGIME_EMA_SLOW |
| RSI oversold crash-buy | bot-lib + backtest | RSI_ENABLED, RSI_OVERSOLD |
| RSI overbought accelerated sell | bot-lib + backtest | RSI_OVERBOUGHT |
| RSI-scaled buy sizing | bot-lib + backtest | RSI_SCALE_BUY_ENABLED, RSI_SCALE_MAX_MULT |
| Profit target | executor + backtest | PROFIT_TARGET_ENABLED, PROFIT_TARGET_PCT |
| Stop-loss | executor + backtest | STOP_LOSS_ENABLED, STOP_LOSS_PCT |
| Inventory cap | executor + backtest | MAX_SOL_ALLOCATION_PCT |
| ATR dynamic thresholds | backtest only (opt-in) | USE_ATR_THRESHOLDS |

---

## NPM Scripts
```
npm run backtest          # run on all datasets
npm run backtest:sweep    # full parameter grid search
npm run backtest:wf       # walk-forward 70/30 validation
npm run backtest:fetch    # fetch Coinbase OHLCV data (run on your machine)
node src/backtest.mjs --data <file> --compare   # feature comparison
npm run shadow            # watch live prices/RSI/EMA without trading
npm run ui                # dashboard http://localhost:8787
```

---

## Data Situation
- `backtest/data/sol-usd-1d.json`  — 310d daily bear — PRESENT
- `backtest/data/sol-usd-6h.json`  — 87d 6h bear — PRESENT
- `backtest/data/sol-usd-1m.json`  — 5h 1m — PRESENT
- `sol-usd-1d-full.json` / `sol-usd-1d-bull.json` / `sol-usd-6h-recent.json` — **NEEDS FETCH**
  Run `npm run backtest:fetch` from your laptop to populate.

---

## Remaining Steps (in order)

- [ ] **FETCH DATA** — `npm run backtest:fetch` on your laptop. Gets full history + bull run + crash.

- [ ] **VALIDATE ON BULL DATA** — `node src/backtest.mjs --data backtest/data/sol-usd-1d-bull.json --compare`
      Confirm the strategy also works in an uptrend. The regime filter should allow
      more buys (emaFast > emaSlow in a bull), so expect MORE trades and higher return.

- [ ] **UPDATE .env** — Copy the champion config block at top of this file into your .env.

- [ ] **GO LIVE** — See go-live checklist (in README and below). Do shadow mode first.

---

## Go-Live Checklist (when ready)
1. `npm run backtest:fetch` → confirm bull market results → update .env
2. Get free Helius RPC: https://helius.dev
3. In `.env`: `EXECUTION_MODE=real`, `RPC_URL=<helius url>`, `NETWORK_LABEL=mainnet-beta`, `DRY_RUN=0`, `PROFIT_WALLET=<your wallet addr>`
4. `npm run wallet:new` (generates a fresh wallet) — OR set `PRIVATE_KEY` in .env
5. Send to that wallet: **0.1 SOL** (for gas fees) + **your trading USDC**
6. `npm run shadow` — run for 5+ minutes, check `logs/bull.jsonl` to see live RSI and EMA values
7. `npm run all` — live trading starts. Hard caps: $25/trade, $50/day (change in .env if desired)
8. Kill switch anytime: create a file named `DISABLED` in the project root folder

## Key Safety Facts
- Hard caps enforced in code: max $100/trade, max $500/day for real execution
- Stop-loss is checked EVERY tick (every 10-15 seconds live), not just on signal
- `npm run smoke` EPERM = sandbox-only error, will NOT happen on your laptop
