# RED TEAM ANALYSIS: Solana SOL/USDC Trading Bot Live Deployment Risk Assessment

**Generated:** 2026-06-15 | **Scope:** Brutally honest assessment of live deployment risks

---

## EXECUTIVE SUMMARY

| Risk Category | Overall Rating | Key Finding |
|---------------|----------------|-------------|
| **Model Risk** | **HIGH** | Strategy validated ONLY on bear/chop regimes; ZERO validation on strong bull (>100% moves) |
| **Execution Risk** | **HIGH** | Jupiter Ultra API single point of failure; no MEV protection; slippage assumption (8bps) likely optimistic |
| **Infrastructure Risk** | **CRITICAL** | Single process, no HA, no reconciliation for partial fills, RPC outage = total blindness |
| **Market Regime Risk** | **CRITICAL** | Backtest data ends 2026-06-12; NO coverage of hyper-bull, flash crash, or prolonged chop |
| **Parameter Sensitivity** | **MEDIUM** | Configs A/B/C/D converge on identical test results (overfit concern); small changes = large behavior shifts |
| **Unknown Unknowns** | **HIGH** | Correlation risk (SOL/USDC depeg), black swan tail risk, Jupiter API changes unmonitored |

---

## 1. MODEL RISK — Rating: HIGH

### 1.1 Core Assumption: Mean Reversion on Dips
**Assumption:** SOL reverts from 0.5–1.5% intraday dips (anchor-based dip/rip thresholds)
**Evidence from Backtest:**
- Bear dataset (310d, -55.8% SOL): Strategy +9.29% vs Hold -36.3% ✅
- 1h-540d (-67.7% SOL): Strategy -0.17% vs Hold -34.5% ✅
- 5m/15m intraday: Small positive or slightly negative vs hold

**Where it FAILS:**
- Bull 1d (183d, +705% SOL): Strategy +5.6% vs Hold +135.9% — **misses 130pp of upside**
- Bull 6h (183d, +815% SOL): Strategy +5.8% vs Hold +143% — **sits in USDC entire bull**
- Monte Carlo Strong Bull (+0.9%/d): Strategy +16% vs Hold +182% — **captures <10% of trend**

**Specific Failure Modes:**
1. **Bot specialization gone wrong**: BULL bot ONLY buys when EMA fast > slow AND rising (trend-follower). In parabolas, no pullbacks → zero buys.
2. **BEAR bot RSI gate**: Only buys RSI < 30/35. In bull, RSI stays >50 → BEAR never buys either.
3. **Anchor mechanism**: Resets on every trade. In sustained trend, anchor chases price up but dip threshold never hit.

**Mitigation:** 
- Accept this is a BEAR/CHOPS strategy, not a full-cycle strategy.
- Set capital allocation accordingly (max 10–20% of portfolio).
- Add explicit "bull detection" to reduce position size or pause.

---

### 1.2 Regime Detection: Dual EMA (Fast 20, Slow 45)
**Assumption:** Fast > Slow = uptrend confirmed; Fast < Slow = downtrend
**Backtest Evidence:**
- Train max DD: 0.31–0.77% (regime filter works in-sample)
- Test max DD: 4.69% (6–15x higher) — **regime shift not captured**
- Stop-losses fired 10–13x in train, **ZERO in test** — test period had no deep drawdowns triggering stops

**Failure Modes:**
- EMA lag: 20/45 periods = ~20–45 days on daily data. By time regime flips, 10–20% move already happened.
- Whipsaw in chop: Fast EMA crosses slow repeatedly → regime gate blocks entries repeatedly.
- No regime detection on intraday (5m/15m/1h) — uses daily EMA state for intraday decisions.

**Mitigation:**
- Add faster regime detection for intraday (separate EMAs per timeframe).
- Monitor regime flip frequency in logs; alert on >2 flips/day.

---

