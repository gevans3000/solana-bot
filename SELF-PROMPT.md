# SELF-PROMPT — self-authored directive for the Solana bot
# Each run READS this at start and REWRITES at end.

## Focus for the next run (do this first)
- **FIRST: verify George restarted the stack via start-shadow.cmd.** Check in order:
  (1) `git log -1` — HEAD must be NEWER than 4f92745 (the auto-commit of the staged batch);
  (2) `.git/*.lock` gone; (3) executor.jsonl current session begins with a `"type":"boot"` line whose
  `commit` matches `git rev-parse --short HEAD`; (4) `tick` lines every ~10s and eventually
  `dry_run_trade` entries. If HEAD is still 4f92745 or no boot line: stack/commit still pending —
  surface as the #1 blocker, do NOT write new code on top of the uncommitted batch.
- Baseline to confirm: `npm run test:all` green (23 unit + 10 selftest), bear >= 9.0% (currently
  9.48% with ENTRY_BOUNCE_CONFIRM=true, REGIME_EMA_SLOW=45, BULL_DIP_PCT=0.8). Proven knobs:
  BULL_REGIME_THRESHOLD=7.0, REGIME_SIZE_UP_MULT=2.0, REGIME_SIZE_DOWN_MULT=0.75.
- Integrity-check edited src files: `node --check src/*.mjs` (loop, not one-liner pipe).
- Do NOT propose DRY_RUN=0 until several days of clean dry_run_trade logs with bounce-confirm active.
- Remaining go-live gaps: (1) paid RPC swap (George/Helius); (2) shadow -> one tiny live trade
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
- 2026-06-10 (SHADOW WAS BLIND — FIXED, commit 4f92745): executor.mjs had an early DRY_RUN return
  BEFORE decision logging, sizing caps and the quote gate — so shadow mode logged only
  'skip: DRY_RUN is on' every tick and NEVER recorded a dry trade. The quote-aware net-edge gate
  (built for shadow validation) had never executed. Removed the early return; the designed dry path
  downstream already handles everything ('dry_run_trade' log, counters skipped, executeRealTrade
  blocks real execution). Shadow runner must be RESTARTED to pick this up. When reviewing shadow
  logs, look for 'dry_run_trade' in executor.jsonl and 'pre_trade' in shadow.jsonl.
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

- 2026-06-11 (EXECUTOR SILENT — PROCESS STOPPED AT MIDNIGHT): Bear/bull bots running today (195 signals, sweeper dry_run_sweep active). But executor.jsonl has ZERO entries for June 11. Last executor entry was 2026-06-10T23:58 ("skip: DRY_RUN is on" — OLD pre-fix code). After the 4f92745 fix, executor should log `tick` on every cycle regardless of trade decision — the silence means the executor PROCESS stopped at midnight and was not restarted with the new shadow session. state-exec.json shows signalIndex=796 (= total signal count), suggesting executor ran once at shadow start, consumed all signals (all stale), then stopped or the process exited. No `dry_run_trade` has EVER been logged. George must restart the full shadow from start-shadow.cmd (all.mjs = bots + executor together).
- 2026-06-11 (BOT CONFLICT ANALYSIS): Of today's 7 BUY signals, BEAR BUYs had 3–5 BULL SELLs in the 180s window (conflict → NO_TRADE). Pure BULL BUY signals had 0 conflicts and would pass decide. The dry-trade absence is executor-process absence, not a logic bug in conflict detection.

- 2026-06-11 (SWEEP WIN — BULL_DIP_PCT 0.8 + REGIME_EMA_SLOW 45): single-knob sweep over 17 knobs,
  then combo grid. Winner improves EVERY dataset: bear 9.36->9.48 (margin UP), 1h-540d -7.74->-7.12
  (+0.63pp), 5m -1.99->-1.08, 1m -1.75->-0.98, 15m ~flat, 5yr 169.8->183.1, full 85.1->94.1,
  bull 94.1->95.2. Plateau smooth in both directions (0.7-0.9 x 42-48 all positive — not a spike).
  Walk-forward thirds: 1h wins ALL 3 segments, bear wins all 3; losses only in noisy daily-candle
  slices + two <0.1pp 5m/15m misses. Applied to .env + .env.example.
