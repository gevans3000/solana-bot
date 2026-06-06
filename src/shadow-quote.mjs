import { CFG, NOW, fetchJson } from './common.mjs';

export async function getJupiterQuote({ side, amountUsdc, amountSol, walletAddress }) {
  const url = 'https://lite-api.jup.ag/ultra/v1/order';
  const timeout = 10000;

  const body = {
    wallet: walletAddress,
    inputMint: side === 'BUY' ? CFG.usdcMint : CFG.solMint,
    outputMint: side === 'BUY' ? CFG.solMint : CFG.usdcMint,
    amount: side === 'BUY' ? Math.floor(amountUsdc * 1e6) : Math.floor(amountSol * 1e9),
    slippageBps: CFG.maxSlippageBps,  // was hardcoded 50; use the configured live cap
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 100)}`);
    }

    let quote;
    try {
      quote = await response.json();
    } catch (parseError) {
      throw new Error(`Invalid JSON from Jupiter: ${parseError.message}`);
    }
    return quote;
  } catch (error) {
    return { error: String(error || 'Unknown error') };
  }
}