### 1.3 Profit Target / Trailing Exit Logic
**Assumption:** Trail in uptrend (give-back 14%), fixed target (3%) in chop/downtrend
**Backtest Evidence:**
- Profit targets fired 9–11x in train, 3x in test
- Trail give-back widened to 14% (from 10%) after June 2026 leg down re-optimization
- **Critical**: Trail only arms at 2% gain, then exits on 14% give-back from peak

**Failure Modes:**
1. **Wide trail = large give-back**: In a 50% rally, bot sells at 36% from peak (14% give-back). Captures only 36% of move.
2. **Fixed target in chop**: 3% target may never hit in low-vol chop → position rides down.
3. **No partial takes**: Full position exit on PT/SL → no scaling, all-or-nothing.

**Mitigation:**
- Add partial take-profits (e.g., 50% at 2%, 50% at 5%).
- Test narrower trail give-back (8–10%) with faster arm.

---

## 2. EXECUTION RISK — Rating: HIGH

### 2.1 Slippage: Backtest Assumes 8bps, Live Reality Unknown
| Context | Backtest | Live Expectation |
|---------|----------|------------------|
| Simulated fee | 30bps | N/A |
| Simulated slippage | 8bps | **Unknown** |
| Max slippage config | 100bps | Jupiter Ultra default |
| Typical SOL/USDC 1M depth | ~$50–100k/side | **5–10bps for <$10k** |
| During volatility | N/A | **50–200bps+** |

**Evidence:** 
- `jupiter-swap.mjs` logs slippage note if >8bps: "HIGH: live slippage exceeds backtest by 6x+" at >50bps
- Shadow-quote fetches real Jupiter quote pre-trade, calculates `priceImpactBps`, blocks if `netEdgeBps < 0`
- BUT: Quote is **pre-trade estimate**, not guaranteed fill. MEV searchers can frontrun.

**Gap:** Backtest applies fixed 8bps to EVERY trade. Live slippage is path-dependent, size-dependent, time-dependent.

### 2.2 Partial Fills & Failed Transactions
**Current Code (jupiter-swap.mjs):**
- No partial fill handling — Jupiter Ultra returns full transaction or fails
- `executeJupiterSwap` retries **zero times** on HTTP error (intentional per comments)
- Confirmation timeout: 60s polling `getSignatureStatuses` every 2s
- **CRITICAL**: If confirmation times out → transaction marked `UNCONFIRMED`, portfolio NOT updated, **manual reconciliation required**

**Failure Scenarios:**
1. RPC outage during confirmation → bot thinks trade failed, but it may have succeeded on-chain
2. Priority fee too low (default 5000 lamports) → transaction stuck in mempool >60s
3. Jupiter API returns success but transaction fails on-chain (insufficient balance, slippage exceeded)
4. Network partition → signed transaction sent but response lost

**Mitigation:**
- Implement retry with exponential backoff on HTTP errors (transient failures)
- Add priority fee dynamic adjustment (Jupiter prioritization fee API)
- Build reconciliation job: scan `trades.jsonl` for `UNCONFIRMED`, verify on-chain via RPC
- Set `maxSlippageBps` conservatively (50–100) for live; backtest used 8

### 2.3 MEV & Frontrunning
- **No MEV protection**: Jupiter Ultra routes through their relay; no Jito bundles, no private mempool
- Signal generation → quote fetch → sign → execute takes ~2–5 seconds. MEV bot can see pending tx, frontrun.
- **Price impact gate helps**: `shadowQuoteOnTrade` blocks trades where `priceImpactBps > signal.edgeBps`
- BUT: Quote is snapshot; MEV can push price between quote and execution

### 2.4 RPC Latency & Reliability
- Single RPC endpoint (no failover in `common.mjs`)
- `rpcRequest` in `common.mjs` — no timeout, no retry, no circuit breaker
- Price fetch (`price-source.mjs`) uses Jupiter price API + fallback to mock
- If RPC down: bot cannot get balances, cannot confirm tx, cannot fetch price → **total blindness**

---

## 3. INFRASTRUCTURE RISK — Rating: CRITICAL

