# Ideas for a Sonnet session — ranked, with exact test commands
# Context: 2026-06-12 Fable session swept all 17 strategy knobs (singles + combos of winners).
# Config is at a LOCAL OPTIMUM for entry knobs. The one validated win (MIN_SOL_RESERVE
# 0.02->0.01) is applied. Everything below is promising but UNVALIDATED — test before applying.
#
# Tools: tools/bt.mjs (single run) and tools/sweep.mjs (grid, deltas vs current .env baseline).
#   node tools/bt.mjs [knob=val ...] [--data "1d,1h-540d,..."] [--thirds]
#   node tools/sweep.mjs knob=v1,v2,v3 [knob2=...]        # all 8 datasets, ~30s total
# Validation bar (HARD): bear (1d) >= 9.0; judge by 1h-540d + intraday mean (1h/15m/5m/1m),
# NEVER by daily sets alone; winner needs smooth plateau + walk-forward thirds majority
# (node tools/bt.mjs <knobs> --thirds --data "1h-540d,1d" — must win most segments incl. #3)
# + TWO-WINDOW (added 2026-06-12): must also hold on the PREVIOUS data window:
#   node tools/bt.mjs <knobs> --git <last-data-refresh-commit>
# (proven necessary: trail=14 fitted on fresh data scores bear 8.49 on the prior window).

## 1. MIN_SOL_RESERVE 0.005 (needs George's OK; re-validate on fresh data first)
On the retired cached data 0.005 beat 0.01 everywhere and won all thirds. On 2026-06-12
fresh data (pre-trail-fix baseline) it was still directionally good: 1h +0.31, bear +0.44,
intraday +0.18. Re-run the full bar under the new TRAIL_GIVE_PCT=14/BEAR_RSI_MAX=30 config.
We keep 0.01 for live gas/rent margin (0.005 SOL ~ $0.75).
If George okays the thinner reserve:
  node tools/bt.mjs minSolReserve=0.005 --thirds --data "1h-540d,1d"
Then: sed MIN_SOL_RESERVE in .env + .env.example. The legacy pin in selftest Test 1 stays
0.02 (that is the historical legacy value, it does not track .env). Re-run npm run test:all.

## 2. Block BUYS while regime is deeply negative — TESTED 2026-06-12: DEAD
Probed as gated knob regimeBuyBlockPct (suppress buyAllowed when regimeStrength <= -X) and
swept X=3,5,8,10,15 on FRESH data: delta is EXACTLY 0.00 on all 8 datasets at every X.
Two reasons: (a) downtrend buys are already suppressed by sizing — regimeSizeDownMult(0.75)
x bearBuyUsdc(1) < minTradeUsdc(1) kills the signal unless RSI-scale lifts it; (b) in the
June 2026 crash the buys fire EARLY, while the lagging EMA-45 regime is still > -3%.
LESSON: a lagging-EMA gate cannot catch a fast crash. The successor idea is #2b below.

## 2b. FAST crash detector — TESTED 2026-06-12: BOTH VARIANTS DEAD
Probed price-vs-rolling-high crash mode (crashDropPct x crashLookbackBars grid: drop 5-25,
lookback 5-50) in two flavors:
- BUY-BLOCK in crash mode: exact 0.00 on bear/1h/intraday everywhere (buys are $1-2 — they
  were never the bleed; only daily-candle sets twitch, mixed).
- EXIT-TO-RESERVE in crash mode: catastrophic wherever it fires — 5yr 174 -> 3..25,
  full 86 -> 51..66, bull 83 -> 3..48, 1h -10.4 at drop=10. Selling into crashes misses
  every V-recovery; the trail give-back already handles exits with better timing.
VERDICT: the June-leg weakness is the cost of being long-biased through a fast leg down;
crash heuristics on THIS strategy either never fire usefully or whipsaw. Do not re-probe
without a fundamentally different mechanism (e.g. hedging, or regime-scaled position caps).

## 3. Conflict resolution by edge (executor decide())
decide() returns NO_TRADE when BULL and BEAR disagree (180s window). 2026-06-11 live analysis:
every BEAR BUY that day was killed by 3-5 BULL SELLs in-window. Variant: on conflict, take the
signal with the larger |edgeBps| instead of dropping both. Gated knob, change decide() in
backtest.mjs (threading a flag), parity in executor.mjs decide(). More trades + uses information
already computed. Risk: the conflict gate may BE the edge — validate hard.

## 4. bounceBypassRsi (rejected at 10s-granularity, retest on new data)
Bypass ENTRY_BOUNCE_CONFIRM when RSI < 30 (catch V-bottom capitulation without waiting a bar).
On 1h: +0.20pp AND +19 trades (45->64, win 87%) — exactly the frequency goal. REJECTED because
5m/1m degrade monotonically (knife-catching at fine granularity, which live 10s polling
resembles). Retest when intraday datasets covering a DIFFERENT regime exist, or try a variant
that only bypasses for the BULL bot (uptrend context). Probe sed (backtest.mjs line ~171):
  sed -i 's/price > botState.prevClose;/price > botState.prevClose || (P.bounceBypassRsi > 0 \&\& rsiVal != null \&\& rsiVal < P.bounceBypassRsi);/' src/backtest.mjs
  node tools/sweep.mjs bounceBypassRsi=25,30,32
  git restore src/backtest.mjs   # if it fails again

