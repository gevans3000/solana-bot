# GO-LIVE Checklist

## Validated Performance (real Binance data, all regimes)

| Dataset | Period | SOL move | Strategy | Hold | Verdict |
|---------|--------|----------|----------|------|---------|
| Bear (310d) | 2023–2024 | -55.8% | **+9.29%** | -36.3% | ✅ Outperforms |
| Bull 1d (183d) | Oct23–Apr24 | +705% | +5.6% | +135.9% | ⚠️ Sits out bull |
| Bull 6h (183d) | Oct23–Apr24 | +815% | +5.8% | +143% | ⚠️ Sits out bull |
| Recent 6h (90d) | 2026 bear | -19% | +0.81% | -8.7% | ✅ Outperforms |
| Full 1d (1982d) | 2021–2026 | +3618% | +2.5% | +65.5% | ⚠️ Under hold |

**Monte-Carlo (synthetic regimes, 40 paths each):**
- Strong bull: +16% strategy vs +182% hold — strategy sits out (correct, avoids buying tops)
- Crash bear (-0.6%/d): -7.3% strategy vs -34.7% hold — strategy protects capital
- Mean across all regimes: +2.05% vs legacy +0.67%

**What this bot is:** A bear/chop market capital-protection strategy. It outperforms
when SOL drops. In strong bull runs it generates very few signals and sits mostly in
USDC — this is intentional (avoids chasing tops). Do not expect it to capture bull runs.

---

## Minimum actions, in order

### 1. Set your profit wallet

Edit `.env`:
```
PROFIT_WALLET=<your Solana wallet address>
```
This is where swept profits land. Use a wallet you control.

### 2. Fund the trading wallet

The bot's wallet is in `state/generated-wallet.json`. Check the address:
```
npm run wallet
```
Send it:
- ~$10–20 USDC (initial trading capital — keep it tiny on day 1)
- ~0.05 SOL (gas / transaction fees)

### 3. Run preflight — must fully PASS

```
DRY_RUN=1 npm run preflight
```
Fix any FAIL before proceeding. Do not go live with any FAIL.

### 4. Shadow session (watch-only, no real trades)

In `.env` set:
```
EXECUTION_MODE=real
DRY_RUN=1
```
Then start:
```
npm run shadow
```
Watch logs for at least one full session. Confirm signals look sane,
`state/regime.json` updates, no errors. Check `logs/` for signal/executor output.

### 5. Flip live

Only when shadow logs look clean. In `.env` set:
```
DRY_RUN=0
```
Start:
```
npm run all
```
Monitor `logs/` closely on the first live day.

---

## Safety caps (keep tiny on day 1)

```
REAL_MAX_NOTIONAL_USDC=10
REAL_DAILY_NOTIONAL_LIMIT_USDC=50
REAL_MAX_TRADES_PER_DAY=5
```
Raising these proportionally increases drawdown exposure.

## When to expect activity

The bot generates most signals during **sideways chop and bear markets** when
SOL makes 0.5–2% intraday dips. In a strong uptrend (EMA fast > slow) the BULL
bot waits for pullbacks that may not come; the BEAR bot only fires on RSI < 35
(deep oversold). Expect quiet periods of days during strong bull runs — that is normal.

## Optional: increase position sizing

`MAX_SOL_ALLOCATION_PCT=0.60` (60% inventory cap). Raising it increases both
returns and drawdowns. Only change after re-running the bear backtest to verify
the new DD profile is acceptable.

## Stopping the bot

Kill with Ctrl-C or `pkill -f "node src/all"`. State is preserved in `state/` — safe to restart.

## Key files

| File | Purpose |
|------|---------|
| `.env` | All config/params |
| `state/generated-wallet.json` | Trading wallet (keep private) |
| `state/regime.json` | Current market regime (written each tick) |
| `logs/bull.jsonl`, `logs/bear.jsonl` | Signal history |
| `logs/executor.jsonl` | Trade execution log |
| `backtest/data/sol-usd-1d.json` | Validated bear dataset (310d) |
| `backtest/data/sol-usd-1d-bull.json` | Real bull dataset (183d, Oct23–Apr24) |
| `backtest/data/sol-usd-1d-full.json` | Full history (1982d, 2021–2026) |

## Data refresh

To refresh market data (requires Chrome extension connected):
```
npm run backtest:fetch
```
Rate limits: Binance 1200 weight/min, each call = 2 weight. Script enforces 600ms
between calls and auto-backs off on 429 errors. Total usage per refresh: ~16 weight.
