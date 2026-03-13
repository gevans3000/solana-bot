# Tuning Cheatsheet

Use the fewest knobs possible.

## First knobs to tune
### Bull bot
- `BULL_DIP_PCT`
  - lower = buys sooner / more often
  - higher = buys less often
- `BULL_RIP_PCT`
  - lower = sells sooner
  - higher = lets winners run longer

### Bear bot
- `BEAR_DIP_PCT`
  - lower = buys more often
  - higher = waits for deeper dips
- `BEAR_RIP_PCT`
  - lower = takes profit faster
  - higher = waits longer to sell

### Shared controls
- `MIN_CONFIDENCE`
  - higher = fewer trades
  - lower = more trades
- `COOLDOWN_SEC`
  - higher = slower system, less churn
  - lower = faster system, more churn
- `MAX_TRADES_PER_DAY`
  - hard cap on activity
- `MAX_TRADE_USDC`
  - caps each paper position size
- `PAPER_FEE_BPS`
  - increases realism
- `PAPER_SLIPPAGE_BPS`
  - increases realism

## Best tuning order
1. cooldown
2. max trades/day
3. fee/slippage realism
4. bull dip/rip
5. bear dip/rip
6. confidence threshold

## What to avoid
- tuning many variables at once
- changing both bots and executor rules together
- chasing a tiny sample of good trades
- treating paper PnL as proof of production profitability

## Good sign
- trade count is disciplined
- skips are explainable
- PnL is not entirely dependent on one lucky move
- bull and bear behavior is visibly different

## Bad sign
- too many trades
- constant disagreement
- constant no-trade because thresholds are unrealistic
- paper PnL only looks good because fees/slippage are too small
