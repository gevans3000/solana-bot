import { CFG, NOW, logJsonl, runLoop } from './common.mjs';
import { botTick } from './bot-lib.mjs';

async function tick() {
  await botTick({
    bot: 'BEAR',
    dipPct: CFG.bearDipPct,
    ripPct: CFG.bearRipPct,
    buyUsdc: CFG.bearBuyUsdc,
    sellSol: CFG.bearSellSol,
  });
}

runLoop(async () => {
  try {
    await tick();
  } catch (error) {
    logJsonl('bear.jsonl', { t: NOW(), bot: 'BEAR', type: 'error', error: String(error?.stack || error) });
    if (CFG.runOnce) throw error;
  }
}, CFG.loopSec).catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
