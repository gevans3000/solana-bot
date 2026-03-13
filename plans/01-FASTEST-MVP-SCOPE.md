# Fastest MVP Scope

## Core promise
Build the smallest paper-trading system that can produce believable evidence of whether the SOL/USDC idea is worth tuning further.

## In scope
- Solana only
- SOL/USDC only
- local machine only
- paper trading only
- bull bot
- bear bot
- shared executor
- portfolio tracking
- local UI
- JSONL logs
- recent summary command
- smoke test

## Out of scope
- real-money trading
- extra assets
- extra chains
- multi-venue routing
- machine learning
- online learning
- self-modifying logic
- cloud deployment
- external databases
- alerts and notifications
- advanced dashboards
- complex analytics

## Success definition
The MVP succeeds if it is:
- easy to run
- easy to understand
- easy to tune
- hard to break
- honest about paper results

## Simplest decision model
- bull proposes
- bear proposes
- executor decides
- disagreement = no trade
- stale data = no trade
- cooldown active = no trade
- max trades/day reached = no trade
- low confidence = no trade

## Why this scope
Anything larger increases noise, delay, and tuning difficulty.
