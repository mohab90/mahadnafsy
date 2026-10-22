'use strict';

// The timers that live beside their routes (the daily report, reminders, the
// SLA and payment-review sweeps in routes/misc/_shared.js, the ticket sweep in
// routes/support.js). They used to start when the route file was required, so
// they ran in every process serving HTTP — and only there: a second web
// instance doubled them, and a MAHAD_ROLE=web + worker split left them in the
// web process. Now they start once, from the process that owns the jobs
// (lib/processRole.js runsJobs): server.js with MAHAD_ROLE=all, or worker.js.
//
// routes/gsheets.js and routes/analytics/financial.js keep their own timers:
// one runs under the 'sheets_sync' job lock, the other claims each recurring
// expense with SELECT … FOR UPDATE and its last_run, so neither repeats work.
let started = false;

function startRouteJobs({ logger = require('./logger') } = {}) {
  if (started) return false;
  started = true;
  require('../routes/misc/_shared').startSharedRouteJobs();
  require('../routes/support').scheduleSlaSweep();
  logger.info('[jobs] route timers started in this process');
  return true;
}

module.exports = { startRouteJobs };
