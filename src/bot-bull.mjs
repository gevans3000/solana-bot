import { CFG, NOW, logJsonl, runLoop } from './common.mjs';
import { botTick } from './bot-lib.mjs';

async function tick() {
  await botTick({
    bot: 'BULL',
    dipPct: CFG.bullDipPct,
    ripPct: CFG.bullRipPct,
    buyUsdc: CFG.bullBuyUsdc,
    sellSol: CFG.bullSellSol,
  });
}

runLoop(async () => {
  try {
    await tick();
  } catch (error) {
    logJsonl('bull.jsonl', { t: NOW(), bot: 'BULL', type: 'error', error: String(error?.stack || error) });
    if (CFG.runOnce) throw error;
  }
}, CFG.loopSec).catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
