import { CFG, NOW, rpcRequest } from './common.mjs';

export async function getOnChainBalances(walletAddress) {
  const source = 'on-chain';
  const fetchedAt = NOW();

  try {
    // Get SOL balance
    const solLamports = await rpcRequest('getBalance', [walletAddress]);
    const sol = Number(solLamports ?? 0) / 1_000_000_000;

    // Get USDC token accounts
    let usdc = 0;
    try {
      const response = await rpcRequest('getTokenAccountsByOwner', [
        walletAddress,
        { mint: CFG.usdcMint },
        { encoding: 'jsonParsed' },
      ]);

      if (response?.value?.length > 0) {
        const account = response.value[0];
        usdc = Number(account?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0);
      }
    } catch {
      usdc = 0;
    }

    return { sol, usdc, source, fetchedAt };
  } catch (error) {
    return {
      sol: 0,
      usdc: 0,
      source,
      fetchedAt,
      error: String(error),
    };
  }
}
