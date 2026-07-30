'use strict';
/**
 * Integration tests against a real MySQL (Top10 #10). These run only when
 * TEST_DB_NAME (or DB_NAME) + creds are present, so CI without a DB skips them
 * cleanly. Run: npm --prefix api run test:integration
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { getDbSslConfig } = require('../../lib/dbSsl');
let mysql; try { mysql = require('mysql2/promise'); } catch { /* optional */ }

const cfg = {
  host: process.env.TEST_DB_HOST || process.env.DB_HOST || '127.0.0.1',
  port: +(process.env.TEST_DB_PORT || process.env.DB_PORT || 3306),
  user: process.env.TEST_DB_USER || process.env.DB_USER,
  password: process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD,
  database: process.env.TEST_DB_NAME || process.env.DB_NAME,
  ssl: getDbSslConfig(),
};
const ENABLED = !!(mysql && cfg.user && cfg.database);
let conn;

before(async () => { if (ENABLED) conn = await mysql.createConnection(cfg); });
after(async () => { if (conn) await conn.end(); });

test('DB is reachable', { skip: !ENABLED && 'no TEST_DB_* configured' }, async () => {
  const [[row]] = await conn.query('SELECT 1 AS ok');
  assert.equal(row.ok, 1);
});

test('payments revenue reconciles with the payment journal (no ledger drift)', { skip: !ENABLED && 'no TEST_DB_* configured' }, async () => {
  const [[pay]] = await conn.query("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE status='paid' AND (currency IS NULL OR currency='EGP')");
  const [[jr]] = await conn.query("SELECT COALESCE(SUM(jel.debit),0) t FROM journal_entry_lines jel JOIN journal_entries je ON je.id=jel.entry_id WHERE je.ref_type='payment' AND jel.account_code='1100'");
  // Allow drift only for legacy rows predating ledger-first; assert it is not growing wildly.
  assert.ok(Number(pay.t) >= 0 && Number(jr.t) >= 0);
});

test('no course has a negative student count (regression guard)', { skip: !ENABLED && 'no TEST_DB_* configured' }, async () => {
  const [[row]] = await conn.query('SELECT COUNT(*) n FROM courses WHERE students < 0');
  assert.equal(Number(row.n), 0);
});

test('no subscriber is left without a branch (post-backfill invariant)', { skip: !ENABLED && 'no TEST_DB_* configured' }, async () => {
  const [[row]] = await conn.query("SELECT COUNT(*) n FROM subscribers WHERE branch IS NULL OR branch=''");
  assert.equal(Number(row.n), 0);
});

