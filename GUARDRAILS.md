# 🛡️ Bot Guardrails & Constitution

This document defines the **Hard Guardrails** for this Solana SOL/USDC bot. To prevent feature creep, instability, and "code rot," all future modifications must adhere to these rules.

---

## ⚖️ Technical Guardrails

### 1. The Separation of Powers
*   **Signaling (Bull/Bear bots)**: Must remain *purely observational*. They read prices and emit signals to `signals.jsonl`. They **CANNOT** access private keys, execute swaps, or make any network call besides price-fetching.
*   **Execution (Shared Executor — `executor.mjs`)**: Must remain the *sole gatekeeper*. Only the executor may call `executeTrade`. All risk checks (daily limits, max notional, cooldowns, decision-window dedup, edge-minimum, balance sufficiency) happen here — never in bots.
*   **State (Portfolio — `portfolio.json`)**: Must remain the *single source of truth*. No component should calculate balances independently; they must read from `loadPortfolio()`.

### 2. Kill Switch
*   A file named `DISABLED` in the project root immediately halts all loops (bots, executor, sweeper). Every `tick()` must check `isDisabled()` first.
*   This is the emergency stop. It must never be bypassed.

### 3. Dependency Freeze
*   Do NOT add new npm dependencies unless they are core Solana (`@solana/web3.js`, `@solana/spl-token`) or `bs58`.
*   Avoid "utility" libraries (Lodash, Axios, Express, etc.). Use native Node.js APIs (`fs`, `path`, `crypto`, `fetch`).

### 4. Network Hygiene
*   **Mandatory HTTP Timeouts**: Every outbound `fetch` call must wrap with an `AbortController` and a maximum **15 s** timeout.
*   **Confirmation Polling**: On-chain transaction confirmation may poll for up to **60 s** (via `getSignatureStatuses`). This is *not* a retry of the swap — the transaction was already submitted. Polling for finality is allowed and expected.
*   **No Auto-Retry of Swaps**: If a Jupiter swap fails or times out at the HTTP/sign/execute stage, do **not** retry. Log the failure and return. If confirmation times out with a valid `txSignature`, log an `UNCONFIRMED` event and flag for **manual reconciliation** — the portfolio must NOT be updated.

### 5. Stale Data Protection
*   **Stale Prices**: If the price cache age exceeds `STALE_PRICE_SEC`, bots must emit `skip_stale_price` and refuse to signal. "No signal" is the only valid response to stale data.
*   **Stale Signals**: The executor filters out any signal older than `STALE_SIGNAL_SEC`. Stale signals are silently discarded.

### 6. Local-First Persistence
*   No external databases (PostgreSQL, MongoDB, Redis).
*   All persistence must remain local `JSON` or `JSONL` files in the `state/` and `logs/` directories.
*   Log rotation is mandatory — files > 5 MB are rotated automatically in `logJsonl()`.

### 7. Concurrency Safety
*   The executor uses `withLock('executor.lock', …)` to guarantee at most one trade evaluation at a time. If the lock is busy, the tick is skipped.
*   Stale locks (older than `loopSec * 4` or 120 s, whichever is greater) are automatically cleaned and re-acquired.

---

## 🔐 Real-Execution Hardening

These rules apply **exclusively** when `EXECUTION_MODE=real`. They are enforced by `validateConfig()` at startup and by the executor at runtime.

| Guard | Enforcement |
|-------|-------------|
| RPC must NOT contain `devnet` | `validateConfig()` throws on startup |
| `PRIVATE_KEY` env or `state/generated-wallet.json` must exist | `validateConfig()` throws on startup |
| `PROFIT_WALLET` must be set and non-empty | `validateConfig()` throws on startup |
| `REAL_MAX_NOTIONAL_USDC ≤ 100` | `validateConfig()` hard ceiling |
| `REAL_DAILY_NOTIONAL_LIMIT_USDC ≤ 500` | `validateConfig()` hard ceiling |
| `DRY_RUN=1` blocks all real trades | Double-gated in both `executeTrade` and `executeRealTrade` |
| Separate `REAL_MAX_TRADES_PER_DAY` | Executor selects real-mode limits when `executionMode === 'real'` |
| Pre-trade intent logged before swap | `trade_intent` event written to `trades.jsonl` before `executeJupiterSwap` |
| Post-trade balances sourced on-chain | After confirmed swap, `getOnChainBalances` refreshes `portfolio.json` |

> **Never bypass these checks.** If you need higher limits, the hard ceilings in `validateConfig()` must be raised explicitly — not removed.

---

## 🌑 Shadow Mode

When `SHADOW_MODE=1`, the bot runs its full signal + execution pipeline against **real prices** but records results to `shadow.jsonl` instead of executing swaps. This is paper-trading.

*   Shadow mode fetches a Jupiter quote before each would-be trade (if `SHADOW_QUOTE_ON_TRADE=1`) so you can compare simulated vs. real slippage.
*   Shadow mode must NEVER touch the wallet or execute a swap. The only allowed network call is the quote request.

---

## 🧘 Philosophical Guardrails

### 1. Config vs. Code
*   If you want to change a numerical value (a dip %, a rip %, a limit), do NOT change the code. Add/edit the value in `.env` and `CFG` in `common.mjs`.
*   All numeric CFG values apply a `Math.max()` floor to prevent misconfiguration (e.g. `loopSec` can never go below 5).
*   The code is a **black box**; the behavior is a **dial**.

### 2. Failure > Uncertainty
*   The bot must **fail fast and loudly** (log the error and stop the loop) rather than guessing or retrying in an uncertain state.
*   Example: If the price is stale → "No Trade" is the only valid response.
*   Example: If a swap confirmation times out → log `UNCONFIRMED`, do NOT update portfolio.

### 3. Small-Diff Mandate
*   Prefer 5-line patches over 100-line refactors.
*   If a feature requires a massive rewrite of the executor, the feature is too complex for this MVP.

---

## 🚦 Feature "Slow Lane"

Before adding a new feature, pass every gate:

1.  Can this be achieved by tuning an existing `.env` value? → **Tune, don't code.**
2.  Does this add a new network dependency or external API? → **Reject**.
3.  Does this require a new database or persistence layer? → **Reject**.
4.  Does this bypass the shared executor or introduce a second trade path? → **Reject**.
5.  Does this increase the attack surface of real-mode execution? → **Reject** or add a corresponding hard ceiling in `validateConfig()`.

If any gate is **Reject** and cannot be mitigated, the feature does not ship.
