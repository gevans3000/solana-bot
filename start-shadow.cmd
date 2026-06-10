@echo off
REM === Solana bot: one-click finish + shadow start (George double-clicks this) ===
cd /d "C:\Users\lovel\Claude\Projects\Solana Bot"

echo [1/4] Clearing stale git locks left by the sandbox...
del /f .git\HEAD.lock .git\index.lock 2>nul

echo [2/4] Committing any staged session work + pushing...
git commit -m "session work (auto-committed by start-shadow.cmd)" 2>nul
git push origin master

echo [3/4] Refreshing backtest data (needs internet; skips on failure)...
node backtest\fetch-data.mjs

echo [4/4] Starting SHADOW runner (DRY_RUN=1 - no real trades). Leave this window open.
npm run shadow
