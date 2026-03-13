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
- `PROFIT_WALLET` is set (mandatory in real mode)
- USDC is above `USDC_RESERVE`
- sweep size is above `USDC_PROFIT_MIN`
- SOL is above `MIN_SOL_FOR_SWEEP`

## Transaction is UNCONFIRMED
The bot sent the swap transaction, but RPC confirmation polls timed out (60s).
1. Copy the `txSignature` from `logs/trades.jsonl` or the `UNCONFIRMED` log.
2. Search it on [Solscan](https://solscan.io).
3. If the transaction succeeded on-chain, run `npm run reconcile` to manually re-sync the portfolio state.

## RPC or Jupiter API errors / timeouts
Network calls timeout after 15s to prevent the bot from hanging.
- Check if your internet connection is stable.
- Verify your `RPC_URL` is responsive.
- If you see `429 Too Many Requests`, Jupiter is rate-limiting you; try reducing `LOOP_SEC`.

## Corrupted JSON state or cache
If a state file (e.g., `state/portfolio.json`) is corrupted:
- The bot will fallback to default values automatically.
- Check logs for any JSON parse errors.
- You can manually move or delete a corrupted file to let the bot regenerate it.

## Duplicate executors
The executor uses a file lock under `state/executor.lock`. Remove it only if the process crashed and the lock is stale.
