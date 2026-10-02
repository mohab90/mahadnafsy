'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// getTenantSetting reads the real database; stand it in before the module loads.
let setting = {};
const settingsPath = require.resolve('../lib/tenantSettings');
require.cache[settingsPath] = { id: settingsPath, filename: settingsPath, loaded: true, exports: { getTenantSetting: async () => setting } };
const { markAutoAbsences } = require('../lib/autoAbsence');

const fakePool = () => { const calls = []; return { calls, async query(sql, params) { calls.push({ sql, params }); return [{ affectedRows: 3 }]; } }; };

test('off by default: nothing is written', async () => {
  setting = {};
  const pool = fakePool();
  assert.deepEqual(await markAutoAbsences({ pool, tenantId: 't1', date: '2026-10-01' }), { enabled: false, marked: 0 });
  assert.equal(pool.calls.length, 0);
});

test('on: marks only scheduled working days with no row at all', async () => {
  setting = { enabled: true };
  const pool = fakePool();
  const result = await markAutoAbsences({ pool, tenantId: 't1', date: '2026-10-01' }); // a Thursday
  assert.equal(result.marked, 3);
  const { sql, params } = pool.calls[0];
  assert.match(sql, /INSERT IGNORE INTO attendance_logs/, 'idempotent: a day with a row is never overwritten');
  assert.match(sql, /JOIN work_schedules/, 'only people who have a schedule');
  assert.match(sql, /w\.is_off_day=0/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM attendance_logs/, 'leave, holiday and manual rows block it');
  assert.equal(params[1], 4, 'Thursday');
});
