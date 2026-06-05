# Handoff — Solana Bot, Sonnet Session 2
# Goal: keep it in tip-top shape, finish go-live readiness, and run the daily self-improvement loop.

**Opener for the next session:**
*"Read HANDOFF-SONNET2.md in my solana-bot folder. Confirm tests + preflight are green,
then work the BACKLOG top to bottom — but stop and ask before anything that trades, moves
funds, or changes EXECUTION_MODE/DRY_RUN. Be token-efficient: batch shell commands, edit
src/*.mjs from the shell (not the Edit tool — the mount truncates them), node --check after
every edit, and report only results."*

Repo: `C:\Users\lovel\Desktop\solana-bot` — Node ESM (node 22), everything validated in simulation.

---

## CRITICAL ENVIRONMENT RULES (read first — these have bitten us)
1. **The Windows↔Linux mount truncates `src/*.mjs` written by the Edit/Write tools.**
   Always edit source from the shell (python/sed/cat heredoc). Run `node --check <file>` after
   EVERY edit. If a file truncates, restore from git (`git show HEAD:<path>`) and re-apply via shell.
2. **Git commits fail in the Cowork sandbox** (it can't unlink `.git/*.lock`). All file changes
   save to disk fine; George commits from his own machine (Claude Code). See "Pending commit".
3. Never run the live bot from the sandbox — it can't hold long processes. Live runs happen in
   George's terminal.

## CURRENT STATE (proven — do not redo)
Backtests (real Binance data, simulated fills): bear 1d **+9.42%**, bull 1d **+25.05%**,
bull 6h **+19.43%**, recent 6h **+1.03%**, full-cycle 1d **+7.30%** (maxDD 10.95%).
Tests: `npm run test:all` => **11 unit + 10 selftest, all green**. `DRY_RUN=1 npm run preflight`
=> **10/10 PASS** (PROFIT_WALLET is set). `.env` is at the safe `DRY_RUN=1`.
Reality check: walk-forward OOS is ~+1.4%, far below in-sample — expect modest live results.
This is a defensive bear/chop bot; it sits out bull runs by design.

What shipped across Opus-2 + this session:
- Bull-regime overlay (momentum accumulation when regimeStrength > BULL_REGIME_THRESHOLD=7).
- Daily-loss circuit breaker (DAILY_LOSS_LIMIT_USDC=3) — and the real-mode realized-PnL fix that
  makes it actually fire live (executor.mjs + portfolio.mjs).
- Regime-aware position sizing (REGIME_SIZE_UP_MULT=2.0 in uptrend dips, 0.75 in downtrends).
- Cross-platform `npm run shadow` (uses `--shadow` flag; the old `SHADOW_MODE=1 node` broke in
  PowerShell). Unit tests (src/unit.mjs) + GitHub Actions CI (.github/workflows/ci.yml).
- Daily self-audit loop (src/self-audit.mjs) + scheduled task `solana-bot-daily-self-audit`.

## PENDING COMMIT (George runs this once, in Claude Code / PowerShell)
```
Remove-Item .git\index.lock,.git\HEAD.lock -ErrorAction SilentlyContinue
git add -A
git commit -m "Real-mode PnL fix, daily self-audit loop, cross-platform shadow, unit tests + CI"
```
(The sandbox left the git index half-staged; `git add -A` re-stages the true working tree.)

## ARCHITECTURE MAP (only the files you'll touch)
- `src/common.mjs` — config (CFG), env loading, validateConfig, circuitBreakerTripped.
- `src/backtest.mjs` — backtester + botTick signal logic + sweep. Source of truth for strategy.
- `src/bot-lib.mjs` — LIVE tick logic; must stay in parity with backtest.mjs botTick.
- `src/executor.mjs` — live executor loop, cooldowns, circuit breaker, PT/SL.
- `src/portfolio.mjs` — sim + real trade execution, realized PnL.
- `src/self-audit.mjs` — daily self-improvement + health loop.
- `src/selftest.mjs` (regression) / `src/unit.mjs` (unit). Run both: `npm run test:all`.

## HARD GUARDRAILS (never violate)
- Bear baseline (`backtest/data/sol-usd-1d.json`) must stay **>= 8.5%**; selftest enforces **>= 9.0%**.
- Never place a trade, move/sweep funds, or change EXECUTION_MODE / DRY_RUN without George's OK.
- Never raise REAL_MAX_NOTIONAL_USDC > 100 or MAX_SOL_ALLOCATION_PCT > 0.60.
- Any strategy edit must keep backtest.mjs and bot-lib.mjs in parity, and keep `npm test` green.
- Keep edits minimal and reversible. If a change doesn't improve numbers, revert and document why.

## THE DAILY SELF-IMPROVEMENT LOOP
`node src/self-audit.mjs` (scheduled ~8am daily). Each run: refreshes data, grid-searches the
SAFE knobs (BULL_REGIME_THRESHOLD, REGIME_SIZE_UP_MULT, REGIME_SIZE_DOWN_MULT — all gated on bot
specialization so they never disturb the proven core or the legacy regression test), runs the
regression suite, and scans 24h of logs. It auto-applies a change ONLY if bear >= 9.0%, mean
upside +>= 0.5pp, `npm test` green, AND the bot is not live; otherwise it recommends. Writes
`logs/self-audit/<date>.md` and appends `TUNING-LOG.md`. Flags: `--report-only`, `--no-fetch`.
To extend it safely: add knobs to the `grid` object, keep the bear-floor + tests-green gates,
and only tune things that don't change the legacy selftest (i.e., specialization-gated knobs).

## BACKLOG (work top to bottom; each must keep tests green + bear >= 9.0%, ask before live)
1. **Paid RPC endpoint** (Helius/Triton/QuickNode) — #1 reliability fix; public RPC is rate-limited
   and will throw errors live. Swap `RPC_URL` in `.env`. No code change.
2. **Jupiter slippage + priority-fee guard** in `src/jupiter-swap.mjs` — cap max slippage, set a
   priority fee, so live fills don't silently eat the thin edge. Log realized slippage vs the 8bps
   backtest assumption.
3. **Shadow session then ONE tiny live trade**, watched — the only real validation. `npm run shadow`
   first (DRY_RUN=1), review `logs/shadow.jsonl`, then George flips DRY_RUN=0 for a single small trade.
4. **Reconciliation cron** — run `npm run reconcile` before/after live sessions so portfolio.json
   can't drift from on-chain reality. Consider a scheduled task.
5. **Alert webhook** (ALERT_WEBHOOK_URL) so trades/errors/breaker trips notify George.
6. **Expand backtest data** with the newest candles each week (the self-audit already refreshes;
   widen the Monte-Carlo regime set in backtest/montecarlo.mjs for more honest stress tests).

## LESSONS LEARNED (so we don't repeat them)
- Edit/Write on `src/*.mjs` => truncation. Use the shell. (Cost us a corrupted portfolio.mjs once.)
- The bull "improvement" only worked when re-interpreted as **momentum re-entry**, not the literal
  "multiply dip x3" — widening the dip makes re-entry HARDER in a relentless uptrend (anchor deadlock).
- The handoff's "RSI>60 => 0.75x" sizing rule FOUGHT the momentum overlay (cut accumulation through
  strong bulls); it's disabled by default (REGIME_SIZE_HIGH_RSI=100). Don't re-enable blindly.
- Real-mode realized PnL was never tracked => the circuit breaker was blind live. Fixed; if you touch
  `executeRealTrade`, keep returning `realizedPnlUsdc`.
- In-sample sweeps overfit single regimes. Always cross-validate a candidate across ALL datasets and
  protect the bear floor before adopting anything.

## DEFINITION OF DONE for the next session
Tests green, preflight 10/10, pending commit landed, and at least the top 1–2 backlog items done
(paid RPC + slippage guard) with before/after notes. Then George runs the shadow→tiny-live sequence.

## SELF-PROMPTING LOOP (you and the daily task both use this)
`SELF-PROMPT.md` is a versioned, self-authored directive. At the START of a work session READ it —
its "Focus for the next run" and "Running lessons" are notes from the previous session; honor them
and avoid the listed dead ends. At the END of a session REWRITE it: check off completed backlog
items, set the next focus, and APPEND any new dated lesson (never delete old lessons — it's our
long-term memory). Commit it. The daily scheduled task does this automatically; interactive Sonnet
sessions should do it too. This is how we "prompt ourselves" and compound learning across days.
