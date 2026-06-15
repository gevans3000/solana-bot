# Parameter Sensitivity Analysis Report

**Generated:** 2026-06-15T13:48:24.974Z
**Data:** 1988 candles (1987 days) — sol-usd-1d-full.json
**Metric:** Sharpe Proxy (Return/MaxDD)
**Sobol Samples:** 300 (N × (d+2) = 8700 backtests)

---

## 📊 Variance Decomposition

| Component | Value |
|-----------|-------|
| Total First-Order (ΣS₁) | 1.438 |
| Total-Order (ΣST) | 2.098 |
| Interaction Strength | 0.660 |

**Interpretation:** 🔴 Strong parameter interactions — joint tuning required

---

## 🔴 Critical Parameters (ST > 0.10) — **Must Tune Carefully**

| Parameter | Category | S₁ (Main) | ST (Total) | Interaction | Safe Range |
|-----------|----------|-----------|------------|-------------|------------|
| bullRegimeThreshold | Regime | 0.191 | 0.394 | 0.203 | 4.60 – 15.00 |
| emaPeriod | Trend | 0.178 | 0.316 | 0.138 | 18.00 – 30.00 |
| trailGivePct | Exit | 0.102 | 0.305 | 0.202 | 4.00 – 12.00 |
| bullTrailGivePct | Exit | 0.058 | 0.291 | 0.233 | 10.00 – 40.00 |
| regimeEmaSlow | Regime | 0.152 | 0.261 | 0.110 | 40.00 – 72.00 |
| minSolReserve | Risk | 0.095 | 0.199 | 0.103 | 0.01 – 0.01 |
| bearRsiMax | Entry | 0.088 | 0.165 | 0.077 | 20.00 – 45.00 |

## 🟠 Important Parameters (0.05 < ST ≤ 0.10) — **Tune with Care**

| Parameter | Category | S₁ | ST | Interaction | Safe Range |
|-----------|----------|----|----|-------------|------------|
| rsiPeriod | RSI | 0.000 | 0.061 | 0.061 | 7.00 – 21.00 |

## 🟡 Moderate Parameters (0.01 < ST ≤ 0.05) — **Default Usually Fine**

| Parameter | Category | S₁ | ST | Interaction | Safe Range |
|-----------|----------|----|----|-------------|------------|
| bullMinSolHold | Risk | 0.023 | 0.034 | 0.010 | 0.00 – 1.00 |
| stopLossPct | Exit | 0.026 | 0.020 | -0.005 | 4.00 – 4.00 |
| anchorCooldownBars | Gates | 0.003 | 0.018 | 0.015 | 0.00 – 10.00 |
| rsiOversold | RSI | 0.034 | 0.014 | -0.020 | 25.00 – 45.00 |

## 🟢 Robust Parameters (ST ≤ 0.01) — **Set & Forget**

| Parameter | Category | S₁ | ST | Safe Range |
|-----------|----------|----|----|------------|
| trailArmPct | Exit | 0.034 | 0.007 | 0.50 – 5.00 |
| simSlippageBps | Costs | 0.028 | 0.006 | 2.00 – 16.00 |
| regimeSizeUpMult | Sizing | 0.035 | 0.006 | 1.00 – 4.00 |
| bullDipPct | Entry | 0.030 | 0.001 | 0.20 – 2.00 |
| rsiOverbought | RSI | 0.033 | 0.000 | 60.00 – 85.00 |
| simFeeBps | Costs | 0.031 | 0.000 | 10.00 – 60.00 |
| bullDipScale | Regime | 0.033 | 0.000 | 1.00 – 6.00 |
| profitTargetPct | Exit | 0.034 | 0.000 | 1.00 – 8.00 |
| bearDipPct | Entry | 0.033 | 0.000 | 0.30 – 3.00 |
| bearRipPct | Entry | 0.033 | 0.000 | 0.50 – 5.00 |
| bullRipPct | Entry | 0.032 | 0.000 | 0.50 – 4.00 |
| regimeSizeDownMult | Sizing | 0.033 | 0.000 | 0.30 – 1.00 |
| bullBuyPctOfUsdc | Sizing | 0.033 | 0.000 | 0.05 – 0.30 |
| minExpectedEdgeBps | Gates | 0.033 | 0.000 | 0.00 – 30.00 |
| maxSolAllocationPct | Risk | 0.033 | 0.000 | 30.00 – 90.00 |

