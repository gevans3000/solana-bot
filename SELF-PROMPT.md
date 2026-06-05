# SELF-PROMPT — self-authored directive for the Solana bot
# Each run READS this at start and REWRITES at end.

## Focus for the next run (do this first)
- Confirm `npm run test:all` green and bear >= 9.0% before anything else.
- **Opus priority: redesign the BULL bot sell logic for wealth building.**
  Current problem: BULL bot sells only 0.01 SOL per rip regardless of how much it bought.
  Fix candidates (pick best):
    A) Proportional sell: sell the same fraction you bought (track lastBuyAmount in state)
    B) Core SOL position: never sell below MIN_SOL_HOLD (default 0.3 SOL), let core ride the trend
    C) Regime-gated trailing: widen TRAIL_GIVE_PCT to 25-30% in strong bull (7%+ EMA gap)
  Test: all 3 on sol-usd-1d-bull.json — want > 60% return (vs hold 136%, current 20%).
  Guard: bear baseline must stay >= 9.0%.
- Backlog item #3: run shadow session then ONE tiny live trade (ask George first).

## Running lessons (append; never delete)
- 2026-06-05: Edit/Write tool truncates src/*.mjs on this mount — always edit from shell + node --check.
- 2026-06-05: Bull gains came from MOMENTUM re-entry, not widening the dip (anchor deadlock).
- 2026-06-05: "RSI>60 => smaller buys" fought the momentum overlay; kept disabled (REGIME_SIZE_HIGH_RSI=100).
- 2026-06-05: Real-mode realized PnL was untracked => circuit breaker was blind live. Fixed.
- 2026-06-05: In-sample sweeps overfit; always cross-validate across ALL datasets + protect bear floor.
- 2026-06-05: .env is NOT in git — never open with python open(path,'w') before reading; truncation destroyed it once.
- 2026-06-05: Cowork connects to C:\Users\lovel\Claude\Projects\Solana Bot. Canonical git at Desktop\solana-bot. Request Desktop folder via request_cowork_directory at session start.
- 2026-06-05: Daily-candle backtest is misleading for live bot (runs every 10s). 1h result (-12% in bear) is honest live expectation. Daily backtest is useful for strategy direction only.
- 2026-06-05: Proportional sizing (BULL_BUY_PCT_OF_USDC) without proportional SELLING creates mismatched trade sizes — bot buys large, sells tiny 0.01 SOL, leaving inventory stranded. Fix the sell side first.
- 2026-06-05: sol-usd-1d-bull.json (pure 183d bull +705%) is NOT the right validation target — bot can't know it's at the start of a bull. Use sol-usd-1d-5yr.json (full cycle) as primary benchmark.
- 2026-06-05: Grid search found threshold=7% for BULL_BUY_PCT_OF_USDC keeps bear >= 9% but barely improves bull. The sell side is the real bottleneck.

## Backlog progress
- [x] 1. Paid RPC endpoint — documented in .env (Helius/QuickNode/Triton); George swaps when ready
- [x] 2. Jupiter max-slippage + priority-fee guard — wired in jupiter-swap.mjs + .env
- [x] 5. Alert webhook — circuit-breaker alert + Discord instructions in .env
- [x] DATA: Fetched real multi-timeframe data (1d-5yr, 1h-540d, 15m-60d, 5m-30d, 1m-7d) via Yahoo Finance
- [x] ANALYSIS: Full honest backtest across all timeframes — capital preservation confirmed, bull underperformance identified
- [x] WEALTH-V1: Proportional buy sizing in confirmed bull regime (BULL_BUY_PCT_OF_USDC=0.15)
      Result: 5yr +26.64% (was +20.59%), bear +9.53% (was +9.42%), hourly -11.64% (was -12.09%)
      OPEN ISSUE: pure-bull 183d regressed 25%→20% due to mismatched sell size — needs sell-side fix
- [ ] 3. Shadow session → one tiny live trade (ask George before DRY_RUN=0)
- [ ] 4. Reconciliation cron scheduled task
- [ ] 6. Expand backtest data (already done — see backtest/data/)
- [ ] WEALTH-V2: Fix sell-side to match buy-side (proportional sells or core SOL position)

## How to rewrite this file at the end of a run
Keep sections. Check off completed items, set next focus, append lessons. Never trade/move funds/change EXECUTION_MODE without George's approval. Keep changes reversible, tests green, bear >= 9.0%.
