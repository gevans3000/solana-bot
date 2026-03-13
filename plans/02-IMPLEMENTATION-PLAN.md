# Minimal Implementation Plan

## Phase A — Keep the current skeleton
Do not replace the current project. Keep these files as the core:
- `src/price-source.mjs`
- `src/bot-bull.mjs`
- `src/bot-bear.mjs`
- `src/executor.mjs`
- `src/portfolio.mjs`
- `src/all.mjs`
- `src/ui-server.mjs`
- `src/recent.mjs`
- `src/smoke.mjs`

## Phase B — Tighten only the minimum logic
1. **Price source**
   - ensure timestamps are included
   - ensure stale data is easy to detect
   - keep it simple
2. **Bots**
   - use only dip/rip thresholds
   - emit reason codes and confidence
   - avoid complicated indicators
3. **Executor**
   - keep one-trade-per-window
   - enforce cooldown
   - enforce max trades/day
   - default disagreement to no trade
   - log explicit skip reasons
4. **Portfolio**
   - keep paper balances simple
   - include fees/slippage as fixed config values
   - update realized/unrealized PnL clearly
5. **Recent summary**
   - show wins/losses, PnL, trade count, skip reasons
   - keep the output short and readable
6. **UI**
   - only show start/stop, mode, latest status, and recent summary
   - do not build a complex dashboard

## Phase C — Make tuning easy
Expose only a small set of knobs in `.env.example`:
- `BULL_DIP_PCT`
- `BULL_RIP_PCT`
- `BEAR_DIP_PCT`
- `BEAR_RIP_PCT`
- `MIN_CONFIDENCE`
- `COOLDOWN_SEC`
- `MAX_TRADES_PER_DAY`
- `MAX_TRADE_USDC`
- `PAPER_FEE_BPS`
- `PAPER_SLIPPAGE_BPS`

## Phase D — Validate
Run only these checks:
- `npm install`
- `npm run smoke`
- `npm run dry-run`
- `npm run recent`
- `npm run ui`

## Stop conditions
Stop adding work once the system is:
- runnable
- understandable
- tunable
- producing believable paper logs

Do not keep polishing beyond that point in this phase.
