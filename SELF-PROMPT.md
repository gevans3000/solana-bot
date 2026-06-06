# SELF-PROMPT — self-authored directive for the Solana bot
# Each run READS this at start and REWRITES at end.

## Focus for the next run (do this first)
- Confirm `npm run test:all` green and bear >= 9.0% before anything else.
- **Wealth-V2 is DONE.** The sell-side mismatch is fixed (Option C: regime-gated wider trailing).
  Current results: bear +9.53%, pure-bull 183d +67.09%, 5yr +122.64%, 1h-540d beats hold +38pp.
- **Next priority: shadow validation before live.** Run a shadow session (DRY_RUN stays 1),
  watch the bull/bear sell sizes in logs/ for a few days, confirm live ticks match backtest intent.
  Only after that, ask George before ONE tiny live trade (DRY_RUN=0). Never flip DRY_RUN yourself.
- **Optional tuning:** Options A (BULL_PROPORTIONAL_SELLS) and B (BULL_MIN_SOL_HOLD) are
  implemented + gated but OFF by default (neutral/slightly-negative in daily backtest).
  They may help on the higher-frequency live path — validate on 1h/15m data before enabling.

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

## Backlog progress
- [x] 1. Paid RPC endpoint — documented in .env (Helius/QuickNode/Triton); George swaps when ready
- [x] 2. Jupiter max-slippage + priority-fee guard — wired in jupiter-swap.mjs + .env
- [x] 5. Alert webhook — circuit-breaker alert + Discord instructions in .env
- [x] DATA: multi-timeframe data (1d-5yr, 1h-540d, 15m-60d, 5m-30d, 1m-7d) via Yahoo Finance
- [x] WEALTH-V1: Proportional buy sizing in confirmed bull regime (BULL_BUY_PCT_OF_USDC=0.15)
- [x] WEALTH-V2: Sell-side fixed. Option C (regime-gated wide trailing) ACTIVE; A & B implemented + OFF.
      Results: bear +9.53%, bull183d +67.09%, 5yr +122.64%, 1h-540d +38pp vs hold. Targets all met.
- [ ] 3. Shadow session -> one tiny live trade (ask George before DRY_RUN=0)
- [ ] 4. Reconciliation cron scheduled task
- [ ] A/B-LIVE: validate BULL_PROPORTIONAL_SELLS / BULL_MIN_SOL_HOLD on 1h/15m before enabling live

## How to rewrite this file at the end of a run
Keep sections. Check off completed items, set next focus, append lessons. Never trade/move funds/change
EXECUTION_MODE or DRY_RUN without George's approval. Keep changes reversible, tests green, bear >= 9.0%.
