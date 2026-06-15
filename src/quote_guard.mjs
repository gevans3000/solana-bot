import { CFG, NOW, logJsonl, sleep } from './common.mjs';

const DEFAULT_QUOTE_MAX_AGE_MS = 200;
const CACHE_TTL_MS = 150;
const CACHE_MAX_ENTRIES = 50;

const quoteCache = new Map();
let metrics = {
  hits: 0,
  misses: 0,
  rejections: 0,
  totalAgeMs: 0,
  totalQuotes: 0,
};

function cacheKey({ inputMint, outputMint, amount, slippageBps }) {
  return `${inputMint}:${outputMint}:${amount}:${slippageBps}`;
}

function isCacheValid(entry) {
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

function evictOldest() {
  if (quoteCache.size >= CACHE_MAX_ENTRIES) {
    const firstKey = quoteCache.keys().next().value;
    quoteCache.delete(firstKey);
  }
}

export function getQuoteMaxAgeMs() {
  return CFG.quoteMaxAgeMs || DEFAULT_QUOTE_MAX_AGE_MS;
}

export function checkQuoteFreshness(quote, rpcLatencyEstimate = 50) {
  if (!quote || !quote.timestamp) {
    return { fresh: false, reason: 'no_timestamp', ageMs: null };
  }
  
  const quoteAge = Date.now() - new Date(quote.timestamp).getTime();
  const staleness = quoteAge - rpcLatencyEstimate;
  const maxAge = getQuoteMaxAgeMs();
  
  if (staleness > maxAge) {
    metrics.rejections++;
    return { fresh: false, reason: 'stale', ageMs: staleness, maxAge };
  }
  
  return { fresh: true, ageMs: staleness, maxAge };
}

export function getCachedQuote({ inputMint, outputMint, amount, slippageBps }) {
  const key = cacheKey({ inputMint, outputMint, amount, slippageBps });
  const entry = quoteCache.get(key);
  
  if (entry && isCacheValid(entry)) {
    metrics.hits++;
    return { hit: true, quote: entry.quote, ageMs: Date.now() - entry.timestamp };
  }
  
  metrics.misses++;
  return { hit: false };
}

export function setCachedQuote({ inputMint, outputMint, amount, slippageBps }, quote) {
  evictOldest();
  const key = cacheKey({ inputMint, outputMint, amount, slippageBps });
  quoteCache.set(key, {
    quote: { ...quote, timestamp: new Date().toISOString() },
    timestamp: Date.now(),
  });
}

export async function preFetchQuote({ side, amountUsdc, amountSol, walletAddress, slippageBps }) {
  const { getJupiterQuote } = await import('./shadow-quote.mjs');
  
  const inputMint = side === 'BUY' ? CFG.usdcMint : CFG.solMint;
  const outputMint = side === 'BUY' ? CFG.solMint : CFG.usdcMint;
  const amount = side === 'BUY' ? Math.floor(amountUsdc * 1e6) : Math.floor(amountSol * 1e9);
  
  const cached = getCachedQuote({ inputMint, outputMint, amount, slippageBps });
  if (cached.hit) return cached.quote;
  
  const quote = await getJupiterQuote({ side, amountUsdc, amountSol, walletAddress });
  
  if (!quote.error) {
    setCachedQuote({ inputMint, outputMint, amount, slippageBps }, quote);
  }
  
  return quote;
}

export function getMetrics() {
  const total = metrics.hits + metrics.misses;
  return {
    quote_hit_rate: total > 0 ? metrics.hits / total : 0,
    avg_age_ms: metrics.totalQuotes > 0 ? metrics.totalAgeMs / metrics.totalQuotes : 0,
    rejection_rate: metrics.totalQuotes > 0 ? metrics.rejections / metrics.totalQuotes : 0,
    cache_size: quoteCache.size,
    hits: metrics.hits,
    misses: metrics.misses,
    rejections: metrics.rejections,
  };
}

export function recordQuoteAge(ageMs) {
  metrics.totalAgeMs += ageMs;
  metrics.totalQuotes++;
}

export function clearCache() {
  quoteCache.clear();
}

export function getCacheSize() {
  return quoteCache.size;
}