# Handoff — Solana Bot, Opus Session 5 -> next run
# Status: Wealth-V2 verified + parity-clean. Wealth-V3 (cap 5->8) + Wealth-V4 (regime-gated bull cap=25) shipped.
# Next: shadow-validate, then ONE tiny live trade (ask George first). Never flip DRY_RUN yourself.

---

## CRITICAL ENVIRONMENT RULES (read first)
1. **Edit `src/*.mjs` from the shell only** (sed/heredoc). The Edit/Write tools truncate on this
   Windows<->Linux mount. Run `node --check <file>` after EVERY src edit.
2. **`.env` parser does NOT strip inline comments.** `KEY=25  # note` throws "Invalid number".
   Keep every `.env` value bare; comments on their own lines.
3. **`.env` is NOT in git.** Read before any change; change single lines with `sed -i` (never rewrite
   the whole file). `.env.example` IS tracked — mirror durable config there.
4. **Git commits fail in the Cowork sandbox** (.git lock). George commits from his machine.
5. **ONE canonical path:** `C:\Users\lovel\Claude\Projects\Solana Bot` (the Cowork mount) is the SINGLE
   working copy. The old Desktop clone has been retired. See CLAUDE.md. Commit happens here; George pushes.

---

## CURRENT STATE (validated this session; NOT yet committed)
Tests: `npm run test:all` -> **10 passed, 0 failed**.

| Dataset | File | Bot | Orig handoff | After V3 | After V4 (now) |
|---------|------|-----|------|------|------|
| 1d bear (310d) | sol-usd-1d.json | floor >= 9.0 | +9.53% | +9.53% | **+9.53%** (UNCHANGED) |
| 1d bull (183d) | sol-usd-1d-bull.json | | +67.09% | +113.94% | **+121.43%** |
| 1d 5yr | sol-usd-1d-5yr.json | | +122.64% | +140.27% | **+222.30%** |
| 1d full-cycle | sol-usd-1d-full.json | | +40.01% | +92.81% | **+239.26%** |
| 1h 540d (live-like) | sol-usd-1h-540d.json | beats hold +38pp | -11.64% | -11.64% | **-11.64%** (UNCHANGED) |
| 15m 60d | sol-usd-15m-60d.json | | +0.83% | +0.83% | **+0.83%** (UNCHANGED) |
| 5m 30d | sol-usd-5m-30d.json | | -3.27% | -3.27% | **-3.27%** (UNCHANGED) |

Uncommitted changes this run:
- `src/common.mjs` — new config knob `bullMaxNotionalUsdc` (BULL_MAX_NOTIONAL_USDC, default 8).
- `src/backtest.mjs` — `cfgToParms` maps the knob; trade block uses a regime-gated effective cap.
- `src/executor.mjs` — non-real path uses the gated cap; REAL mode untouched (hard cap stays).
- `.env.example` — MAX_NOTIONAL_USDC 5->8 (V3) and BULL_MAX_NOTIONAL_USDC=25 (V4).
- `SELF-PROMPT.md`, `HANDOFF-OPUS4.md`.
- `.env` locally (not tracked): MAX_NOTIONAL_USDC=8, BULL_MAX_NOTIONAL_USDC=25.
NOTE: the prior Wealth-V2 `src/*.mjs` edits were ALSO still uncommitted before this run — they
were audited (parity-clean) and are part of the same uncommitted set. `bot-lib.mjs` was NOT
changed for V4 (it emits the proportional buy amount; the cap is enforced downstream in executor).

---

## WHAT HAPPENED THIS SESSION

### 1. Verified the Wealth-V2 baseline — all green, all matched the prior handoff.
bear +9.53, bull +67.09, 5yr +122.64, tests 10/10.

