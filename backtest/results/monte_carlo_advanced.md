# Monte Carlo Advanced Simulation Report

**Generated:** 2026-06-15T13:46:09.397Z
**Paths:** 10,000 mixed-regime + NaN pure-regime
**Simulation Horizon:** 365 days
**Start Price:** $100
**Champion Config:** Config C (Tier 2)

---

## 📊 Mixed-Regime (HMM) Results — 10,000 Paths

### Return Distribution
| Percentile | Return (%) |
|------------|------------|
| 1% (Tail)  | -21.21% |
| 5% (VaR95) | -10.46% |
| 10%        | -4.64% |
| 25%        | -1.52% |
| **50% (Median)** | **1.33%** |
| 75%        | 6.04% |
| 90%        | 13.06% |
| 95% (VaR95+) | 20.52% |
| 99%        | 45.88% |

**Mean:** 3.27% | **Std:** 12.60%
**Prob(Positive):** 60.0%

### Max Drawdown Distribution
| Percentile | Max DD (%) |
|------------|------------|
| 5%         | 3.22% |
| 25%        | 4.29% |
| **50% (Median)** | **5.51%** |
| 75%        | 8.64% |
| 95% (Tail) | 19.01% |
| 99% (Extreme) | 27.09% |

**Mean:** 7.45%

### Sharpe Proxy Distribution (Return / MaxDD)
| Percentile | Sharpe Proxy |
|------------|--------------|
| 5%         | -0.68 |
| 25%        | -0.29 |
| **50% (Median)** | **0.24** |
| 75%        | 1.13 |
| 95%        | 2.88 |

**Mean:** 0.59

### Ruin Risk
- **Ruin Probability (DD > 50%):** 0.00%
- **Probability of Positive Return:** 60.0%

---

## 🎯 Pure Regime Analysis

| Regime | Paths | Mean Return | Median Return | Mean MaxDD | Median MaxDD | Ruin Prob |
|--------|-------|-------------|---------------|------------|--------------|-----------|
| BULL   | 1000 | 10.28% | 3.26% | 6.19% | 5.17% | 0.00% |
| BEAR   | 1000 | -6.13% | -1.91% | 13.62% | 9.31% | 0.00% |
| CHOP   | 1000 | 0.15% | -0.47% | 6.83% | 5.07% | 0.00% |

---

## 💥 Stress Test Results

### USDC Depeg (-10% for 10 days)
- **Paths:** 2000
- **Mean Return:** 3.34%
- **Mean Max DD:** 7.57%
- **Worst Case Return:** -29.26%
- **Worst Case Max DD:** 38.35%

### SOL Flash Crash (-50% single day)
- **Paths:** 2000
- **Mean Return:** 2.25%
- **Mean Max DD:** 8.55%
- **Worst Case Return:** -29.26%
- **Worst Case Max DD:** 39.20%

### Jupiter Outage (3 days)
- **Status:** Requires backtest.mjs modification to honor jupiterDown flag — skipped execution
- **Scenario:** 3-day Jupiter API outage at day 100

---

## 📋 Key Takeaways

1. **Regime Robustness:** Strategy performs better in bull markets
2. **Tail Risk:** ⚠️ Significant left tail risk (5% VaR < -10%)
3. **Drawdown Control:** ✅ 95th percentile DD under 30%
4. **Ruin Risk:** ✅ Negligible
5. **Stress Resilience:** ✅ Survives SOL -50% crash

---

## 🔧 Recommendations




- Run walk-forward validation to confirm OOS stability
- Consider regime-detection overlay for dynamic parameter adjustment
