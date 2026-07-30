'use strict';

function startProductionRuntimeGuard({ logger }) {
  if (process.env.NODE_ENV !== 'production') return { enabled: false };

  const thresholdMb = Math.max(128, Number(process.env.MEMORY_HEAL_LIMIT_MB || 256));
  const interval = setInterval(() => {
    const rssMb = process.memoryUsage().rss / 1048576;
    if (rssMb <= thresholdMb) return;
    logger.warn(`[runtime] memory ${rssMb.toFixed(1)}MB exceeded ${thresholdMb}MB; requesting managed restart`);
    try {
      require('./errorMonitor').alert('Memory threshold exceeded', {
        rssMB: Number(rssMb.toFixed(1)),
        thresholdMB: thresholdMb,
      });
    } catch (_) {}
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 3000).unref();
  }, 30000);
  if (interval.unref) interval.unref();

  logger.info('[runtime] external process manager owns restart; application filesystem remains immutable');
  return { enabled: true, interval, thresholdMb };
}

module.exports = { startProductionRuntimeGuard };
