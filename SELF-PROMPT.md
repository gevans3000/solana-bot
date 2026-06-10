# SELF-PROMPT — self-authored directive for the Solana bot
# Each run READS this at start and REWRITES at end.

## Focus for the next run (do this first)
- Confirm `npm run test:all` green (now 23 unit + 10 selftest) and bear >= 9.0% (currently 9.36%
  with ENTRY_BOUNCE_CONFIRM=true). Config PROVEN: BULL_REGIME_THRESHOLD=7.0, REGIME_SIZE_UP_MULT=2.0,
  REGIME_SIZE_DOWN_MULT=0.75.
- **FIRST: integrity-check all edited src files** — `node --check src/*.mjs` (loop, not one-liner pipe).
- **SHADOW SESSION**: Ask George if the shadow runner is up and restart it if it predates 2026-06-10
  (smoke-isolation fix landed — older runs may have read a leaked mock price from price-cache.json).
  Do NOT propose DRY_RUN=0 until several days of clean dry trades exist with bounce-confirm active.
- **Daily reconcile cron is live** (`solana-bot-daily-reconcile`, 8:30am, after the 8am self-audit).
  It can't reach mainnet RPC from the sandbox — George verifies with `npm run reconcile` from a
  normal terminal. Once on Helius RPC, re-test.
