# Solana Trading Bot — System Architecture

## Overview

This is a multi-process, signal-driven trading bot for SOL/USDC on Solana. It implements a dual-bot strategy (BULL + BEAR) with regime-conditional profit targets, trailing stops, and a quote-aware net-edge gate. The system is designed for **backtest/live parity** — the exact same logic runs in simulation (backtest) and live execution.

---

## Processes

### 1. Signal Generators (2 independent processes)
- **`bull-bot.mjs`** (BULL bot) — Trend-following bot optimized for uptrends
- **`bear-bot.mjs`** (BEAR bot) — Mean-reversion bot optimized for downtrend flushes
- Both read price via `price-source.mjs`, maintain independent state (`state-BULL.json`, `state-BEAR.json`)
- Emit signals to `logs/signals.jsonl` (append-only JSONL)

### 2. Executor (single process, **sole writer to portfolio**)
- **`executor.mjs`** — Consumes signals, manages risk, executes trades
- Runs under a file lock (`state/executor.lock`) to prevent concurrent instances
- Only process that writes to `state/portfolio.json`
- Enforces: cooldown, daily limits, notional caps, circuit breaker, quote gate

### 3. Portfolio Manager (library, not a process)
- **`portfolio.mjs`** — Pure trade execution logic (sim + real)
- `executeTrade()` handles both simulated and real execution paths
- Real mode delegates to `jupiter-swap.mjs` for on-chain execution
- Updates `portfolio.json` atomically after confirmed fills

### 4. Backtester (standalone, parity-validated)
- **`backtest.mjs`** — Full replay engine using same logic as live
- Reads candle data from `backtest/data/*.json`
- Exports `runBacktest(series, params)` for programmatic use
- Supports walk-forward, parameter sweep, and feature comparison modes

### 5. Auxiliary Tools
- `ui-server.mjs` — HTTP dashboard (port 8787 default)
- `wallet.mjs` — Keypair generation/management
- `reconcile.mjs` — State reconciliation with on-chain
- `alerts.mjs` — Webhook notifications

---

## Data Flow

```
┌──────────────┐     ┌──────────────┐
│  price-source │────▶│  BULL bot    │────┐
│  (Jupiter/    │     │  (trend-     │    │
│   mock/auto)  │     │   follower)  │    │
└──────────────┘     └──────────────┘    │
       ▲                   │             │
       │                   ▼             ▼
       │            ┌──────────────┐  logs/signals.jsonl
       │            │  BEAR bot    │  (append-only,
       │            │  (mean-rev)  │   one line per signal)
       └────────────┴──────────────┘
                          │
                          ▼
                   ┌──────────────┐
                   │  EXECUTOR    │
                   │  (single      │
                   │   process)   │
                   └──────┬───────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   ┌────────────┐ ┌─────────────┐ ┌──────────────┐
   │ portfolio  │ │  executor   │ │   shadow     │
   │ .json      │ │  .jsonl     │ │  .jsonl      │
   │ (state)    │ │  (logs)     │ │  (quote gate │
   └────────────┘ └─────────────┘ │   audits)    │
                                  └──────────────┘
                          │
                          ▼
                   ┌──────────────┐
                   │  Jupiter     │
                   │  Aggregator  │
                   │  (on-chain)  │
                   └──────────────┘
```

### Signal → Executor Pipeline

1. **Signal Generation** (per bot, every loop tick):
   - Fetch price → Update EMAs/RSI/ATR → Check dip/rip triggers → Emit signal if eligible
   - Signal includes: `side`, `amount`, `edgeBps`, `rsi`, `emaFast`, `emaSlow`, `signalId`

2. **Signal Persistence**:
   - Appended to `logs/signals.jsonl` (SHA-256 `signalId` for deduplication)

3. **Executor Tick** (every `LOOP_SEC` seconds, under lock):
   - Read new signals since last `signalIndex`
   - Filter stale signals (`STALE_SIGNAL_SEC`)
   - **Decision Logic** (`decide()`):
     - Manual override > all
     - BULL/BEAR conflict → NO_TRADE (or edge-resolution if enabled)
     - Single bot signal → validate `edgeBps >= minExpectedEdgeBps`

4. **Pre-Trade Gates** (sequential, fail-fast):
   - Daily loss circuit breaker
   - Cooldown since last trade
   - Max trades/day (real vs sim limits)
   - Daily notional limit (real vs sim limits)
   - One-trade-per-decision-window
   - Signal deduplication
   - Min/max notional sizing (Wealth-V4: `effectiveMaxNotionalUsdc()` with strong-bull gating)
   - Balance sufficiency (USDC for BUY, SOL for SELL + reserve)
   - SOL allocation cap (`maxSolAllocationPct`)

5. **Quote-Aware Net-Edge Gate** (`shadowQuoteOnTrade || executionMode === 'real'`):
   - Fetch Jupiter quote for exact trade size
   - Compute `priceImpactBps` from `priceImpactPct`
   - `netEdgeBps = signal.edgeBps - priceImpactBps`
   - Block if `netEdgeBps < minNetEdgeBps` (default 0 = block only negative net edge)
   - **REAL mode**: quote error → FAIL CLOSED
   - **SIM/SHADOW**: quote error → log and proceed

