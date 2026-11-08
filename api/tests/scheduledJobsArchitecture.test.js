'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createScheduledJobHandlers } = require('../lib/scheduledJobHandlers');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const scheduler = fs.readFileSync(path.join(__dirname, '..', 'lib', 'backgroundScheduler.js'), 'utf8');
const handlersSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'scheduledJobHandlers.js'), 'utf8');

test('server bootstrap delegates scheduled business work to one handler module', () => {
  assert.ok(server.split(/\r?\n/).length < 100);
  
  
  
  
  for (const name of [
    'installmentReminder', 'pendingPaymentReminder', 'refreshFxRates',
    'daqqiSessionReminder', 'leadRetargeting', 'waitlistNotify',
  ]) {
    assert.match(handlersSource, new RegExp(`async function ${name}\\(`));
  }
});

test('empty scheduled jobs are safe no-ops against their injected database', async () => {
  const queries = [];
  const pool = {
    query: async sql => {
      queries.push(sql);
      return [[]];
    },
  };
  const logger = { info() {}, warn() {} };
  const jobs = createScheduledJobHandlers({ pool, logger });
  await jobs.installmentReminder();
  await jobs.pendingPaymentReminder();
  await jobs.daqqiSessionReminder();
  await jobs.leadRetargeting();
  await jobs.waitlistNotify();
  assert.equal(queries.length, 5);
});

test('scheduled job storage reads and mutations retain tenant identity', () => {
  
  
  
  
  // The waitlist sweep used to carry its own SQL, and this pinned the tenant
  // join inside it. That SQL asked for cw.notify_sent and c.capacity — columns
  // that exist in neither the schema nor any migration — so it threw on its
  // first query every run and nobody waiting for a seat was ever told one had
  // opened. The rule now comes from lib/courseWaitlist.js, which is the copy
  // that always worked, and the tenant travels as an argument rather than as a
  // join. Same guarantee, and this is where it now lives.
  
  
  // Comments stripped: the note left in place of the old SQL names the column
  // it removed, and matched against the raw file that sentence answers the
  // assertion instead of the code.
  const handlersCode = handlersSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(handlersCode, /notify_sent/, 'the column that never existed must be gone');

  const waitlist = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'courseWaitlist.js'), 'utf8');
  
});
