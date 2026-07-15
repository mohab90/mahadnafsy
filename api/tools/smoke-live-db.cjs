#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { pool } = require('../lib/db');

const failures = [];
const warnings = [];

function fail(name, details) {
  failures.push({ name, details });
}

function warn(name, details) {
  warnings.push({ name, details });
}

async function scalar(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return Number(Object.values(rows[0] || { value: 0 })[0] || 0);
}

async function tableExists(tableName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
       FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName]
  );
  return Number(rows[0]?.c || 0) > 0;
}

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [tableName, columnName]
  );
  return Number(rows[0]?.c || 0) > 0;
}

async function requireTable(tableName) {
  if (!(await tableExists(tableName))) fail(`missing table: ${tableName}`, 'Required production table is not present.');
}

async function checkSchema() {
  await requireTable('schema_migrations');
  const lastMigration = await scalar(
    "SELECT COUNT(*) AS c FROM schema_migrations WHERE version = '059_v25_journal_ref_id_width.sql' AND status IN ('applied','baseline')"
  );
  if (lastMigration !== 1) {
    fail('migration 059 not applied', 'Financial journal reference width migration is not marked applied.');
  }

  const requiredTables = [
    'payments',
    'refund_requests',
    'journal_entries',
    'journal_entry_lines',
    'subscribers',
    'leads',
    'tenants',
    'saas_plans',
    'tenant_subscriptions',
  ];
  for (const table of requiredTables) await requireTable(table);

  if (!(await tableExists('feature_flags')) && !(await tableExists('tenant_feature_flags'))) {
    fail('missing feature flags table', 'No feature_flags or tenant_feature_flags table exists.');
  }
}

async function checkFinanceIntegrity() {
  const paidWithoutJournal = await scalar(`
    SELECT COUNT(*) AS c
      FROM payments p
     WHERE p.status = 'paid'
       AND p.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM journal_entries j
          WHERE j.ref_type = 'payment'
            AND CAST(j.ref_id AS CHAR) = CAST(p.id AS CHAR)
       )
  `);
  if (paidWithoutJournal > 0) {
    fail('paid payments without journals', `${paidWithoutJournal} paid payment(s) have no accounting journal.`);
  }

  const refundedWithoutJournal = await scalar(`
    SELECT COUNT(*) AS c
      FROM payments p
     WHERE p.status = 'refunded'
       AND p.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM journal_entries j
          WHERE j.ref_type = 'refund'
            AND (
              CAST(j.ref_id AS CHAR) = CAST(p.id AS CHAR)
              OR EXISTS (
                SELECT 1
                  FROM refund_requests r
                 WHERE CAST(r.payment_id AS CHAR) = CAST(p.id AS CHAR)
                   AND CAST(j.ref_id AS CHAR) = CAST(r.id AS CHAR)
              )
            )
       )
  `);
  if (refundedWithoutJournal > 0) {
    fail('refunded payments without refund journals', `${refundedWithoutJournal} refunded payment(s) have no refund journal.`);
  }

  const approvedRefundsNotRefunded = await scalar(`
    SELECT COUNT(*) AS c
     FROM refund_requests r
     JOIN payments p ON CAST(p.id AS CHAR) = CAST(r.payment_id AS CHAR)
     WHERE UPPER(r.status) = 'APPROVED'
       AND p.status <> 'refunded'
  `);
  if (approvedRefundsNotRefunded > 0) {
    fail('approved refunds not reflected on payment', `${approvedRefundsNotRefunded} approved refund(s) did not update payment.status.`);
  }

  const imbalancedJournals = await scalar(`
    SELECT COUNT(*) AS c
      FROM journal_entries
     WHERE ROUND(COALESCE(total_debit, 0), 2) <> ROUND(COALESCE(total_credit, 0), 2)
  `);
  if (imbalancedJournals > 0) {
    fail('imbalanced journal entries', `${imbalancedJournals} journal entrie(s) have debit/credit mismatch.`);
  }

  const journalLinesMismatch = await scalar(`
    SELECT COUNT(*) AS c
      FROM journal_entries j
      LEFT JOIN (
        SELECT entry_id, SUM(COALESCE(debit,0)) AS debit, SUM(COALESCE(credit,0)) AS credit
          FROM journal_entry_lines
         GROUP BY entry_id
      ) l ON l.entry_id = j.id
     WHERE ROUND(COALESCE(j.total_debit, 0), 2) <> ROUND(COALESCE(l.debit, 0), 2)
        OR ROUND(COALESCE(j.total_credit, 0), 2) <> ROUND(COALESCE(l.credit, 0), 2)
  `);
  if (journalLinesMismatch > 0) {
    fail('journal header/lines mismatch', `${journalLinesMismatch} journal entrie(s) do not match their line totals.`);
  }
}

