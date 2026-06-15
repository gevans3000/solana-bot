# GLM-5.1 AGENT QUICK REFERENCE
## Solana Bot Project — Additional Agent via NVIDIA API

---

## 🚀 Quick Commands

```bash
# Basic query
python glm51_agent.py "Your question here"

# With Solana bot context (recommended for project tasks)
python glm51_agent.py "Your question here" --solana

# Stream long responses
python glm51_agent.py "Your question here" --solana --stream
```

---

## 📋 Available Functions (Python Import)

```python
from glm51_agent import (
    glm51_complete,           # Basic completion
    glm51_stream,             # Streaming response
    glm51_solana,             # With Solana bot context
    glm51_solana_stream       # Streaming + Solana context
)

# Basic
response = glm51_complete("What is Jito?")
response = glm51_complete("Complex prompt", temperature=0.3, max_tokens=8192, system_prompt="You are...")

# Solana-specific (auto-includes SOLANA_BOT_CONTEXT)
response = glm51_solana("How to optimize Jupiter Ultra routing?")
response = glm51_solana_stream("Detailed MEV analysis...")  # Streams to stdout
```

---

## 🎯 Solana Bot Context (Auto-Injected)

When using `--solana` flag or `glm51_solana()`, this context is automatically added:

```
You are an expert trading bot engineer specializing in:
- Solana transaction mechanics, priority fees, MEV, Jito bundles
- Jupiter Ultra API, quote freshness, slippage, routing
- Risk management: position sizing, stop-loss, circuit breakers
- Backtesting methodology: walk-forward, parameter sweeps, overfitting
- Market microstructure: order flow, adverse selection, MEV
- Python/Node.js async systems, multi-RPC failover, reconciliation
```

---

## 🧪 Tested & Working Examples

| Task | Command | Result |
|------|---------|--------|
| Backtest-live gap analysis | `python glm51_agent.py "Analyze backtest-to-live gap..." --solana` | ✅ 5 factors with bps drag + mitigations |
| Code review | `python glm51_agent.py "Review this Jupiter swap code..." --solana` | ✅ |
| Strategy design | `python glm51_agent.py "Design a multi-venue routing strategy..." --solana` | ✅ |
| Risk analysis | `python glm51_agent.py "Red team this position sizing logic..." --solana` | ✅ |
| Code generation | `python glm51_agent.py "Write a Jito bundle submitter..." --solana` | ✅ |

---

## ⚙️ Configuration

```python
# In glm51_agent.py - modify these globals if needed:
NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
MODEL = "z-ai/glm-5.1"
NVIDIA_API_KEY = "nvapi-..."  # Your key (already configured)
```

**Parameters:**
- `temperature`: 0.0-2.0 (default 0.7, use 0.3 for Solana technical tasks)
- `max_tokens`: Up to 16384 (default 8192 for complete, 16384 for stream)

---

## 🔄 Integration with Existing Agent Workflow

### Parallel Delegation Pattern (via delegate_task)
```python
# In Hermes, you can now run GLM-5.1 alongside other agents:
delegate_task(
    goal="Analyze MEV risk for our Jupiter swap implementation",
    provider="openai-codex",  # or use GLM-5.1 via custom tool
    # For now, run GLM-5.1 locally and feed results to other agents
)
```

### Recommended Workflow
```
┌─────────────────────────────────────────────────────────┐
│  YOUR TASK                                              │
└─────────────────┬───────────────────────────────────────┘
                  ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  Codex-A    │ │  Codex-B    │ │  GLM-5.1    │
│  (Backtest) │ │  (Red Team) │ │  (MEV/      │
│             │ │             │ │   Micro-    │
│             │ │             │ │   structure)│
└──────┬──────┘ └──────┬──────┘ └──────┬──────┘
       │               │               │
       └───────────────┼───────────────┘
                       ▼
              ┌─────────────────┐
              │  Nemotron       │
              │  (Synthesis)    │
              └─────────────────┘
```

---

## 💡 Pro Tips

1. **Use `--solana` for all project tasks** — the context saves you explaining the architecture
2. **Use `temperature=0.3`** for technical/quantitative tasks (more deterministic)
3. **Use `--stream`** for long analyses (MEV, backtest methodology, code reviews)
4. **Combine with other agents** — GLM-5.1 excels at MEV/microstructure; Codex at backtests; Nemotron at synthesis

---

## 📁 Files

| File | Purpose |
|------|---------|
| `glm51_agent.py` | Main wrapper with Solana context |
| `glm51_agent.py` (run) | CLI interface: `python glm51_agent.py "prompt" --solana` |

---

## ✅ Verified Working

- ✅ OpenAI SDK 2.41.1+ 
- ✅ NVIDIA API key configured
- ✅ GLM-5.1 (z-ai/glm-5.1) responding
- ✅ Solana context auto-injected
- ✅ Streaming output working
- ✅ Complex analysis tested (MEV, backtest gaps, routing)