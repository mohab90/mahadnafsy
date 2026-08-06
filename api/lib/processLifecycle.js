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

  /**
   * Shut down on the first SIGTERM.
   *
   * This used to ignore a lone SIGTERM and only act on a second one within 5s,
   * presumably to survive some supervisor that sent spurious signals. systemd
   * sends exactly one, waits TimeoutStopSec (90s by default) and then SIGKILLs
   * — so the graceful path never ran once in 36 recorded signals, and *every*
   * restart in this service's history was a 90-second hard outage with the port
   * still held. That is the "site is down for a minute" users were reporting
   * after each deploy.
   *
   * The double-signal escape hatch is kept, inverted: a second SIGTERM while a
   * shutdown is already draining exits immediately instead of waiting.
   */
  const shutdown = (signal) => {
    const memory = process.memoryUsage();
    if (isShuttingDown) {
      logger.info(`[${signal}] second signal during drain — exiting now`);
      process.exit(0);
      return;
    }
    isShuttingDown = true;
    sigtermCount += 1;
    sigtermFirst = Date.now();
    logger.info(`[${signal}] received — memRss=${Math.round(memory.rss / 1048576)}MB — draining`);

    if (!httpServer) {
      pool.end().catch(() => {}).finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000);
      return;
    }
    // Stop accepting new connections, let in-flight requests finish.
    httpServer.close(() => {
      pool.end().catch(() => {}).finally(() => {
        logger.info(`[${signal}] graceful shutdown complete`);
        process.exit(0);
      });
    });
    // Well inside systemd's 90s TimeoutStopSec, so the restart is quick even if
    // a long-poll or a slow query is still holding a socket open.
    setTimeout(() => {
      logger.info(`[${signal}] force exit after 10s drain timeout`);
      process.exit(0);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

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
