import { CFG, NOW, loadPortfolio, savePortfolio, logJsonl } from './common.mjs';
import { getOnChainBalances } from './on-chain-balance.mjs';
import { executeJupiterSwap } from './jupiter-swap.mjs';

export async function getBalances(currentPrice) {
  const p = loadPortfolio();
  let unrealizedPnlUsdc = 0;

  if (currentPrice && p.avgEntryPrice && p.sol > 0) {
    unrealizedPnlUsdc = (currentPrice - p.avgEntryPrice) * p.sol;
  }

  return {
    mode: 'simulated',
    usdc: p.usdc,
    sol: p.sol,
    avgEntryPrice: p.avgEntryPrice,
    realizedPnlUsdc: p.realizedPnlUsdc,
    sweptUsdc: p.sweptUsdc,
    unrealizedPnlUsdc,
  };
}

export async function executeTrade({ side, amount, price, signalId, walletKeypair }) {
  if (CFG.executionMode === 'real') {
    return executeRealTrade({ side, amount, price, signalId, walletKeypair });
  }

  const p = loadPortfolio();
  const feeFactor = CFG.simFeeBps / 10000;
  const slipFactor = CFG.simSlippageBps / 10000;
  let executedPrice = price;
  let feeUsdc = 0;
  let deltaUsdc = 0;
  let deltaSol = 0;
  let realizedPnlUsdc = 0;

  if (CFG.dryRun) {
    return { mode: 'simulated', dryRun: true, signalId, side, amount, price };
  }

  if (side === 'BUY') {
    executedPrice = price * (1 + slipFactor);
    feeUsdc = amount * feeFactor;
    const spendUsdc = amount + feeUsdc;
    const acquiredSol = amount / executedPrice;
    if (p.usdc < spendUsdc) throw new Error('Simulated portfolio has insufficient USDC');
    const previousCost = p.sol * (p.avgEntryPrice || 0);
    const newSol = p.sol + acquiredSol;
    const newCost = previousCost + amount + feeUsdc;
    p.usdc -= spendUsdc;
    p.sol = newSol;
    p.avgEntryPrice = newSol > 0 ? newCost / newSol : 0;
    deltaUsdc = -spendUsdc;
    deltaSol = acquiredSol;
  } else {
    executedPrice = price * (1 - slipFactor);
    const sellSol = amount;
    if (p.sol < sellSol) throw new Error('Simulated portfolio has insufficient SOL');
    const grossUsdc = sellSol * executedPrice;
    feeUsdc = grossUsdc * feeFactor;
    const netUsdc = grossUsdc - feeUsdc;
    const avgEntry = p.avgEntryPrice || 0;
    realizedPnlUsdc = (executedPrice - avgEntry) * sellSol - feeUsdc;
    p.usdc += netUsdc;
    p.sol -= sellSol;
    p.realizedPnlUsdc += realizedPnlUsdc;
    if (p.sol <= 1e-9) p.avgEntryPrice = 0;
    deltaUsdc = netUsdc;
    deltaSol = -sellSol;
  }

  savePortfolio(p);
  return {
    mode: 'simulated',
    signalId,
    side,
    amount,
    price,
    executedPrice,
    feeUsdc,
    realizedPnlUsdc,
    deltaUsdc,
    deltaSol,
    post: { ...p },
    executedAt: NOW(),
  };
}

export async function executeRealTrade({ side, amount, price, signalId, walletKeypair }) {
  try {
    // Execute swap on Jupiter
    const swapResult = await executeJupiterSwap({ side, amount, walletKeypair });

    if (!swapResult.success) {
      logJsonl('trades.jsonl', {
        t: NOW(),
        type: 'trade_failed',
        side,
        amount,
        price,
        signalId,
        error: swapResult.error,
        step: swapResult.step,
      });
      return swapResult;
    }

    // Fetch on-chain balances to update portfolio
    const walletAddress = walletKeypair.publicKey || '';
    const onChain = await getOnChainBalances(walletAddress);

    // Update portfolio from on-chain data
    const p = loadPortfolio();
    p.sol = onChain.sol;
    p.usdc = onChain.usdc;

    if (side === 'BUY' && p.sol > 0) {
      const previousCost = (p.sol - amount) * (p.avgEntryPrice || 0);
      p.avgEntryPrice = (previousCost + amount * price) / p.sol;
    } else if (side === 'SELL' && p.sol <= 1e-9) {
      p.avgEntryPrice = 0;
    }

    savePortfolio(p);

    const result = {
      mode: 'real',
      success: true,
      signalId,
      side,
      amount,
      price,
      txSignature: swapResult.txSignature,
      post: { ...p },
      executedAt: NOW(),
    };

    logJsonl('trades.jsonl', {
      t: NOW(),
      type: 'trade',
      ...result,
    });

    return result;
  } catch (error) {
    logJsonl('trades.jsonl', {
      t: NOW(),
      type: 'trade_error',
      side,
      amount,
      price,
      signalId,
      error: String(error),
    });
    throw error;
  }
}

export async function sweepProfitWallet({ amountUsdc }) {
  const p = loadPortfolio();
  if (p.usdc < amountUsdc) throw new Error('Insufficient USDC for simulated sweep');
  if (CFG.dryRun) {
    return { mode: 'simulated', dryRun: true, to: CFG.profitWallet, amountUsdc };
  }
  p.usdc -= amountUsdc;
  p.sweptUsdc += amountUsdc;
  savePortfolio(p);
  return { mode: 'simulated', to: CFG.profitWallet, amountUsdc, post: { ...p } };
}
