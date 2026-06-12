import { CFG } from './common.mjs';

const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function getJupiterQuote({ side, amountUsdc, amountSol, walletAddress }) {
  // Jupiter Ultra /order is a GET with query params — POSTing returns HTTP 404
  // (this dropped the first valid dry trades on 2026-06-12; do not revert to POST).
  const timeout = 10000;

  const params = new URLSearchParams({
    inputMint: side === 'BUY' ? CFG.usdcMint : CFG.solMint,
    outputMint: side === 'BUY' ? CFG.solMint : CFG.usdcMint,
    amount: String(side === 'BUY' ? Math.floor(amountUsdc * 1e6) : Math.floor(amountSol * 1e9)),
    slippageBps: String(CFG.maxSlippageBps),  // was hardcoded 50; use the configured live cap
  });
  // taker must be a real pubkey or the API 400s; without it the quote fields
  // (outAmount, priceImpactPct) still come back, just with transaction:null.
  if (BASE58_PUBKEY.test(walletAddress || '')) params.set('taker', walletAddress);

  const url = `https://lite-api.jup.ag/ultra/v1/order?${params}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { signal: controller.signal });
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
