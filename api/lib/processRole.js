'use strict';

// Which half of the API this process is (MAHAD_ROLE):
//   all    — HTTP and the background jobs in one process (the default, and how
//            the server has always run);
//   web    — HTTP only; the jobs run in api/worker.js under its own unit
//            (deploy/systemd/*-worker.service), so a slow sheet sync or a big
//            score refresh no longer competes with requests for the event loop;
//   worker — the jobs only (api/worker.js).
// Anything else is a typo, and the safe reading of a typo is the old behaviour.
const ROLES = ['all', 'web', 'worker'];

function processRole(env = process.env) {
  const role = String(env.MAHAD_ROLE || 'all').trim().toLowerCase();
  return ROLES.includes(role) ? role : 'all';
}

const servesHttp = role => role !== 'worker';
const runsJobs = role => role !== 'web';

// MAHAD_MULTI_INSTANCE=1: this process is one of two or more web instances
// behind nginx (deploy/MULTI_INSTANCE.md). What one process kept in memory and
// the others must see — rate-limit counts, who is online — then lives in the
// database (or Redis, when that is switched on). Off: the single API as before.
const multiInstance = (env = process.env) => String(env.MAHAD_MULTI_INSTANCE || '').trim() === '1';

// Another process reads the same database for this deployment: the worker
// beside a MAHAD_ROLE=web API, or a second web instance. Then a cache dropped
// here must be dropped there too (lib/cacheBus.js). CACHE_SYNC=1|0 overrides.
function sharesCaches(env = process.env) {
  const forced = String(env.CACHE_SYNC || '').trim();
  if (forced === '1') return true;
  if (forced === '0') return false;
  return multiInstance(env) || processRole(env) !== 'all';
}

module.exports = { ROLES, processRole, servesHttp, runsJobs, multiInstance, sharesCaches };
