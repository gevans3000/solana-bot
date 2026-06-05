# Solana Bot — Opus Strategy Handoff

**Purpose:** Paste this entire file into a new Claude Opus chat to get advanced strategy improvement suggestions.  
**Suggested opener:** *"Read this handoff and suggest the highest-impact improvements to make this strategy more profitable and robust. Be specific — show code changes, not just ideas."*

---

## Project Summary

Two-bot (BULL/BEAR) SOL/USDC spot trading bot in Node.js. All code in `C:\Users\lovel\Desktop\solana-bot`.  
The strategy: buy SOL when it dips below an anchor price, sell when it bounces back. A shared executor handles all risk gates. Simulated + real execution via Jupiter Ultra API.

---

## Current Best Backtest Results (v5 backtester)

### Dataset: 310 days daily candles, SOL fell -55.76% (pure bear market)

**Champion config:**
```
BULL_DIP_PCT=0.5    BULL_RIP_PCT=3.0
BEAR_DIP_PCT=0.8    BEAR_RIP_PCT=2.1
EMA_PERIOD=20       REGIME_EMA_SLOW=50
RSI_OVERSOLD=40     PROFIT_TARGET_PCT=2.0
STOP_LOSS_PCT=8     MIN_EXPECTED_EDGE_BPS=5
```

**Results:**
- Return: **+4.33% absolute profit** in a -55.76% market
- vs Do-nothing hold: **+40.65%**
- Max drawdown: **10.48%**
- Trades: 65 (35 buys, 30 sells) | Win rate: 70% | PT fires: 15 | SL fires: 6
- Walk-forward test (93d held-out): **+1.37% return, +0.93% vs hold, 3.5% MaxDD** ✓ profitable

### Dataset: 87 days 6h candles, SOL -3.84%
- Return: **+0.61%** | Win rate: 100% | 5 PT fires | 0 stop-losses

---

## Strategy Logic (how it actually works)

### Signal generation (`src/bot-lib.mjs`)
- Two bots (BULL = more aggressive, BEAR = more conservative) run independently
- Each bot tracks an `anchor` price. Emits BUY if `price <= anchor * (1 - dip%)`, SELL if `price >= anchor * (1 + rip%)`
- Anchor re-sets to current price on every signal emit
- Signals gated by:
  1. **EMA trend filter**: only BUY when EMA(fast) is rising tick-to-tick
  2. **Dual EMA regime gate**: only BUY when EMA(20) > EMA(50) — medium-term uptrend required. RSI < 40 overrides this gate.
  3. **RSI overbought accelerate sell**: sell early when RSI > 70 and price > anchor

### Executor (`src/executor.mjs`)
- Reads signals, applies additional gates (cooldown, daily limits, size limits, duplicate filter, inventory cap 60%)
- **Profit target**: every tick, if unrealized gain on SOL bag >= 2% from avg entry → sell entire bag
- **Stop-loss**: every tick, if unrealized loss >= 8% from avg entry → sell entire bag

### Backtest (`src/backtest.mjs`)
- Exact replay of live logic — same signal gen, same executor gates, same simulated fills
- EMA + RSI (with RSI-scaled buy sizing) + ATR (opt-in) + profit target + stop-loss + walk-forward

---

## What Was Tried and Results

| Approach | Result | Notes |
|----------|--------|-------|
| Baseline (raw dip/rip grid) | -10.34%, +25.98% vs hold | Starting point |
| + Inventory cap (60% SOL max) | -10.34%, +26.0% vs hold | Small improvement |
| + EMA filter alone | -17.6%, +18.8% vs hold | WORSE — blocks too many crash buys |
| + RSI oversold override | -6.4%, +30.0% vs hold | Better — RSI catches crash bottoms |
| + Profit target + regime filter | **+3.58%, +39.9%** | First positive return |
| + Warmup bug fix + wider rip (3%) | **+4.33%, +40.65%** | Current champion |
| RSI-scaled buy sizing (2x at extreme) | Hurts with tight stop-loss | Creates bigger losses when stopped |
| PT bypass cooldown (re-enter instantly) | Neutral/slightly negative | Rapid re-entry creates fee drag |
| Stop-loss 8% vs 12% | 8% slightly better (fewer big losses) | Used in champion |
| ATR dynamic thresholds | Not yet fully validated | Available via USE_ATR_THRESHOLDS=1 |

**Key discoveries:**
- `rip=3.0%` (wider sell target) is the single biggest lever — captures bigger bounces
- `profit_target=2%` + `regime_filter` together transform the strategy from loser to winner
- EMA filter alone hurts in pure bear markets (blocks too many crash-bottom buys)
- RSI override (buy when RSI < 40 even in downtrend) is essential for crash recovery
- Walk-forward warmup guard was counterproductive — natural EMA divergence is better

---

## What's NOT Been Tested Yet (data gaps)

The only data we have is bear market data. We do NOT have:
- Bull market data (SOL Oct 2023 → Apr 2024: $20 → $200) — `npm run backtest:fetch` needed
- Recent crash data (last 90 days including the 3-day drop mentioned) — same fetch
- Full history (Jan 2021 → today covering all regimes) — same fetch

All of this is fetchable from Coinbase via `npm run backtest:fetch` (script exists, just needs network).

**The strategy is UNVALIDATED in bull markets.** This is the most important gap.

---

## Known Weaknesses to Address

1. **No bull market validation** — the regime filter *should* allow more buys in uptrends (emaFast > emaSlow), but we haven't confirmed it. In a strong bull run, the profit target at 2% might be too tight (leaves gains on the table).

