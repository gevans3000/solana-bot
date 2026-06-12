# Solana Bot — canonical workspace

## SINGLE SOURCE OF TRUTH (read this first)
There is exactly ONE working copy of this repo on this machine:

    C:\Users\lovel\Claude\Projects\Solana Bot

This is the folder Cowork auto-connects to and where ALL edits happen. Do NOT create or use a
second clone (e.g. `C:\Users\lovel\Desktop\solana-bot`). The old Desktop copy has been retired —
having two copies caused sessions and audits to look at stale code. If you find a Desktop copy,
delete it; this Projects folder is authoritative.

Git remote: https://github.com/gevans3000/solana-bot (branch `master`).

## Committing from a Cowork session
The sandbox cannot delete git lock files on this mount, so it commits via an alternate index and
CANNOT push (no credentials). After a Cowork session commits locally, George finishes from a normal
Windows terminal:

```powershell
cd "C:\Users\lovel\Claude\Projects\Solana Bot"
# clear any stale locks the sandbox left behind (harmless; sandbox can't unlink them)
Remove-Item -Force .git\HEAD.lock, .git\index.lock -ErrorAction SilentlyContinue
git push origin master
```

## Hard rules for any session working here
- Edit `src/*.mjs` from the shell (Edit/Write tools truncate on this mount); `node --check` after each edit.
- Keep `.env` values bare (no inline comments — the parser throws on them). `.env` is gitignored.
- Tests must stay green (`npm run test:all`) and the bear backtest (`backtest/data/sol-usd-1d.json`)
  must stay >= 9.0%. Tests write only to a temp dir (see `src/_test-env.mjs`) — they never touch `state/`.
- Never place a trade or change `EXECUTION_MODE` / `DRY_RUN` without George's explicit OK.
- See `HANDOFF-OPUS4.md` for current strategy state and `SELF-PROMPT.md` for the running directive.

## AUTOPILOT — how this project runs itself (added 2026-06-12)
The goal is zero routine George-actions. The loop:

1. **Cowork scheduled tasks** (run automatically while the Claude app is open):
   - `solana-bot-daily-self-audit` (8am/2pm/8pm): self-audit + ONE validated improvement
     increment per run from `IDEAS-FOR-SONNET.md`, commits, rewrites `SELF-PROMPT.md`.
   - `solana-bot-stack-watchdog` (9:30/13:30/17:30/21:30): read-only freshness + stale-code check.
   - `solana-bot-daily-reconcile` (8:30am): wallet-vs-portfolio drift check.
2. **`ensure-shadow.cmd`** (Windows Task Scheduler: at logon + hourly): idempotent — starts
   `start-shadow.cmd` only if `logs/executor.jsonl` is >30 min stale. With this registered, the
   shadow stack survives reboots, sleep/wake, and crashes with no clicks.
3. **`start-shadow.cmd`**: clears stale git locks, `git add -A` + commits + pushes any session
   work, refreshes data, runs the shadow stack in a self-restarting loop.

**Every ad-hoc session follows the same protocol:** read `SELF-PROMPT.md` first; verify the last
commit landed (`git log -1`) and nothing is left unstaged; work ONE item from
`IDEAS-FOR-SONNET.md` against the validation bar (bear >= 9.0%, judge by 1h-540d + intraday mean,
walk-forward `--thirds`, smooth plateau); commit (alternate-index workaround if locks); rewrite
`SELF-PROMPT.md` at the end. Record rejected ideas WITH numbers in `IDEAS-FOR-SONNET.md`.

**Only George can do:** flip `DRY_RUN`/`EXECUTION_MODE` (go-live), approve `MIN_SOL_RESERVE=0.005`,
swap in paid RPC (Helius), push when the sandbox is lock-blocked (or just let
`start-shadow.cmd`/`ensure-shadow.cmd` do it). Everything else: figure it out, don't ask.
