# Handoff — Solana Bot, Opus Session 4 → next run
# Status: Wealth-V2 sell-side fix SHIPPED. Bot now grows in bull/full-cycle and preserves capital in bear.
# Next: shadow-validate, then ONE tiny live trade (ask George first). Never flip DRY_RUN yourself.

---

## CRITICAL ENVIRONMENT RULES (read first — these have bitten us)
1. **Edit `src/*.mjs` from the shell only** (python/sed/cat heredoc). The Edit/Write tools truncate on this Windows↔Linux mount. Run `node --check <file>` after EVERY edit.
2. **`.env` parser does NOT strip inline comments.** A line like `KEY=25  # note` throws "Invalid number". Keep every `.env` value bare (`KEY=25`); put comments on their own lines. (This bit us this session.)
3. **`.env` is NOT in git** — never rewrite it with `open(path,'w')`. Append (`>>`) only; read before any change.
4. **Git commits fail in the Cowork sandbox** (can't unlink `.git/*.lock`). George commits from his machine.
5. **Two folder paths**: `C:\Users\lovel\Desktop\solana-bot` = canonical git repo. `C:\Users\lovel\Claude\Projects\Solana Bot` = Cowork auto-connect copy (this is what mounts in-session; edits land here). Sync Projects→Desktop before committing, or commit straight from Projects.

---

## CURRENT STATE (validated this session; NOT yet committed)
Tests: `npm run test:all` → **10 selftest + unit, all green**.

| Dataset | SOL move | Bot | Hold | vs Hold | Status |
|---------|----------|-----|------|---------|--------|
| 1d bear (310d) | -55.8% | **+9.53%** | -36.3% | +45.9pp | floor ≥9.0 ✅ |
| 1d bull (183d) | +705% | **+67.09%** | +136% | -68.8pp | target ≥60 ✅ |
| 1d 5yr | +52.4% | **+122.64%** | +15.6% | +107.6pp | target ≥30 ✅ |
| 1h 540d (live-like bear) | -71.7% | — | -49.9% | **+38.2pp** | maintain ≥30 ✅ |
| 15m 60d | -19.3% | — | -8.6% | +9.4pp | ✅ |
| 5m 30d | -27.7% | — | -13.1% | +9.8pp | ✅ |

Uncommitted changes: `src/common.mjs`, `src/backtest.mjs`, `src/bot-lib.mjs`, `src/executor.mjs`, `.env.example`, `SELF-PROMPT.md` (+ `.env` locally, not tracked).

---

## WHAT SHIPPED THIS SESSION (Wealth-V2)

### Root cause (was misdiagnosed in earlier handoffs)
The inventory trap was NOT the 0.01 rip-sell. It was the **regime-conditional trailing exit** (in `backtest.mjs` PT block / `executor.mjs`) selling the **WHOLE** position on every 10% give-back. In a 705% bull, each pullback liquidated everything to USDC — the bull test literally ended holding 0.02 SOL.

### Option C — wider trailing in strong bull (ACTIVE, the whole win)
In a strong confirmed bull (`regimeStrength >= BULL_STRONG_REGIME_PCT`), use `BULL_TRAIL_GIVE_PCT` (25%) instead of `TRAIL_GIVE_PCT` (10%) for the give-back exit. Winners run far longer.
- **Gate threshold is critical.** Handoff suggested 7%; at 7% the BEAR set collapsed to **7.64%** (bear relief rallies hit 7-10% regime strength). Grid search → **gate 10% is the safe floor**: the wider trail never fires in the bear set, so bear stays EXACTLY at baseline (9.53%). Always grid-search a new gate before hardcoding.
- Defaults shipped in `.env`: `BULL_STRONG_REGIME_PCT=10`, `BULL_TRAIL_GIVE_PCT=25`.

### Option B — core SOL hold (IMPLEMENTED, default OFF)
`BULL_MIN_SOL_HOLD` floor kept through the trend (trailing/PT exit won't sell below it in strong bull). Backtest showed it **monotonically reduced** bull & 5yr for every value 0.1-0.4 — the wide trail already captures the upside, so a forced hold just exposes SOL to the next dip. Default `BULL_MIN_SOL_HOLD=0`. Gated code remains for live A/B testing.

### Option A — proportional rip-sells (IMPLEMENTED, default OFF)
`BULL_PROPORTIONAL_SELLS`: BULL rip-sells the SOL amount it last bought (tracked as `lastBuyAmountSol`) instead of fixed `BULL_SELL_SOL`. **Neutral** on daily data (in strong bull the dip gate is disabled → bot is in accumulate mode → rip-sells barely fire). Default OFF. May matter on the higher-frequency live path — validate on 1h/15m first.

All three are parity-matched across `backtest.mjs` (source of truth), `bot-lib.mjs` (live signal), `executor.mjs` (live trailing exit), config in `common.mjs`.

---

## ARCHITECTURE MAP (files you'll touch)

| File | Purpose |
|------|---------|
| `src/common.mjs` | Config (CFG), env loading. New knobs: `bullStrongRegimePct`, `bullTrailGivePct`, `bullMinSolHold`, `bullProportionalSells`. |
| `src/backtest.mjs` | Backtester + `botTick`. Source of truth. PT block (~line 305) holds Option C `effTrailGive` + Option B `holdFloor`; `botTick` SELL branch holds Option A. `cfgToParms` maps the new knobs. |
| `src/bot-lib.mjs` | LIVE tick. Option A parity in the SELL branch; records `state.lastBuyAmountSol` on BUY. |
| `src/executor.mjs` | LIVE trailing exit. Option C `effTrailGive` + Option B `holdFloor` parity in the PT block (~line 150). |
| `backtest/data/` | OHLCV. `node backtest/fetch-yahoo.mjs` to refresh. |

---

## DEFINITION OF DONE for next run
1. `npm run test:all` green, bear ≥ 9.0% (non-negotiable).
2. **Shadow session**: run with `DRY_RUN=1` for several days; inspect `logs/` — confirm live sell sizes/exits match backtest intent (trail_exit firing wide in strong bull, normal in chop).
3. Only after shadow looks right: **ask George**, then ONE tiny live trade (`DRY_RUN=0`). Never flip `DRY_RUN`/`EXECUTION_MODE` without his explicit OK.
4. (Optional) Validate Options A/B on 1h/15m data; enable only if they beat the C-only baseline.
5. Rewrite `SELF-PROMPT.md`, sync to Projects, give George one commit command.

---

## HARD GUARDRAILS (never violate)
- Bear baseline (`backtest/data/sol-usd-1d.json`) must stay **≥ 9.0%**; selftest enforces it.
- Never place a trade, move/sweep funds, or change `EXECUTION_MODE` / `DRY_RUN` without George's OK.
- Never raise `REAL_MAX_NOTIONAL_USDC` > 100 or `MAX_SOL_ALLOCATION_PCT` > 0.60.
- Any strategy edit keeps `backtest.mjs` ↔ `bot-lib.mjs` ↔ `executor.mjs` in parity and `npm test` green.
- If a change doesn't help the numbers, revert it and document why in `SELF-PROMPT.md`.

---

## LESSONS LEARNED (don't repeat)
- The real bull lever was the **trailing give-back width**, not the rip-sell size. Diagnose the dominant exit path before tuning the minor one.
- **Grid-search every regime gate.** Gate 7% broke bear; gate 10% was safe. Small gate changes flip the bear floor.
- Forced core-SOL holds hurt when a wide trail already captures upside — don't stack redundant "hold longer" mechanisms.
- `.env` inline comments break the numeric parser — keep values bare.
- Edit/Write truncates `src/*.mjs` on this mount — shell + `node --check` only.

---

## COMMIT COMMAND (George runs from Desktop after syncing Projects→Desktop)
```powershell
cd C:\Users\lovel\Desktop\solana-bot
git add src/common.mjs src/backtest.mjs src/bot-lib.mjs src/executor.mjs .env.example SELF-PROMPT.md
git commit -m "Wealth-V2: regime-gated wide trailing exit (Option C) - bull 20->67%, 5yr 27->123%, bear held at 9.53%"
git push origin master
```
