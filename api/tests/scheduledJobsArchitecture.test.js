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
  assert.match(server, /startBackgroundScheduler\(\{ pool, logger, port: PORT \}\)/);
  assert.match(scheduler, /createScheduledJobHandlers\(\{ pool, logger \}\)/);
  assert.doesNotMatch(server, /FROM daqqi_rounds|INSERT IGNORE INTO retargeting_log|FROM course_waitlist/);
  assert.doesNotMatch(server, /crm_json LIKE '%installmentPlans%'/);
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
  assert.match(handlersSource, /subscribers WHERE is_active=1[\s\S]*tenant_id/);
  assert.match(handlersSource, /JOIN subscribers s ON s\.id=p\.subscriber_id AND s\.tenant_id=p\.tenant_id/);
  assert.match(handlersSource, /c\.tenant_id=dr\.tenant_id/);
  assert.match(handlersSource, /WHERE id=\? AND tenant_id=\?/);
  assert.match(handlersSource, /e\.tenant_id=cw\.tenant_id/);
});