### 2. Audited Option C parity across the 3 strategy files — CLEAN.
`backtest.mjs` (source of truth), `bot-lib.mjs` (live signal), `executor.mjs` (live trailing exit)
all use the identical regime-strength formula `(emaFast-emaSlow)/emaSlow*100`, the identical gate
`>= bullStrongRegimePct`, identical `effTrailGive = strongBull ? max(trailGive, bullTrailGive) :
trailGive`, identical `holdFloor`, and identical `lastBuyAmountSol = amount/price` recorded on BUY.
Nothing to fix.

### 3. Re-grid-searched the gate + trail, re-tested Options A & B (daily + 1h + 15m).
- Bear cliff confirmed at **gate 7.5** (gate 7 -> 7.64; gate 7.5/8/10 -> 9.53). trail=25 is the peak.
- Gate 8/25 adds only ~1pp on daily and is IDENTICAL on 1h/15m -> not worth the smaller bear buffer.
  **Kept gate 10 / trail 25.**
- Option A (proportional sells): bit-identical to baseline on every dataset. OFF.
- Option B (min SOL hold): monotonically shaves bull/5yr. OFF.

### 4. WEALTH-V3 (the new win): per-trade cap MAX_NOTIONAL_USDC 5 -> 8.
The `.env` cap was 5 (dialed down from an earlier 75). It was the binding constraint on daily bull
deployment. Swept across ALL 7 datasets:
- Raising 5 -> 8 lifts bull 67->114%, 5yr 123->140%, full-cycle 40->93%.
- bear, 1h, 15m, 5m are **bit-unchanged**. => Pareto improvement (better-or-equal everywhere).
- Plateau holds 8..10; **bear floor breaks at 11** (8.98%). Chose **8** for max margin from the cliff.
- trailArmPct / bullBuyPctOfUsdc / profitTargetPct / stopLossPct were all flat or worse — confirms
  the daily-bull bottleneck was the notional cap, nothing else.

### 5. WEALTH-V4 (this run's big win): regime-gated per-trade notional cap.
New knob `BULL_MAX_NOTIONAL_USDC` widens the per-trade cap ONLY when `regimeStrength >=
BULL_STRONG_REGIME_PCT` (the same gate as Option C) — and ONLY in sim/dry/shadow mode. REAL
execution is never widened (still hard-capped at `realMaxNotionalUsdc`, validated <= 100).
- Parity: `backtest.mjs` (trade block, line ~391) and `executor.mjs` (non-real path, line ~281)
  both compute `regimeStrength = (emaFast-emaSlow)/emaSlow*100` and use
  `effMax = strongBull ? max(maxNotionalUsdc, bullMaxNotionalUsdc) : maxNotionalUsdc`.
  `bot-lib.mjs` unchanged (emits proportional amount; cap is downstream).
- Sonnet ran the full grid across all 7 datasets, cap 8..100: **bear NEVER breaks** (flat 9.53
  the whole way — the bull gate fully isolates bear). Chose **25** on the robust plateau.
- Result: bull +121.43%, 5yr +222.30%, full +239.26%; bear/1h/15m/5m bit-unchanged. Strict
  Pareto win, no regression anywhere.
- Robustness note: the surface is bouncy. `buy_pct=0.20` spikes 5yr to ~308% at cap 30 but its
  neighbors are far lower (overfit-fragile), so we did NOT chase it — kept `BULL_BUY_PCT_OF_USDC`
  at its default 0.15 and changed only the one gated knob. Caps above ~30 do not help further.

### 6. Robustness fix: lock release no longer crashes the loop.
`withLock` in `common.mjs` previously called `fs.rmSync` on the lock file with no error handling.
If unlink throws `EPERM` (seen on this mount; also possible on real Windows via AV / OneDrive sync /
held file handles) it crashed the executor loop and a throw in `finally` masked `fn()`'s result.
Fixed: lock release now swallows unlink errors (stale-detection reclaims the lock later), and a failed
stale-lock removal returns `{locked:false}` (skip the tick) instead of throwing. Healthy machines are
unaffected (rmSync succeeds). This made `npm run smoke` pass; all suites green (unit 11/11, selftest
10/10, preflight 10/10, smoke OK).

