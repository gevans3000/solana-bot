# SCOPE DOCUMENT: Solana SOL/USDC Trading Bot
## Deployment Constraints & Operational Boundaries

**Version:** 1.0 | **Date:** 2026-06-15 | **Author:** Red Team Review | **Status:** ENFORCED

---

## ⚠️ CORE MANDATE (READ FIRST)

> **This bot is a BEAR-MARKET CAPITAL PRESERVATION TOOL.**  
> It is NOT a general-purpose trading bot. It does NOT capture bull runs.  
> **Max allocation: 10% of total portfolio.**  
> **Expected live return: -0.5% to +3%/month (backtest says +18%, reality: -18-21pp drag).**  
> **Sharpe: 0.2–0.6 (backtest: 1.8).**  
> **Max Drawdown: 18–25% (backtest: 12%).**

---

## 1. REGIME SCOPE

| Regime | Supported? | Expected Behavior |
|--------|------------|-------------------|
| **Strong Bear** (-30% to -60%) | ✅ **YES** | Primary alpha: +25pp to +50pp vs hold |
| **Mild Bear** (-10% to -30%) | ✅ **YES** | +15pp to +25pp vs hold |
| **Chop/Sideways** (±10%) | ✅ **YES** | Small positive or break-even |
| **Regime Transition** (Bear→Bull) | ⚠️ **PARTIAL** | Late entry, buys near local top |
| **Steady Bull** (+50% to +100%) | ❌ **NO** | Sits in USDC, misses 75%+ of move |
| **Hyper-Bull** (+100%+) | ❌ **NO** | Sits in USDC, misses 100%+ of move |
| **Flash Crash** (-30% in 1h) | ❌ **NO** | Stop-loss at 12% from avg entry; may fill at -30% |
| **USDC Depeg** | ❌ **NO** | Holds USDC as "safe" — loses peg exposure |

**RULE:** If regime detection flags strong bull (EMA fast > slow + regimeStrength > 7%), **reduce position size to 50% or pause.**

---

## 2. CAPITAL & RISK LIMITS (ENFORCED IN .env)

| Limit | Value | Enforcement |
|-------|-------|-------------|
| **Max Portfolio Allocation** | **10%** of total net worth | Manual (human) |
| **REAL_MAX_NOTIONAL_USDC** | **$25** per trade | Code (hard limit ≤100) |
| **REAL_DAILY_NOTIONAL_LIMIT_USDC** | **$200**/day | Code (hard limit ≤500) |
| **REAL_MAX_TRADES_PER_DAY** | **20** | Code |
| **Daily Loss Circuit Breaker** | **$3**/day | Code (halts all trading) |
| **Min SOL Reserve** | **0.01 SOL** (never sold) | Code |
| **Max SOL Allocation** | **60%** of equity | Code |
| **Stop-Loss** | **12%** from avg entry | Code |
| **Profit Target** | **3%** fixed (trail in uptrend) | Code |

---

## 3. LIVE DEPLOYMENT CHECKLIST (ALL P0 = MANDATORY)

### P0 — DO NOT GO LIVE WITHOUT
- [ ] **Multi-RPC failover configured** (RPC_URLS with ≥2 endpoints in .env)
- [ ] **Reconciliation cron running** (`*/5 * * * * node src/reconcile-cron.mjs`)
- [ ] **Position caps at conservative levels** (REAL_MAX_NOTIONAL_USDC=10 for first 30 days)
- [ ] **Process supervisor active** (pm2/systemd with health check + auto-restart)
- [ ] **Explicit scope acknowledgment** (signed: "I understand this misses bull runs")
- [ ] **Wallet funded** (≥0.1 SOL + ≥$50 USDC)
- [ ] **Discord alerts configured** (ALERT_WEBHOOK_URL set)

### P1 — BEFORE SCALING
- [ ] Shadow mode 14 days with ≥10 dry trades verified
- [ ] Jito bundles + dynamic priority fees implemented
- [ ] Prometheus metrics + Grafana dashboard
- [ ] Chaos test: kill mid-trade, verify reconciliation

---

## 4. PROHIBITED ACTIONS

