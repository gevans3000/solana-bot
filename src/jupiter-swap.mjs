import { VersionedTransaction } from '@solana/web3.js';
import { CFG, NOW, rpcRequest, logJsonl } from './common.mjs';

export async function executeJupiterSwap({ side, amount, walletKeypair }) {
  const httpTimeout = 15000;
  const confirmTimeout = 60000;

  try {
    // Step 1: GET /ultra/v1/order to get transaction (POST returns HTTP 404 — found 2026-06-12).
    // taker is required here: without it Jupiter returns transaction:null and there is nothing to sign.
    let quote;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), httpTimeout);

      const params = new URLSearchParams({
        inputMint: side === 'BUY' ? CFG.usdcMint : CFG.solMint,
        outputMint: side === 'BUY' ? CFG.solMint : CFG.usdcMint,
        amount: String(side === 'BUY' ? Math.floor(amount * 1e6) : Math.floor(amount * 1e9)),
        slippageBps: String(CFG.maxSlippageBps),
        taker: walletKeypair.publicKey?.toBase58?.() || String(walletKeypair.publicKey),
      });
      const response = await fetch(`https://lite-api.jup.ag/ultra/v1/order?${params}`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Order HTTP ${response.status}: ${text.slice(0, 100)}`);
      }

      let body;
      try {
        body = await response.json();
      } catch (parseError) {
        throw new Error(`Order response invalid JSON: ${parseError.message}`);
      }
      if (!body.transaction) {
        throw new Error(`Order returned no transaction (error: ${String(body.error || body.errorMessage || 'none').slice(0, 80)})`);
      }
      quote = body;
    } catch (error) {
      return {
        success: false,
        error: String(error),
        step: 'order',
      };
    }

    // Step 2: Deserialize and sign transaction
    let signedTx;
    try {
      const swapTransactionBuf = Buffer.from(quote.transaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([walletKeypair]);
      signedTx = Buffer.from(transaction.serialize()).toString('base64');
    } catch (error) {
      return {
        success: false,
        error: String(error),
        step: 'sign',
      };
    }

    // Step 3: POST to /ultra/v1/execute with signed transaction (NO retry)
    let txResult;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), httpTimeout);

      const response = await fetch('https://lite-api.jup.ag/ultra/v1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedTransaction: signedTx,
          requestId: quote.requestId,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Execute HTTP ${response.status}: ${text.slice(0, 100)}`);
      }

      let body;
      try {
        body = await response.json();
      } catch (parseError) {
        throw new Error(`Execute response invalid JSON: ${parseError.message}`);
      }
      if (body.status === 'Failed') {
        throw new Error(`Execute failed: ${String(body.error || body.code || 'unknown').slice(0, 100)}`);
      }
      txResult = body;
    } catch (error) {
      return {
        success: false,
        error: String(error),
        step: 'execute',
      };
    }

    const txSignature = txResult.signature;

    // Step 4: Confirm transaction via getSignatureStatuses (never auto-retry the swap)
    let confirmed = false;
    const confirmStart = Date.now();
    while (Date.now() - confirmStart < confirmTimeout) {
      try {
        const result = await rpcRequest('getSignatureStatuses', [[txSignature]]);
        const status = result?.value?.[0];
        if (status) {
          if (status.err) {
            return {
              success: false,
              error: `Transaction failed on-chain: ${JSON.stringify(status.err)}`,
              step: 'confirm',
              txSignature,
            };
          }
          if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
            confirmed = true;
            // Log slippage: backtest assumes 8bps; warn if we're using more
            const slippageUsed = CFG.maxSlippageBps;
            if (slippageUsed > 8) {
              logJsonl('executor.jsonl', { type: 'slippage_note', t: NOW(),
                slippageBpsUsed: slippageUsed, backtestAssumptionBps: 8,
                note: slippageUsed > 50 ? 'HIGH: live slippage exceeds backtest by 6x+' : 'within 6x backtest' });
            }
            break;
          }
        }
      } catch {
        // RPC error during confirmation poll — keep polling until timeout
      }
      if (Date.now() - confirmStart >= confirmTimeout) break;
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!confirmed) {
      return {
        success: false,
        error: 'Transaction confirmation timeout',
        step: 'confirm',
        txSignature,
      };
    }

    return {
      success: true,
      txSignature,
      executedAt: NOW(),
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
      step: 'unknown',
    };
  }
}
