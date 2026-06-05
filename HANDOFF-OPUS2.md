# Handoff — Solana Bot, Opus Session 2
# Goal: Improve to maximum capability, then go live

**Opener:** *"Read HANDOFF-OPUS2.md in my solana-bot folder and execute the TASK LIST
top to bottom. Token-efficient: batch shell commands, don't re-read unchanged files,
report only results and final numbers."*

Repo: `C:\Users\lovel\Desktop\solana-bot` — Node ESM, everything validated.

---

## CURRENT STATE (proven, do NOT redo)

**Validated numbers on real Binance data:**
- Bear 310d: **+9.29%** vs SOL -55.8%, maxDD 10.48%, win 79%
- Bull 183d: **+5.6%** vs hold +136% — strategy sits out bull runs (intentional by design)
- Recent 6h 90d: **+0.81%** vs hold -8.7%
- `npm test` — 6/6 PASS
- `npm run preflight` — 9/9 PASS (simulated mode)

**Key insight discovered:** The bot is a bear/chop capital-protection strategy.
In strong bull runs it goes quiet (regime filter blocks buys when EMA fast < slow).
This is correct but leaves significant upside on the table. The #1 improvement
opportunity is a bull-regime overlay.

**All real data now populated in `backtest/data/`:**
- `sol-usd-1d.json` — 311 candles, bear 2023–2024
- `sol-usd-1d-bull.json` — 184 candles, Oct23–Apr24 bull run ($23→$192)
- `sol-usd-1d-full.json` — 1982 candles, Jan 2021–Jun 2026
- `sol-usd-6h-bull.json` — 733 candles, 6h bull run
- `sol-usd-6h-recent.json` — 360 candles, recent 90d

**Environment gotcha:** Windows↔Linux mount truncates large files written by Edit/Write
tools. Always edit `src/*.mjs` from shell (python/sed/cat). After every edit run
`node --check <file>`. If truncated, repair with python overwrite.

**Commands:**
```
node src/backtest.mjs --data backtest/data/sol-usd-1d.json   # bear baseline (+9.29%)
node src/backtest.mjs                                         # all files
node src/backtest.mjs --sweep --walk-forward                  # walk-forward
node backtest/montecarlo.mjs                                  # regime stress test
node backtest/walkforward.mjs                                 # TRAIL_GIVE_PCT OOS test
npm test                                                      # must stay green
npm run preflight                                             # must PASS before live
```

---

## TASK LIST (execute in order)

### TASK 1 — Bull-regime overlay (HIGHEST VALUE)
The bot currently returns near-zero in strong bull markets because dip thresholds
(0.5%/0.8%) are calibrated for sideways/bear chop, not bull pullbacks.

Implement a **dynamic threshold scaling** based on regime strength:
- Compute `regimeStrength = (emaFast - emaSlow) / emaSlow * 100` (% spread)
- When `regimeStrength > BULL_REGIME_THRESHOLD` (suggest 2.0%), multiply dip/rip
  thresholds by `BULL_DIP_SCALE` (suggest 3.0x) to catch real bull pullbacks
- Add these 2 new config keys to `src/common.mjs` and `.env`
- Implement in both `src/backtest.mjs` (backtester) and `src/bot-lib.mjs` (live)
- Test: re-run all 5 backtests. Bull 183d should improve materially from +5.6%.
  Bear 310d must NOT drop below +8.5%.

### TASK 2 — Daily loss circuit breaker
The `validateConfig()` checks caps on notional but not on realized loss.
Add to `src/executor.mjs`:
- Track `realizedLossTodayUsdc` in `state/state-exec.json`
- If daily realized loss exceeds `DAILY_LOSS_LIMIT_USDC` (default 3.0, add to
  `.env` and `src/common.mjs`), halt all trades for the rest of that UTC day
  and log `{ type: 'circuit_breaker', reason: 'daily_loss_limit' }`
- Add check to preflight: warn if `DAILY_LOSS_LIMIT_USDC` is not set
- Add assertion to selftest: circuit breaker fires when loss > limit

### TASK 3 — 6h parameter sweep + re-tune
The bot runs on 10-second ticks but params were optimized on 1d candles.
Run `node src/backtest.mjs --sweep` on `sol-usd-6h-bull.json` and
`sol-usd-6h-recent.json` to find optimal dip/rip/PT params for 6h candles.
If different from current `.env`, update and re-verify bear baseline still ≥ 8.5%.

### TASK 4 — Regime-aware position sizing  
Currently buy size is fixed (`BULL_BUY_USDC=1`). Scale it by regime confidence:
- In confirmed uptrend AND RSI < oversold: multiply buy size by up to 1.5x
- In downtrend or RSI > 60: reduce to 0.75x
- Implement via `rsiScaleMaxMult` (already exists) or extend it
- Re-run bear backtest — return should match or exceed +9.29%

### TASK 5 — Final validation & go-live package
After all improvements:
1. Run full backtest suite: all 5 data files + Monte-Carlo + walk-forward
2. Run `npm test` — must be green (update assertions if thresholds improved)
3. Run `DRY_RUN=1 npm run preflight` — must PASS all checks
4. Write a `RESULTS-OPUS2.md` summarizing:
   - What each task changed
   - Before vs after numbers for each dataset
   - Final recommendation on whether to go live

---

## GO-LIVE STEPS (for the user — minimal actions)

After Opus confirms everything passes, George only needs to do 3 things:

**Step 1** — Open `.env`, replace `<YOUR_PROFIT_WALLET_HERE>` with your Solana
wallet address (where profits get swept to).

**Step 2** — Fund `state/generated-wallet.json` wallet:
```
npm run wallet          # shows the address
```
Send: ~$20 USDC + ~0.05 SOL to that address.

**Step 3** — Run shadow mode for 1 session, then flip live:
```
# In .env: DRY_RUN=1, EXECUTION_MODE=real
npm run preflight       # must PASS
npm run shadow          # watch logs for 1 session (~2-4 hrs)

# When shadow looks good: in .env set DRY_RUN=0
npm run all             # LIVE
```

Keep `REAL_MAX_NOTIONAL_USDC=10` and `REAL_DAILY_NOTIONAL_LIMIT_USDC=50` for
the first live day. The circuit breaker (`DAILY_LOSS_LIMIT_USDC=3`) will halt
trading automatically if something goes wrong.

---

## RULES
- After every file edit: `node --check`, then run the relevant backtest.
- Never execute a real trade or move funds.
- Bear baseline must stay ≥ +8.5% after every change — if it drops, revert.
- Do NOT raise `REAL_MAX_NOTIONAL_USDC > 100` or `MAX_SOL_ALLOCATION_PCT > 0.60`.
- Keep edits minimal and reversible.
- If an improvement doesn't improve numbers, revert it and document why.

## Definition of done
All 4 tasks complete, `npm test` green, `npm run preflight` PASS, `RESULTS-OPUS2.md`
written with before/after numbers, and bull 183d return materially improved over +5.6%.
Then the user runs the 3 go-live steps above.
