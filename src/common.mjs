import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env');
const EXAMPLE_ENV_PATH = path.join(ROOT, '.env.example');

function loadEnvFile(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  const text = fs.readFileSync(targetPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(EXAMPLE_ENV_PATH);
loadEnvFile(ENV_PATH);

export { ROOT };
export const LOG_DIR = path.join(ROOT, 'logs');
export const STATE_DIR = path.join(ROOT, 'state');
export const NOW = () => new Date().toISOString();

export function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${name}: ${raw}`);
  return n;
}

export function bool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(raw).toLowerCase());
}

export const CFG = {
  networkLabel: process.env.NETWORK_LABEL || 'devnet',
  rpcUrl: process.env.RPC_URL || 'https://api.devnet.solana.com',
  executionMode: process.env.EXECUTION_MODE || 'simulated',
  dryRun: bool('DRY_RUN', true),
  uiPort: num('UI_PORT', 8787),
  loopSec: Math.max(5, num('LOOP_SEC', 15)),
  signalMinSec: Math.max(5, num('SIGNAL_MIN_SEC', 300)),
  cooldownSec: Math.max(5, num('COOLDOWN_SEC', 900)),
  decisionWindowSec: Math.max(10, num('DECISION_WINDOW_SEC', 60)),
  maxTradesPerDay: Math.max(1, num('MAX_TRADES_PER_DAY', 8)),
  staleSignalSec: Math.max(10, num('STALE_SIGNAL_SEC', 180)),
  minExpectedEdgeBps: Math.max(0, num('MIN_EXPECTED_EDGE_BPS', 20)),
  minTradeUsdc: Math.max(1, num('MIN_TRADE_USDC', 10)),
  maxNotionalUsdc: Math.max(1, num('MAX_NOTIONAL_USDC', 75)),
  dailyNotionalLimitUsdc: Math.max(1, num('DAILY_NOTIONAL_LIMIT_USDC', 400)),
  minSolReserve: Math.max(0, num('MIN_SOL_RESERVE', 0.05)),
  bullDipPct: Math.max(0.01, num('BULL_DIP_PCT', 0.5)),
  bullRipPct: Math.max(0.01, num('BULL_RIP_PCT', 1.5)),
  bullBuyUsdc: Math.max(1, num('BULL_BUY_USDC', 25)),
  bullSellSol: Math.max(0.001, num('BULL_SELL_SOL', 0.15)),
  bearDipPct: Math.max(0.01, num('BEAR_DIP_PCT', 1.5)),
  bearRipPct: Math.max(0.01, num('BEAR_RIP_PCT', 0.5)),
  bearBuyUsdc: Math.max(1, num('BEAR_BUY_USDC', 15)),
  bearSellSol: Math.max(0.001, num('BEAR_SELL_SOL', 0.15)),
  mockStartPrice: Math.max(1, num('MOCK_START_PRICE', 180)),
  mockDriftBps: num('MOCK_DRIFT_BPS', 18),
  mockVolBps: num('MOCK_VOL_BPS', 45),
  simStartUsdc: Math.max(0, num('SIM_START_USDC', 1000)),
  simStartSol: Math.max(0, num('SIM_START_SOL', 5)),
  simFeeBps: Math.max(0, num('SIM_FEE_BPS', 10)),
  simSlippageBps: Math.max(0, num('SIM_SLIPPAGE_BPS', 8)),
  usdcReserve: Math.max(0, num('USDC_RESERVE', 300)),
  usdcProfitMin: Math.max(0, num('USDC_PROFIT_MIN', 25)),
  profitSweepPct: Math.max(0, Math.min(1, num('PROFIT_SWEEP_PCT', 0.5))),
  sweepEverySec: Math.max(30, num('SWEEP_EVERY_SEC', 600)),
  minSolForSweep: Math.max(0, num('MIN_SOL_FOR_SWEEP', 0.05)),
  profitWallet: process.env.PROFIT_WALLET || '',
  runOnce: bool('RUN_ONCE', false),
  priceMode: process.env.PRICE_MODE || 'auto',
  airdropOnWallet: bool('AIRDROP_ON_WALLET', false),
  airdropSol: Math.max(0.1, num('AIRDROP_SOL', 1)),
  solMint: process.env.SOL_MINT || 'So11111111111111111111111111111111111111112',
  usdcMint: process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  shadowMode: bool('SHADOW_MODE', false),
  shadowQuoteOnTrade: bool('SHADOW_QUOTE_ON_TRADE', true),
  stalePriceSec: Math.max(10, num('STALE_PRICE_SEC', 60)),
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || '',
  alertOnTrade: bool('ALERT_ON_TRADE', false),
  alertOnError: bool('ALERT_ON_ERROR', false),
  realMaxTradesPerDay: Math.max(1, num('REAL_MAX_TRADES_PER_DAY', 5)),
  realMaxNotionalUsdc: Math.max(1, num('REAL_MAX_NOTIONAL_USDC', 25)),
  realDailyNotionalLimitUsdc: Math.max(1, num('REAL_DAILY_NOTIONAL_LIMIT_USDC', 50)),
  privateKey: process.env.PRIVATE_KEY || '',
};

function validateConfig() {
  if (!CFG.rpcUrl.startsWith('http')) throw new Error('RPC_URL must start with http');
  const numericFields = ['loopSec', 'signalMinSec', 'cooldownSec', 'decisionWindowSec', 'maxTradesPerDay', 'staleSignalSec', 'minExpectedEdgeBps', 'minTradeUsdc', 'maxNotionalUsdc', 'dailyNotionalLimitUsdc', 'minSolReserve', 'bullDipPct', 'bullRipPct', 'bullBuyUsdc', 'bullSellSol', 'bearDipPct', 'bearRipPct', 'bearBuyUsdc', 'bearSellSol', 'mockStartPrice', 'mockDriftBps', 'mockVolBps', 'simStartUsdc', 'simStartSol', 'simFeeBps', 'simSlippageBps', 'usdcReserve', 'usdcProfitMin', 'profitSweepPct', 'sweepEverySec', 'minSolForSweep', 'stalePriceSec', 'realMaxTradesPerDay', 'realMaxNotionalUsdc', 'realDailyNotionalLimitUsdc'];
  for (const field of numericFields) {
    if (!Number.isFinite(CFG[field])) throw new Error(`${field} must be a finite number`);
  }
  if (CFG.executionMode === 'real') {
    if (CFG.rpcUrl.includes('devnet')) throw new Error('RPC_URL must not contain devnet when executionMode is real');
    const hasPrivateKey = CFG.privateKey || fs.existsSync(path.join(STATE_DIR, 'generated-wallet.json'));
    if (!hasPrivateKey) throw new Error('Either PRIVATE_KEY env or state/generated-wallet.json must exist for real execution');
    if (CFG.realMaxNotionalUsdc > 100) throw new Error('realMaxNotionalUsdc must be <= 100 for real execution');
    if (CFG.realDailyNotionalLimitUsdc > 500) throw new Error('realDailyNotionalLimitUsdc must be <= 500 for real execution');
    if (!CFG.profitWallet || CFG.profitWallet.trim() === '') throw new Error('PROFIT_WALLET must be set for real execution');
  }
}

validateConfig();

export function ensureDirs() {
  for (const dir of [LOG_DIR, STATE_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

export function fileInState(name) {
  ensureDirs();
  return path.join(STATE_DIR, name);
}

export function fileInLogs(name) {
  ensureDirs();
  return path.join(LOG_DIR, name);
}

export function logJsonl(file, obj) {
  ensureDirs();
  const filePath = fileInLogs(file);
  const logDir = path.dirname(filePath);

  // Log rotation: if file > 5MB, rotate it
  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    if (stat.size > 5 * 1024 * 1024) {
      const date = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const baseName = path.basename(file);
      const rotatedName = baseName.replace(/\.jsonl$/, `.${date}.jsonl`);
      const rotatedPath = path.join(logDir, rotatedName);
      fs.renameSync(filePath, rotatedPath);
    }
  }

  fs.appendFileSync(filePath, JSON.stringify(obj) + '\n');
}

export function loadJson(file, fallback) {
  const p = fileInState(file);
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

export function saveJson(file, value) {
  fs.writeFileSync(fileInState(file), JSON.stringify(value, null, 2));
}

export function isDisabled() {
  return fs.existsSync(path.join(ROOT, 'DISABLED'));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runLoop(tick, intervalSec) {
  while (true) {
    await tick();
    if (CFG.runOnce) return;
    await sleep(intervalSec * 1000);
  }
}

export function makeSignalId(signal) {
  return crypto.createHash('sha256').update(JSON.stringify(signal)).digest('hex').slice(0, 16);
}

export function getDecisionWindow(ts = Date.now()) {
  const windowMs = CFG.decisionWindowSec * 1000;
  return Math.floor(ts / windowMs);
}

export function freshDay() {
  return new Date().toISOString().slice(0, 10);
}

export function loadPortfolio() {
  const fallback = {
    mode: CFG.executionMode,
    usdc: CFG.simStartUsdc,
    sol: CFG.simStartSol,
    avgEntryPrice: 0,
    realizedPnlUsdc: 0,
    sweptUsdc: 0,
    lastUpdatedAt: NOW(),
  };
  const state = loadJson('portfolio.json', fallback);
  return { ...fallback, ...state };
}

export function savePortfolio(portfolio) {
  saveJson('portfolio.json', { ...portfolio, lastUpdatedAt: NOW() });
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(buffer) {
  if (!buffer.length) return '';
  const digits = [0];
  for (const byte of buffer) {
    let carry = byte;
    for (let j = 0; j < digits.length; ++j) {
      const x = digits[j] * 256 + carry;
      digits[j] = x % 58;
      carry = Math.floor(x / 58);
    }
    while (carry) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let result = '';
  for (const byte of buffer) {
    if (byte === 0) result += '1';
    else break;
  }
  for (let q = digits.length - 1; q >= 0; --q) result += ALPHABET[digits[q]];
  return result;
}

export function generateWalletRecord() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  const publicKeyRaw = spki.subarray(spki.length - 32);
  return {
    address: base58Encode(publicKeyRaw),
    publicKeySpkiBase64: spki.toString('base64'),
    privateKeyPkcs8Base64: pkcs8.toString('base64'),
    createdAt: NOW(),
  };
}

export function walletFilePath() {
  return fileInState('generated-wallet.json');
}

export function saveGeneratedWallet(record) {
  fs.writeFileSync(walletFilePath(), JSON.stringify(record, null, 2));
}

export function loadWallet({ createIfMissing = false } = {}) {
  const p = walletFilePath();
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!createIfMissing) throw new Error('No generated wallet found. Run: npm run wallet:new');
  const record = generateWalletRecord();
  saveGeneratedWallet(record);
  return record;
}

export async function rpcRequest(method, params = []) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(CFG.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`RPC HTTP ${response.status} ${response.statusText}`);
    const json = await response.json();
    if (json.error) throw new Error(`RPC ${method} error: ${JSON.stringify(json.error)}`);
    return json.result;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error(`RPC ${method} timed out after 15s`);
    throw error;
  }
}

export async function getWalletBalance(address) {
  try {
    const result = await rpcRequest('getBalance', [address]);
    return Number(result?.value || 0) / 1_000_000_000;
  } catch {
    return 0;
  }
}

export async function requestAirdrop(address, solAmount) {
  const lamports = Math.floor(solAmount * 1_000_000_000);
  return rpcRequest('requestAirdrop', [address, lamports]);
}

export async function withLock(lockName, fn) {
  ensureDirs();
  const lockPath = fileInState(lockName);
  const staleMs = Math.max(CFG.loopSec * 4000, 120000);
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: NOW() }));
    fs.closeSync(fd);
  } catch {
    if (fs.existsSync(lockPath)) {
      const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (ageMs > staleMs) {
        fs.rmSync(lockPath, { force: true });
        return withLock(lockName, fn);
      }
    }
    return { locked: false };
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

export async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}: ${text.slice(0, 250)}`);
    }
    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error(`Request to ${url} timed out`);
    throw error;
  }
}

export function safeReadJsonFile(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}
