import { CFG } from './src/common.mjs';
import { loadSeries, runBacktest, paramsFromCfg } from './src/backtest.mjs';
import path from 'node:path';

console.log('Config loaded, keys:', Object.keys(CFG).length);

const dataFile = path.join(process.cwd(), 'backtest', 'data', 'sol-usd-1d-full.json');
const series = loadSeries(dataFile);
console.log('Series loaded:', series.length, 'candles');

const base = paramsFromCfg(CFG);
console.log('Base params:', Object.keys(base).length);

const tr = runBacktest(series.slice(0, 100), base);
console.log('Test backtest result:', tr.returnPct, tr.trades);