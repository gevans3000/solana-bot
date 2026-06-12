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
# (node tools/bt.mjs <knobs> --thirds --data "1h-540d,1d" — must win most segments incl. #3).

## 1. MIN_SOL_RESERVE 0.005 (validated, deliberately not taken — needs George's OK)
0.005 beats the applied 0.01 on every metric: 1h -6.37 -> -6.02, bear 10.42 -> 10.92,
and wins ALL walk-forward thirds. We kept 0.01 for live gas/rent margin (0.005 SOL ~ $0.75).
If George okays the thinner reserve:
  node tools/bt.mjs minSolReserve=0.005 --thirds --data "1h-540d,1d"
Then: sed MIN_SOL_RESERVE in .env + .env.example. The legacy pin in selftest Test 1 stays
0.02 (that is the historical legacy value, it does not track .env). Re-run npm run test:all.

## 2. Block BUYS while regime is deeply negative (regime detection, backlog #3)
A regime-breakdown EXIT (sell all when regimeStrength <= -X%) was probed and is NEUTRAL at
X>=5 — trail/stops already empty the position by then. But the bot KEEPS BUYING during a
-71% collapse (BEAR bot buys every RSI<35 flush); those buys + their stop-losses are the
remaining bleed on 1h-540d. Untested variant: suppress all BUY signals while
regimeStrength <= -X (sweep X = 3,5,8,10,15). Implement as gated knob (default 0=off) inside
botTick (it has emaFast/emaSlow), backtest.mjs first; wire bot-lib parity only if it validates.
This is the highest-expected-value untested idea.

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
