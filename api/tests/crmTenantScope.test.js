'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('CRM timeline migration and writer bind every event to a tenant', () => {
  const migration = read('migrations/073_v25_crm_timeline_tenant_scope.sql');
  const crm = read('lib/crm.js');
  assert.match(migration, /ALTER TABLE lead_timeline[\s\S]*tenant_id/);
  assert.match(crm, /INSERT INTO lead_timeline \(id, tenant_id, lead_id/);
  assert.match(crm, /\[uuidv4\(\), tenantId, leadId/);
});

test('lead create/update cannot upsert across tenant boundaries', () => {
  const route = read('routes/admin/leads.js');
  assert.match(route, /FROM leads WHERE id=\? AND tenant_id=\?/);
  assert.match(route, /INSERT INTO leads \(id, tenant_id/);
  assert.match(route, /UPDATE leads SET name=[\s\S]*WHERE id=\? AND tenant_id=\?/);
  assert.doesNotMatch(route, /INSERT INTO leads[\s\S]{0,900}ON DUPLICATE KEY UPDATE name=/);
});

test('lead bulk operations, timeline and dedup are tenant and ownership scoped', () => {
  const route = read('routes/admin/leads.js');
  assert.match(route, /bulk-whatsapp[\s\S]*WHERE tenant_id=\? AND id IN/);
  assert.match(route, /lead_timeline WHERE tenant_id=\? AND lead_id=\?/);
  assert.match(route, /UPDATE leads SET hidden=1[\s\S]*WHERE tenant_id=\?/);
  assert.doesNotMatch(route, /DELETE FROM leads/);
});

test('lead conversion is tenant-owned, transactional and releases once', () => {
  const route = read('routes/admin/leads.js');
  assert.match(route, /FROM leads WHERE id=\? AND tenant_id=\? AND hidden=0/);
  assert.match(route, /SELECT id FROM subscribers[\s\S]*WHERE tenant_id=\? AND \(lead_id=\?/);
  assert.match(route, /let transactionStarted = false/);
  assert.match(route, /finally \{ conn\.release\(\); \}/);
});

test('automatic staff assignment measures workload inside the same tenant', () => {
  const db = read('lib/db.js');
  assert.match(db, /async function autoAssignStaff\(role, tenantId/);
  assert.match(db, /WHERE s\.tenant_id=\? AND s\.role=\?/);
  assert.doesNotMatch(db, /crm_rr_index/);
});

test('account creation first payment is period-locked and journaled atomically', () => {
  const auth = read('routes/auth.js');
  assert.match(auth, /assertWritable\(paymentDate, conn, tenantId\)/);
  assert.match(auth, /postPaymentJournal\([\s\S]*tenantId[\s\S]*\}, conn\)/);
  assert.match(auth, /Payment subscriber not found in tenant/);
  assert.doesNotMatch(auth, /firstPayment insert failed/);
});

test('subscriber CRM saves cannot create payments outside the journal workflow', () => {
  const subscribers = read('routes/admin/subscribers.js');
  assert.match(subscribers, /Payments are never accepted through subscriber CRM JSON/);
  assert.doesNotMatch(subscribers, /\[payment-sync\]/);
});

test('CRM inbox and retargeting records are tenant owned', () => {
  const migration = read('migrations/116_v25_crm_auxiliary_tenant_scope.sql');
  const inbox = read('routes/inbox.js');
  const scheduledJobs = read('lib/scheduledJobHandlers.js');
  assert.match(migration, /inbox_conversations[\s\S]*tenant_id/);
  assert.match(migration, /retargeting_log[\s\S]*tenant_id/);
  assert.match(inbox, /FROM inbox_conversations WHERE tenant_id=\?/);
  assert.match(inbox, /DELETE FROM inbox_conversations WHERE id=\? AND tenant_id=\?/);
  assert.match(scheduledJobs, /INSERT IGNORE INTO retargeting_log[\s\S]*\(id,tenant_id,lead_id/);
});

test('CRM operational views share the canonical role and branch scope', () => {
  const access = read('lib/leadAccess.js');
  const admin = read('routes/admin/leads.js');
  const advanced = read('routes/crm-advanced.js');
  const ops = read('routes/crm-ops.js');
  assert.match(access, /DATA_SCOPE/);
  assert.match(access, /assigned_sales/);
  assert.match(access, /assigned_cs/);
  assert.match(access, /scope\.startsWith\('branch:'\)/);
  assert.match(admin, /leadScope\(req, 'l'\)/);
  assert.match(advanced, /leadScope\(req, 'l'\)/);
  assert.match(ops, /leadScope\(req, 'l'\)/);
});
