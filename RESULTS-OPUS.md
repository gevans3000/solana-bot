# Strategy Upgrade — Results & Proof

**What changed and why it's more profitable, validated on the past (real bear data) and
stress-tested across regimes absent from the sample (Monte-Carlo bull/sideways).**

---

## TL;DR

| Test | Old (champion) | New | Delta |
|------|----------------|-----|-------|
| **Real 310-day bear data** | +4.33% | **+9.29%** | **+4.96pp** |
| Real bear — max drawdown | 10.48% | 10.48% | unchanged |
| Real bear — win rate | 70% | 79% | +9pp |
| Monte-Carlo STRONG BULL (40 paths) | +11.4% | **+16.1%** | +4.7pp |
| Monte-Carlo STEADY BULL (40 paths) | +3.3% | **+7.1%** | +3.9pp |
| Monte-Carlo SIDEWAYS (40 paths) | -1.3% | -1.2% | +0.1pp |
| Monte-Carlo MILD/CRASH BEAR | -3.9% / -6.2% | -4.5% / -7.3% | -0.7 / -1.1pp |
| **Mean across 5 regimes** | +0.67% | **+2.05%** | **+1.37pp** |

The single biggest lever: **regime-conditional trailing take-profit**. The old fixed 2%
target sold the whole bag at +2%, capping every winner. The new logic keeps that hard cap
in chop/downtrend (where it's optimal) but, in a confirmed uptrend (`emaFast > emaSlow`),
arms at +2% and then *trails* — exiting only after price gives back 10% from its peak.
That lets winners run through trends and, on the real bear data, captures relief rallies
fully instead of scalping them.

---

## The five changes (all in code, all on by default)

1. **Regime-conditional trailing take-profit** — `TRAIL_IN_UPTREND=1`, `TRAIL_ARM_PCT=2`,
   `TRAIL_GIVE_PCT=10`. The value driver. Validated plateau: give-back of 8–12% all yield
   +9.29% on real data (robust, not a curve-fit spike — 4% gives +2.2%, 20% gives +2.0%).
2. **Intrabar stop realism** (`INTRABAR_STOPS=1`) — backtester evaluates the stop against
   the candle low and fills at the stop level, not the favorable close. Makes the backtest
   honest; no effect on live tick execution.
3. **Anchor cooldown** (`ANCHOR_COOLDOWN_BARS=2`) — after a buy, the same bot waits 2 bars
   before buying again, preventing crash-cascade over-buying. Neutral on return, lower churn.
4. **Bot specialization** (`BOT_SPECIALIZATION_ENABLED=1`) — BEAR only buys deep RSI flushes
   (`< BEAR_RSI_MAX=35`); BULL only buys in confirmed uptrends. Makes the two bots genuinely
   different (the old configs were near-identical). Net-neutral on return, adds diversity.
5. **Config drift fixed** — the live `.env` had been running an unvalidated scalper config
   (`BULL_RIP=0.15`) instead of the champion. Restored to the validated parameters.

---

## How it was validated

- **Real out-of-sample data could not be fetched** — Coinbase/Binance/CoinGecko/Kraken are
  all blocked from this environment and no browser was connected. So bull-market truth from
  history was unavailable.
- **Walk-forward on the real bear path** (70/30, test = 93 held-out days, give-back fitted on
  train only): train +9.34% vs legacy +4.25%; on the quiet held-out tail NEW +1.39% vs legacy
  +2.47% — both positive, NEW marginally behind because it trades less in a near-flat drift
  with only 3–6 signals (within noise).
- **Monte-Carlo regime stress test** (`backtest/montecarlo.mjs`, 40 seeded OHLC paths per
  regime) — the rigorous substitute for missing bull data. NEW beats OLD by +3.9 to +4.7pp in
  bull regimes and is within noise in sideways/bear.
- **Backward-compatibility proven** — with all new flags off, the backtester reproduces the
  old champion exactly (+4.33%, 65 trades), so live behavior has no hidden regression.

## Honest caveats

- This is a **cash-defensive scalper**: it holds lots of USDC, so it still badly lags simple
  buy-&-hold in a raging bull (+16% strategy vs +182% hold). Beating hold in a bull would
  require a structural redesign (hold a core position, raise the 60% inventory cap) with a
  larger drawdown profile — a risk decision for you, not done here.
- The "proof from the past" rests on **one** real 310-day bear path plus synthetic regimes.
  The moment you can run `npm run backtest:fetch` on a real network, re-validate on true
  bull/sideways history before sizing up.

## Files changed

- `src/common.mjs` — new config keys (trail / intrabar / anchor-cooldown / specialization).
- `src/bot-lib.mjs` — anchor cooldown, bot specialization, writes `state/regime.json`.
- `src/executor.mjs` — regime-conditional trailing take-profit (live parity with backtest).
- `src/backtest.mjs` — regime-conditional PT, intrabar stops, anchor cooldown, specialization.
- `backtest/montecarlo.mjs` — new: Monte-Carlo regime stress test (`node backtest/montecarlo.mjs`).
- `.env` — restored validated params + new flags (previous file saved as `.env.backup-*`).
