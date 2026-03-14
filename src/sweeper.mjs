import { CFG, NOW, isDisabled, logJsonl, runLoop } from './common.mjs';
import { getBalances, sweepProfitWallet } from './portfolio.mjs';
import { getSolUsdPrice } from './price-source.mjs';

async function tick() {
  if (isDisabled()) {
    logJsonl('sweeper.jsonl', { t: NOW(), type: 'disabled' });
    return;
  }
  if (!CFG.profitWallet) {
    logJsonl('sweeper.jsonl', { t: NOW(), type: 'skip', reason: 'PROFIT_WALLET not set' });
    return;
  }

  const price = await getSolUsdPrice();
  const balances = await getBalances(price);
  if (balances.sol < CFG.minSolForSweep) {
    logJsonl('sweeper.jsonl', { t: NOW(), type: 'skip', reason: 'sol reserve too low', balances });
    return;
  }

  const excess = balances.usdc - CFG.usdcReserve;
  if (excess < CFG.usdcProfitMin) {
    logJsonl('sweeper.jsonl', { t: NOW(), type: 'no_sweep', balances, excess });
    return;
  }

  const amountUsdc = excess * CFG.profitSweepPct;
  if (amountUsdc < CFG.usdcProfitMin) {
    logJsonl('sweeper.jsonl', { t: NOW(), type: 'no_sweep', reason: 'below sweep minimum', amountUsdc });
    return;
  }

  const result = await sweepProfitWallet({ amountUsdc });
  logJsonl('sweeper.jsonl', {
    t: NOW(),
    type: CFG.dryRun ? 'dry_run_sweep' : 'sweep',
    amountUsdc,
    result,
  });
}

runLoop(async () => {
  try {
    await tick();
  } catch (error) {
    logJsonl('sweeper.jsonl', { t: NOW(), type: 'error', error: String(error?.stack || error) });
    if (CFG.runOnce) throw error;
  }
}, CFG.sweepEverySec).catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
