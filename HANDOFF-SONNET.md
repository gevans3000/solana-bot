# Handoff — Solana Bot (for a new Sonnet chat)

**Opener to paste:** *"Read HANDOFF-SONNET.md in my solana-bot folder and execute the
TASK LIST top to bottom. Be token-efficient: batch shell commands, don't re-read files you
haven't changed, don't paste large file contents back to me. Report only results."*

Repo: `C:\Users\lovel\Desktop\solana-bot`. Node ESM project. Everything below already works —
your job is to extend tests, finish hardening, and make going live a 2-step action for me.

---

## STATE (already done, validated — do NOT redo)

A regime-conditional trailing take-profit was added and proven:
- Real 310d bear data: **+4.33% → +9.29%**, same 10.48% maxDD, win 70%→79%.
- Monte-Carlo bull regimes (`backtest/montecarlo.mjs`): **+3.9 to +4.7pp** vs old.
- Plateau-robust (give-back 8–12% all = +9.29%), backward-compatible (flags off = old +4.33%).
- Live parity done: `src/bot-lib.mjs` (specialization, anchor cooldown, writes
  `state/regime.json`), `src/executor.mjs` (trailing PT), `src/backtest.mjs`, `src/common.mjs`.
- `.env` restored to validated params (old saved `.env.backup-*`). Read `RESULTS-OPUS.md` for full detail.

New config keys (in `.env` and `src/common.mjs`): `TRAIL_IN_UPTREND=1 TRAIL_ARM_PCT=2.0
TRAIL_GIVE_PCT=10 INTRABAR_STOPS=1 ANCHOR_COOLDOWN_BARS=2 BOT_SPECIALIZATION_ENABLED=1 BEAR_RSI_MAX=35`.

## KNOWN ENVIRONMENT GOTCHA (important)
The Windows↔Linux mount **truncates large files written by the Edit/Write tools** mid-save
(syntax errors at the tail). WORKAROUND: edit `src/*.mjs` from the **shell** (python/sed/cat),
not the Edit tool. After ANY edit run `node --check <file>` immediately. If truncated, repair
the tail with `head -n N file > /tmp/x && cat tail >> /tmp/x && cat /tmp/x > file`. `rm` is
blocked on the mount; overwrite with `>` instead.

## Commands
```
node src/backtest.mjs --data backtest/data/sol-usd-1d.json   # real bear (expect +9.29%)
node src/backtest.mjs                                         # all data files
node backtest/montecarlo.mjs                                  # regime stress test
node --check src/<file>.mjs                                   # syntax gate after edits
```
Live/runtime scripts (from package.json): `npm run all` = run everything live (bots+executor),
`npm run dry-run` = full pipeline dry, `npm run shadow` = shadow mode, `npm run ui` = dashboard,
`npm run wallet:new` = generate wallet, `npm run smoke` = quick check. `npm test`/`npm run preflight`
do NOT exist yet — you create them in tasks 2 and 5.

Baseline to reproduce old champion (sanity): append
`TRAIL_IN_UPTREND=0 INTRABAR_STOPS=0 ANCHOR_COOLDOWN_BARS=0 BOT_SPECIALIZATION_ENABLED=0` → +4.33%.

---

## TASK LIST (do in order; each is independently committable)

### 1. Get REAL multi-regime data (highest value — unblocks true OOS proof)
External APIs (Coinbase/Binance/CoinGecko/Kraken) were blocked in the prior environment and
no browser was connected. RETRY here:
- `node backtest/fetch-data.mjs` (Coinbase). If it fills `backtest/data/*-bull.json` and
  `*-full.json` (currently empty `[]`), re-run all backtests + walk-forward on the real
  bull/full history and report whether +9.29%-class results hold out-of-sample.
- If still blocked, say so and SKIP — do not fake data. The Monte-Carlo test already covers
  regime robustness.

### 2. Add an automated test gate (`npm test`)
Create `src/selftest.mjs` that asserts and exits non-zero on failure:
- legacy flags off reproduces +4.33% (±0.05) on `sol-usd-1d.json`;
- new defaults give ≥ +9.0% on same;
- `runBacktest` on a synthetic +0.9%/day path returns > a synthetic -0.6%/day path;
- `botTick` (simulated) runs and writes `state/regime.json`.
Wire `"test": "node src/selftest.mjs"` into `package.json`. Run it; make it green.

### 3. Walk-forward robustness sweep (anti-overfit)
Extend `backtest/montecarlo.mjs` or add `backtest/walkforward.mjs`: fit `TRAIL_GIVE_PCT` on
train (first 70% of real bear) and report test (last 30%) — confirm chosen give-back stays in
the 8–12 plateau. Document the OOS number. (Prior run: train +9.34% / test +1.39%, both +.)

### 4. Parameter stability check on the live levers
For `TRAIL_GIVE_PCT ∈ {8,10,12}`, `STOP_LOSS_PCT ∈ {6,8,10}`, `PROFIT_TARGET_PCT ∈ {1.5,2,2.5}`:
run the real bear backtest + Monte-Carlo mean, print a small grid. Pick the most robust cell
(highest *minimum* across regimes, not highest peak). If it differs from current defaults,
update `.env` + `src/common.mjs` defaults via shell and re-verify.

### 5. Pre-flight / go-live safety (make live a 2-action task for me)
- Verify `src/common.mjs validateConfig()` blocks real mode unless `PROFIT_WALLET` set,
  `PRIVATE_KEY` or `state/generated-wallet.json` present, RPC not devnet, real caps sane.
- Add `npm run preflight` (`src/preflight.mjs`) that prints a checklist and PASS/FAIL for:
  config valid, data present, `npm test` green, simulated dry-run of one bot+executor tick OK,
  wallet/profit-wallet presence, `DRY_RUN`/`EXECUTION_MODE` current values. It must NOT trade.
- Confirm `EXECUTION_MODE=real DRY_RUN=1` does a full shadow pass without sending a tx.

### 6. Final go-live instructions for me (write to `GO-LIVE.md`)
Exactly the minimal actions I must take, in order, e.g.:
1) set `PROFIT_WALLET` to my address in `.env`;
2) fund the address in `state/generated-wallet.json` with ~$10 USDC + ~0.05 SOL;
3) `npm run preflight` (must PASS);
4) start with `EXECUTION_MODE=real DRY_RUN=1` for one session to watch shadow logs;
5) flip `DRY_RUN=0`. Keep `REAL_MAX_NOTIONAL_USDC`/daily caps tiny for the first live day.
Include the exact start command(s) from `package.json` (check `scripts`).

---

## RULES
- Treat this as production money code. After every file edit: `node --check`, then run the
  relevant backtest. Never leave a file failing syntax.
- Do NOT enable larger position sizing or raise the 60% inventory cap without explicit OK —
  it changes the risk profile (bigger drawdowns). Note it as an option in `GO-LIVE.md` only.
- Never execute a real trade or move funds yourself. Going live is the user's action.
- Keep edits minimal and reversible; `.env` backups already exist as `.env.backup-*`.
- If real bull data can't be fetched, the strategy remains validated only on one bear path +
  synthetic regimes — say so plainly; don't overclaim.

## Definition of done
`npm test` green, `npm run preflight` PASS in simulated mode, Monte-Carlo + real backtest
numbers reported, `GO-LIVE.md` written, and a one-paragraph summary of what (if anything)
changed in the param grid. Then I run the GO-LIVE steps.