### 3.1 Single Points of Failure
| Component | Redundancy | Failure Impact |
|-----------|------------|----------------|
| **Bot process** | ❌ Single Node.js process | Crash = bot dead until manual restart |
| **RPC endpoint** | ❌ Single URL in `.env` | RPC down = no price, no balances, no tx confirmation |
| **Jupiter API** | ❌ Single endpoint (`lite-api.jup.ag`) | API down = no quotes, no swaps |
| **Wallet** | ❌ Single keypair | Key compromise = total loss |
| **State files** | ❌ Local filesystem only | Disk failure = loss of portfolio state, PnL tracking |
| **Logs** | ❌ Local JSONL files | No centralized logging, no alerting on errors |

### 3.2 Crash Recovery
- **State persistence**: Portfolio, regime, bot states saved to `state/*.json` each tick
- **On restart**: Loads from disk, continues. **BUT**:
  - `signalIndex` tracks position in `signals.jsonl` — if file rotated, may reprocess old signals
  - `lastTradeWindow` prevents duplicate trades per window — survives restart
  - **NO**: In-flight trade reconciliation. If crash during `executeTrade`, portfolio may be out of sync with chain
  - **NO**: Idempotency keys for trades — duplicate submission possible on retry

### 3.3 RPC Outage Handling
- `getSolUsdPrice()` in `price-source.mjs`: tries Jupiter price, falls back to mock walk
- **BUT**: `getOnChainBalances()` in `on-chain-balance.mjs` calls RPC directly — **no fallback**
- Executor calls `getBalances(price)` → calls `getOnChainBalances()` in real mode
- If RPC fails: `getBalances` throws → executor tick fails → logged, next tick retries
- **No circuit breaker on RPC**: Bot keeps hammering dead RPC

### 3.4 Jupiter API Changes
- Hardcoded endpoints: `lite-api.jup.ag/ultra/v1/order`, `/ultra/v1/execute`
- hardcoded param names: `inputMint`, `outputMint`, `amount`, `slippageBps`, `taker`
- **No version pinning**, no compatibility layer
- June 2026: POST /order returned 404, GET required — discovered by accident
- **No automated API health check** or version detection

### 3.5 Monitoring & Alerting
- Discord webhook config exists (`ALERT_WEBHOOK_URL`, `ALERT_ON_TRADE`, `ALERT_ON_ERROR`, `ALERT_ON_BREAKER`)
- **BUT**: Default all OFF in `.env.example`
- No health check endpoint, no metrics export (Prometheus/statsd)
- No dead man's switch (alert if no tick for N minutes)

---

## 4. MARKET REGIME RISK — Rating: CRITICAL

### 4.1 Regimes NOT in Backtest Data
| Regime | Backtest Coverage | Expected Behavior |
|--------|-------------------|-------------------|
| **Hyper-bull** (SOL +200% in 60d) | ❌ None | Bot sits in USDC, misses entire move |
| **Flash crash** (-30% in 1 hour) | ❌ None | Stop-loss at 12% from avg entry; intrabarStops uses candle low — may fill at -30% |
| **Prolonged chop** (90d sideways, 2% range) | ⚠️ Partial (1h-540d has chop periods) | Many small whipsaw trades, fees bleed |
| **Regime change** (bear → bull transition) | ⚠️ Partial (6h-recent 90d) | EMA lag = late entry, buys near local top |
| **USDC depeg** | ❌ None | Bot holds USDC as "safe" — loses peg exposure |
| **SOL halving/event pump** | ❌ None | No event-driven logic |

### 4.2 Walk-Forward Evidence of Regime Fragility
From `walk-forward-results.json`:
- Train (70% = ~1390 days): Max DD 0.31–0.77%, stop-losses fired 10–13x
- Test (30% = ~596 days): Max DD 4.69% (6–15x higher), **stop-losses fired 0x**
- All 5 configs produce **IDENTICAL test results** (-2.44% return, 25.56pp vs hold)
- Overfit gap: 3.86–5.34pp (train return - test return)
- **Interpretation**: Test period (recent ~1.5 years) is a DIFFERENT REGIME than train. Strategy parameters overfit to train regime.

