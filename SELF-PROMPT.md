# SELF-PROMPT — self-authored directive for the Solana bot
# Each daily run READS this at the start and REWRITES it at the end.
# It is the bot's evolving "note to its future self": what to focus on next,
# what's been learned, and which mistakes not to repeat. Versioned in git so the
# evolution is visible (`git log -p SELF-PROMPT.md`).

## Focus for the next run (do this first)
- Confirm `npm run test:all` green and bear >= 9.0% before anything else.
- Backlog item #3: Run shadow session (`npm run shadow`), review logs/shadow.jsonl,
  then STOP and ask George before flipping DRY_RUN=0 for any live trade.
- Backlog item #4: Set up reconciliation cron (`npm run reconcile`) as a scheduled task.

## Running lessons (append; never delete — this is our long-term memory)
- 2026-06-05: Edit/Write tool truncates src/*.mjs on this mount — always edit from shell + node --check.
- 2026-06-05: Bull gains came from MOMENTUM re-entry, not widening the dip (anchor deadlock in uptrends).
- 2026-06-05: "RSI>60 => smaller buys" fought the momentum overlay; kept disabled (REGIME_SIZE_HIGH_RSI=100).
- 2026-06-05: Real-mode realized PnL was untracked => circuit breaker was blind live. Fixed.
- 2026-06-05: In-sample sweeps overfit; always cross-validate across ALL datasets + protect bear floor.
- 2026-06-05: .env is NOT in git — never open it with python open(path,'w') before reading; always read first, then write. Truncation destroyed the file once.
- 2026-06-05: Cowork sessions connect to C:\Users\lovel\Claude\Projects\Solana Bot (not Desktop). Bot files are synced there. Canonical git repo stays at C:\Users\lovel\Desktop\solana-bot; George commits from there.
- 2026-06-05: Always request_cowork_directory for Desktop\solana-bot at session start if doing shell edits; Projects folder auto-connects but Desktop has the live git.

## Backlog progress (update as items land)
- [x] 1. Paid RPC endpoint — documented in .env with Helius/QuickNode/Triton instructions; George swaps RPC_URL when ready (no code change needed)
- [x] 2. Jupiter max-slippage + priority-fee guard — MAX_SLIPPAGE_BPS=100, PRIORITY_FEE_LAMPORTS=5000 in .env + wired into jupiter-swap.mjs; slippage logged to executor.jsonl on every confirmed swap
- [x] 5. Alert webhook — alerts.mjs already existed; wired circuit-breaker alert (ALERT_ON_BREAKER=1 default on); ALERT_WEBHOOK_URL instructions in .env (Discord webhook)
- [ ] 3. Shadow session, then one tiny watched live trade — run `npm run shadow`, review logs/shadow.jsonl, ask George before DRY_RUN=0
- [ ] 4. Reconciliation cron (npm run reconcile before/after sessions) — consider scheduled task
- [ ] 6. Refresh + widen backtest data and Monte-Carlo regimes

## How to rewrite this file at the end of a run
Keep the 4 sections. Move completed backlog items to checked, set "Focus for the next run" to the
next highest-value safe action, and APPEND any new lesson learned today (dated). Never trade, move
funds, or change EXECUTION_MODE/DRY_RUN. Keep changes reversible, tests green, bear >= 9.0%.
