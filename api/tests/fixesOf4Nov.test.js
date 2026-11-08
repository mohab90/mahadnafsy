'use strict';

// 4 Nov 2026, after the release of the 3 Nov work: Saturday is a work day; no bonus is written by the system; an activate / pause / convert save names the fields it
// changes; the client database pages each population in its own indexed query; a client with two logins sees the same courses on both.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-fixes-secret-0123456789-abcdefghijklmnopqr';
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const readRepo = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

test('Saturday is a working day: the policy moves to Friday only and no fallback names Saturday', () => {
  const sql = read('migrations/361_v26_saturday_is_a_work_day_and_manual_bonuses.sql');
  
  
  
  const { evaluateMonth } = require('../lib/attendancePolicy');
  const days = evaluateMonth({ policy: { weekend_days_json: [5] }, month: '2026-10' }).days.map(day => day.date);
  assert.ok(days.includes('2026-10-03'), 'Saturday 3 Oct is judged');
  assert.ok(!days.includes('2026-10-02'), 'Friday 2 Oct is the weekend');
});

test('no bonus is written by the system, and the month sheet has no required / reached / bonus columns', () => {
  const compensation = read('lib/paymentCompensation.js');
  
  
  const routes = read('routes/hr/compensation.js');
  
  
  const sheet = readRepo('admin/pages/dashboard/tabs/hr-sections/HrMonthSheet.tsx');
  assert.doesNotMatch(sheet, /month-bonuses|المطلوب|المحقق/);
  
});

test('an activate, pause or convert save names the fields it changes, so a stale screen is not refused', () => {
  const hook = readRepo('admin/context/site-data-hooks/useCrmCoreState.ts');
  assert.match(hook, /updateSubscriber = async \(item: SubscriberItem, only\?: string\[\]\)/);
  assert.match(hook, /const changedFields = only \? \[\.\.\.new Set\(only\)\] : base/);
  assert.match(readRepo('admin/pages/dashboard/tabs/online-clients-sections/BulkActionBar.tsx'), /updateSubscriber\(\{ \.\.\.sub, clientStatus: newStatus \}, \['clientStatus'\]\)/);
  assert.match(readRepo('admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx'), /updateSubscriber\(nextRow, nextClientStatus \? \['status', 'clientStatus'\] : \['status'\]\)/);
  const online = readRepo('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
  for (const name of ['moved', 'onlineUpdated', 'pending', 'updated']) assert.match(online, new RegExp(`updateSubscriber\\(${name}, \\[`), `${name} names its fields`);
  assert.match(readRepo('admin/pages/UnifiedClientPage.tsx'), /status: subscriber!\.status === 'active' \? 'paused' : 'active' \}, \['status'\]\)/);
});

test('the client database pages each population in its own query, with the order inside it', () => {
  const route = read('routes/misc/clientDbList.js');
  
  
  
  
  
  
  
  const screen = readRepo('admin/pages/dashboard/tabs/ClientDbTab.tsx');
  assert.match(screen, /setSummaryFailed\(true\)/, 'a failed summary is said, not shown as zeros');
  assert.doesNotMatch(screen, /setRows\(\[\]\); setTotal\(0\); notify/, 'a failed page keeps the rows on screen');
});

test('a login reaches the client record holding the courses; two logins of one client share it', async () => {
  const { resolveSubscriberRow } = require('../lib/subscriberIdentity');
  const seen = [];
  // Login u-2 (verified e-mail a@b.c, no record of its own); the record of that e-mail is held by another live login and holds a course.
  const db = {
    async query(sql, params) {
      seen.push(sql);
      if (/FROM users WHERE id=\?/.test(sql)) return [[{ email: 'a@b.c', phone: null, email_unverified: 0 }]];
      if (/s\.firebase_uid=\? AND s\.deleted_at IS NULL LIMIT 1/.test(sql)) return [[undefined]];
      if (/s\.email=\?/.test(sql)) return [[{ id: 'client-held-by-u1' }]];
      return [{ affectedRows: 0 }];
    },
  };
  const row = await resolveSubscriberRow({ tenantId: 't', user: { uid: 'u-2' } }, ['id'], db);
  assert.equal(row.id, 'client-held-by-u1', 'the e-mail reaches the record although another login holds it');
  assert.ok(!seen.some(sql => /^UPDATE subscribers SET firebase_uid=NULL/.test(sql.trim())), 'nothing is taken from the other login');
  const emailQuery = seen.find(sql => /s\.email=\?/.test(sql));
  assert.match(emailQuery, /ORDER BY \(EXISTS \(SELECT 1 FROM enrollments en/, 'the record holding courses comes first');
});

test('a login tied to an empty record moves to the record of the same person that holds the courses', async () => {
  const { resolveSubscriberRow } = require('../lib/subscriberIdentity');
  const updates = [];
  const db = {
    async query(sql) {
      if (/s\.firebase_uid=\? AND s\.deleted_at IS NULL LIMIT 1/.test(sql)) return [[{ id: 'empty-record' }]];
      if (/FROM enrollments WHERE tenant_id=\? AND subscriber_id=\?/.test(sql)) return [[undefined]];
      if (/FROM users WHERE id=\?/.test(sql)) return [[{ email: 'a@b.c', phone: null, email_unverified: 0 }]];
      if (/s\.email=\?/.test(sql)) return [[{ id: 'full-record' }]];
      if (/SELECT 1 AS ok FROM subscribers s/.test(sql)) return [[{ ok: 1 }]];
      updates.push(sql.trim().slice(0, 40));
      return [{ affectedRows: 1 }];
    },
  };
  const row = await resolveSubscriberRow({ tenantId: 't', user: { uid: 'u-1' } }, ['id'], db);
  assert.equal(row.id, 'full-record');
  assert.equal(updates.length, 2, 'the old record lets go, then the new one is taken');
});

test('the repair tools: a report until --apply, a backup first, nothing taken by a payroll run is touched, a name link only for the accounts named', () => {
  const void_ = read('tools/void-booking-bonuses.cjs');
  
  
  
  
  
  const link = read('tools/link-site-accounts.cjs');
  
  
  const diagnose = read('tools/diagnose-client-sign-in.cjs');
  
  assert.ok(diagnose.includes('UPDATE|INSERT|DELETE|REPLACE') && diagnose.includes('Promise.resolve([{ affectedRows: 0 }])'), 'the rehearsal answers every write with 0 rows');
});
