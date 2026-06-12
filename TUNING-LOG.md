# Tuning log (self-audit history)

- 2026-06-05T12:50:40.454Z — NO_CHANGE — bear 9.42%→9.42% upside 10.84%→10.84% — best candidate +0.00pp < 0.5pp threshold
- 2026-06-05T12:51:14.468Z — NO_CHANGE — bear 9.42%→9.42% upside 10.84%→10.84% — best candidate +0.00pp < 0.5pp threshold
- 2026-06-05T13:01:11.940Z — NO_CHANGE — bear 9.42%→9.42% upside 10.84%→10.84% — best candidate +0.00pp < 0.5pp threshold
- 2026-06-05T13:09:58.619Z — NO_CHANGE — bear 9.42%→9.42% upside 10.84%→10.84% — best candidate +0.00pp < 0.5pp threshold
- 2026-06-06T13:57:48.519Z — APPLY_REVERTED (reviewer override) — candidate th=8/up=3/dn=0.5 gained +12.03pp mean upside but ALL honest/intraday timeframes regressed (1h-540d -11.64→-11.98); overfit to 1d-full daily candle. Reverted to proven th=7.0/up=2.0/dn=0.75; tests green. Net: NO_CHANGE.
- 2026-06-06T15:16:58.288Z — NO_CHANGE — bear 9.53%→9.59% upside 57.50%→69.54% — 1h-540d regressed (-11.64%→-11.98%) — overfit guard blocked apply
- 2026-06-06T23:41:51.662Z — RECOMMEND — bear 9.53%→9.54% upside 57.50%→69.39% — report-only flag set
- 2026-06-07T00:36:54.312Z — RECOMMEND — bear 9.53%→9.54% upside 57.50%→69.39% — report-only flag set
- 2026-06-07T00:37:38.787Z — NO_CHANGE — bear 9.53%→9.54% upside 57.50%→69.39% — best candidate +11.89pp < 0.5pp threshold
- 2026-06-07T13:12:10.874Z — NO_CHANGE — bear 9.53%→9.54% upside 57.50%→69.39% — best candidate +11.89pp < 0.5pp threshold
- 2026-06-07T13:13:01.605Z — NO_CHANGE — bear 9.53%→9.54% upside 57.50%→69.39% — best candidate intraday +0.00pp < 0.5pp threshold (overall +11.89pp is daily-candle-driven, not actionable)

- 2026-06-07T13:14:00Z — NO_CHANGE — bear 9.53%→9.53% upside 57.50%→57.50% — best candidate intraday +0.00pp < 0.5pp (overall +11.89pp is daily-candle-driven); self-audit.mjs recovered from truncation; tests 10/10
- 2026-06-10T20:43:19.962Z — NO_CHANGE — bear 9.36%→9.35% upside 36.95%→34.66% — best candidate intraday +0.11pp < 0.5pp threshold (overall +-2.29pp is daily-candle-driven, not actionable)
- 2026-06-10T20:44:45.530Z — NO_CHANGE — bear 9.36%→9.35% upside 36.95%→34.66% — best candidate intraday +0.11pp < 0.5pp threshold (overall +-2.29pp is daily-candle-driven, not actionable)
- 2026-06-11T12:09:59.273Z — NO_CHANGE — bear 9.36%→9.35% upside 36.95%→34.66% — best candidate intraday +0.11pp < 0.5pp threshold (overall +-2.29pp is daily-candle-driven, not actionable)
- 2026-06-11T20:35:34.902Z — NO_CHANGE — bear 9.48%→9.48% upside 38.35%→38.35% — best candidate intraday +0.00pp < 0.5pp threshold (overall +0.00pp is daily-candle-driven, not actionable)
- 2026-06-12T00:11:23.497Z — NO_CHANGE — bear 9.48%→9.48% upside 38.35%→38.35% — best candidate intraday +0.00pp < 0.5pp threshold (overall +0.00pp is daily-candle-driven, not actionable)
- 2026-06-12 (manual session, Fable) — APPLY — MIN_SOL_RESERVE 0.02→0.01 — 1h-540d -7.12→-6.37 (+0.75pp), bear 9.48→10.42, 15m +0.20, 5yr +2.03, full +2.02; 5m -0.29, 1m -0.24, bull -1.51 (less dead inventory in bear = slightly less ride in bull). Structural: the unsellable reserve rode SOL's -71.7% through the 1h window. Monotone plateau (0.005-0.018 all positive on 1h), walk-forward: wins ALL 3 thirds on 1h AND 1d. 17-knob single sweep + combos found NOTHING else: config is at a local optimum; rsiPeriod=22/rsiOverbought=75 (+0.3 each) fail walk-forward (middle third -3.7pp); bounceBypassRsi=30 adds +19 trades on 1h but monotonically degrades 5m/1m. Tests 23/23+10/10.
- 2026-06-12 night (manual, Fable) — DATA REFRESH + APPLY — fetch-data.mjs rewritten (Coinbase primary; 451 was Binance geo-block). All 8 sets refreshed to 2026-06-12. Source validated: old bear window Coinbase 10.40 vs Yahoo-cache 10.42. ROLLING bear window broke the floor (2.08) after SOL -19% June leg; re-opt applied TRAIL_GIVE_PCT 10->14 + BEAR_RSI_MAX 35->30: bear 15.08, 1h -0.17 (73 tr), intraday mean -0.87, dailies ~unchanged. regimeBuyBlockPct (idea #2) tested DEAD (0.00 everywhere). Legacy Test 1 re-pinned 4.33->6.68 (data-driven). Tests 23/23+10/10.
