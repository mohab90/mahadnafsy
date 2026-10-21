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

module.exports = { ROLES, processRole, servesHttp, runsJobs };