| Action | Reason |
|--------|--------|
| Increase REAL_MAX_NOTIONAL_USDC > $25 without 30-day shadow validation | Blast radius control |
| Disable circuit breaker (DAILY_LOSS_LIMIT_USDC=0) | Removes only hard stop |
| Run without multi-RPC (single RPC_URL only) | Single point of failure |
| Run without reconciliation cron | UNCONFIRMED trades = blind portfolio |
| Allocate >10% portfolio without red-team re-review | Strategy scope violation |
| Expect bull market capture | Strategy explicitly misses 100%+ moves |
| Disable CONFLICT_EDGE_RESOLUTION | Free signal recovery, zero cost |

---

## 5. MONITORING REQUIREMENTS

| Metric | Alert Threshold | Action |
|--------|-----------------|--------|
| **No tick for >5 min** | Page immediately | Bot crashed or RPC dead |
| **RPC failover triggered** | Alert on first failover | Investigate primary RPC |
| **UNCONFIRMED > 30 min** | Alert | Manual check required |
| **Circuit breaker tripped** | Page | Trading halted for day |
| **Daily trades > 15** | Alert | Unexpected frequency spike |
| **Max DD > 10%** | Alert | Regime shift check |
| ** Wallet SOL < 0.02** | Page | Fund immediately |

---

## 6. REGIME DETECTION RULES (AUTOMATED)

```javascript
// In executor.mjs - these ARE the live rules
const regimeUp = emaFast > emaSlow;                    // Fast 20 > Slow 45
const regimeStrengthPct = ((emaFast - emaSlow) / emaSlow) * 100;
const strongBull = regimeStrengthPct >= 10;            // BULL_STRONG_REGIME_PCT

// ACTIONS:
if (strongBull) {
  // 1. Widen trail give-back to 25% (BULL_TRAIL_GIVE_PCT)
  // 2. Keep core SOL floor (BULL_MIN_SOL_HOLD)
  // 3. Allow per-trade notional up to $8 (BULL_MAX_NOTIONAL_USDC) — SIM ONLY!
  // 4. Never applies to REAL mode (safety invariant in common.mjs)
}

// BEAR RULES:
if (rsi < 30) {  // BEAR_RSI_MAX
  // Allow BUY even in downtrend (oversold override)
}

// HUMAN OVERRIDE:
if (regimeStrengthPct > 15) {
  // CONSIDER: Reduce position size, increase stop-loss, or PAUSE
}
```

---

## 7. ESCALATION PROCEDURES

| Event | Response Time | Owner | Action |
|-------|---------------|-------|--------|
| Bot down >5 min | **Immediate** | Human | Check process, RPC, redeploy |
| RPC failover | **5 min** | Human | Verify primary, check secondary |
| Circuit breaker trip | **End of day** | Human | Review trades, decide resume |
| DD > 15% | **1 hour** | Human | Pause bot, analyze regime |
| UNCONFIRMED > 1h | **30 min** | Human | Manual on-chain check |
| Flash crash detected | **Immediate** | Human | Emergency stop, assess damage |

---

## 8. ROLLBACK PROCEDURE

1. **Create DISABLED file:** `echo > DISABLED` (executor checks this every tick)
2. **Verify all positions:** Run reconcile-cron manually
3. **Document state:** Portfolio, trades, regime at rollback time
4. **Root cause analysis:** Before re-enabling
5. **Re-enable:** Remove DISABLED, verify first tick clean

---

## 9. SIGN-OFF

By deploying this bot, you acknowledge:

> [ ] I have read and understand the REGIME SCOPE — this bot misses bull markets  
> [ ] I accept the LIVE PERFORMANCE PROJECTION (-0.5% to +3%/mo, Sharpe 0.2–0.6)  
> [ ] I have completed ALL P0 checklist items  
> [ ] I accept max 10% portfolio allocation  
> [ ] I understand USDC depeg = total loss of "safe" leg  
> [ ] I have tested reconciliation cron and multi-RPC failover  

**Signature:** _______________ **Date:** _______________

---

*This document is ENFORCED. Violations require immediate bot stop and red-team re-review.*