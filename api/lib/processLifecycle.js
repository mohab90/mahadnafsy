'use strict';

// Set from the first SIGTERM until the process exits. lib/httpApp.js reads it:
// every answer from then on carries «Connection: close», so nginx does not send
// the next request down a socket that is about to go, and /api/health answers
// 503 «draining», so neither nginx nor the rolling deploy counts this instance
// as up while it finishes.
let draining = false;
const isDraining = () => draining;

// How long in-flight requests get after SIGTERM. Inside systemd's
// TimeoutStopSec (30s in deploy/systemd), and long enough for a slow report.
const drainCapMs = (env = process.env) => {
  const value = Number(env.SHUTDOWN_DRAIN_MS);
  return Number.isFinite(value) && value >= 1000 ? Math.min(value, 25000) : 10000;
};

// `proc` and `exit` are the real process unless a test passes stand-ins.
function registerProcessLifecycle({ logger, pool, proc = process, exit = code => process.exit(code), drainMs = drainCapMs() }) {
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
    draining = true;
    sigtermCount += 1;
    sigtermFirst = Date.now();
    logger.info(`[${signal}] received — memRss=${Math.round(memory.rss / 1048576)}MB — draining`);

    if (!httpServer) {
      pool.end().catch(() => {}).finally(() => exit(exitCode));
      setTimeout(() => exit(exitCode), 3000).unref();
      return;
    }
    // A keep-alive socket whose request finishes after close() sits idle until
    // its 65s timeout and holds close() open; sweep the idle ones as they appear.
    const idleSweep = setInterval(() => httpServer.closeIdleConnections?.(), 250);
    idleSweep.unref?.();
    // Stop accepting: the listening socket closes now, so nginx's next connect
    // to this port is refused and (proxy_next_upstream error) goes to the other
    // instance — for any method, because nothing was sent here yet. Requests
    // already in flight finish.
    httpServer.close(() => {
      clearInterval(idleSweep);
      pool.end().catch(() => {}).finally(() => {
        logger.info(`[${signal}] graceful shutdown complete`);
        exit(exitCode);
      });
    });
    httpServer.closeIdleConnections?.();
    // The cap: whatever is still running is cut, the pool is closed (briefly
    // waited for) and the process exits, well inside systemd's TimeoutStopSec.
    setTimeout(() => {
      clearInterval(idleSweep);
      logger.info(`[${signal}] force exit after ${Math.round(drainMs / 1000)}s drain cap`);
      httpServer.closeAllConnections?.();
      Promise.race([pool.end().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500).unref?.())])
        .finally(() => exit(exitCode));
    }, drainMs).unref();
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

module.exports = { registerProcessLifecycle, isDraining, drainCapMs, _testing: { reset() { draining = false; } } };
