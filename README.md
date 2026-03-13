# Solana SOL/USDC Agent Team — Test-First MVP

This package gives you a **two-bot SOL/USDC spot trading MVP** with a **single shared executor**, **risk gates**, **profit sweeper**, **JSONL logs**, and a **local one-click UI**.

## What is inside
- **Bull bot**: buys dips more aggressively and sells less aggressively
- **Bear bot**: buys less often and sells sooner
- **Shared executor**: the only component allowed to act on trade ideas
- **Sweeper**: periodically sweeps a portion of excess USDC to `PROFIT_WALLET`
- **Local UI**: click start/stop and watch status from your browser

## Important mode choice
The default configuration is:
- `NETWORK_LABEL=devnet`
- `EXECUTION_MODE=simulated`
- `DRY_RUN=1`

That gives you a **safe test-first environment** using:
- a real-looking persistent Solana dev wallet address for testing flows
- devnet balance lookup and optional airdrop
- live or mock price inputs
- paper execution with position/PnL tracking

This is the intended theory-testing path.

---

## Planning files
See `plans/` for the smallest implementation path, tuning notes, and the copy-paste starter prompt for your next coding agent.

## Fast start

### 1) Install
```bash
npm install
```

### 2) Create your local env file
macOS/Linux:
```bash
cp .env.example .env
```

Windows PowerShell:
```powershell
Copy-Item .env.example .env
```

### 3) Create or inspect your wallet
If you want the app to generate a local dev wallet:
```bash
npm run wallet:new
```

Then check it:
```bash
npm run wallet
```

### 4) Start the one-click local UI
```bash
npm run ui
```
Then open:
```text
http://localhost:8787
```
Click **Start Dry Run** first.

### 5) Run from terminal instead of UI (optional)
Dry run:
```bash
npm run dry-run
```

Live simulated execution on devnet:
```bash
# In .env set DRY_RUN=0
npm run all
```

---

## Minimal user flow
1. unzip
2. `npm install`
3. `cp .env.example .env`
4. set `PROFIT_WALLET`
5. `npm run wallet:new`
6. `npm run ui`
7. click **Start Dry Run**
8. when ready, set `DRY_RUN=0` and click **Start Live**

---

## What “live” means in this test-first build
With `NETWORK_LABEL=devnet` and `EXECUTION_MODE=simulated`, “live” means:
- the loop is fully autonomous
- the bots emit real ideas continuously
- the executor accepts/rejects and records decisions
- portfolio balances, PnL, and sweeps are updated in state files
- logs behave exactly like a production-style bot
- no real token swaps are sent

This package is optimized for theory-testing and guardrail validation first.

---

## Kill switch
Create a file named `DISABLED` in the project root.

When it exists:
- bots stop proposing trades
- executor stops acting
- sweeper stops

Remove the file to resume.

---

## NPM commands
```bash
npm run wallet      # show the active wallet address and devnet balance
npm run wallet:new  # generate a local dev wallet and save it under state/
npm run dry-run     # force DRY_RUN=1 and run all agents
npm run all         # run all agents using values in .env
npm run watch       # tail logs in terminal
npm run recent      # summarize recent activity
npm run ui          # local one-click browser UI
npm run smoke       # quick one-pass validation
npm run shadow      # run with SHADOW_MODE=1 (fetch Jupiter quotes before trading)
npm run reconcile   # compare portfolio state vs on-chain balances
```

---

## Logs
JSONL logs are written to `logs/`:
- `logs/bull.jsonl`
- `logs/bear.jsonl`
- `logs/executor.jsonl`
- `logs/sweeper.jsonl`
- `logs/signals.jsonl`

Useful commands:
```bash
tail -f logs/executor.jsonl
tail -f logs/bull.jsonl
tail -f logs/bear.jsonl
tail -f logs/sweeper.jsonl
npm run recent
```

---

## tmux example
Start in tmux:
```bash
tmux new -s solbot
npm run all
```
Detach:
```bash
Ctrl+b then d
```
Reattach:
```bash
tmux attach -t solbot
```

---

## How the bots behave
### Bull bot
- buys on smaller dips
- sells on bigger rips
- biased toward accumulating SOL sooner

### Bear bot
- buys only on larger dips
- sells on smaller rips
- biased toward taking profit faster

### Conflict rule
If the bots disagree in the same decision window, the executor does **nothing**.

### One-trade-per-window rule
The executor only allows one action inside a decision window.

---

## State files
State is written to `state/`:
- `state/state-BULL.json`
- `state/state-BEAR.json`
- `state/state-exec.json`
- `state/portfolio.json`
- `state/generated-wallet.json` (if you use `wallet:new`)

---

## Sweeper
The sweeper is separate from trading and checks every `SWEEP_EVERY_SEC`.

It will only sweep if:
- `PROFIT_WALLET` is set
- USDC balance is above reserve
- sweep amount is above minimum
- SOL reserve remains protected

In simulated mode, sweeps are recorded in state and logs.

---

## What to watch first
1. `npm run smoke`
2. `npm run dry-run`
3. `npm run recent`
4. UI status page
5. `logs/executor.jsonl`

---

## Shadow Mode
Shadow mode fetches real Jupiter quotes and on-chain balances **without executing trades**. Useful for validating the bot's decision logic against real market prices.

Enable with `SHADOW_MODE=1` or run:
```bash
npm run shadow
```

Shadow data is logged to `logs/shadow.jsonl`.

---

## Real Execution
To enable real on-chain trading:
1. Set `EXECUTION_MODE=real`
2. Set `RPC_URL` to a mainnet RPC endpoint (not devnet)
3. Provide a keypair: either `PRIVATE_KEY` env (base58 encoded) or `state/generated-wallet.json`
4. Set realistic limits: `REAL_MAX_NOTIONAL_USDC` ≤ 100, `REAL_DAILY_NOTIONAL_LIMIT_USDC` ≤ 500
5. Keep `DRY_RUN=0`

Real trades are logged to `logs/trades.jsonl`.

---

## Dashboard
The live dashboard updates every 5 seconds via Server-Sent Events. Features:
- Status bar: running/stopped, mode, current price
- Portfolio: SOL, USDC, unrealized/realized PnL
- Last 15 trades table
- Top 5 skip reasons
- Last 8 signals

Start with `npm run ui` and open http://127.0.0.1:8787

---

## Alerts
Discord webhook alerts for trades and errors. Set:
- `ALERT_WEBHOOK_URL` (Discord webhook URL)
- `ALERT_ON_TRADE=1` to notify after trades
- `ALERT_ON_ERROR=1` to notify on errors

---

## Reconciliation
Compare portfolio state against on-chain balances:
```bash
npm run reconcile
```

Shows SOL and USDC discrepancies with status (OK/DRIFT/MISMATCH).

---

## Troubleshooting
See `TROUBLESHOOTING.md`.
