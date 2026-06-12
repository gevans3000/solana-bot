@echo off
REM === Solana bot: one-click finish + shadow start (George double-clicks this) ===
REM Self-healing: if the shadow runner ever exits (crash, sleep/wake kill, etc.)
REM it restarts automatically after 15s. Close the window to stop it for real.
cd /d "C:\Users\lovel\Claude\Projects\Solana Bot"

echo [1/4] Clearing stale git locks left by the sandbox...
del /f .git\HEAD.lock .git\index.lock 2>nul

echo [2/4] Committing any staged session work + pushing...
git add -A
git commit -m "session work (auto-committed by start-shadow.cmd)" 2>nul
git push origin master

echo [3/4] Refreshing backtest data (needs internet; skips on failure)...
node backtest\fetch-data.mjs

echo [4/4] Starting SHADOW runner (DRY_RUN=1 - no real trades). Leave this window open.
:shadowloop
npm run shadow
echo.
echo [!] Shadow runner exited at %date% %time% - auto-restarting in 15 seconds...
echo     (close this window to stop the bot for real)
timeout /t 15 /nobreak >nul
goto shadowloop