6. **Execution** (`portfolio.executeTrade()`):
   - SIM: local fill with fee/slippage model
   - REAL: Jupiter swap → on-chain balance fetch → portfolio update
   - DRY_RUN: blocks real execution, logs `dry_run_trade`

7. **Post-Trade**:
   - Update `state-exec.json` (counters, timestamps)
   - Log to `executor.jsonl` (trade or dry_run_trade)
   - Alert webhook if configured

---

## State Files

| File | Location | Owner | Purpose |
|------|----------|-------|---------|
| `portfolio.json` | `state/` | Executor | **Single source of truth for positions/PnL**. Contains: `usdc`, `sol`, `avgEntryPrice`, `realizedPnlUsdc`, `sweptUsdc`, `lastUpdatedAt`. **Fails CLOSED on corruption in REAL mode** (protects circuit breaker). |
| `state-exec.json` | `state/` | Executor | Runtime state: `signalIndex`, `lastTradeAt`, `lastTradeWindow`, `lastSignalId`, `tradesToday`, `notionalTodayUsdc`, `realizedLossTodayUsdc`, `day`, `peakSinceEntry`. |
| `state-BULL.json` | `state/` | BULL bot | Bot-specific: `anchor`, `lastSignalAt`, `emaFast`, `emaSlow`, `priceBuf`, `tickCount`, `lastBuyTick`, `lastBuyAmountSol`. |
| `state-BEAR.json` | `state/` | BEAR bot | Same structure as BULL. |
| `regime.json` | `state/` | BULL bot (writer) | Shared regime snapshot: `emaFast`, `emaSlow`, `bot`, `t`. Read by executor for profit target regime logic. |
| `price-cache.json` | `state/` | Price source | Cached price with timestamp. Stale check (`STALE_PRICE_SEC`) gates all bots. |
| `signals.jsonl` | `logs/` | Both bots (append) | Signal audit trail. One JSON line per signal. Executor reads via `signalIndex` cursor. |
| `executor.jsonl` | `logs/` | Executor | Full execution audit: ticks, decisions, skips, trades, errors, circuit breaker events. |
| `shadow.jsonl` | `logs/` | Executor | Quote gate audit: pre-trade quotes, price impact, net edge calculations. |
| `bull.jsonl` / `bear.jsonl` | `logs/` | Respective bots | Per-bot tick logs: triggers, EMA/RSI values, balances, signal emission. |
| `trades.jsonl` | `logs/` | Portfolio (real mode) | Real trade intents, fills, failures, UNCONFIRMED flags. |
| `generated-wallet.json` | `state/` | Wallet tool | Ed25519 keypair (SPKI/PKCS#8 base64). Created by `npm run wallet:new`. |
| `DISABLED` | `ROOT/` | Admin | Kill switch. If present, executor logs `disabled` and skips all trading. |

---

## Key Design Invariants

### 1. Single Writer for Portfolio
Only `executor.mjs` writes `portfolio.json`. Bots and backtester are read-only. This prevents race conditions and ensures the daily-loss circuit breaker sees accurate realized PnL.

### 2. File-Based Mutex (`withLock`)
All critical sections (executor tick, portfolio saves) run under `withLock()`. Stale locks (older than `max(loopSec * 4000, 120s)`) are auto-reclaimed. Lock release **never throws** — Windows AV/OneDrive unlink failures are swallowed.

### 3. Backtest/Live Parity
- **Shared pure functions**: `effectiveMaxNotionalUsdc()`, `circuitBreakerTripped()`, `decide()`, `fill()` logic
- **Identical signal generation**: `botTick()` in `bot-lib.mjs` used by both live bots and backtester
- **Same config object**: `CFG` from `common.mjs` drives both
- **Wealth-V4 notional gates**: Real mode **never** gets strong-bull widening (`bullMaxNotionalUsdc`)

### 4. Fail-Closed Safety
- Corrupt `portfolio.json` in REAL mode → **throws** (won't silently reset PnL)
- Missing/bad quote in REAL mode → **skip trade**
- Circuit breaker → **halts all trading for UTC day**
- `DRY_RUN=true` → **blocks all real execution** at two layers

### 5. Regime-Conditional Exits
- **Profit Target**: Trailing in confirmed uptrend (`emaFast > emaSlow`), fixed target in chop
- **Option C**: Strong bull (regimeStrengthPct ≥ `bullStrongRegimePct`) widens trail give-back to `bullTrailGivePct`
- **Option B**: Strong bull keeps `bullMinSolHold` core position through trend
- **Stop-Loss**: Always protective, full exit to `minSolReserve`, no regime exceptions

---

## Configuration (Environment Variables)

All config via `.env` (see `.env.example`). Key categories:

| Category | Variables |
|----------|-----------|
| **Execution** | `EXECUTION_MODE` (simulated/real), `DRY_RUN`, `PRIVATE_KEY`, `RPC_URL` |
| **Risk Limits** | `MAX_NOTIONAL_USDC`, `REAL_MAX_NOTIONAL_USDC`, `DAILY_NOTIONAL_LIMIT_USDC`, `REAL_DAILY_NOTIONAL_LIMIT_USDC`, `DAILY_LOSS_LIMIT_USDC`, `MAX_TRADES_PER_DAY`, `REAL_MAX_TRADES_PER_DAY` |
| **Strategy** | `BULL_DIP_PCT`, `BULL_RIP_PCT`, `BEAR_DIP_PCT`, `BEAR_RIP_PCT`, `EMA_PERIOD`, `REGIME_EMA_SLOW`, `RSI_OVERSOLD`, `RSI_OVERBOUGHT` |
| **Exits** | `PROFIT_TARGET_PCT`, `TRAIL_ARM_PCT`, `TRAIL_GIVE_PCT`, `STOP_LOSS_PCT`, `BULL_TRAIL_GIVE_PCT`, `BULL_MIN_SOL_HOLD` |
| **Features** | `TRAIL_IN_UPTREND`, `REGIME_FILTER_ENABLED`, `BOT_SPECIALIZATION_ENABLED`, `CONFLICT_EDGE_RESOLUTION`, `SHADOW_QUOTE_ON_TRADE` |
| **Simulation** | `SIM_START_USDC`, `SIM_START_SOL`, `SIM_FEE_BPS`, `SIM_SLIPPAGE_BPS` |

---

## Running the System

```bash
# Simulated (default)
npm start          # runs all.mjs (price + bots + executor + ui)

# Real execution (requires PRIVATE_KEY, PROFIT_WALLET, mainnet RPC)
EXECUTION_MODE=real DRY_RUN=false npm start

# Shadow mode (real prices, simulated fills, full quote gate)
SHADOW_MODE=true npm start

# Backtest
npm run backtest              # all data files
npm run backtest -- --sweep   # parameter sweep
npm run backtest -- --walk-forward  # 70/30 walk-forward
```

---

## Monitoring & Debugging

- **UI Dashboard**: `http://localhost:8787` (when running)
- **Live tail**: `tail -f logs/executor.jsonl`
- **Signal audit**: `tail -f logs/signals.jsonl`
- **Quote gate audit**: `tail -f logs/shadow.jsonl`
- **Circuit breaker alert**: Webhook on `alertOnBreaker`
- **Boot fingerprint**: First line of `executor.jsonl` shows git commit

---

## Parity Verification Checklist

When modifying strategy logic, verify backtest matches live by checking:

- [ ] `effectiveMaxNotionalUsdc()` behavior (strong-bull gating, REAL mode invariant)
- [ ] `circuitBreakerTripped()` threshold and reset (UTC day boundary)
- [ ] `decide()` conflict resolution and edge validation
- [ ] Profit target: `trailArmPct` arming, `effTrailGive` give-back, `peakSinceEntry` tracking
- [ ] Stop-loss: intrabar (`INTRABAR_STOPS`) vs close-only, fill price at stop level
- [ ] Quote gate: `minNetEdgeBps` floor, REAL vs SIM failure modes
- [ ] Signal generation: `anchor` updates, `signalMinSec` cooldown, `anchorCooldownBars`
- [ ] Regime overlay: `bullRegimeThreshold`, `bullDipScale`, `bullStrongRegimePct`
- [ ] Position sizing: `regimeSizeEnabled` multipliers, `bullBuyPctOfUsdc`, `bullProportionalSells`

---

## File Structure

```
src/
├── common.mjs           # Config, state utils, pure helpers (shared)
├── executor.mjs         # Main loop, risk gates, execution orchestration
├── portfolio.mjs        # Trade execution (sim + real), portfolio persistence
├── bot-lib.mjs          # Signal generation logic (used by bots + backtest)
├── backtest.mjs         # Full replay engine, sweep, walk-forward
├── price-source.mjs     # Price fetching (Jupiter, mock, auto)
├── jupiter-swap.mjs     # On-chain swap via Jupiter aggregator
├── shadow-quote.mjs     # Quote fetching for net-edge gate
├── on-chain-balance.mjs # Wallet balance queries
├── solana-signer.mjs    # Keypair loading, transaction signing
├── alerts.mjs           # Webhook notifications
├── ui-server.mjs        # HTTP dashboard
├── wallet.mjs           # Wallet generation CLI
├── reconcile.mjs        # State reconciliation
└── all.mjs              # Process orchestrator (starts price + bots + executor + ui)

backtest/
├── data/                # Candle JSON files (gitignored)
├── fetch-data.mjs       # Download candles from Yahoo/other
├── fetch-yahoo.mjs      # Yahoo Finance fetcher
├── montecarlo.mjs       # Monte Carlo simulation
└── walkforward.mjs      # Walk-forward analysis

docs/
└── ARCHITECTURE.md      # This file
```