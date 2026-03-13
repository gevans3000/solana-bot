# Troubleshooting

## `wallet` says no wallet found
Run:
```bash
npm run wallet:new
```

## The UI starts but the buttons do nothing
Check whether another process is already using the same port. Change `UI_PORT` in `.env`.

## No trades are happening
Check these first:
1. `DISABLED` file exists
2. `COOLDOWN_SEC` is too large for your test
3. `SIGNAL_MIN_SEC` is too large
4. `PRICE_MODE=mock` is not moving enough
5. `MIN_EXPECTED_EDGE_BPS` is too high

For faster testing, temporarily use:
```env
PRICE_MODE=mock
SIGNAL_MIN_SEC=15
COOLDOWN_SEC=30
DECISION_WINDOW_SEC=15
BULL_DIP_PCT=0.15
BULL_RIP_PCT=0.15
BEAR_DIP_PCT=0.25
BEAR_RIP_PCT=0.10
```

## Dry run works but live simulated does not change balances
Set `DRY_RUN=0` in `.env` or start from the UI using **Start Live**.

## Profit sweeps are not happening
Check:
- `PROFIT_WALLET` is set
- USDC is above `USDC_RESERVE`
- sweep size is above `USDC_PROFIT_MIN`
- SOL is above `MIN_SOL_FOR_SWEEP`

## Duplicate executors
The executor uses a file lock under `state/executor.lock`. Remove it only if the process crashed and the lock is stale.