## 5. Measure pure strategy alpha (diagnostic, not a knob)
The sim starts with 0.5 SOL whose cost basis enters as ~0 on the first BUY, so early "profit"
and the first whole-position trail exit are partly phantom. Quantify how much of every
dataset's return is starting-inventory artifact:
  node tools/bt.mjs simStartSol=0 simStartUsdc=164 --data "1h-540d,1d,1d-5yr"
If 1h flips strongly positive with simStartSol=0, the headline -6.37 is inventory drag, not
strategy weakness — changes what to optimize next (inventory management, not entries).

## 6. Daily-candle-only winners (PARKED — do not apply on current data)
These improve ONLY daily sets with intraday flat (the overfit signature the 3-layer gate
rejects). Revisit ONLY when intraday data covering a real bull regime exists:
  minExpectedEdgeBps=10..20  (full +74.6pp)    regimeSizeHighRsi=70..80 (5yr +15pp)
  anchorCooldownBars=0..1    (full +6.4pp)     bullDipScale=2 or 4      (full +5.7/+8.5pp)
  trailArmPct=1.0            (full +5.6pp)     BULL_TRAIL_GIVE_PCT=35   (full +232pp, 06-10 log)

## 7. Knife-edge knobs (FAILED walk-forward twice — needs more history, not more sweeps)
rsiPeriod=18..24 and rsiOverbought=75 each show +0.2-0.3pp on full 1h-540d but LOSE the middle
third by ~3.7pp (single-trade path dependence). Their combo CRASHES 1h to -13.5. Do not chase
without longer 1h history. If 1h data grows (Yahoo 451-blocks fetch from this machine —
fix data sourcing first, e.g. Binance klines API in backtest/fetch-data.mjs), rerun:
  node tools/bt.mjs rsiPeriod=22 --thirds --data "1h-540d"

## 8. Structural (bigger lifts, in priority order from backlog)
- Multi-timeframe confirm: require 1h-trend agreement for 10s-loop entries (live executor reads
  regime.json which is built from the live tick stream; a slow-EMA-on-1h-candles input would
  decouple regime from poll cadence).
- Asymmetric sizing (backlog #4): scale buy size DOWN as drawdown-from-equity-peak grows
  (runBacktest already tracks peakEquity/maxDD — expose to sizing).
- Replace Yahoo data source (HTTP 451 everywhere now): Binance klines (SOLUSDT) has 1m..1d,
  free, no key, 1000-candle pages. Rewrite backtest/fetch-data.mjs; keeps datasets refreshable.

## 9. Tested 2026-06-12 on fresh data — verdicts with numbers (do not re-test blind)
- APPLIED: TRAIL_GIVE_PCT 10->14 (bear 2.08->15.08, plateau 13-16, 17-20 still 9.66; 1h -0.07)
  + BEAR_RSI_MAX 35->30 (flat plateau 25-32, all identical: 1h -0.65->-0.17, +4 trades,
  daily sets bit-identical). Combo thirds: 1h wins/ties all 3; bear wins 2/3 (loses June leg).
- stopLossPct tighter: 5 -> 1d-full 86->31 (-55pp), 4 -> 5yr 174->84. DEAD on daily sets.
- entryBounceConfirm=false on fresh data: 1h -0.65 -> -7.72. Bounce-confirm is still load-bearing.
- regimeEmaSlow 50/55 on fresh data: 1h -7.3/-7.2. 45 confirmed. 40 neutral-ish (1h -0.01).
- bullDipPct 0.6: 1h +0.25, 89 trades — but spike, not plateau (0.5 and 0.7 both negative).
  Possible frequency lead if it firms up after other changes; re-check with --thirds.

## 10. Sell notional floor (MIN_SELL_NOTIONAL_MULT) — TESTED 2026-06-12: KEEP OFF
Live finding: all 825 live rip-SELL signals are 0.01 SOL = $0.67 < MIN_TRADE_USDC, auto-skipped.
Implemented gated floor (effSell >= minTradeUsdc*mult/price; parity backtest.mjs + bot-lib.mjs).
Sweep mult 1.0-3.0: intraday mean +0.17..+0.57 BUT 1h -0.28..-0.42 and daily sets bleed hard
(fresh window: 5yr -21..-54, full -16..-41; OLD window confirms: 5yr -35, full -20).
VERDICT: skipping sub-$1 rip-sells IS the validated optimum — backtest skips them identically
(parity already held), and live profit-taking flows through the executor trail/PT path which
sells whole positions (not size-blocked). Knob ships default-0; enable only if SOL falls so far
that trail/PT exits themselves drop under MIN_TRADE_USDC.