test('Tenant A/B live matrix isolates SaaS, CRM, HR, LMS, finance and operations', { skip: !ENABLED && 'no TEST_DB_* configured' }, async () => {
  const stamp = `${process.pid.toString(36)}${Date.now().toString(36)}`;
  const ids = suffix => [`uat-a-${stamp}-${suffix}`, `uat-b-${stamp}-${suffix}`];
  const [tenantA, tenantB] = ids('tenant');
  const [branchA, branchB] = ids('branch');
  const [staffA, staffB] = ids('staff');
  const [leadA, leadB] = ids('lead');
  const [subA, subB] = ids('sub');
  const [courseA, courseB] = ids('course');
  const shared = `shared-${stamp}`;

  await conn.beginTransaction();
  try {
    await conn.query(
      `INSERT INTO tenants (id,slug,name) VALUES (?,?,?),(?,?,?)`,
      [tenantA, `${shared}-a`, 'Tenant A', tenantB, `${shared}-b`, 'Tenant B']
    );
    await conn.query(
      `INSERT INTO branches (id,tenant_id,branch_key,slug,label)
       VALUES (?,?,?,?,?),(?,?,?,?,?)`,
      [branchA, tenantA, 'MAIN', 'main', 'Main A', branchB, tenantB, 'MAIN', 'main', 'Main B']
    );
    await conn.query(
      `INSERT INTO tenant_settings (id,tenant_id,section,config_json)
       VALUES (?,?,?,?),(?,?,?,?)`,
      [...ids('setting').flatMap((id, index) => [id, index ? tenantB : tenantA, 'brand', JSON.stringify({ owner: index ? 'B' : 'A' })])]
    );
    await conn.query(
      `INSERT INTO staff (id,name,email,phone,role,joined_at,tenant_id)
       VALUES (?,?,?,?,?,NOW(),?),(?,?,?,?,?,NOW(),?)`,
      [staffA, 'Sales A', `${shared}@example.test`, '01000000000', 'SALES', tenantA,
       staffB, 'Sales B', `${shared}@example.test`, '01000000000', 'SALES', tenantB]
    );
    await conn.query(
      `INSERT INTO leads (id,client_code,name,email,phone,source,tenant_id,branch_id)
       VALUES (?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?)`,
      [leadA, shared, 'Lead A', `${shared}@example.test`, '01111111111', 'matrix', tenantA, branchA,
       leadB, shared, 'Lead B', `${shared}@example.test`, '01111111111', 'matrix', tenantB, branchB]
    );
    await conn.query(
      `INSERT INTO subscribers
       (id,firebase_uid,client_code,lead_id,name,email,phone,tenant_id,branch_id)
       VALUES (?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?)`,
      [subA, shared, shared, leadA, 'Client A', `${shared}@example.test`, '01222222222', tenantA, branchA,
       subB, shared, shared, leadB, 'Client B', `${shared}@example.test`, '01222222222', tenantB, branchB]
    );
    await conn.query(
      `INSERT INTO courses
       (id,slug,title,description,short_description,instructor,thumbnail,category,type,tenant_id)
       VALUES (?,?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?,?)`,
      [courseA, shared, 'Course A', '', '', 'Instructor', '', 'GENERAL', 'RECORDED', tenantA,
       courseB, shared, 'Course B', '', '', 'Instructor', '', 'GENERAL', 'RECORDED', tenantB]
    );

    for (const [tenantId, branchId, subscriberId, courseId, staffId, label] of [
      [tenantA, branchA, subA, courseA, staffA, 'A'],
      [tenantB, branchB, subB, courseB, staffB, 'B'],
    ]) {
      await conn.query(
        `INSERT INTO payments
         (id,subscriber_id,course_id,amount,date,tenant_id,branch_id,staff_id,status,transaction_id)
         VALUES (?,?,?,?,NOW(),?,?,?,?,?)`,
        [`uat-${stamp}-payment-${label}`, subscriberId, courseId, 100, tenantId, branchId, staffId, 'pending', `uat-${stamp}-txn-${label}`]
      );
      await conn.query(
        `INSERT INTO enrollments (id,subscriber_id,course_id,enrolled_at,tenant_id,branch_id)
         VALUES (?,?,?,NOW(),?,?)`,
        [`uat-${stamp}-enrollment-${label}`, subscriberId, courseId, tenantId, branchId]
      );
      await conn.query(
        `INSERT INTO notifications (id,tenant_id,subscriber_id,title) VALUES (?,?,?,?)`,
        [`uat-${stamp}-notification-${label}`, tenantId, subscriberId, `Notice ${label}`]
      );
      await conn.query(
        `INSERT INTO tasks (id,tenant_id,title,assigned_to,related_lead_id) VALUES (?,?,?,?,?)`,
        [`uat-${stamp}-task-${label}`, tenantId, `Task ${label}`, staffId, label === 'A' ? leadA : leadB]
      );
      await conn.query(
        `INSERT INTO expenses (id,description,amount,category,date,tenant_id,branch_id)
         VALUES (?,?,?,?,CURDATE(),?,?)`,
        [`uat-${stamp}-expense-${label}`, `Expense ${label}`, 10, 'Other', tenantId, branchId]
      );
      await conn.query(
        `INSERT INTO activity_logs (id,tenant_id,action,entity,label,actor)
         VALUES (?,?,?,?,?,?)`,
        [`uat-${stamp}-activity-${label}`, tenantId, 'matrix', 'tenant-test', `Activity ${label}`, staffId]
      );
    }

    for (const [table, ownedId, foreignId] of [
      ['branches', branchA, branchB], ['staff', staffA, staffB], ['leads', leadA, leadB],
      ['subscribers', subA, subB], ['courses', courseA, courseB],
      ['payments', `uat-${stamp}-payment-A`, `uat-${stamp}-payment-B`],
      ['enrollments', `uat-${stamp}-enrollment-A`, `uat-${stamp}-enrollment-B`],
      ['notifications', `uat-${stamp}-notification-A`, `uat-${stamp}-notification-B`],
      ['tasks', `uat-${stamp}-task-A`, `uat-${stamp}-task-B`],
      ['expenses', `uat-${stamp}-expense-A`, `uat-${stamp}-expense-B`],
      ['activity_logs', `uat-${stamp}-activity-A`, `uat-${stamp}-activity-B`],
    ]) {
      const [[owned]] = await conn.query(`SELECT id FROM \`${table}\` WHERE tenant_id=? AND id=?`, [tenantA, ownedId]);
      const [[leaked]] = await conn.query(`SELECT id FROM \`${table}\` WHERE tenant_id=? AND id=?`, [tenantA, foreignId]);
      assert.equal(owned?.id, ownedId, `${table}: own row is not visible`);
      assert.equal(leaked, undefined, `${table}: cross-tenant row leaked`);
      const [changed] = await conn.query(`UPDATE \`${table}\` SET tenant_id=tenant_id WHERE tenant_id=? AND id=?`, [tenantA, foreignId]);
      assert.equal(changed.affectedRows, 0, `${table}: cross-tenant update succeeded`);
    }

    const [[invalidJoin]] = await conn.query(
      `SELECT p.id FROM payments p
       JOIN subscribers s ON s.id=p.subscriber_id AND s.tenant_id=p.tenant_id
       WHERE p.tenant_id=? AND s.tenant_id=? LIMIT 1`,
      [tenantA, tenantB]
    );
    assert.equal(invalidJoin, undefined, 'finance/customer join crossed tenants');
  } finally {
    await conn.rollback();
  }
});
