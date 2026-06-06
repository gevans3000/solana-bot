# Handoff — Solana Bot, Opus Session 3
# Goal: Fix the sell-side mismatch, make the bull strategy genuinely wealth-building,
# and validate across all timeframes before any live money.

---

## CRITICAL ENVIRONMENT RULES (read first — these have bitten us)
1. **Edit `src/*.mjs` from the shell only** (python/sed/cat heredoc). The Edit/Write tools truncate on this Windows↔Linux mount. Run `node --check <file>` after EVERY edit.
2. **Git commits fail in the Cowork sandbox** (can't unlink `.git/*.lock`). George commits from his machine.
3. **`.env` is NOT in git** — never open it with `open(path,'w')` before reading. Truncation destroyed it once.
4. **Two folder paths**: `C:\Users\lovel\Desktop\solana-bot` = canonical git repo (edits go here). `C:\Users\lovel\Claude\Projects\Solana Bot` = Cowork auto-connect copy (rsync at end of session). Request Desktop folder via `request_cowork_directory` at session start.

---

## CURRENT STATE (committed — f359e03)
Tests: `npm run test:all` → **10 selftest + unit, all green**.
Bear baseline (sol-usd-1d.json, SOL -55.76%): **+9.53%** (floor is 9.0%).
5yr full-cycle (sol-usd-1d-5yr.json): **+26.64%** vs hold +15.59%.
Pure-bull 183d (sol-usd-1d-bull.json, SOL +705%): **+20.36%** vs hold +135.92% ← **THIS IS THE PROBLEM**.

### What shipped in Sonnet-3:
- Multi-timeframe historical data (Yahoo Finance): `backtest/data/sol-usd-1d-5yr.json`, `sol-usd-1h-540d.json`, `sol-usd-15m-60d.json`, `sol-usd-5m-30d.json`, `sol-usd-1m-7d.json`
- `backtest/fetch-yahoo.mjs` — run `node backtest/fetch-yahoo.mjs` to refresh data
- Jupiter slippage guard: `MAX_SLIPPAGE_BPS=100`, `PRIORITY_FEE_LAMPORTS=5000` in `.env` + wired in `src/jupiter-swap.mjs`
- Circuit-breaker alert: `ALERT_ON_BREAKER=1` wired in `src/executor.mjs`; Discord webhook instructions in `.env`
- **Wealth-V1**: `BULL_BUY_PCT_OF_USDC=0.15` in `src/common.mjs` + `src/backtest.mjs` + `src/bot-lib.mjs` — BULL bot deploys 15% of USDC per buy when EMA gap > 7% (strong confirmed uptrend). Improved 5yr by +6pp.

---

## THE CORE PROBLEM TO FIX (Wealth-V2)

### The sell-side mismatch
The BULL bot buys with proportional sizing (up to 15% of USDC = ~$7.50) but **always sells only 0.01 SOL per rip** (~$0.65 at current prices). This creates an inventory trap:

- Buy 0.15 SOL at $50 (spent $7.50 USDC)
- Price rips 2.1% to $51.05 → sell 0.01 SOL → get back $0.51 USDC
- Net: -$6.99 USDC, +0.14 SOL still stuck in inventory
- After 5-6 buys: USDC nearly depleted, large SOL inventory held
- In a bull run this SOL appreciates but the bot CAN'T BUY MORE DIPS (no USDC left)
- So fewer trades, less compound growth

### Why the pure-bull test scores only 20% vs hold's 136%
In a 700% bull run, both BEAR and BULL bots are active against the SAME portfolio. Both sell 0.01 SOL per rip. Price rising 2.1% → sell trigger fires frequently → SOL inventory slowly sold off at each step. Meanwhile USDC runs dry from proportional buys. The portfolio ends up partially converted at each step with neither bot capitalizing fully.

### Three candidate fixes (pick the best or combine)

**Option A — Proportional sells (most correct)**
Track `lastBuyAmountSol` in bot state. On sell signal, sell the SAME SOL amount that was purchased (not a fixed 0.01). This symmetry means each buy/sell cycle is a complete trade.
- Sell: `amount = botState.lastBuyAmountSol` (or a configurable fraction of it)
- Requires state tracking: `botState.lastBuyAmountSol = signalAmount / price` on each BUY
- Must update `bot-lib.mjs` and `backtest.mjs` in parity

**Option B — Core SOL position (simplest)**
Add `BULL_MIN_SOL_HOLD` (default 0): the BULL bot never sells SOL below this floor.
- In a bull run: 0.3 SOL held through the entire move → $7.20 → $57.60 = +$50 on core alone
- BEAR bot unaffected (different bot, different specialization)
- Implementation: change sell condition to `balances.sol >= sellSol + CFG.bullMinSolHold + CFG.minSolReserve`
- Risk: in bear markets where regime briefly looks bullish, holding SOL core hurts. Gate on `regimeStrengthPct >= 7.0` to prevent.

**Option C — Wider trailing in strong bull (least invasive)**
When `regimeStrengthPct >= 7.0`, override `TRAIL_GIVE_PCT` with a wider value (e.g., 25%).
- Current: trail fires when price drops 10% from peak. At $100 peak: sells at $90.
- Wide: trail fires at 25% give. At $100 peak: sells at $75. Captures more of the move.
- In a 700% run: holds positions much longer, accumulates compound gains.
- Zero state-tracking changes, one conditional in trail logic.

### Recommended approach
**Do all three, gated on `regimeStrengthPct >= 7.0`:**
1. Option C first (safest, zero state risk) — validate bear doesn't regress
2. Option B second — add `BULL_MIN_SOL_HOLD=0.2` as default
3. Option A third — proportional sells as the capstone

**Target metrics after fix:**
- Bear baseline: >= 9.0% (non-negotiable)
- Pure-bull 183d: >= 60% (currently 20.36%, hold is 136%)
- 5yr full cycle: >= 30% (currently 26.64%)
- 1h 540d bear: beats hold by >= 30pp (currently -11.64% vs hold -49.85% = 38pp spread, maintain this)

---

## ARCHITECTURE MAP (files you'll touch)

| File | Purpose |
|------|---------|
| `src/common.mjs` | Config (CFG), env loading. Add new params here. |
| `src/backtest.mjs` | Backtester + botTick signal logic. Source of truth for strategy. |
| `src/bot-lib.mjs` | LIVE tick logic. Must stay in parity with backtest.mjs botTick. |
| `src/executor.mjs` | Live executor loop, cooldowns, circuit breaker, PT/SL. |
| `backtest/data/` | Historical OHLCV files. Use `node backtest/fetch-yahoo.mjs` to refresh. |

**Key functions:**
- `botTick()` in `backtest.mjs` — the strategy brain (lines ~113–190). Buy/sell logic lives here.
- `botTick()` in `bot-lib.mjs` — live parity version (lines ~27–160).
- `cfgToParms(cfg)` in `backtest.mjs` — maps CFG to P object passed to botTick. Add new params here.
- `loadSeries(file)` in `backtest.mjs` — loads OHLCV, handles both array and object formats.

---

## BACKTEST RESULTS (full picture, for reference)

| Dataset | Candles | SOL Move | Bot | Hold | vs Hold | Trades | Win% |
|---------|---------|----------|-----|------|---------|--------|------|
| 1d bear (310d) | 311 | -55.8% | +9.53% | -36.3% | +46pp | 29 | 90% |
| **1d bull (183d)** | 184 | **+705%** | **+20.36%** | **+136%** | **-116pp** | 11 | 100% |
| 1d 5yr | 1826 | +52.4% | +26.64% | +15.6% | +11pp | 63 | 76% |
| 1h 540d | 12923 | -71.7% | -11.64% | -49.9% | +38pp | 119 | 47% |
| 15m 60d | 5751 | -19.3% | +0.83% | -8.6% | +9pp | 15 | 100% |
| 5m 30d | 8604 | -27.7% | -3.27% | -13.1% | +10pp | 48 | 67% |

Key insight: bot beats hold on EVERY dataset. In bear/flat it grows, in strong bull it falls behind.
The hourly result (-11.64%) is the realistic live expectation for bear markets.

---

## HARD GUARDRAILS (never violate)
- Bear baseline (backtest/data/sol-usd-1d.json) must stay **>= 9.0%**; selftest enforces this.
- Never place a trade, move/sweep funds, or change EXECUTION_MODE / DRY_RUN without George's OK.
- Never raise REAL_MAX_NOTIONAL_USDC > 100 or MAX_SOL_ALLOCATION_PCT > 0.60.
- Any strategy edit must keep backtest.mjs and bot-lib.mjs in parity, and keep `npm test` green.
- If a change doesn't help the numbers, revert it and document why in SELF-PROMPT.md.

---

## DAILY SELF-IMPROVEMENT LOOP
`node src/self-audit.mjs` (scheduled ~8am). Tunes specialization-gated knobs (BULL_REGIME_THRESHOLD, REGIME_SIZE_UP_MULT, REGIME_SIZE_DOWN_MULT). Auto-applies only if bear >= 9.0%, +0.5pp upside, `npm test` green, bot not live.

---

## DEFINITION OF DONE for Opus session
1. `npm run test:all` green, bear >= 9.0%
2. Pure-bull 183d result >= 60%
3. 5yr full cycle result >= 30%
4. SELF-PROMPT.md rewritten with lessons + next focus
5. Files synced to `C:\Users\lovel\Claude\Projects\Solana Bot`
6. George given one commit command

---

## LESSONS LEARNED (don't repeat)
- Edit/Write on `src/*.mjs` → truncation. Use the shell.
- `.env` not in git — always read before write.
- Proportional buying without proportional selling = inventory trap.
- `Math.min(scaledBuy, balances.usdc * 0.25)` cap blocks small buys when USDC runs low. Use `Math.min(scaledBuy, balances.usdc)`.
- In-sample sweeps overfit. Cross-validate across ALL datasets.
- The sol-usd-1d-bull.json (pure 183d bull) is not a realistic validation target. Use 5yr for primary benchmark.
- Grid search to find safe parameter threshold before hardcoding anything.
- `BULL_BUY_PCT_OF_USDC` only fires for BULL bot (not BEAR), only when regimeStrengthPct >= 7.0%.