async function checkTenantAndJourneyIntegrity() {
  for (const table of ['payments', 'subscribers', 'leads']) {
    if (await columnExists(table, 'tenant_id')) {
      const missingTenant = await scalar(
        `SELECT COUNT(*) AS c FROM ${table} WHERE tenant_id IS NULL OR TRIM(CAST(tenant_id AS CHAR)) = ''`
      );
      if (missingTenant > 0) fail(`${table} missing tenant scope`, `${missingTenant} row(s) have no tenant_id.`);
    }
  }

  if (await columnExists('payments', 'branch_id')) {
    const missingPaidBranch = await scalar(`
      SELECT COUNT(*) AS c
        FROM payments
       WHERE status IN ('paid','refunded')
         AND deleted_at IS NULL
         AND (branch_id IS NULL OR TRIM(CAST(branch_id AS CHAR)) = '')
    `);
    if (missingPaidBranch > 0) {
      fail('financial payments missing branch scope', `${missingPaidBranch} paid/refunded payment(s) have no branch_id.`);
    }
  }

  if (await columnExists('subscribers', 'source')) {
    const missingSubscriberSource = await scalar(`
      SELECT COUNT(*) AS c
        FROM subscribers
       WHERE deleted_at IS NULL
         AND (source IS NULL OR TRIM(CAST(source AS CHAR)) = '')
    `);
    if (missingSubscriberSource > 0) {
      fail('subscribers missing source', `${missingSubscriberSource} subscriber(s) have no visible source.`);
    }
  }

  const activeTenants = await scalar("SELECT COUNT(*) AS c FROM tenants WHERE status = 'active'");
  if (activeTenants < 1) fail('no active tenant', 'At least one active tenant is required.');

  const activePlans = await scalar("SELECT COUNT(*) AS c FROM saas_plans WHERE is_active = 1");
  if (activePlans < 1) fail('no active SaaS plan', 'At least one active plan is required.');

  const activeSubscriptions = await scalar("SELECT COUNT(*) AS c FROM tenant_subscriptions WHERE status IN ('trialing','active')");
  if (activeSubscriptions < 1) fail('no active tenant subscription', 'At least one active tenant subscription is required.');

  if (!(await tableExists('audit_logs'))) {
    warn('audit logs table not found', 'Recommended before enterprise production for finance/security traceability.');
  }
  if (!(await tableExists('task_queue')) && !(await tableExists('queue_jobs'))) {
    warn('queue jobs table not found', 'Recommended for durable heavy jobs if Redis/BullMQ is not the only queue backend.');
  }
}

async function main() {
  await pool.query('SELECT 1');
  await checkSchema();
  await checkFinanceIntegrity();
  await checkTenantAndJourneyIntegrity();

  if (warnings.length) {
    console.log('[smoke:live-db] warnings:');
    for (const item of warnings) console.log(`  - ${item.name}: ${item.details}`);
  }

  if (failures.length) {
    console.error('[smoke:live-db] FAILED');
    for (const item of failures) console.error(`  - ${item.name}: ${item.details}`);
    process.exitCode = 1;
    return;
  }

  console.log('[smoke:live-db] PASS: finance, refunds, tenant scope, SaaS base tables, and customer-source visibility are consistent.');
}

main()
  .catch((err) => {
    console.error('[smoke:live-db] fatal:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
