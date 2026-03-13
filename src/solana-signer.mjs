import fs from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { CFG, fileInState, loadJson } from './common.mjs';

let cachedKeypair = null;

function base58Decode(str) {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const decoded = [];
  let num = 0n;

  for (let char of str) {
    num = num * 58n + BigInt(ALPHABET.indexOf(char));
  }

  while (num > 0n) {
    decoded.unshift(Number(num & 0xFFn));
    num = num >> 8n;
  }

  // Handle leading 1s
  for (let char of str) {
    if (char === '1') decoded.unshift(0);
    else break;
  }

  return Buffer.from(decoded);
}

export function loadKeypair() {
  if (cachedKeypair) return cachedKeypair;

  let seed;

  if (CFG.privateKey) {
    // Base58 encoded private key
    const decoded = base58Decode(CFG.privateKey);
    if (decoded.length !== 64) throw new Error('Invalid private key length');
    seed = decoded.slice(0, 32);
  } else {
    // Load from generated-wallet.json and extract seed from PKCS8 DER
    const wallet = loadJson('generated-wallet.json', null);
    if (!wallet || !wallet.privateKeyPkcs8Base64) {
      throw new Error('No PRIVATE_KEY env and no generated-wallet.json found');
    }

    const pkcs8Buffer = Buffer.from(wallet.privateKeyPkcs8Base64, 'base64');
    // Extract 32-byte seed from bytes 16..48 of PKCS8 DER
    seed = pkcs8Buffer.slice(16, 48);
  }

  cachedKeypair = Keypair.fromSeed(seed);
  return cachedKeypair;
}

export function getWalletPublicKey() {
  const keypair = loadKeypair();
  return keypair.publicKey.toBase58();
}