2. **Anchor re-anchoring on every signal is aggressive** — when a buy fires, the anchor jumps to current price immediately. If price keeps falling, the next dip trigger is now much lower. In fast crashes this creates a cascade of buys. Could add "anchor cooldown" — don't re-anchor for N candles after a buy.

3. **No asymmetric exit strategy** — currently sells 100% of bag at 2% profit. A partial sell (e.g., sell 50% at 2%, let 50% run to 5%) could capture more upside in trending markets while still locking in guaranteed profit.

4. **Fixed sell amount (`sellSol`)** — the sell signal sells a fixed amount of SOL, not the full bag. The profit target sells the whole bag. These work against each other: if the profit target fires, all the normal SELL signals that were pending become irrelevant. Could unify these.

5. **Two separate bots with similar configs** — BULL and BEAR are basically the same bot with slightly different params. They often agree (same side), meaning the "conflict rule" (which cancels conflicting signals) rarely fires. The bots don't add diversity.

6. **No position sizing based on conviction** — every buy is the same size regardless of how oversold we are (RSI-scaled sizing was tried and hurt due to stop-loss interaction). Needs rethinking.

7. **Daily limit prevents compounding** — `maxTradesPerDay` caps trade count. In a volatile day with many good opportunities, we stop after N trades. Could separate hard safety limits from opportunity limits.

---

## Config Keys Reference (all tunable)

```
# Signal thresholds
BULL_DIP_PCT=0.5          # % drop from anchor to trigger BULL buy
BULL_RIP_PCT=3.0          # % rise from anchor to trigger BULL sell  
BEAR_DIP_PCT=0.8          # BEAR versions (typically slightly more conservative)
BEAR_RIP_PCT=2.1

# Trend intelligence
TREND_FILTER_ENABLED=1    # only BUY when fast EMA is rising
EMA_PERIOD=20             # fast EMA period
REGIME_FILTER_ENABLED=1   # only BUY when emaFast > emaSlow
REGIME_EMA_SLOW=50        # slow EMA period for regime gate

# RSI
RSI_ENABLED=1
RSI_PERIOD=14
RSI_OVERSOLD=40           # buy override threshold (even in downtrend)
RSI_OVERBOUGHT=70         # accelerated sell threshold

# Profit certainty
PROFIT_TARGET_ENABLED=1
PROFIT_TARGET_PCT=2.0     # sell whole bag when up 2% from avg entry
STOP_LOSS_ENABLED=1
STOP_LOSS_PCT=8           # sell whole bag when down 8% from avg entry

# Risk gates  
MAX_SOL_ALLOCATION_PCT=60 # never buy if SOL > 60% of portfolio
MIN_EXPECTED_EDGE_BPS=5   # minimum signal quality
MAX_NOTIONAL_USDC=75      # max per trade
DAILY_NOTIONAL_LIMIT_USDC=400
MAX_TRADES_PER_DAY=8
COOLDOWN_SEC=900          # wait 15 min between trades

# Advanced (off by default)
RSI_SCALE_BUY_ENABLED=0   # scale buy size up when more oversold
RSI_SCALE_MAX_MULT=2.0
PROFIT_TARGET_BYPASS_COOLDOWN=0  # re-enter immediately after PT fires
USE_ATR_THRESHOLDS=0      # use ATR-scaled dip/rip instead of fixed %
```

---

## Backtester CLI Reference

```bash
npm run backtest                                           # all data files
npm run backtest:sweep                                     # grid search
npm run backtest:wf                                        # 70/30 walk-forward
node src/backtest.mjs --data backtest/data/sol-usd-1d.json
node src/backtest.mjs --data <file> --compare              # vs baseline
node src/backtest.mjs --data <file> --sweep --walk-forward
```

Override any config key via env var:
```bash
BULL_DIP_PCT=1.2 PROFIT_TARGET_PCT=3.0 node src/backtest.mjs --data backtest/data/sol-usd-1d.json
```

---

## Key Source Files

| File | Purpose |
|------|---------|
| `src/common.mjs` | All CFG keys, env loading, utilities |
| `src/bot-lib.mjs` | Signal generation: EMA, RSI, dip/rip logic |
| `src/executor.mjs` | Trade execution: gates, profit target, stop-loss |
| `src/backtest.mjs` | Full backtest engine (v5) |
| `backtest/fetch-data.mjs` | Fetch Coinbase OHLCV data |
| `.env` | User's live config (overrides .env.example) |
| `.env.example` | All documented config keys with defaults |
| `GUIDE.md` | Plain-English guide for the user |

---

## Questions for Opus

1. **Bull market strategy**: Given the current design, what config changes or code additions would improve performance when SOL is in an uptrend? Should the profit target be raised dynamically? Should sell sizing increase?

2. **Anchor management**: The current anchor-on-emit approach is aggressive. What's the best alternative that prevents cascade buying in fast crashes while keeping the strategy responsive?

3. **Partial profit taking**: How should we implement a profit ladder (sell X% at 2%, let Y% run to 5%) while keeping the stop-loss working correctly on the remaining position?

4. **BULL vs BEAR differentiation**: The two bots are nearly identical in current config. What should BULL and BEAR actually specialize in to add real diversity and reduce bot-conflict cancellations?

5. **Position sizing**: RSI-scaled buying (buy more when more oversold) hurt because of stop-loss interaction. What's the right way to scale up conviction buys without increasing stop-loss exposure?

6. **Regime filter tuning**: EMA(20) > EMA(50) is our regime gate. Would a different regime signal (e.g., price > EMA(200), or MACD crossover) work better? What would you test?

7. **Walk-forward out-of-sample is +1.37%** — respectable but modest. What specific changes would push the out-of-sample return higher without overfitting to the training period?
