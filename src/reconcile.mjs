import { CFG, loadPortfolio, loadWallet } from './common.mjs';
import { getOnChainBalances } from './on-chain-balance.mjs';

async function main() {
  try {
    const wallet = loadWallet({ createIfMissing: false });
    const portfolio = loadPortfolio();
    const onChain = await getOnChainBalances(wallet.address);

    const rows = [];
    rows.push('Solana SOL/USDC Portfolio Reconciliation');
    rows.push('=========================================');
    rows.push(`Wallet: ${wallet.address}`);
    rows.push(`Portfolio Mode: ${portfolio.mode}`);
    rows.push('');
    rows.push('Asset    | Tracked  | On-Chain | Status');
    rows.push('---------|----------|----------|--------');

    // Check SOL
    const solDiff = Math.abs(portfolio.sol - onChain.sol);
    const solStatus = solDiff < 0.001 ? 'OK' : solDiff < 0.01 ? 'DRIFT' : 'MISMATCH';
    rows.push(`SOL      | ${portfolio.sol.toFixed(6).padEnd(8)} | ${onChain.sol.toFixed(6).padEnd(8)} | ${solStatus}`);

    // Check USDC
    const usdcDiff = Math.abs(portfolio.usdc - onChain.usdc);
    const usdcStatus = usdcDiff < 0.01 ? 'OK' : usdcDiff < 1 ? 'DRIFT' : 'MISMATCH';
    rows.push(`USDC     | ${portfolio.usdc.toFixed(2).padEnd(8)} | ${onChain.usdc.toFixed(2).padEnd(8)} | ${usdcStatus}`);

    rows.push('');
    rows.push('Summary');
    rows.push('-------');
    rows.push(`Realized PnL: $${portfolio.realizedPnlUsdc.toFixed(2)}`);
    rows.push(`Swept Profit: $${portfolio.sweptUsdc.toFixed(2)}`);
    if (portfolio.avgEntryPrice) rows.push(`Avg Entry Price: $${portfolio.avgEntryPrice.toFixed(2)}`);
    rows.push(`Last Updated: ${portfolio.lastUpdatedAt}`);

    if (onChain.error) {
      rows.push('');
      rows.push(`Warning: ${onChain.error}`);
    }

    console.log(rows.join('\n'));
  } catch (error) {
    console.error(error?.stack || error);
    process.exit(1);
  }
}

main();
