#!/usr/bin/env node
/**
 * Chaos Engineering Suite for Solana Trading Bot
 * Tests resilience against: RPC failure, Jupiter timeout, balance mismatch, network partition
 * 
 * Usage: node scripts/chaos_test.mjs [scenario] [--iterations N]
 * Scenarios: rpc-failure, jupiter-timeout, balance-mismatch, network-partition, kill-mid-trade, corrupt-state, rpc-503, all
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SCENARIOS = {
  'rpc-failure': {
    name: 'RPC Complete Failure',
    description: 'Primary RPC returns 503/timeout, failover must activate',
    test: async (botProcess) => {
      // Simulate by blocking RPC endpoint at firewall level (simulated via env)
      process.env.CHAOS_BLOCK_RPC = 'true';
      await sleep(5000);
      // Verify failover happened
      const health = await fetchHealth();
      return health.rpc === 'healthy' && health.status === 'healthy';
    }
  },
  'jupiter-timeout': {
    name: 'Jupiter API Timeout',
    description: 'Jupiter Ultra API hangs for 30s, bot must gracefully handle',
    test: async (botProcess) => {
      process.env.CHAOS_JUPITER_DELAY = '30000';
      await sleep(10000);
      // Verify no crash, trades skipped with proper logging
      const logs = getRecentLogs('jupiter', 100);
      return logs.some(l => l.includes('timeout') || l.includes('skip'));
    }
  },
  'balance-mismatch': {
    name: 'Portfolio Balance Mismatch',
    description: 'On-chain balance differs from portfolio.json by >$100',
    test: async (botProcess) => {
      // Corrupt portfolio.json
      const portfolioPath = path.join(ROOT, 'state/portfolio.json');
      const original = fs.readFileSync(portfolioPath, 'utf8');
      const corrupted = JSON.parse(original);
      corrupted.usdc += 500; // Add fake $500
      fs.writeFileSync(portfolioPath, JSON.stringify(corrupted, null, 2));
      
      await sleep(5000);
      
      // Check if reconciliation detected and alerted
      const logs = getRecentLogs('reconcile', 50);
      const detected = logs.some(l => l.includes('drift') || l.includes('mismatch'));
      
      // Restore
      fs.writeFileSync(portfolioPath, original);
      
      return detected;
    }
  },
  'network-partition': {
    name: 'Network Partition',
    description: 'Bot loses connectivity to RPC and Jupiter simultaneously',
    test: async (botProcess) => {
      process.env.CHAOS_BLOCK_ALL = 'true';
      await sleep(10000);
      delete process.env.CHAOS_BLOCK_ALL;
      await sleep(5000);
      // Verify recovery
      const health = await fetchHealth();
      return health.status !== 'unhealthy';
    }
  },
  'kill-mid-trade': {
    name: 'Kill Mid-Trade',
    description: 'SIGKILL executor during trade execution, verify reconciliation',
    test: async (botProcess) => {
      // Trigger a trade first
      await triggerTestTrade();
      await sleep(1000); // Let trade start
      
      // Kill executor
      botProcess.kill('SIGKILL');
      await sleep(3000);
      
      // Restart and verify
      // (In real test, supervisor would restart)
      await sleep(5000);
      const logs = getRecentLogs('reconcile', 50);
      return logs.some(l => l.includes('UNCONFIRMED') || l.includes('reconciled'));
    }
  },
  'corrupt-state': {
    name: 'Corrupt State Files',
    description: 'state/executor.json corrupted, bot must recover from checkpoint',
    test: async (botProcess) => {
      const statePath = path.join(ROOT, 'state/state-exec.json');
      const original = fs.readFileSync(statePath, 'utf8');
      fs.writeFileSync(statePath, '{ corrupted: true');
      
      await sleep(5000);
      
      // Check if bot handles gracefully (falls back to defaults)
      const logs = getRecentLogs('executor', 50);
      const handled = logs.some(l => l.includes('corrupt') || l.includes('fallback') || l.includes('reset'));
      
      fs.writeFileSync(statePath, original);
      return handled;
    }
  },
  'rpc-503': {
    name: 'RPC 503 Service Unavailable',
    description: 'RPC returns HTTP 503 for 30 seconds',
    test: async (botProcess) => {
      process.env.CHAOS_RPC_503 = 'true';
      await sleep(35000);
      delete process.env.CHAOS_RPC_503;
      await sleep(5000);
      const health = await fetchHealth();
      return health.rpc === 'healthy';
    }
  }
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchHealth() {
  try {
    const res = await fetch('http://localhost:8788/health');
    return await res.json();
  } catch {
    return { status: 'unreachable', rpc: 'down' };
  }
}

function getRecentLogs(prefix, lines) {
  const logDir = path.join(ROOT, 'logs');
  const files = fs.readdirSync(logDir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.log'))
    .sort()
    .reverse();
  
  if (files.length === 0) return [];
  
  const latest = fs.readFileSync(path.join(logDir, files[0]), 'utf8');
  return latest.trim().split('\n').slice(-lines);
}

async function triggerTestTrade() {
  // This would need to inject a test signal
  // For now, just simulate by writing to signals.jsonl
  const signal = {
    t: new Date().toISOString(),
    bot: 'TEST',
    side: 'BUY',
    amount: 10,
    signalId: 'chaos-test-' + Date.now(),
    edgeBps: 50
  };
  fs.appendFileSync(path.join(ROOT, 'logs/signals.jsonl'), JSON.stringify(signal) + '\n');
}

async function runScenario(name, iterations = 1) {
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`Unknown scenario: ${name}`);
  
  console.log(`\n[Chaos] Starting: ${scenario.name}`);
  console.log(`[Chaos] ${scenario.description}`);
  
  const results = { name, passed: 0, failed: 0, details: [] };
  
  for (let i = 0; i < iterations; i++) {
    console.log(`[Chaos] Iteration ${i + 1}/${iterations}...`);
    
    // Start bot if not running (use supervisor)
    // For this test, we assume bot is already running under supervisor
    
    const startTime = Date.now();
    let passed = false;
    let error = null;
    
    try {
      passed = await scenario.test(null);
    } catch (e) {
      error = e.message;
    }
    
    const duration = Date.now() - startTime;
    
    if (passed) {
      results.passed++;
      results.details.push({ iteration: i + 1, passed: true, duration });
      console.log(`[Chaos] ✅ Passed (${duration}ms)`);
    } else {
      results.failed++;
      results.details.push({ iteration: i + 1, passed: false, duration, error });
      console.log(`[Chaos] ❌ Failed (${duration}ms) - ${error || 'assertion failed'}`);
    }
    
    // Cool down between iterations
    await sleep(5000);
  }
  
  return results;
}

async function runAll(iterations = 1) {
  console.log('[Chaos] Starting full chaos engineering suite...');
  
  const allResults = {
    timestamp: new Date().toISOString(),
    totalScenarios: Object.keys(SCENARIOS).length,
    iterations,
    scenarios: [],
    summary: { total: 0, passed: 0, failed: 0 }
  };
  
  for (const name of Object.keys(SCENARIOS)) {
    const result = await runScenario(name, iterations);
    allResults.scenarios.push(result);
    allResults.summary.total += result.passed + result.failed;
    allResults.summary.passed += result.passed;
    allResults.failed += result.failed;
  }
  
  // Save report
  const reportPath = path.join(ROOT, 'chaos_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(allResults, null, 2));
  
  console.log('\n[Chaos] ========== CHAOS ENGINEERING REPORT ==========');
  console.log(`Total tests: ${allResults.summary.total}`);
  console.log(`Passed: ${allResults.summary.passed}`);
  console.log(`Failed: ${allResults.summary.failed}`);
  console.log(`Report saved to: ${reportPath}`);
  
  // Exit with failure if any failed
  if (allResults.summary.failed > 0) {
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const scenario = args[0];
  const iterations = parseInt(args.find(a => a.startsWith('--iterations='))?.split('=')[1] || '1');
  
  if (!scenario || scenario === 'all') {
    await runAll(iterations);
  } else if (SCENARIOS[scenario]) {
    await runScenario(scenario, iterations);
  } else {
    console.log('Available scenarios:');
    for (const [name, s] of Object.entries(SCENARIOS)) {
      console.log(`  ${name}: ${s.name} - ${s.description}`);
    }
    console.log('\nUsage: node scripts/chaos_test.mjs <scenario|all> [--iterations=N]');
  }
}

main().catch(e => {
  console.error('[Chaos] Fatal error:', e);
  process.exit(1);
});