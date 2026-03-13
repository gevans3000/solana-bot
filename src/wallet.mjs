import { CFG, generateWalletRecord, getWalletBalance, loadWallet, requestAirdrop, saveGeneratedWallet } from './common.mjs';

const createNew = process.argv.includes('--new');

async function main() {
  const wallet = createNew ? generateWalletRecord() : loadWallet({ createIfMissing: true });
  if (createNew) saveGeneratedWallet(wallet);

  if (CFG.airdropOnWallet && CFG.networkLabel === 'devnet') {
    try {
      await requestAirdrop(wallet.address, CFG.airdropSol);
    } catch {}
  }

  const sol = await getWalletBalance(wallet.address);
  console.log(JSON.stringify({
    networkLabel: CFG.networkLabel,
    rpcUrl: CFG.rpcUrl,
    address: wallet.address,
    sol,
    generated: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