### 7. BULLETPROOFING (this run): unified gate + safety tests + OOS validation.
- **Single source of truth:** extracted the cap logic into a pure exported helper
  `effectiveMaxNotionalUsdc({isReal, regimeStrengthPct, cfg})` in `common.mjs`. Both `backtest.mjs`
  and `executor.mjs` now call it, so the sim/live gate can NEVER drift out of parity. Refactor is
  behavior-preserving (bear 9.53 / bull 121.43 / 5yr 222.30 / full 239.26 unchanged).
- **Real-money safety invariant, now permanently tested:** the helper returns `realMaxNotionalUsdc`
  whenever `isReal` — the strong-bull widening can NEVER apply to real execution, for any regime
  strength or any `bullMaxNotionalUsdc`. Locked by Unit 6 (8 assertions) + edge guards. Unit suite
  grew 11 -> 21 tests, all green.
- **Edge cases:** missing/NaN/null regime (e.g. regime.json absent at boot) defaults to the base cap
  (no widen). Empty / 1-candle / malformed backtest data exit cleanly (exit 0, no crash).
- **Anti-overfit (walk-forward):** Sonnet split the 5yr and full datasets into thirds and ran cap 8
  vs 25 on each held-out segment. VERDICT: ROBUST — 25 >= 8 on 9/10 segments (both most-recent OOS
  windows favor 25; one negligible -0.48pp miss on a bearish-within-bull slice from fee drag). Bear
  floor identical at 8 and 25 on every bear segment. The improvement is real, not curve-fit.
- All suites green: unit 21/21, selftest 10/10, preflight 10/10, smoke OK.

### 8. CORRECTNESS / SAFETY FIXES (from a code-review of the 7 ideas)
Evaluated 7 external suggestions; verified each against code+backtests. Implemented the real fixes:
- **#6 hardcoded threshold:** `bot-lib.mjs` + `backtest.mjs` hardcoded `>= 7.0` for the bull
  proportional-buy gate; replaced with configurable `bullRegimeThreshold` (default 7.0 → behavior-
  neutral, verified identical numbers).
- **#4 test/live state isolation (REAL BUG):** `selftest.mjs` wrote `price-cache.json` price=150 into
  the live `state/` dir and it leaked into real signal generation (anchors stuck at 150 vs real ~$63).
  Fixed: `STATE_DIR`/`LOG_DIR` now honor `SOLBOT_STATE_DIR`/`SOLBOT_LOG_DIR`; new `src/_test-env.mjs`
  bootstrap (imported first by selftest/unit) redirects tests to a throwaway temp dir and copies the
  wallet so real-mode config still validates. Proven: tests no longer touch live `state/` (md5 identical).
- **#5 polluted/stale state reset:** cleared the leaked price-150 artifacts (`state-BEAR/BULL.json`,
  `regime.json`, `price-cache.json`) to fresh shapes so EMAs rebuild from real prices; reset stale
  `portfolio.json` (avg $32.88 from March → clean sim baseline) so dry-run stops firing phantom PT
  exits; repaired a **truncated `price-state.json`** (ended mid-value — would've relied on fallback).
- **#3 quote-aware net-edge gate:** the shadow Jupiter quote was fetched but only logged. Now the
  executor computes `netEdgeBps = signalEdge − priceImpactBps` and SKIPS the trade when it falls below
  `MIN_NET_EDGE_BPS` (default 0 = block only negative net edge). Conservative (mis-scaled impact only
  makes it stricter). Enable with `SHADOW_MODE=1` before live. Backtest-neutral.
- **Not adopted (tradeoffs, not bugs):** #1 `BULL_REGIME_THRESHOLD=8` (mixed: full↑ but 5yr↓, overfit-
  smell) — superseded by the gated cap already shipped. #2 `BEAR_RSI_MAX=25` (helps 5m/1m slightly but
  drops daily-bear margin 9.53→9.21 and worsens 1h) — left for a careful floor-protected sweep.