---

## 🌪️ Tornado Chart (OAT Sensitivity — Max Delta from Base)

Sorted by maximum impact on Sharpe Proxy when varying parameter across full range.

| Rank | Parameter | Category | Base Value | Max Δ Sharpe~ | Range Tested | Sensitivity/Unit |
|------|-----------|----------|------------|---------------|--------------|------------------|
| 1 | stopLossPct | Exit | 8 | 3.489 | 4–20 | 0.2181 |
| 2 | simSlippageBps | Costs | 8 | 2.256 | 2–20 | 0.1253 |
| 3 | minSolReserve | Risk | 0.05 | 2.127 | 0.01–0.20 | 11.1929 |
| 4 | trailGivePct | Exit | 12 | 1.533 | 4–25 | 0.0730 |
| 5 | regimeEmaSlow | Regime | 50 | 1.416 | 40–80 | 0.0354 |
| 6 | emaPeriod | Trend | 20 | 1.235 | 10–30 | 0.0617 |
| 7 | bullRegimeThreshold | Regime | 7 | 1.096 | 2–15 | 0.0843 |
| 8 | trailArmPct | Exit | 2 | 0.155 | 0.50–5.00 | 0.0344 |
| 9 | bullDipPct | Entry | 0.5 | 0.151 | 0.20–2.00 | 0.0840 |
| 10 | anchorCooldownBars | Gates | 2 | 0.149 | 0–10 | 0.0149 |
| 11 | rsiPeriod | RSI | 14 | 0.135 | 7–21 | 0.0096 |
| 12 | simFeeBps | Costs | 30 | 0.110 | 10–60 | 0.0022 |
| 13 | bullRipPct | Entry | 1.5 | 0.028 | 0.50–4.00 | 0.0081 |
| 14 | bearRsiMax | Entry | 35 | 0.011 | 20–45 | 0.0004 |
| 15 | regimeSizeDownMult | Sizing | 0.75 | 0.009 | 0.30–1.00 | 0.0129 |
| 16 | rsiOversold | RSI | 40 | 0.000 | 25–45 | 0.0000 |
| 17 | rsiOverbought | RSI | 70 | 0.000 | 60–85 | 0.0000 |
| 18 | profitTargetPct | Exit | 3 | 0.000 | 1–8 | 0.0000 |
| 19 | bullTrailGivePct | Exit | 25 | 0.000 | 10–40 | 0.0000 |
| 20 | bearDipPct | Entry | 0.8 | 0.000 | 0.30–3.00 | 0.0000 |

---

## ✅ Safe Operating Ranges (Within 15% of Base Sharpe)

Parameters where you can move freely without significant performance degradation.

