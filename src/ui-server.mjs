import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { CFG, NOW, fileInLogs, loadJson, logJsonl } from './common.mjs';

let runner = null;
const sseClients = [];

function logsTail(file, count = 15) {
  const p = fileInLogs(file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).slice(-count);
}

function getSkipReasons() {
  const p = fileInLogs('executor.jsonl');
  if (!fs.existsSync(p)) return {};
  const reasons = {};
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'skip' && obj.reason) {
        reasons[obj.reason] = (reasons[obj.reason] || 0) + 1;
      }
    } catch {}
  }
  return reasons;
}

function getLastSignals() {
  const p = fileInLogs('signals.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).slice(-8).reverse().map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function stateSnapshot() {
  const portfolio = loadJson('portfolio.json', null);
  const trades = logsTail('executor.jsonl', 15).filter(line => {
    try {
      const obj = JSON.parse(typeof line === 'string' ? line : JSON.stringify(line));
      return obj.type === 'trade' || obj.type === 'dry_run_trade';
    } catch { return false; }
  }).map(line => {
    try { return typeof line === 'string' ? JSON.parse(line) : line; } catch { return null; }
  }).filter(Boolean);

  const skipReasons = getSkipReasons();
  const lastSignals = getLastSignals();

  const snapshot = {
    running: Boolean(runner && !runner.killed),
    pid: runner?.pid || null,
    mode: CFG.executionMode,
    dryRun: CFG.dryRun,
    price: loadJson('price-cache.json', null)?.price || 0,
    portfolio,
    trades,
    skipReasons,
    lastSignals,
    now: NOW(),
  };

  return snapshot;
}

function startAll({ dryRun }) {
  if (runner && !runner.killed) return;
  const env = { ...process.env, DRY_RUN: dryRun ? '1' : '0' };
  runner = spawn(process.execPath, ['src/all.mjs'], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  });
  runner.on('exit', () => {
    runner = null;
    broadcastSnapshot();
  });
  broadcastSnapshot();
}

function stopAll() {
  if (!runner) return;
  runner.kill('SIGTERM');
}

function broadcastSnapshot() {
  const data = stateSnapshot();
  const json = JSON.stringify(data);
  for (const res of sseClients) {
    try {
      res.write(`data: ${json}\n\n`);
    } catch {}
  }
}

