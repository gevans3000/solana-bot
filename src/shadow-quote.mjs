import { CFG, NOW, fetchJson } from './common.mjs';

export async function getJupiterQuote({ side, amountUsdc, amountSol, walletAddress }) {
  const url = 'https://lite-api.jup.ag/ultra/v1/order';
  const timeout = 10000;
  const maxRetries = 1;

  const body = {
    wallet: walletAddress,
    inputMint: side === 'BUY' ? CFG.usdcMint : CFG.solMint,
    outputMint: side === 'BUY' ? CFG.solMint : CFG.usdcMint,
    amount: side === 'BUY' ? Math.floor(amountUsdc * 1e6) : Math.floor(amountSol * 1e9),
    slippageBps: 50,
  };

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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

      const quote = await response.json();
      return quote;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 500));
    }
  }

  return { error: String(lastError || 'Unknown error') };
}