| Parameter | Base | Safe Min | Safe Max | Width (% of Range) | Status |
|-----------|------|----------|----------|-------------------|--------|
| rsiOversold | 40 | 25 | 45 | 100% | 🟢 Wide |
| rsiOverbought | 70 | 60 | 85 | 100% | 🟢 Wide |
| rsiPeriod | 14 | 7 | 21 | 100% | 🟢 Wide |
| profitTargetPct | 3 | 1 | 8 | 100% | 🟢 Wide |
| trailArmPct | 2 | 0.5 | 5 | 100% | 🟢 Wide |
| bullTrailGivePct | 25 | 10 | 40 | 100% | 🟢 Wide |
| bullDipPct | 0.5 | 0.2 | 2 | 100% | 🟢 Wide |
| bullRipPct | 1.5 | 0.5 | 4 | 100% | 🟢 Wide |
| bearDipPct | 0.8 | 0.3 | 3 | 100% | 🟢 Wide |
| bearRipPct | 2.1 | 0.5 | 5 | 100% | 🟢 Wide |
| bearRsiMax | 35 | 20 | 45 | 100% | 🟢 Wide |
| bullDipScale | 3 | 1 | 6 | 100% | 🟢 Wide |
| regimeSizeUpMult | 2 | 1 | 4 | 100% | 🟢 Wide |
| regimeSizeDownMult | 0.75 | 0.3 | 1 | 100% | 🟢 Wide |
| bullBuyPctOfUsdc | 0.15 | 0.05 | 0.3 | 100% | 🟢 Wide |
| anchorCooldownBars | 2 | 0 | 10 | 100% | 🟢 Wide |
| minExpectedEdgeBps | 5 | 0 | 30 | 100% | 🟢 Wide |
| maxSolAllocationPct | 60 | 30 | 90 | 100% | 🟢 Wide |
| bullMinSolHold | 0 | 0 | 1 | 100% | 🟢 Wide |
| simFeeBps | 30 | 10 | 60 | 100% | 🟢 Wide |
| regimeEmaSlow | 50 | 40 | 72 | 80% | 🟢 Wide |
| bullRegimeThreshold | 7 | 4.6 | 15 | 80% | 🟢 Wide |
| simSlippageBps | 8 | 2 | 16 | 78% | 🟢 Wide |
| emaPeriod | 20 | 18 | 30 | 60% | 🟢 Wide |
| trailGivePct | 12 | 4 | 12 | 38% | 🟡 Moderate |
| stopLossPct | 8 | 4 | 4 | 0% | 🔴 Narrow |
| minSolReserve | 0.05 | 0.01 | 0.01 | 0% | 🔴 Narrow |

---

## 🔑 Key Interactions (ST - S₁ > 0.02)

Parameters whose effect depends heavily on other parameters.

| Parameter | Interaction | Category | Implication |
|-----------|-------------|----------|-------------|
| bullTrailGivePct | 0.233 | Exit | Tune jointly with related params |
| bullRegimeThreshold | 0.203 | Regime | Tune jointly with related params |
| trailGivePct | 0.202 | Exit | Tune jointly with related params |
| emaPeriod | 0.138 | Trend | Tune jointly with related params |
| regimeEmaSlow | 0.110 | Regime | Tune jointly with related params |
| minSolReserve | 0.103 | Risk | Tune jointly with related params |
| bearRsiMax | 0.077 | Entry | Tune jointly with related params |
| rsiPeriod | 0.061 | RSI | Tune jointly with related params |

---

## 📋 Recommendations

1. **Focus tuning effort on:** bullRegimeThreshold, emaPeriod, trailGivePct
2. **Safe defaults for:** trailArmPct, simSlippageBps, regimeSizeUpMult, bullDipPct, rsiOverbought
3. **Watch interactions between:** bullTrailGivePct, bullRegimeThreshold, trailGivePct
4. **Safe operating region:** Keep emaPeriod, regimeEmaSlow, rsiOversold, rsiOverbought, rsiPeriod in their safe ranges
5. **Cost sensitivity:** Fees/slippage have low impact on strategy logic

---

## 🎯 Suggested Configuration (Robust Defaults)

```json
{
  "emaPeriod": 20,
  "regimeEmaSlow": 50,
  "rsiOversold": 40,
  "profitTargetPct": 3.0,
  "stopLossPct": 8,
  "trailGivePct": 12,
  "bullDipPct": 0.5,
  "bearDipPct": 0.8,
  "bullTrailGivePct": 25,
  "anchorCooldownBars": 2
}
```

*All parameters set to base values which lie within safe operating ranges.*
