'use strict';

// `proc` and `exit` are the real process unless a test passes stand-ins.
function registerProcessLifecycle({ logger, pool, proc = process, exit = code => process.exit(code) }) {
  let sigtermCount = 0;
  let sigtermFirst = 0;
  let isShuttingDown = false;
  let httpServer = null;

  // An uncaught exception leaves the process in an unknown state (a half-run
  // handler, a lock or transaction never released), so carrying on — which this
  // used to do — served requests from a broken process indefinitely. Drain what
  // can be drained and exit non-zero; systemd (Restart=on-failure) starts a
  // clean one.
  proc.on('uncaughtException', (error) => {
    if (error?.code === 'EADDRINUSE') {
      const port = error.port || process.env.PORT || 3001;
      logger.warn(`[EADDRINUSE] Port ${port} is busy — another instance running, exiting quietly (supervisor handles restart)`);
      setTimeout(() => exit(1), 500);
      return;
    }
    logger.error('[uncaughtException]', error?.message, error?.stack);
    try {
      require('./errorMonitor').captureException(error, { kind: 'uncaughtException' });
    } catch { /* optional monitor */ }
    shutdown('uncaughtException', 1);
  });

  // A rejected promise nobody awaited is logged, not fatal. Many fire-and-forget
  // calls here (`void notify(...)`, audit writes) can reject on a transient
  // network or DB error without leaving shared state broken, and restarting the
  // whole API for each would turn one failed WhatsApp send into an outage.
  proc.on('unhandledRejection', (reason) => {
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
  function shutdown(signal, exitCode = 0) {
    const memory = process.memoryUsage();
    if (isShuttingDown) {
      logger.info(`[${signal}] second signal during drain — exiting now`);
      exit(exitCode);
      return;
    }
    isShuttingDown = true;
    sigtermCount += 1;
    sigtermFirst = Date.now();
    logger.info(`[${signal}] received — memRss=${Math.round(memory.rss / 1048576)}MB — draining`);

    if (!httpServer) {
      pool.end().catch(() => {}).finally(() => exit(exitCode));
      setTimeout(() => exit(exitCode), 3000).unref();
      return;
    }
    // Stop accepting new connections, let in-flight requests finish.
    httpServer.close(() => {
      pool.end().catch(() => {}).finally(() => {
        logger.info(`[${signal}] graceful shutdown complete`);
        exit(exitCode);
      });
    });
    // Well inside systemd's 90s TimeoutStopSec, so the restart is quick even if
    // a long-poll or a slow query is still holding a socket open.
    setTimeout(() => {
      logger.info(`[${signal}] force exit after 10s drain timeout`);
      exit(exitCode);
    }, 10000).unref();
  }

  proc.on('SIGTERM', () => shutdown('SIGTERM'));
  proc.on('SIGINT', () => shutdown('SIGINT'));

  setInterval(() => {
    const memory = process.memoryUsage();
    logger.info(`[memory] rss=${Math.round(memory.rss / 1048576)}MB heap=${Math.round(memory.heapUsed / 1048576)}MB/${Math.round(memory.heapTotal / 1048576)}MB ext=${Math.round(memory.external / 1048576)}MB`);
  }, 10 * 60 * 1000).unref();

  return {
    setHttpServer(server) {
      httpServer = server;
    },
  };
}

module.exports = { registerProcessLifecycle };
