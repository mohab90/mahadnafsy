'use strict';

// Health observer only. It never opens SSH sessions or restarts processes.
const HEALTH_URL = process.env.WATCHDOG_HEALTH_URL || 'http://127.0.0.1:3001/api/health';
const INTERVAL_MS = Math.max(10_000, Number(process.env.WATCHDOG_INTERVAL_MS || 30_000));
const FAILURE_THRESHOLD = Math.max(2, Number(process.env.WATCHDOG_FAILURE_THRESHOLD || 3));
let failures = 0;

async function probe() {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    failures = 0;
    console.log(JSON.stringify({ level: 'info', event: 'health_ok', at: new Date().toISOString() }));
  } catch (error) {
    failures += 1;
    console.error(JSON.stringify({
      level: failures >= FAILURE_THRESHOLD ? 'error' : 'warn',
      event: 'health_failed',
      failures,
      threshold: FAILURE_THRESHOLD,
      at: new Date().toISOString(),
      error: error.message,
    }));
  }
}

probe();
const timer = setInterval(probe, INTERVAL_MS);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(timer);
    process.exit(0);
  });
}
