'use strict';

function startProductionRuntimeGuard({ logger }) {
  if (process.env.NODE_ENV !== 'production') return { enabled: false };

  // 256MB was a hair trigger, not a safety net. On an 8GB box serving a dashboard
  // that pulls ~20k leads and ~5k subscribers on every load, ordinary operation
  // crosses it constantly: it fired 414 times in a single day on production.
  // Keep the net — hang it low enough that only a real leak reaches it.
  const thresholdMb = Math.max(128, Number(process.env.MEMORY_HEAL_LIMIT_MB || 1536));
  let restarting = false;
  const interval = setInterval(() => {
    const rssMb = process.memoryUsage().rss / 1048576;
    if (rssMb <= thresholdMb || restarting) return;
    restarting = true;
    logger.warn(`[runtime] memory ${rssMb.toFixed(1)}MB exceeded ${thresholdMb}MB; requesting managed restart`);
    try {
      require('./errorMonitor').alert('Memory threshold exceeded', {
        rssMB: Number(rssMb.toFixed(1)),
        thresholdMB: thresholdMb,
      });
    } catch (_) {}
    // SIGTERM, not process.exit(1): lib/processLifecycle.js registers a drain on
    // that signal which stops accepting new connections and lets the requests
    // already running finish. Exiting outright severed them mid-flight, which is
    // what turned each of those 414 restarts into 502s for whoever was mid-click.
    // systemd is Restart=always, so a clean exit still brings the service back;
    // the raw exit(1) stays as the backstop if the drain itself wedges.
    process.kill(process.pid, 'SIGTERM');
    setTimeout(() => process.exit(1), 15000).unref();
  }, 30000);
  if (interval.unref) interval.unref();

  logger.info('[runtime] external process manager owns restart; application filesystem remains immutable');
  return { enabled: true, interval, thresholdMb };
}

module.exports = { startProductionRuntimeGuard };
