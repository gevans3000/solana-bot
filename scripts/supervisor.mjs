#!/usr/bin/env node
/**
 * Process Supervisor - PM2-compatible process manager for Solana bot
 * Manages: executor, bull-bot, bear-bot, sweeper, ui-server
 * 
 * Usage: node scripts/supervisor.mjs [start|stop|restart|status|health]
 * Config: scripts/supervisor.config.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(__dirname, 'supervisor.config.json');
const PID_DIR = path.join(ROOT, 'run');
const LOG_DIR = path.join(ROOT, 'logs');

if (!fs.existsSync(PID_DIR)) fs.mkdirSync(PID_DIR, { recursive: true });
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Default configuration
const DEFAULT_CONFIG = {
  processes: [
    { name: 'executor', script: 'src/executor.mjs', args: [], instances: 1, autorestart: true, maxRestarts: 5, restartDelay: 10000, env: {} },
    { name: 'bull-bot', script: 'src/bot-bull.mjs', args: [], instances: 1, autorestart: true, maxRestarts: 5, restartDelay: 5000, env: {} },
    { name: 'bear-bot', script: 'src/bot-bear.mjs', args: [], instances: 1, autorestart: true, maxRestarts: 5, restartDelay: 5000, env: {} },
    { name: 'sweeper', script: 'src/sweeper.mjs', args: [], instances: 1, autorestart: true, maxRestarts: 3, restartDelay: 10000, env: {} },
    { name: 'ui-server', script: 'src/ui-server.mjs', args: [], instances: 1, autorestart: true, maxRestarts: 3, restartDelay: 5000, env: {} }
  ],
  healthCheck: { enabled: true, port: 8788, path: '/health', interval: 30000 },
  logging: { maxSizeMB: 100, maxFiles: 10, compress: true },
  resources: { cpuAlertPercent: 80, ramAlertMB: 2048 },
  gracefulShutdown: { timeout: 30000 }
};

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return { ...DEFAULT_CONFIG, ...config, processes: config.processes || DEFAULT_CONFIG.processes };
    } catch (e) {
      console.error(`[Supervisor] Failed to load config: ${e.message}, using defaults`);
    }
  }
  return DEFAULT_CONFIG;
}

const config = loadConfig();

const processes = new Map();
const processStates = new Map();

function getPidPath(name) {
  return path.join(PID_DIR, `${name}.pid`);
}

function getLogPath(name, type) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return path.join(LOG_DIR, `${name}-${type}-${date}.log`);
}

function rotateLogs(logPath, maxSizeMB, maxFiles) {
  try {
    if (!fs.existsSync(logPath)) return;
    const stats = fs.statSync(logPath);
    if (stats.size >= maxSizeMB * 1024 * 1024) {
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const rotated = logPath.replace(/\.log$/, `-${timestamp}.log`);
      fs.renameSync(logPath, rotated);
      
      // Clean old logs
      const dir = path.dirname(logPath);
      const prefix = path.basename(logPath).split('-')[0];
      const files = fs.readdirSync(dir)
        .filter(f => f.startsWith(prefix + '-') && f.endsWith('.log'))
        .map(f => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time);
      
      if (files.length > maxFiles) {
        files.slice(maxFiles).forEach(f => fs.rmSync(path.join(dir, f.name), { force: true }));
      }
    }
  } catch (e) {
    console.warn(`[Supervisor] Log rotation failed: ${e.message}`);
  }
}

function startProcess(procConfig) {
  const name = procConfig.name;
  const env = { ...process.env, ...procConfig.env, SUPERVISED: '1', PROCESS_NAME: name };
  
  for (let i = 0; i < (procConfig.instances || 1); i++) {
    const instanceName = procConfig.instances > 1 ? `${name}-${i}` : name;
    const logOut = getLogPath(instanceName, 'out');
    const logErr = getLogPath(instanceName, 'err');
    
    rotateLogs(logOut, config.logging.maxSizeMB, config.logging.maxFiles);
    rotateLogs(logErr, config.logging.maxSizeMB, config.logging.maxFiles);
    
    const child = spawn('node', [procConfig.script, ...(procConfig.args || [])], {
      cwd: ROOT,
      env,
      detached: false,
      stdio: ['ignore', fs.openSync(logOut, 'a'), fs.openSync(logErr, 'a')]
    });
    
    processes.set(instanceName, child);
    processStates.set(instanceName, {
      name: instanceName,
      config: procConfig,
      pid: child.pid,
      restarts: 0,
      startTime: Date.now(),
      lastRestart: 0,
      status: 'running'
    });
    
    // Save PID
    fs.writeFileSync(getPidPath(instanceName), String(child.pid));
    
    child.on('exit', (code, signal) => {
      const state = processStates.get(instanceName);
      if (state) {
        state.status = 'stopped';
        state.exitCode = code;
        state.signal = signal;
      }
      console.log(`[Supervisor] ${instanceName} exited with code ${code} signal ${signal}`);
      
      if (procConfig.autorestart && state && state.restarts < (procConfig.maxRestarts || 5)) {
        const now = Date.now();
        if (now - state.lastRestart > (procConfig.restartDelay || 5000)) {
          state.restarts++;
          state.lastRestart = now;
          console.log(`[Supervisor] Restarting ${instanceName} (attempt ${state.restarts}/${procConfig.maxRestarts})`);
          setTimeout(() => startSingleInstance(instanceName, procConfig), procConfig.restartDelay || 5000);
        } else {
          console.error(`[Supervisor] ${instanceName} exceeded restart rate, waiting...`);
          setTimeout(() => startSingleInstance(instanceName, procConfig), 60000);
        }
      } else if (state && state.restarts >= (procConfig.maxRestarts || 5)) {
        console.error(`[Supervisor] ${instanceName} exceeded max restarts (${procConfig.maxRestarts}), alerting!`);
        // Would send alert here
      }
    });
    
    child.on('error', (err) => {
      console.error(`[Supervisor] ${instanceName} error: ${err.message}`);
    });
    
    console.log(`[Supervisor] Started ${instanceName} (PID: ${child.pid})`);
  }
}

function startSingleInstance(name, procConfig) {
  const env = { ...process.env, ...procConfig.env, SUPERVISED: '1', PROCESS_NAME: name };
  const logOut = getLogPath(name, 'out');
  const logErr = getLogPath(name, 'err');
  
  rotateLogs(logOut, config.logging.maxSizeMB, config.logging.maxFiles);
  rotateLogs(logErr, config.logging.maxSizeMB, config.logging.maxFiles);
  
  const child = spawn('node', [procConfig.script, ...(procConfig.args || [])], {
    cwd: ROOT,
    env,
    detached: false,
    stdio: ['ignore', fs.openSync(logOut, 'a'), fs.openSync(logErr, 'a')]
  });
  
  processes.set(name, child);
  const state = processStates.get(name) || {};
  state.pid = child.pid;
  state.status = 'running';
  state.lastRestart = Date.now();
  processStates.set(name, state);
  fs.writeFileSync(getPidPath(name), String(child.pid));
  
  child.on('exit', (code, signal) => {
    const state = processStates.get(name);
    if (state) {
      state.status = 'stopped';
      state.exitCode = code;
      state.signal = signal;
    }
    if (procConfig.autorestart && state && state.restarts < (procConfig.maxRestarts || 5)) {
      state.restarts++;
      setTimeout(() => startSingleInstance(name, procConfig), procConfig.restartDelay || 5000);
    }
  });
}

function stopProcess(name) {
  const child = processes.get(name);
  if (child) {
    console.log(`[Supervisor] Stopping ${name} (PID: ${child.pid})...`);
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, config.gracefulShutdown?.timeout || 30000);
    processes.delete(name);
  }
  
  // Remove PID file
  try { fs.rmSync(getPidPath(name), { force: true }); } catch {}
}

function stopAll() {
  console.log('[Supervisor] Stopping all processes...');
  for (const name of processes.keys()) {
    stopProcess(name);
  }
}

async function healthCheck() {
  const results = { status: 'healthy', timestamp: new Date().toISOString(), processes: {}, rpc: 'unknown' };
  let unhealthyCount = 0;
  
  for (const [name, state] of processStates) {
    const alive = state.status === 'running' && processes.has(name);
    const uptime = state.startTime ? Date.now() - state.startTime : 0;
    const restarts = state.restarts || 0;
    
    results.processes[name] = { alive, status: state.status, uptime, restarts, pid: state.pid };
    if (!alive) unhealthyCount++;
  }
  
  // Test RPC
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://api.devnet.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const json = await res.json();
      results.rpc = json.result === 'ok' ? 'healthy' : 'degraded';
    } else {
      results.rpc = 'down';
    }
  } catch {
    results.rpc = 'down';
  }
  
  if (unhealthyCount > 0 || results.rpc === 'down') {
    results.status = unhealthyCount > 0 ? 'degraded' : 'unhealthy';
  }
  
  return results;
}

async function startHealthServer() {
  if (!config.healthCheck?.enabled) return;
  
  const http = await import('node:http');
  const server = http.createServer(async (req, res) => {
    if (req.url === config.healthCheck.path) {
      const health = await healthCheck();
      res.writeHead(health.status === 'healthy' ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
    } else {
      res.writeHead(404); res.end();
    }
  });
  
  server.listen(config.healthCheck.port, () => {
    console.log(`[Supervisor] Health server listening on port ${config.healthCheck.port}`);
  });
  
  return server;
}

async function resourceMonitor() {
  setInterval(() => {
    const usage = process.memoryUsage();
    const ramMB = usage.heapUsed / 1024 / 1024;
    if (ramMB > (config.resources?.ramAlertMB || 2048)) {
      console.warn(`[Supervisor] HIGH RAM: ${ramMB.toFixed(0)}MB`);
    }
    // Note: CPU % requires sampling over time, omitted for simplicity
  }, 60000);
}

async function main() {
  const command = process.argv[2] || 'start';
  
  // Write default config if not exists
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    console.log(`[Supervisor] Created default config at ${CONFIG_PATH}`);
  }
  
  switch (command) {
    case 'start':
      console.log('[Supervisor] Starting all processes...');
      for (const procConfig of config.processes) {
        startProcess(procConfig);
      }
      await startHealthServer();
      resourceMonitor();
      
      // Handle graceful shutdown
      process.on('SIGTERM', async () => {
        console.log('[Supervisor] SIGTERM received, shutting down...');
        stopAll();
        process.exit(0);
      });
      process.on('SIGINT', async () => {
        console.log('[Supervisor] SIGINT received, shutting down...');
        stopAll();
        process.exit(0);
      });
      break;
      
    case 'stop':
      console.log('[Supervisor] Stopping all processes...');
      stopAll();
      break;
      
    case 'restart':
      console.log('[Supervisor] Restarting all processes...');
      stopAll();
      setTimeout(() => {
        for (const procConfig of config.processes) {
          startProcess(procConfig);
        }
      }, 2000);
      break;
      
    case 'status':
      for (const [name, state] of processStates) {
        const alive = state.status === 'running' && processes.has(name);
        console.log(`${name}: ${alive ? 'RUNNING' : 'STOPPED'} (PID: ${state.pid}, restarts: ${state.restarts})`);
      }
      break;
      
    case 'health':
      const health = await healthCheck();
      console.log(JSON.stringify(health, null, 2));
      break;
      
    default:
      console.log('Usage: node scripts/supervisor.mjs [start|stop|restart|status|health]');
  }
}

main().catch(e => {
  console.error('[Supervisor] Fatal error:', e);
  process.exit(1);
});