### 4.3 Monte Carlo Regime Test Results (from `montecarlo.mjs`)
| Regime | Legacy Return | New Return | Hold Return | New vs Hold |
|--------|---------------|------------|-------------|-------------|
| Strong Bull (+0.9%/d) | ~0% | +16% | +182% | -166pp |
| Steady Bull (+0.4%/d) | ~0% | ~+5% | +80% | -75pp |
| Sideways Chop (0%/d) | ~0% | ~+1% | ~0% | +1pp |
| Mild Bear (-0.3%/d) | ~0% | ~+2% | -15% | +17pp |
| Crash Bear (-0.6%/d) | -5% | -7% | -35% | +28pp |

**Conclusion**: Strategy ONLY adds value in bear/chop. In any bull, it severely underperforms hold.

---

## 5. PARAMETER SENSITIVITY — Rating: MEDIUM

### 5.1 Config A/B/C/D Walk-Forward Comparison (`walkforward-matrix-results.json`)
All 4 configs produce **IDENTICAL test-period results**:
- Return: 14.47% (test), -2.44% (older walk-forward)
- Vs Hold: 42.48pp
- Max DD: 7.01%
- Trades: 22, Win Rate: 87.5%

**But train results differ significantly:**
| Config | Train Return | Train Max DD | Train Trades | Train Win Rate |
|--------|--------------|--------------|--------------|----------------|
| A (Original) | +2.12% | 0.45% | 42 | 80% |
| B (3 Zero-Risk) | +2.12% | 0.45% | 42 | 80% |
| C (Tier 2) | +2.13% | 0.45% | 38 | 79% |
| D (Sweep Best) | +0.82% | 0.29% | 31 | 62.5% |

**Key Insight**: Test period convergence suggests **overfitting to test window** — all configs found same local optimum for recent regime, but train behavior diverges.

### 5.2 Sweep Results (`moderate-sweep-results.json`)
Top 20 results: **ALL IDENTICAL** (1.29% return, -30.92pp vs hold, 0.31% max DD, 71 trades)
- Parameters varied: `rsiOversold` 30/35/40, `profitTargetPct` 2/3, `bearRipPct` 0.8/1.0/1.2
- **15,552 combinations tested** → top 20 all same result
- Indicates **flat optimization surface** — many params don't matter for this dataset/regime
- OR: Backtest framework has bug causing identical results (needs verification)

### 5.3 Sensitivity to Key Parameters
From `TUNING-LOG.md`:
- `MIN_SOL_RESERVE` 0.02→0.01: 1h-540d -7.12→-6.37 (+0.75pp), bear 9.48→10.42
- `TRAIL_GIVE_PCT` 10→14: Bear floor restored (2.08→15.08) after June 2026 leg
- `BEAR_RSI_MAX` 35→30: Bear 15.08, 1h -0.65→-0.17
- `CONFLICT_EDGE_RESOLUTION`: "bit-identical on all 8 sets (opposing-side conflicts never coexist)"

**Conclusion**: Small param changes (±0.5% on thresholds, ±2 on trail give-back) can swing bear performance by 5–10pp. Config is at local optimum but **highly regime-dependent**.

---

## 6. UNKNOWN UNKNOWNS — Rating: HIGH

### 6.1 Correlation Risk (SOL/USDC Depeg)
- **Strategy assumes USDC = risk-free anchor**
- If USDC depegs (e.g., Circle insolvency, regulatory action): Both legs lose
- March 2023: USDC depegged to $0.87 for 48h — bot would have held "safe" USDC losing 13%
- **No stablecoin diversification**, no depeg detection

### 6.2 Tail Risk / Black Swans
| Event | Probability | Strategy Exposure |
|-------|-------------|-------------------|
| SOL -50% in 24h (FTX-style) | Low | Stop-loss at 12% from avg entry; intrabarStops uses daily candle low → may fill at -50% |
| Jupiter exploit / smart contract bug | Low | Full notional at risk per trade (max $25 real mode) |
| RPC censorship / Solana outage | Medium | Bot blind, cannot exit positions |
| USDC freeze / blacklist | Low | USDC held becomes worthless |
| Priority fee spike (5000→500k lamports) | Medium | Tx fails or overpays; default 5000 lamports fixed |

