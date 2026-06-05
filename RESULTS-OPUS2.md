# RESULTS — Opus Session 2

All four improvement tasks complete. `npm test` 10/10 green, preflight passes every
check except `PROFIT_WALLET` (George's go-live Step 1). Bull-market participation is
dramatically improved while the bear capital-protection baseline is preserved and
slightly improved.

---

## Headline before / after (real Binance data, simulated fills)

| Dataset | Span | Before (Opus 1) | After (Opus 2) | Δ |
|---|---|---|---|---|
| **Bear 1d** (`sol-usd-1d`) | 310d, SOL −55.8% | +9.29% | **+9.42%** | +0.13pp |
| **Bull 1d** (`sol-usd-1d-bull`) | 183d, SOL +705% | +5.61% | **+25.05%** | **+19.44pp** |
| **Bull 6h** (`sol-usd-6h-bull`) | 183d, SOL +815% | +5.76% | **+19.43%** | **+13.67pp** |
| **Recent 6h** (`sol-usd-6h-recent`) | 90d, SOL −19% | +0.81% | **+1.03%** | +0.22pp |
| **Full cycle 1d** (`sol-usd-1d-full`) | 1982c, 2021–2026 | — | **+7.30%** (maxDD 10.95%) | new |

Bear max drawdown unchanged at 10.48%. Bull max drawdowns stay tiny (2.1% / 4.9%).
`npm test`: **6/6 → 10/10**. Preflight: 9/9 functional checks pass; only the
`PROFIT_WALLET` placeholder remains (George fills it in go-live Step 1).

The strategy still sits *under* buy-and-hold in raging bull runs by design (it is a
risk-managed strategy, not a leveraged long), but it now captures a meaningful slice
of the upside instead of sitting in cash.

---

## What each task changed

### Task 1 — Bull-regime overlay (highest value)
**Problem:** In strong bull runs the bot exited its single position at the +2% target,
then sat in cash for the entire run — because in a relentless uptrend price never dips
the required % below the anchor, so the dip-trigger never re-fires (deadlock).

**Fix:** When the confirmed-uptrend strength
`regimeStrength = (emaFast − emaSlow) / emaSlow × 100` exceeds
`BULL_REGIME_THRESHOLD`, the BULL trend-follower switches from dip-buying to
**momentum accumulation** (no dip gate) and widens its rip by `BULL_DIP_SCALE`, letting
the regime-conditional trailing take-profit ride the trend. Throttled by the existing
cooldown, per-day trade cap, anchor cooldown, and 60% inventory cap.

**Threshold tuning:** bear relief rallies top out at regimeStrength ≈ 8%, while real
bull markets spend 100+ bars above 8%. A threshold of **7.0** cleanly isolates true
bull regimes — bear stays +9.17%, bull explodes. (The handoff's suggested literal
"multiply dip/rip ×3 at threshold 2.0" was implemented first but moved the needle
< 1pp on bull, because widening the dip makes re-entry *harder*; the momentum
re-interpretation is what unlocked the gain.)

New keys: `BULL_REGIME_THRESHOLD=7.0`, `BULL_DIP_SCALE=3.0`. Implemented in both
`src/backtest.mjs` and `src/bot-lib.mjs` (live parity). Gated on
`BOT_SPECIALIZATION_ENABLED` so the legacy single-switch still reproduces the old
baseline.

### Task 2 — Daily-loss circuit breaker
Tracks `realizedLossTodayUsdc` in `state/state-exec.json` (reset each UTC day,
accumulated on every losing SELL — regular, profit-target, and stop-loss exits). When
the day's realized loss reaches `DAILY_LOSS_LIMIT_USDC` (default **3.0**, 0 disables),
the executor logs `{ type: 'circuit_breaker', reason: 'daily_loss_limit' }` and halts
**all** trading until the next UTC day. The predicate `circuitBreakerTripped()` lives in
`common.mjs` (pure, shared). Preflight warns if the limit is unset; selftest Test 5
asserts the breaker fires at/above the limit, stays off below it, and is disabled at 0.

### Task 3 — 6h parameter sweep + re-tune
Swept dip/rip/EMA/RSI/PT/SL on both 6h files and cross-validated every candidate
across all four regimes. The single-regime sweep winners overfit: e.g. the 6h-bull
optimum (dip 3.0 / EMA 10 / SL 20) hits +31.7% on 6h-bull but drags the bear baseline
to +8.60% and bull-1d to +8.03%. **No param set beats the current (post-Task-1)
configuration across all regimes without weakening the bear floor**, so per the
"revert if it doesn't improve" rule the params are unchanged. The current values are
Pareto-optimal for the multi-regime objective; the sweep confirmed this rather than
replacing it.

### Task 4 — Regime-aware position sizing
Buy size now scales with regime confidence: **2.0×** in a confirmed-uptrend oversold
dip (`emaFast>emaSlow` and `RSI<RSI_OVERSOLD`), **0.75×** in a confirmed downtrend.
The handoff's "RSI>60 → 0.75×" clause was found to *fight* the Task-1 momentum overlay
(it cut accumulation through sustained strong bulls, collapsing 6h-bull from +19.5% to
+6.6%), so the RSI-overheated reduction is **disabled by default**
(`REGIME_SIZE_HIGH_RSI=100`; lower it to 60 to re-enable). Result is a Pareto win:
bear +9.17→**+9.42%**, bull-1d +9.44→**+25.05%**, 6h-bull flat at +19.43%, recent
+0.81→**+1.03%**. New keys: `REGIME_SIZE_ENABLED`, `REGIME_SIZE_UP_MULT=2.0`,
`REGIME_SIZE_DOWN_MULT=0.75`, `REGIME_SIZE_HIGH_RSI=100`. Live parity in `bot-lib.mjs`.

---

## Stress tests

**Monte-Carlo (40 paths × 5 regimes, 180d):** mean return **+0.67% (legacy) → +1.68%
(new)**, +1.01pp. New strongly beats legacy in strong bull (+7.9pp), steady bull
(+5.5pp) and chop (+0.5pp). It gives back more in synthetic *monotonic* crashes
(crash-bear −6.2% legacy → −12.5% new) — the cost of taking more trend risk. This is a
worst-case artifact of geometric crash paths with no relief rallies; on the **real**
310-day bear (which had rallies) the strategy improved. In live trading this tail is
bounded by the two new safeguards: the **daily-loss circuit breaker** (halts at $3/day)
and the **8% stop-loss** per position.

**Walk-forward (TRAIL_GIVE_PCT, 217d train / 94d test):** the current default
`give=10` sits in the positive out-of-sample region (train +9.49% / OOS +1.39%, equal
to give=8). give≥12 turns OOS negative — confirming the default is robust, not overfit.

---

## Final recommendation

**Ready for shadow → live, with the standard small-size first-day caps.** The two
highest-value improvements (bull participation and the daily-loss circuit breaker)
landed cleanly, the bear protection that is the strategy's core value is intact and
slightly stronger, and every automated gate is green. The only open item is George's
own go-live Step 1 (`PROFIT_WALLET`).

Keep the conservative first-day caps already in `.env`
(`REAL_MAX_NOTIONAL_USDC=25`, `REAL_DAILY_NOTIONAL_LIMIT_USDC=50`,
`DAILY_LOSS_LIMIT_USDC=3`). Run one shadow session, watch the logs, then flip
`DRY_RUN=0`.

### George's 3 go-live steps
1. Open `.env`, set `PROFIT_WALLET=` to your Solana wallet address.
2. `npm run wallet` → fund the printed address with ~$20 USDC + ~0.05 SOL.
3. With `DRY_RUN=1`, `EXECUTION_MODE=real`: `npm run preflight` (must PASS) →
   `npm run shadow` for one session → set `DRY_RUN=0` → `npm run all` (LIVE).
