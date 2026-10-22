'use strict';

// The background jobs without the HTTP server (MAHAD_ROLE, lib/processRole.js).
// Started by deploy/systemd/mahad-api-worker.service beside an API that runs
// with MAHAD_ROLE=web. The reps' WhatsApp sessions stay in an API process (the
// one with MAHAD_WA_WEB=1 when there are several, lib/whatsappWeb.js waWebMode):
// the «واتساب» routes link and send through the session object held in memory
// (lib/whatsappWeb.js requireOwner), so moving them here would refuse every send.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
process.env.TZ = 'UTC';
process.env.MAHAD_ROLE = 'worker';

const logger = require('./lib/logger');
const { pool } = require('./lib/db');
const { registerProcessLifecycle } = require('./lib/processLifecycle');
const { startProductionRuntimeGuard } = require('./lib/productionRuntimeGuard');
const { startBackgroundScheduler } = require('./lib/backgroundScheduler');

const criticalConfig = require('./lib/productionConfig').criticalProductionPolicy();
if (!criticalConfig.ok) {
  logger.error('[FATAL] Production secret policy failed', { errors: criticalConfig.errors });
  process.exit(1);
}
if (!process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
  logger.error('[FATAL] DB_USER / DB_PASSWORD / DB_NAME must be set in .env');
  process.exit(1);
}

registerProcessLifecycle({ logger, pool });
startProductionRuntimeGuard({ logger });

// No migrations here: the release job (or the web process outside production)
// owns the schema, and two processes migrating at once is what it must never do.
require('./lib/messageTemplates').startTemplatesRefresh();
require('./lib/rbacOverrides').startRbacRefresh();
// The API's own port, for the scheduler's self-ping of /api/health.
startBackgroundScheduler({ pool, logger, port: Number.parseInt(process.env.PORT || '3001', 10) });
require('./lib/reconcileJob').startReconcileMonitor(pool);
// The timers that live beside the routes (daily report, reminders, sweeps):
// here, and not in the MAHAD_ROLE=web processes, so N web instances run them once.
require('./lib/routeJobs').startRouteJobs({ logger });

// Every scheduler timer is unref'd so the API can exit cleanly; this process
// has no server holding the event loop open, so it holds it itself.
setInterval(() => {}, 60 * 60 * 1000);
logger.info('[worker] background jobs running (MAHAD_ROLE=worker)');
