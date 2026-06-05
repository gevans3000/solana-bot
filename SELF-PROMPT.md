# SELF-PROMPT — self-authored directive for the Solana bot
# Each daily run READS this at the start and REWRITES it at the end.
# It is the bot's evolving "note to its future self": what to focus on next,
# what's been learned, and which mistakes not to repeat. Versioned in git so the
# evolution is visible (`git log -p SELF-PROMPT.md`).

## Focus for the next run (do this first)
- Backlog item #1: recommend/plan the **paid RPC endpoint** swap (Helius/Triton/QuickNode).
  Public RPC is the top reliability risk; until it's done, errors are expected. Do NOT change
  RPC_URL yourself — surface it for George with the exact 1-line change.
- Confirm `npm run test:all` is green and bear >= 9.0% before anything else.

## Running lessons (append; never delete — this is our long-term memory)
- 2026-06-05: Edit/Write tool truncates src/*.mjs on this mount — always edit from shell + node --check.
- 2026-06-05: Bull gains came from MOMENTUM re-entry, not widening the dip (anchor deadlock in uptrends).
- 2026-06-05: "RSI>60 => smaller buys" fought the momentum overlay; kept disabled (REGIME_SIZE_HIGH_RSI=100).
- 2026-06-05: Real-mode realized PnL was untracked => circuit breaker was blind live. Fixed.
- 2026-06-05: In-sample sweeps overfit; always cross-validate across ALL datasets + protect bear floor.

## Backlog progress (update as items land)
- [ ] 1. Paid RPC endpoint
- [ ] 2. Jupiter max-slippage + priority-fee guard + slippage logging
- [ ] 3. Shadow session, then one tiny watched live trade
- [ ] 4. Reconciliation cron (npm run reconcile before/after sessions)
- [ ] 5. Alert webhook for trades/errors/breaker
- [ ] 6. Refresh + widen backtest data and Monte-Carlo regimes

## How to rewrite this file at the end of a run
Keep the 4 sections. Move completed backlog items to checked, set "Focus for the next run" to the
next highest-value safe action, and APPEND any new lesson learned today (dated). Never trade, move
funds, or change EXECUTION_MODE/DRY_RUN. Keep changes reversible, tests green, bear >= 9.0%.
