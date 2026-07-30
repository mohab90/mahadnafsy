'use strict';

function registerProcessLifecycle({ logger, pool }) {
  let sigtermCount = 0;
  let sigtermFirst = 0;
  let isShuttingDown = false;
  let httpServer = null;

  process.on('uncaughtException', (error) => {
    if (error.code === 'EADDRINUSE') {
      const port = error.port || process.env.PORT || 3001;
      logger.warn(`[EADDRINUSE] Port ${port} is busy — another instance running, exiting quietly (supervisor handles restart)`);
      setTimeout(() => process.exit(1), 500);
      return;
    }
    logger.error('[uncaughtException]', error.message, error.stack);
    try {
      require('./errorMonitor').captureException(error, { kind: 'uncaughtException' });
    } catch { /* optional monitor */ }
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('[unhandledRejection]', reason);
    try {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      require('./errorMonitor').captureException(error, { kind: 'unhandledRejection' });
    } catch { /* optional monitor */ }
  });

  process.on('SIGTERM', () => {
    sigtermCount += 1;
    const now = Date.now();
    const memory = process.memoryUsage();
    const rapid = sigtermCount > 1 && now - sigtermFirst < 5000;
    logger.info(`[SIGTERM] #${sigtermCount} received — memRss=${Math.round(memory.rss / 1048576)}MB — ${rapid ? 'rapid=yes → shutting down' : 'isolated → ignoring'}`);
    if (sigtermCount === 1) sigtermFirst = now;
    if (!rapid || isShuttingDown) return;
    isShuttingDown = true;

    if (!httpServer) {
      setTimeout(() => process.exit(0), 3000);
      return;
    }
    httpServer.close(() => {
      pool.end().catch(() => {}).finally(() => {
        logger.info('[SIGTERM] graceful shutdown complete');
        process.exit(0);
      });
    });
    setTimeout(() => {
      logger.info('[SIGTERM] force exit after 15s timeout');
      process.exit(0);
    }, 15000);
  });

  setInterval(() => {
    const memory = process.memoryUsage();
    logger.info(`[memory] rss=${Math.round(memory.rss / 1048576)}MB heap=${Math.round(memory.heapUsed / 1048576)}MB/${Math.round(memory.heapTotal / 1048576)}MB ext=${Math.round(memory.external / 1048576)}MB`);
  }, 10 * 60 * 1000);

  return {
    setHttpServer(server) {
      httpServer = server;
    },
  };
}

module.exports = { registerProcessLifecycle };
