'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const logger = require('./lib/logger');
const { pool } = require('./lib/db');
const { ROOT: brandAssetRoot } = require('./lib/brandAssetStorage');
const { loadBlacklistFromDB } = require('./lib/token');
const { registerProcessLifecycle } = require('./lib/processLifecycle');
const { createHttpApp } = require('./lib/httpApp');
const { startProductionRuntimeGuard } = require('./lib/productionRuntimeGuard');
const { startBackgroundScheduler } = require('./lib/backgroundScheduler');

const PORT = Number.parseInt(process.env.PORT || '3001', 10);
const criticalConfig = require('./lib/productionConfig').criticalProductionPolicy();
if (!criticalConfig.ok) {
  logger.error('[FATAL] Production secret policy failed', { errors: criticalConfig.errors });
  process.exit(1);
}
if (!process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
  logger.error('[FATAL] DB_USER / DB_PASSWORD / DB_NAME must be set in .env');
  process.exit(1);
}

const processLifecycle = registerProcessLifecycle({ logger, pool });
startProductionRuntimeGuard({ logger });

// Numbered migrations are the only schema authority. Runtime DDL is never
// registered by the HTTP process, including when legacy environment flags exist.
logger.info('[startup] numbered migrations are the exclusive schema authority');

const runMigrationsOnStartup = process.env.RUN_MIGRATIONS_ON_STARTUP == null
  ? process.env.NODE_ENV !== 'production'
  : process.env.RUN_MIGRATIONS_ON_STARTUP === 'true';
const migrationReady = runMigrationsOnStartup
  ? require('./lib/migrationRunner').runMigrations(pool)
  : Promise.resolve({ baseline: 0, applied: 0, failed: 0, bootstrapped: 0, unavailable: false, skipped: true });
if (!runMigrationsOnStartup) logger.info('[startup] migrations are delegated to the release job');
require('./lib/reconcileJob').startReconcileMonitor(pool);
const app = createHttpApp({ pool, brandAssetRoot });

migrationReady.then(migrationResult => {
  if (migrationResult.failed > 0) {
    throw new Error(`database preparation failed (${migrationResult.failed} migration error(s))`);
  }
  if (migrationResult.unavailable) {
    logger.warn('[migrate] database unavailable; API will start unready until MySQL recovers');
  }

  const server = app.listen(PORT, () => {
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    processLifecycle.setHttpServer(server);
    logger.info(`Mahad API running on port ${PORT}`);
    logger.info(`Live: http://localhost:${PORT}/api/health/live`);
    logger.info(`Ready: http://localhost:${PORT}/api/health`);

    loadBlacklistFromDB().catch(() => {});
    require('./lib/rbacOverrides').startRbacRefresh();
    require('./lib/messageTemplates').startTemplatesRefresh();
    startBackgroundScheduler({ pool, logger, port: PORT });
  });
}).catch(error => {
  logger.error('[FATAL] API not started because database preparation failed:', error.message);
  process.exitCode = 1;
});
