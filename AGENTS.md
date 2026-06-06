# Solana Bot — canonical workspace

## SINGLE SOURCE OF TRUTH (read this first)
There is exactly ONE working copy of this repo on this machine:

    C:\Users\lovel\Codex\Projects\Solana Bot

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
cd "C:\Users\lovel\Codex\Projects\Solana Bot"
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