function sendHtml(res) {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Solana SOL/USDC Agent Dashboard</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #f1f5f9; padding: 20px; line-height: 1.6; }
.container { max-width: 1200px; margin: 0 auto; }
h1 { margin-bottom: 30px; font-size: 28px; }
h2 { font-size: 16px; margin: 15px 0 10px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.8; }
.status-bar { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
.status-item { background: #1e293b; padding: 15px; border-radius: 8px; border-left: 3px solid #3b82f6; }
.status-item.running { border-left-color: #10b981; }
.status-item.stopped { border-left-color: #ef4444; }
.status-item label { font-size: 11px; text-transform: uppercase; opacity: 0.6; }
.status-item .value { font-size: 18px; font-weight: bold; margin-top: 8px; font-family: monospace; }
.portfolio-card { background: #1e293b; padding: 20px; border-radius: 8px; margin-bottom: 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; }
.portfolio-item { border-left: 2px solid #64748b; padding-left: 15px; }
.portfolio-item label { font-size: 11px; text-transform: uppercase; opacity: 0.6; }
.portfolio-item .value { font-size: 20px; font-weight: bold; margin-top: 8px; font-family: monospace; }
.portfolio-item .sub { font-size: 12px; opacity: 0.7; margin-top: 4px; }
.controls { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
button { padding: 10px 16px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.2s; }
button:hover { background: #2563eb; }
button.stop { background: #ef4444; }
button.stop:hover { background: #dc2626; }
.trades-table { background: #1e293b; border-radius: 8px; overflow: hidden; margin-bottom: 20px; }
.trades-header { display: grid; grid-template-columns: 100px 80px 100px 120px 80px; gap: 10px; padding: 12px; background: #0f172a; font-size: 12px; text-transform: uppercase; font-weight: 600; }
.trade-row { display: grid; grid-template-columns: 100px 80px 100px 120px 80px; gap: 10px; padding: 12px; border-top: 1px solid #334155; font-size: 12px; }
.trade-row:hover { background: #0f172a; }
.trade-side.BUY { color: #10b981; }
.trade-side.SELL { color: #f59e0b; }
.skip-reasons { background: #1e293b; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
.skip-reason { font-size: 12px; padding: 6px 12px; background: #334155; border-radius: 4px; display: inline-block; margin: 3px; }
.last-signals { background: #1e293b; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
.signal-item { font-size: 12px; padding: 8px; border-left: 2px solid #64748b; margin-bottom: 6px; padding-left: 12px; }
.signal-item.BUY { border-left-color: #10b981; }
.signal-item.SELL { border-left-color: #f59e0b; }
@media (max-width: 768px) {
  .trades-header, .trade-row { grid-template-columns: 1fr; }
  .status-bar { grid-template-columns: 1fr; }
  .portfolio-card { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
  <div class="container">
    <h1>Solana SOL/USDC Agent Dashboard</h1>

    <div class="controls">
      <button onclick="start(true)">Start Paper (Observe Only)</button>
      <button onclick="start(false)">Start Paper (Autonomous)</button>
      <button class="stop" onclick="stop()">Stop</button>
    </div>

    <div class="status-bar">
      <div class="status-item" id="status-running">
        <label>Status</label>
        <div class="value" id="status-text">Stopped</div>
      </div>
      <div class="status-item">
        <label>Mode</label>
        <div class="value" id="status-mode">-</div>
      </div>
      <div class="status-item">
        <label>Price (SOL/USD)</label>
        <div class="value" id="status-price">-</div>
      </div>
      <div class="status-item">
        <label>Updated</label>
        <div class="value" id="status-time">-</div>
      </div>
    </div>

    <div class="portfolio-card" id="portfolio">
      <div class="portfolio-item">
        <label>SOL</label>
        <div class="value" id="portfolio-sol">-</div>
      </div>
      <div class="portfolio-item">
        <label>USDC</label>
        <div class="value" id="portfolio-usdc">-</div>
      </div>
      <div class="portfolio-item">
        <label>Unrealized PnL</label>
        <div class="value" id="portfolio-unrealized">-</div>
      </div>
      <div class="portfolio-item">
        <label>Realized PnL</label>
        <div class="value" id="portfolio-realized">-</div>
      </div>
    </div>

    <h2>Recent Trades</h2>
    <div class="trades-table">
      <div class="trades-header">
        <div>Time</div>
        <div>Side</div>
        <div>Amount</div>
        <div>Price</div>
        <div>PnL</div>
      </div>
      <div id="trades"></div>
    </div>

    <h2>Skip Reasons (Top 5)</h2>
    <div class="skip-reasons" id="skip-reasons"></div>

    <h2>Last 8 Signals</h2>
    <div class="last-signals" id="last-signals"></div>
  </div>

  <script>
    function start(dryRun) {
      const action = dryRun ? 'start-dry' : 'start-live';
      fetch(\`/\${action}\`, { method: 'POST' }).catch(e => console.error(e));
    }

    function stop() {
      fetch('/stop', { method: 'POST' }).catch(e => console.error(e));
    }

    function updateUI(snapshot) {
      document.getElementById('status-running').className = 'status-item ' + (snapshot.running ? 'running' : 'stopped');
      document.getElementById('status-text').textContent = snapshot.running ? 'Running' : 'Stopped';
      document.getElementById('status-mode').textContent = snapshot.mode;
      document.getElementById('status-price').textContent = snapshot.price ? snapshot.price.toFixed(2) : '-';
      document.getElementById('status-time').textContent = new Date(snapshot.now).toLocaleTimeString();

      const p = snapshot.portfolio;
      if (p) {
        document.getElementById('portfolio-sol').textContent = p.sol?.toFixed(3) || '-';
        document.getElementById('portfolio-usdc').textContent = p.usdc?.toFixed(2) || '-';
        const unrealPnl = p.sol && snapshot.price ? (snapshot.price - (p.avgEntryPrice || 0)) * p.sol : 0;
        document.getElementById('portfolio-unrealized').innerHTML =
          '<div class="value' + (unrealPnl >= 0 ? ' green' : ' red') + '">' + unrealPnl.toFixed(2) + '</div>';
        document.getElementById('portfolio-realized').innerHTML =
          '<div class="value' + (p.realizedPnlUsdc >= 0 ? ' green' : ' red') + '">' + p.realizedPnlUsdc.toFixed(2) + '</div>';
      }

      const trades = snapshot.trades || [];
      const tradesHtml = trades.map(t => \`
        <div class="trade-row">
          <div>\${new Date(t.t).toLocaleTimeString()}</div>
          <div class="trade-side \${t.side}">\${t.side}</div>
          <div>\${t.amount?.toFixed(4) || '-'}</div>
          <div>\${t.price?.toFixed(2) || '-'}</div>
          <div>\${t.realizedPnlUsdc?.toFixed(2) || '-'}</div>
        </div>
      \`).join('');
      document.getElementById('trades').innerHTML = tradesHtml || '<div class="trade-row">No trades yet</div>';

      const reasons = snapshot.skipReasons || {};
      const reasonsArray = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 5);
      document.getElementById('skip-reasons').innerHTML = reasonsArray.length > 0
        ? reasonsArray.map(([r, c]) => \`<div class="skip-reason">\${r}: \${c}</div>\`).join('')
        : '<div style="opacity: 0.5;">No skips yet</div>';

      const signals = snapshot.lastSignals || [];
      document.getElementById('last-signals').innerHTML = signals.length > 0
        ? signals.map(s => \`<div class="signal-item \${s.side}">\${new Date(s.t).toLocaleTimeString()} <strong>\${s.side}</strong> @ \${s.price.toFixed(2)} (edge \${s.edgeBps}bps)</div>\`).join('')
        : '<div style="opacity: 0.5;">No signals yet</div>';
    }

    const eventSource = new EventSource('/events');
    eventSource.onmessage = (e) => {
      try {
        const snapshot = JSON.parse(e.data);
        updateUI(snapshot);
      } catch (err) {
        console.error('Failed to parse snapshot:', err);
      }
    };
    eventSource.onerror = () => {
      console.error('EventSource connection lost');
      setTimeout(() => location.reload(), 3000);
    };
  </script>
</body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${CFG.uiPort}`);

  if (req.method === 'GET' && url.pathname === '/') return sendHtml(res);

  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    sseClients.push(res);
    broadcastSnapshot();
    res.on('close', () => {
      const idx = sseClients.indexOf(res);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/start-dry') {
    startAll({ dryRun: true });
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/start-live') {
    startAll({ dryRun: false });
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/stop') {
    stopAll();
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

// Periodically broadcast snapshot
setInterval(broadcastSnapshot, 5000);

server.listen(CFG.uiPort, '127.0.0.1', () => {
  console.log(`UI ready on http://127.0.0.1:${CFG.uiPort}`);
});
