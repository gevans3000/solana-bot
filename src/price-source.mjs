import { CFG, NOW, fetchJson, loadJson, saveJson, fileInState } from './common.mjs';
import fs from 'node:fs';
import path from 'node:path';

const PRICE_STATE_FILE = 'price-state.json';
const PRICE_CACHE_FILE = 'price-cache.json';

function stepMockPrice() {
  const state = loadJson(PRICE_STATE_FILE, {
    price: CFG.mockStartPrice,
    step: 0,
    seed: 1337,
  });

  // simple deterministic LCG for reproducible smoke tests
  state.seed = (state.seed * 1103515245 + 12345) % 2147483647;
  const rnd = state.seed / 2147483647;
  const centered = (rnd - 0.5) * 2;
  const drift = CFG.mockDriftBps / 10000;
  const vol = CFG.mockVolBps / 10000;
  state.price = Math.max(1, state.price * (1 + drift + centered * vol));
  state.step += 1;
  saveJson(PRICE_STATE_FILE, { ...state, updatedAt: NOW() });
  return state.price;
}

async function fetchJupiterPrice() {
  const base = 'https://lite-api.jup.ag/price/v3';
  const url = `${base}?ids=${encodeURIComponent(CFG.solMint)}`;
  const data = await fetchJson(url);
  const row = data?.[CFG.solMint];
  const price = Number(row?.usdPrice ?? row?.price ?? row);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid Jupiter price payload');
  // Preserve mock-walk fields (seed, step) so switching to mock mode doesn't corrupt the walk
  const existing = loadJson(PRICE_STATE_FILE, {});
  saveJson(PRICE_STATE_FILE, { ...existing, price, source: 'jupiter', updatedAt: NOW() });
  return price;
}

export async function getSolUsdPrice() {
  const cacheFilePath = fileInState(PRICE_CACHE_FILE);

  // Check if cache is fresh
  if (fs.existsSync(cacheFilePath)) {
    try {
      const cache = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
      const cacheAgeMs = Date.now() - new Date(cache.timestamp).getTime();
      if (cacheAgeMs < CFG.loopSec * 1000) {
        return cache.price;
      }
    } catch {}
  }

  // Cache is stale or doesn't exist, fetch new price
  let price;
  if (CFG.priceMode === 'mock') {
    price = stepMockPrice();
  } else if (CFG.priceMode === 'jupiter') {
    price = await fetchJupiterPrice();
  } else {
    try {
      price = await fetchJupiterPrice();
    } catch {
      price = stepMockPrice();
    }
  }

  // Write to cache
  fs.writeFileSync(cacheFilePath, JSON.stringify({ price, timestamp: NOW() }));
  return price;
}