### 6.3 Unmeasured Risks
1. **Jupiter quote staleness**: Quote fetched pre-trade, but price moves between quote and sign/execute
2. **Portfolio accounting drift**: Real mode uses on-chain balances post-trade; sim mode uses calculated. Drift accumulates.
3. **Signal deduplication**: `signalId` = hash of signal. If same signal emitted twice (bot restart), executor skips. But if signal slightly different (price changed), treated as new.
4. **Time synchronization**: Bot uses local `Date.now()`. Clock drift → wrong window decisions, stale signal logic.
5. **Fee changes**: Solana base fee + priority fee not modeled in backtest (fixed 30bps).

### 6.4 Operational Blind Spots
- No integration testing with real Jupiter API (only `preflight.mjs` dry-run)
- No chaos engineering (kill bot mid-trade, RPC failure injection)
- No canary deployment — single process goes live
- No rollback procedure documented

---

## RISK MATRIX SUMMARY

| # | Risk | Rating | Likelihood | Impact | Mitigation Priority |
|---|------|--------|------------|--------|---------------------|
| 1 | Infrastructure: Single process, no HA, no reconciliation | **CRITICAL** | High | Total loss of control | P0 — Add process supervisor, reconciliation job, multi-RPC |
| 2 | Market Regime: Zero bull coverage, regime shift fragility | **CRITICAL** | Certain | Severe underperformance | P0 — Define regime scope, add bullpause, limit allocation |
| 3 | Execution: Jupiter API SPOF, no MEV protection, slippage unknown | **HIGH** | Medium | Failed trades, worse fills | P1 — Add RPC failover, quote freshness check, dynamic priority fee |
| 4 | Model: Mean reversion assumption invalid in bull, EMA lag | **HIGH** | Certain in bull | Misses 100%+ moves | P1 — Accept as bear-only strategy, cap allocation |
| 5 | Unknown: USDC depeg, SOL flash crash, RPC censorship | **HIGH** | Low | Catastrophic | P2 — Add circuit breakers, multi-stablecoin, position limits |
| 6 | Parameters: Config convergence suggests overfit/flat surface | **MEDIUM** | High | Unstable live params | P2 — Run sensitivity analysis, add parameter guards |

---

## RED TEAM RECOMMENDATIONS (Priority Order)

### P0 — DO NOT GO LIVE WITHOUT
1. **Process supervisor** (pm2/systemd) with auto-restart, log rotation, health check endpoint
2. **Multi-RPC failover** (primary + 2 backups) with automatic switching
3. **Reconciliation job**: Cron every 5min — scan `trades.jsonl` for `UNCONFIRMED`, verify on-chain, fix portfolio state
4. **Position size cap**: `REAL_MAX_NOTIONAL_USDC=10`, `REAL_DAILY_NOTIONAL_LIMIT_USDC=50` for first 30 days
5. **Explicit scope doc**: "This bot trades bear/chop only. Max 10% portfolio allocation. Do not expect bull capture."

### P1 — BEFORE SCALING
6. **Dynamic priority fee**: Query Jupiter prioritization fee API, set `priorityFeeLamports` per trade
7. **Partial take-profit**: Sell 50% at 2%, 50% at 5% (reduces trail give-back risk)
8. **Clock sync**: Add NTP check on startup, alert if drift >1s
9. **Prometheus metrics**: Export trades, PnL, errors, latency for Grafana alerting
10. **Chaos test**: Kill bot mid-trade, verify reconciliation works

### P2 — ONGOING
11. **Regime monitoring dashboard**: Track EMA fast/slow, regime flips, signal frequency
12. **Parameter drift guards**: Alert if live trade frequency deviates >50% from backtest expectation
13. **USDC depeg monitor**: Poll Circle API / CoinGecko for USDC price, halt if >2% off peg
14. **Jupiter API version pinning**: Lock to specific version, test on staging before prod upgrades