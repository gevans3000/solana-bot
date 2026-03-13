# BEGIN — One-Shot Prompt

Copy everything below into your coding agent and attach this zip.

```text
BEGIN

You are my AI developer agent. I am attaching a zip that already contains a small Solana SOL/USDC paper-trading MVP. Your job is to improve it in the SMALLEST, FASTEST, MOST TUNABLE way possible.

PRIMARY OBJECTIVE
Preserve the current project and tighten it into the smallest paper-trading MVP that is easy for me to tune by hand.

HARD RULES
- Do NOT rebuild from scratch if the current package can be patched.
- Do NOT add features outside this MVP.
- Do NOT add real-money execution.
- Do NOT add extra assets, chains, or pairs.
- Do NOT add ML, auto-learning, or autonomous self-modifying logic.
- Do NOT add cloud deployment, alerts, or dashboards beyond the current local UI.
- Prefer minimum-diff changes.
- Keep commands simple.
- Keep logs JSONL.
- Keep everything local.
- If uncertain, choose the simpler implementation.

PROJECT TARGET
- Chain: Solana only
- Pair: SOL/USDC only
- Mode: paper trading only
- Goal: produce credible paper-trading evidence, not fake profit claims
- User experience: unzip -> npm install -> cp .env.example .env -> npm run ui -> click start

FILES TO PRIORITIZE
Focus on these files first and avoid touching unrelated files unless necessary:
- package.json
- .env.example
- README.md
- TROUBLESHOOTING.md
- src/all.mjs
- src/price-source.mjs
- src/bot-bull.mjs
- src/bot-bear.mjs
- src/executor.mjs
- src/portfolio.mjs
- src/recent.mjs
- src/ui-server.mjs
- src/smoke.mjs

ARCHITECTURE TO KEEP
- Bull bot proposes ideas
- Bear bot proposes ideas
- Shared executor is the only component allowed to act
- Portfolio module updates paper balances/PnL
- UI starts/stops and shows status
- Recent command summarizes logs

SMALLEST TRUE MVP
Keep only these behaviors:
1. fetch or simulate SOL/USDC price data
2. bull bot emits BUY / SELL / HOLD with reason code
3. bear bot emits BUY / SELL / HOLD with reason code
4. executor decides with default = NO TRADE
5. if bots disagree, NO TRADE
6. cooldown enforced
7. max trades/day enforced
8. one-trade-per-window enforced
9. portfolio updates after paper fills
10. recent command gives useful summary

NON-GOALS
- no regime agent unless implemented as tiny logic inside executor
- no sweeper changes unless a bug exists
- no extra orchestration layers
- no multiple venues
- no strategy marketplace
- no backtesting engine
- no additional services

WHAT TO IMPROVE
- simplify config names where useful
- make tuning knobs obvious in .env.example
- improve paper-fill realism modestly only if it stays simple
- improve skip reason codes
- improve recent summary output
- improve local UI clarity
- improve README for a non-technical user
- remove any needless complexity

TUNING PRIORITIES
I want to be able to tune only a few values myself:
- bull buy dip percent
- bull sell rip percent
- bear buy dip percent
- bear sell rip percent
- confidence threshold
- cooldown seconds
- max trades/day
- max trade size
- paper slippage bps
- paper fee bps

DEFAULT DECISION RULES
- default = NO TRADE
- if data is stale -> NO TRADE
- if cooldown active -> NO TRADE
- if max trades/day reached -> NO TRADE
- if bull and bear disagree -> NO TRADE
- if confidence below threshold -> NO TRADE
- every skip must be logged with a reason code

DELIVERABLES
Return one updated zip that includes:
- improved source code
- updated README.md
- updated .env.example
- updated TROUBLESHOOTING.md
- working local UI
- working dry-run / paper trading
- working recent summary
- clear tuning notes

VALIDATION
Before finishing, run and verify:
- npm install
- npm run smoke
- npm run dry-run
- npm run recent
- local UI starts
- logs populate
- disagreement defaults to no trade
- cooldown works
- max trades/day works
- final zip is created

OUTPUT FORMAT
Return only:
1. short summary
2. final zip
3. exact run commands
4. short checklist

If you are unsure about any design choice, choose the smaller and simpler version.
END
```