- 2026-06-11 (LEGACY TEST PIN, again): the .env change broke selftest Test 1 (legacy baseline drifted
  4.33->3.91) — same env-leak class as 06-10. Pinned regimeEmaSlow:50 + bullDipPct:0.5 in Test 1
  overrides. RULE CONFIRMED: every .env knob change must be pinned in the legacy test the same run.
- 2026-06-11 (ALL.MJS RESTART BUG — ROOT CAUSE of the dead executor): all.mjs only restarted children
  with exit code != 0. The executor exited CLEANLY (code 0) at midnight and stayed dead 12h while
  bots kept running — shadow collected nothing, silently. Fixed: ALWAYS restart (every child is a
  long-lived loop; clean exit is still abnormal). start-shadow.cmd also got a :shadowloop
  auto-restart wrapper. ONE double-click from George and the stack stays up on its own.
- 2026-06-11 (CADENCE): self-audit cron 1x->3x daily (0 8,14,20); new watchdog task
  solana-bot-stack-watchdog 4x daily (30 9,13,17,21) — freshness check + notify, read-only.

- 2026-06-11 evening (STALE-CODE EXECUTOR CONFIRMED + STACK DOWN): executor.jsonl shows 14.5k ticks
  00:00-18:25 all logging "skip: DRY_RUN is on for real execution" — that string does NOT exist in
  HEAD (4f92745 removed the early return) — hard proof the process ran pre-fix code all day. Zero
  dry_run_trade ever logged. ALL processes (bull/bear/executor) stopped at 18:25:11; stack is DOWN.
  Fix shipped: executor now logs a `boot` line at startup with the git commit + pid, so the running
  build is identifiable from the first line of any session's log. George must restart via
  start-shadow.cmd (now self-healing, auto-commits staged work).
- 2026-06-11 evening: morning session's work (REGIME_EMA_SLOW 50->45, BULL_DIP_PCT 0.5->0.8 sweep,
  all.mjs always-restart, self-healing start-shadow.cmd, selftest legacy pins, 6h datasets) was left
  STAGED but uncommitted — .git/index.lock was stale and the sandbox can't unlink it. Worked around
  with `cp .git/index /tmp/idx && GIT_INDEX_FILE=/tmp/idx git add ... && git commit`. LESSON: when
  index.lock blocks staging, the alternate-index path works end-to-end; always finish the commit in
  the same run.
- 2026-06-11 evening audit: NO_CHANGE (intraday +0.00pp), bear 9.48%, tests PASS, 0 errors/breaker
  in 24h (the 2 executor "error" entries are June 5/6 EPERM lock noise, not new).
- 2026-06-11 evening (COMMIT DEFERRED): stale .git/HEAD.lock+index.lock (sandbox cannot unlink)
  blocked even the alternate-index commit. Workaround shipped: start-shadow.cmd now does
  `git add -A` before its auto-commit, so ALL of tonight's work (executor boot log, SELF-PROMPT,
  start-shadow CRLF fix, .gitignore .claude/) commits+pushes the moment George double-clicks it.
  Next run: verify the auto-commit landed (`git log -1`) before doing anything else.

- 2026-06-12 00:10 UTC night audit (= 2026-06-11 8pm run): NO_CHANGE (best candidate intraday
  +0.00pp), bear 9.48%, tests PASS, all src/*.mjs node --check clean. STACK STILL DOWN since
  2026-06-11 18:25 and the staged batch is STILL uncommitted (HEAD=4f92745, stale HEAD.lock +
  index.lock persist — sandbox cannot unlink). Deliberately wrote NO new code: piling more edits on
  an uncommitted batch is how the 06-07 truncation loss happened. Everything resolves with ONE
  George action: double-click start-shadow.cmd (it now does git add -A + auto-commit + push +
  data refresh + self-healing shadow loop).
- 2026-06-12: sandbox note — `nohup cmd &` dies when the bash call returns; `setsid nohup cmd &`
  survives. Needed for any in-sandbox run of self-audit longer than the 45s tool timeout.
