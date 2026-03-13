import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR, ensureDirs } from './common.mjs';

ensureDirs();
const files = ['executor.jsonl', 'bull.jsonl', 'bear.jsonl', 'sweeper.jsonl'];
const positions = new Map();

for (const file of files) {
  const full = path.join(LOG_DIR, file);
  if (!fs.existsSync(full)) fs.writeFileSync(full, '');
  positions.set(file, fs.statSync(full).size);
  fs.watchFile(full, { interval: 1000 }, () => {
    const start = positions.get(file) || 0;
    const end = fs.statSync(full).size;
    if (end <= start) return;
    const stream = fs.createReadStream(full, { start, end: end - 1, encoding: 'utf8' });
    let data = '';
    stream.on('data', (chunk) => { data += chunk; });
    stream.on('end', () => {
      positions.set(file, end);
      for (const line of data.split('\n').filter(Boolean)) {
        console.log(`[${file}] ${line}`);
      }
    });
  });
}

console.log('Watching logs...');