All suites green after fixes: unit 21/21, selftest 10/10, preflight 10/10, smoke OK, backtests
unchanged (bear 9.53 / bull 121.43 / 5yr 222.30 / full 239.26).

---

## IMPORTANT NUANCE FOR GOING LIVE (decide deliberately)
- The backtest + dry-run/shadow path uses `MAX_NOTIONAL_USDC` (now **8**).
- REAL execution uses a SEPARATE cap `REAL_MAX_NOTIONAL_USDC` (**25**), enforced at `executor.mjs:281`
  and hard-capped <= 100 in `common.mjs:167`.
- So the backtest UNDER-models real per-trade size. Before live, decide whether to align them.
  Do NOT raise `REAL_MAX_NOTIONAL_USDC` > 100 or `MAX_SOL_ALLOCATION_PCT` > 0.60.

---

## DEFINITION OF DONE for next run
1. `npm run test:all` green, bear >= 9.0% (non-negotiable).
2. **Shadow session** with `DRY_RUN=1` for several days; inspect `logs/` — confirm trail_exit fires
   wide in strong bull, normal in chop, and the new ~$8 buys look right.
3. Only after shadow looks right: **ask George**, then ONE tiny live trade (`DRY_RUN=0`).
4. Rewrite `SELF-PROMPT.md`, sync Projects->Desktop, give George the commit command.

---

## HARD GUARDRAILS (never violate)
- Bear baseline (`backtest/data/sol-usd-1d.json`) must stay **>= 9.0%**; selftest enforces it.
- Never trade, move/sweep funds, or change `EXECUTION_MODE` / `DRY_RUN` without George's OK.
- Never raise `REAL_MAX_NOTIONAL_USDC` > 100 or `MAX_SOL_ALLOCATION_PCT` > 0.60.
- Any strategy edit keeps `backtest.mjs` <-> `bot-lib.mjs` <-> `executor.mjs` in parity and tests green.
- If a change doesn't help, revert it and document why in `SELF-PROMPT.md`.

---

## COMMIT COMMANDS (George runs from Desktop after syncing Projects->Desktop, or from Projects)
IMPORTANT: the working tree had a CORRUPTED staged state from a prior truncating-mount session
(it staged DELETIONS of src/unit.mjs, wallet.mjs, watch.mjs, ui-server.mjs and a broken
`sweeper.mjs -> sweeper.` rename, though all those files exist and work). Do `git reset` FIRST to
clear it, then add only the intended files. Do NOT `git add -A`.

```powershell
cd C:\Users\lovel\Desktop\solana-bot     # after syncing Projects->Desktop (or run from Projects)
git reset                                   # clear bogus staged deletions/rename (working files untouched)

# 1) Wealth-V2 (was already uncommitted before this session) — the regime-gated wide trailing exit
git add src/common.mjs src/backtest.mjs src/bot-lib.mjs src/executor.mjs
git commit -m "Wealth-V2+V4: regime-gated sell-side (Option C wide trailing) + regime-gated bull notional cap (BULL_MAX_NOTIONAL_USDC). bull->121%, 5yr->222%, full->239%, bear held 9.53%; REAL caps untouched"

# 2) Config knobs (tracked template)
git add .env.example
git commit -m "config: MAX_NOTIONAL_USDC 5->8 (V3) + BULL_MAX_NOTIONAL_USDC=25 gated bull cap (V4)"

# 3) Session docs
git add SELF-PROMPT.md HANDOFF-OPUS4.md
git commit -m "docs: Opus session handoff - Wealth-V2 verified, V3+V4 shipped, proven via full backtest grid"

git push origin master
```
NOTE: `.env` is not tracked; it already has MAX_NOTIONAL_USDC=8 and BULL_MAX_NOTIONAL_USDC=25 locally.
