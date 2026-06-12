@echo off
REM === ensure-shadow.cmd: idempotent stack starter (safe to run hourly) ===
REM Starts start-shadow.cmd ONLY if the stack looks dead. Registered in Windows
REM Task Scheduler (at logon + hourly) this makes the shadow stack self-starting:
REM no double-clicks needed, survives reboots, sleep/wake, and crashes.
cd /d "C:\Users\lovel\Claude\Projects\Solana Bot"

REM 1) If a window we launched is already running, do nothing.
tasklist /fi "WINDOWTITLE eq SolanaBot Shadow*" 2>nul | find /i "cmd.exe" >nul && exit /b 0

REM 2) If executor.jsonl was written in the last 30 min, stack is alive - do nothing.
powershell -NoProfile -Command "$f='logs\executor.jsonl'; if((Test-Path $f) -and (((Get-Date)-(Get-Item $f).LastWriteTime).TotalMinutes -lt 30)){exit 0}else{exit 1}"
if %errorlevel%==0 exit /b 0

REM 3) Stack is dead - launch the self-healing runner (clears locks, commits,
REM    pushes, refreshes data, starts shadow with auto-restart loop).
start "SolanaBot Shadow" /min cmd /c start-shadow.cmd
exit /b 0
