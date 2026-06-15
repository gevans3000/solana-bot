#!/usr/bin/env python3
"""
GLM-5.1 Agent via NVIDIA API - Enhanced wrapper for Solana bot project
"""

import os
import sys
import json
from openai import OpenAI

# Configuration
NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "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")
MODEL = "z-ai/glm-5.1"

_client = None

def get_client():
    global _client
    if _client is None:
        _client = OpenAI(
            base_url=NVIDIA_BASE_URL,
            api_key=NVIDIA_API_KEY
        )
    return _client

def glm51_complete(prompt: str, temperature: float = 0.7, max_tokens: int = 8192, system_prompt: str = None) -> str:
    """
    Complete a prompt using GLM-5.1 via NVIDIA API.
    
    Args:
        prompt: The user prompt
        temperature: Sampling temperature (0-2)
        max_tokens: Maximum tokens in response
        system_prompt: Optional system prompt for context
    
    Returns:
        The model's response as a string
    """
    client = get_client()
    
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    
    completion = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        temperature=temperature,
        top_p=1.0,
        max_tokens=max_tokens,
        stream=False
    )
    
    return completion.choices[0].message.content

def glm51_stream(prompt: str, temperature: float = 0.7, max_tokens: int = 16384, system_prompt: str = None) -> str:
    """Stream the response for long outputs."""
    client = get_client()
    
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    
    completion = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        temperature=temperature,
        top_p=1.0,
        max_tokens=max_tokens,
        stream=True
    )
    
    full_response = ""
    for chunk in completion:
        if not getattr(chunk, "choices", None):
            continue
        if len(chunk.choices) == 0 or getattr(chunk.choices[0], "delta", None) is None:
            continue
        delta = chunk.choices[0].delta
        if getattr(delta, "content", None) is not None:
            content = delta.content
            print(content, end="", flush=True)
            full_response += content
    print()
    return full_response

# Solana bot specific system prompts
SOLANA_BOT_CONTEXT = """You are an expert trading bot engineer specializing in Solana DeFi, MEV, Jupiter aggregator, and quantitative trading systems. 
You have deep knowledge of:
- Solana transaction mechanics, priority fees, MEV, Jito bundles
- Jupiter Ultra API, quote freshness, slippage, routing
- Risk management: position sizing, stop-loss, circuit breakers
- Backtesting methodology: walk-forward, parameter sweeps, overfitting detection
- Market microstructure: order flow, adverse selection, MEV extraction
- Python/Node.js async systems, multi-RPC failover, reconciliation"""

def glm51_solana(prompt: str, temperature: float = 0.3, max_tokens: int = 8192) -> str:
    """Query GLM-5.1 with Solana bot context."""
    return glm51_complete(prompt, temperature=temperature, max_tokens=max_tokens, system_prompt=SOLANA_BOT_CONTEXT)

def glm51_solana_stream(prompt: str, temperature: float = 0.3, max_tokens: int = 16384) -> str:
    """Stream GLM-5.1 response with Solana bot context."""
    return glm51_stream(prompt, temperature=temperature, max_tokens=max_tokens, system_prompt=SOLANA_BOT_CONTEXT)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python glm51_agent.py \"Your prompt here\" [--solana] [--stream]")
        print("  --solana: Use Solana bot context")
        print("  --stream: Stream response")
        sys.exit(1)
    
    args = sys.argv[1:]
    use_solana = "--solana" in args
    use_stream = "--stream" in args
    prompt_args = [a for a in args if a not in ("--solana", "--stream")]
    prompt = " ".join(prompt_args)
    
    if use_solana:
        if use_stream:
            glm51_solana_stream(prompt)
        else:
            print(glm51_solana(prompt))
    else:
        if use_stream:
            glm51_stream(prompt)
        else:
            print(glm51_complete(prompt))