- Remaining go-live gaps: (1) paid RPC swap (George/Helius); (2) shadow → one tiny live trade
  (George's explicit OK required, DRY_RUN stays 1 until then).

## Running lessons (append; never delete)
- 2026-06-05: Edit/Write tool truncates src/*.mjs on this mount — always edit from shell + node --check.
- 2026-06-05: Bull gains came from MOMENTUM re-entry, not widening the dip (anchor deadlock).
- 2026-06-05: "RSI>60 => smaller buys" fought the momentum overlay; kept disabled (REGIME_SIZE_HIGH_RSI=100).
- 2026-06-05: Real-mode realized PnL was untracked => circuit breaker was blind live. Fixed.
- 2026-06-05: In-sample sweeps overfit; always cross-validate across ALL datasets + protect bear floor.
- 2026-06-05: .env is NOT in git — never open with python open(path,'w') before reading; append (>>) only.
- 2026-06-05: Cowork connects to C:\Users\lovel\Claude\Projects\Solana Bot. Canonical git at Desktop\solana-bot.
- 2026-06-05: Daily-candle backtest is misleading for live (runs every 10s). 1h result is honest live expectation.
- 2026-06-05: Proportional buying without proportional selling stranded inventory. ROOT CAUSE was the
  trailing exit liquidating the WHOLE position on every 10% give-back, ending bull runs ~all in USDC.
- 2026-06-05: sol-usd-1d-bull.json is an optimistic target, but the fix below lifted it honestly.
- 2026-06-06 (Wealth-V2 FIX): The real sell-side lever was the trailing give-back, not the 0.01 rip size.
  Option C — widen TRAIL_GIVE_PCT to 25% ONLY when regimeStrength >= BULL_STRONG_REGIME_PCT — took
  pure-bull 20.36% -> 67.09% and 5yr 26.64% -> 122.64% with bear UNCHANGED at 9.53%.
- 2026-06-06: GATE THRESHOLD IS CRITICAL. At gate 7% (handoff's suggestion) bear collapsed to 7.64%
  because bear relief rallies hit regimeStrength 7-10%. Grid search => gate 10% is the safe floor:
  bear stays exactly at baseline (wider trail never fires in the bear set). Always grid-search the gate.
- 2026-06-06: Option B (core SOL hold) MONOTONICALLY reduced bull & 5yr for every hold 0.1-0.4 — the
  wide trail already captures the upside, so a forced hold just leaves SOL exposed to the next dip. OFF.
- 2026-06-06: Option A (proportional rip sells) was NEUTRAL on daily data — in strong bull the bot is
  in accumulate mode (dip gate disabled) so rip-sells barely fire. Kept gated + OFF for now.

- 2026-06-06: self-audit.mjs crashed before writing any report — fs.rmSync(backup) throws EPERM
  because the sandbox cannot unlink on the Projects mount (same class as the git lock-file limit).
  Fix: wrapped both `fs.rmSync(backup, {force:true})` calls in try/catch; added `.env.audit-bak`
  to .gitignore. The daily loop now runs end-to-end. Leftover .env.audit-bak is harmless.
- 2026-06-06 (OVERFIT CAUGHT): mechanical auto-apply proposed BULL_REGIME_THRESHOLD=8 /
  REGIME_SIZE_UP_MULT=3 / REGIME_SIZE_DOWN_MULT=0.5 for +12.03pp MEAN upside — but the gain was
  ~entirely 1d-full (+132pp daily candle). EVERY honest/intraday set regressed: 1h-540d -11.64→-11.98,
  1m-7d -2.71→-3.16, 5m-30d -3.27→-3.65, 15m-60d 0.83→0.60, 1d-5yr 222.30→211.54. Reverted to proven
  7.0/2.0/0.75; tests green. LESSON: the mean-upside gate is blind to daily-candle dominance — judge
  APPLY by the 1h/intraday sets, not the mean. (Backlog: harden the gate to require no 1h-540d regress.)

- 2026-06-07 (TRUNCATION RECOVERED): src/self-audit.mjs was truncated to 192 lines — cut off mid
  report-writing tail (`const dpp = bes`) — so the daily loop crashed with "Unexpected end of input"
  before writing any report. Root cause: yesterday's intraday-gate edit was left UNSTAGED and the
  working copy got truncated by the Edit-tool mount hazard; the STAGED blob was the OLDER overall-mean
  gate. Recovered by keeping the (correct, newer) working-copy head [lines 1-192, which HAD the 3-layer
  intraday gate] and re-appending the report tail from shell + node --check. LESSON: after editing any
  src/*.mjs, run node --check AND `git add` it the SAME run — never leave a truncated unstaged file
  overnight, or a real improvement silently disappears.
- 2026-06-07 (GATE VALIDATED IN PROD): the mechanical sweep AGAIN proposed th=8/up=2/dn=0.5 for
  +11.89pp OVERALL mean — but intraday delta was +0.00pp (pure daily-candle: 1d-full 239->370). The
  3-layer gate correctly returned NO_CHANGE. The hardening works exactly as intended.
- 2026-06-07: fixed the misleading NO_CHANGE detail string — it reported the overall delta
  ("+11.89pp < 0.5pp", nonsensical) when the gate actually decides on the intraday delta. Now reports
  "intraday +0.00pp < 0.5pp threshold (overall +11.89pp is daily-candle-driven, not actionable)".
- 2026-06-07: data refresh failed in-sandbox (Yahoo/undici network error) — backtests ran on cached
  data. Transient sandbox-network issue, NOT an RPC/UNCONFIRMED problem. Results still valid vs cache.

- 2026-06-07 (ENTRY_BOUNCE_CONFIRM): Added one-bar bounce confirmation to entry logic. Buy only fires
  when current candle close > previous close (price recovering, not still falling). Result on 1h-540d
  honest set: trades 119→72, win rate 47%→66%, return -11.64%→-7.74% (+3.90pp). Bear floor 9.36% (OK).
  All 21+10 tests green. ENTRY_BOUNCE_CONFIRM=true set in .env. Flag is gated (default false in code).
- 2026-06-07 (BACKTEST TRADE COUNTS): 1d bear: 29 trades/310d (0.09/day, 90% win). 1h-540d: 119 trades
  (0.22/day, 47% win). The bot beats hold on every dataset (vs-hold all strongly positive) — negative
  absolute returns reflect SOL being down/choppy in those windows, not bot failure.
- 2026-06-07 (IMPROVEMENT BACKLOG): Ranked: #1 paid RPC (George doing Helius), #2 bounce confirm (DONE),
  #3 regime detection improvement, #4 asymmetric position sizing, #5 more backtest history.

- 2026-06-10 (CODEX FIXES LANDED): P1 — best candidate is now picked by intradayMean inside the
  grid loop (was meanUpside; a daily-candle-heavy winner could shadow a valid intraday candidate).
  P2 — self-audit aborts if sol-usd-1h-540d.json is absent (the `?? 0` guards failed-open when both
  sides defaulted to 0). Verified live: report now shows the true intraday delta (+0.11pp).
- 2026-06-10 (ENV LEAK INTO LEGACY TEST): selftest Test 1 "legacy mode" builds params from live CFG
  and only overrides the flags it knows about — when ENTRY_BOUNCE_CONFIRM=true landed in .env
  (06-07, after that day's test run), legacy baseline drifted 4.33%->6.00% and the suite went red.
  Fix: entryBounceConfirm:false added to Test 1 overrides. LESSON: every new gated flag flipped on
  in .env MUST also be explicitly disabled in the legacy-mode test the same day.
- 2026-06-10: data refresh failed in-sandbox again (Yahoo/undici network) — backtests ran on cached
  data; results valid vs cache. Recurring sandbox limitation, not an RPC problem.
- 2026-06-10: 0 dry trades / 0 errors / 0 breaker in 24h — shadow session is NOT running. Surfaced
  to George; bounce-confirm has no dry-run evidence yet.

- 2026-06-10 (HARDENING SESSION): Codex P1/P2 fixed & committed — self-audit best-pick now by
  intradayMean (P1) and aborts if sol-usd-1h-540d.json missing (P2, was fail-open). Today's audit
  ran clean: NO_CHANGE, gate held.
- 2026-06-10 (SMOKE LEAK BUG): smoke.mjs ran bot ticks with PRICE_MODE=mock but WITHOUT
  SOLBOT_STATE_DIR isolation — a fake ~$65 price was written into live state/price-cache.json
  (TTL=loopSec, so window is seconds, but a concurrently-running shadow tick could consume it).
  Fixed: smoke now uses a temp state/log dir like _test-env.mjs. Restart any long-lived shadow
  session started before this fix.
- 2026-06-10 (FAIL-CLOSED PORTFOLIO): loadPortfolio silently reset to sim-start values if
  portfolio.json existed but was corrupt — live, that wipes realizedPnlUsdc and blinds the
  circuit breaker. Now throws when EXECUTION_MODE=real && !DRY_RUN; falls back otherwise.
  Unit-tested (23/23).
- 2026-06-10 (A/B INTRADAY VERDICT): Option A (BULL_PROPORTIONAL_SELLS) is exactly neutral on every
  intraday set and costs -13.3pp on 1d-5yr. Option B (BULL_MIN_SOL_HOLD 0.05/0.1/0.2) is neutral
  intraday and monotonically hurts all daily sets. BOTH STAY OFF — backlog item closed, no further
  validation needed.
- 2026-06-10 (RECONCILE): reconcile.mjs upgraded — logs/reconcile.log, sendAlert + exit 2 on
  MISMATCH only when actually live (real && !DRY_RUN), informational otherwise (dry-run trades
  never touch the tracked portfolio, so shadow can't false-alarm). Scheduled daily 8:30am.
- 2026-06-10: mv/rename of data files on this mount fails like unlink (EPERM) — cannot simulate
  missing-file scenarios in place; test such guards by code review or in /tmp copies.
- 2026-06-10 (TRAIL SWEEP — REJECTED): BULL_TRAIL_GIVE_PCT grid 20/25/30/35: 35 shows 1d-full
  +232pp (85->317) but EVERY intraday set delta ~0.00 — textbook daily-candle dominance, same
  pattern the 3-layer gate rejects. 20 and 30 are strictly worse. KEEPING 25. Revisit 35 only
  when intraday data covering a real bull regime exists (current 1h/15m/5m sets are all bear/chop).
- 2026-06-10: shadow runner DOWN since 2026-06-07 14:54 (no shadow data for 3 days). Jupiter price
  API + Binance + mainnet RPC all unreachable from the sandbox — shadow/data-refresh MUST run on
  George's machine. Created start-shadow.cmd (repo root): one double-click = clear locks, commit,
  push, refresh data, start shadow.
- 2026-06-10: current backtest set (bounce-confirm on): bear 9.36, 1h-540d -7.74 (+42pp vs hold),
  5yr 169.83, 1d-bull 94.12, 1d-full 85.15, 15m 0.96, 5m -1.99, 1m-7d -1.75.

## Backlog progress
- [x] 1. Paid RPC endpoint — documented in .env (Helius/QuickNode/Triton); George swaps when ready
- [x] 2. Jupiter max-slippage + priority-fee guard — wired in jupiter-swap.mjs + .env
- [x] 5. Alert webhook — circuit-breaker alert + Discord instructions in .env
- [x] DATA: multi-timeframe data (1d-5yr, 1h-540d, 15m-60d, 5m-30d, 1m-7d) via Yahoo Finance
- [x] WEALTH-V1: Proportional buy sizing in confirmed bull regime (BULL_BUY_PCT_OF_USDC=0.15)
- [x] WEALTH-V2: Sell-side fixed. Option C (regime-gated wide trailing) ACTIVE; A & B implemented + OFF.
      Results: bear +9.53%, bull183d +67.09%, 5yr +122.64%, 1h-540d +38pp vs hold. Targets all met.
- [ ] 3. Shadow session -> one tiny live trade (ask George before DRY_RUN=0)
- [x] 4. Reconciliation cron scheduled task — solana-bot-daily-reconcile, 8:30am daily
- [x] A/B-LIVE: validated on 1h/15m/5m/1m — both neutral intraday, A costs -13pp on 5yr; CLOSED, stay OFF
- [x] GATE-HARDEN: 3-layer gate — 1h-540d no-regress (loop-level), intraday mean no-regress, candidateBetter uses intraday improvement not overall mean
- [x] AUDIT-FIX: self-audit.mjs no longer crashes on the mount (rmSync EPERM wrapped); loop runs clean
- [x] CODEX-FIX (2026-06-10): P1 best-by-intradayMean in-loop; P2 abort when 1h-540d dataset missing
- [x] TEST-FIX (2026-06-10): legacy-mode selftest now disables entryBounceConfirm (env-leak regression)

- 2026-06-07: Codex caught that the 1h-540d guard was post-loop (best already chosen by mean-upside). Fixed to filter inside loop. Then found the overall-mean gate still let daily-candle-dominated candidates through (th=8/up=2/dn=0.5 +11.89pp overall, Δ0.00pp intraday). Fix: candidateBetter now requires intraday mean improvement >= MIN_GAIN_PP. The self-audit gate now has 3 layers and is daily-candle-proof.

## How to rewrite this file at the end of a run
Keep sections. Check off completed items, set next focus, append lessons. Never trade/move funds/change
EXECUTION_MODE or DRY_RUN without George's approval. Keep changes reversible, tests green, bear >= 9.0%.
                                                                                                                                                                                                                                                                                                                                                                                                                                      