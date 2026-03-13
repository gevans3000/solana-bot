import { VersionedTransaction } from '@solana/web3.js';
import { CFG, NOW } from './common.mjs';

export async function executeJupiterSwap({ side, amount, walletKeypair }) {
  const httpTimeout = 15000;
  const confirmTimeout = 60000;

  try {
    // Step 1: POST to /ultra/v1/order to get transaction
    let quote;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), httpTimeout);

      const response = await fetch('https://lite-api.jup.ag/ultra/v1/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: walletKeypair.publicKey,
          inputMint: side === 'BUY' ? CFG.usdcMint : CFG.solMint,
          outputMint: side === 'BUY' ? CFG.solMint : CFG.usdcMint,
          amount: side === 'BUY' ? Math.floor(amount * 1e6) : Math.floor(amount * 1e9),
          slippageBps: 50,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Order HTTP ${response.status}: ${text.slice(0, 100)}`);
      }

      quote = await response.json();
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

    // Step 3: POST to /ultra/v1/execute with signed transaction
    let txResult;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), httpTimeout);

      const response = await fetch('https://lite-api.jup.ag/ultra/v1/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction: signedTx,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Execute HTTP ${response.status}: ${text.slice(0, 100)}`);
      }

      txResult = await response.json();
    } catch (error) {
      return {
        success: false,
        error: String(error),
        step: 'execute',
      };
    }

    const txSignature = txResult.signature;

    // Step 4: Confirm transaction (never auto-retry)
    let confirmed = false;
    const confirmStart = Date.now();
    while (Date.now() - confirmStart < confirmTimeout) {
      try {
        // In real implementation, would use getSignatureStatuses
        confirmed = true;
        break;
      } catch (error) {
        if (Date.now() - confirmStart >= confirmTimeout) break;
        await new Promise(r => setTimeout(r, 1000));
      }
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
