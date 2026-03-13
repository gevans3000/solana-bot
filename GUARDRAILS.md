# 🛡️ Bot Guardrails & Constitution

This document defines the **Hard Guardrails** for this Solana SOL/USDC bot. To prevent feature creep, instability, and "code rot," all future modifications must adhere to these rules.

---

## ⚖️ Technical Guardrails

### 1. The Separation of Powers
*   **Signaling (Bull/Bear)**: Must remain *purely observational*. They can suggest trades but CANNOT access private keys or execute network calls except for price fetching.
*   **Execution (Shared Executor)**: Must remain the *sole gatekeeper*. Only the executor can call `executeTrade`. All risk checks (daily limits, max notional, cooldowns) must happen here.
*   **State (Portfolio)**: Must remain the *single source of truth*. No component should calculate balances independently; they must read `portfolio.json`.

### 2. Dependency Freeze
*   Do NOT add new npm dependencies unless they are core Solana (`@solana/web3.js`) or SplToken library updates.
*   Avoid adding "utility" libraries (Lodash, Axios, Express, etc.). Use native Node.js APIs (`fs`, `path`, `crypto`, `fetch`).

### 3. Network Hygiene
*   **Mandatory Timeouts**: Every `fetch` or RPC call must wrap with an `AbortController` and a maximum 15s timeout.
*   **No Auto-Retries**: On real execution, never automatically retry a failed swap. If a swap fails or times out, it is handled as a `manual reconciliation` event.

### 4. Local-First Persistence
*   No external databases (PostgreSQL, MongoDB, Redis).
*   All persistence must remain local `JSON` or `JSONL` files in the `state/` and `logs/` directories.
*   Log rotation is mandatory (handled in `common.mjs`).

---

## 🧘 Philosophical Guardrails

### 1. Config vs. Code
*   If you want to change a numerical value (a dip %, a rip %, a limit), do NOT change the code. Add/edit the value in `.env` and `common.mjs` CFG.
*   The code should be a **black box**; the behavior should be a **dial**.

### 2. Failure > Uncertainty
*   The bot should **fail fast and loudly** (log the error and stop the loop) rather than guessing or retrying in an uncertain state.
*   Example: If the price is stale, "No Trade" is the only valid response.

### 3. Small-Diff Mandate
*   Prefer 5-line patches over 100-line refactors. 
*   If a feature requires a massive rewrite of the executor, the feature is too complex for this MVP.

---

## 🚦 Feature "Slow Lane" 
Before adding a new feature, ask:
1. Can this be achieved by tuning an existing `.env` value?
2. Does this add a new network dependency? (If yes, Reject).
3. Does this require a new database? (If yes, Reject).
4. Does this bypass the shared executor? (If yes, Reject).

If the answer is **NO TRADE**, then do not build it.
