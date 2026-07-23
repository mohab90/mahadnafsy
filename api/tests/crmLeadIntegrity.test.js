'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { duplicateGroups } = require('../lib/leadMerge');
const { normalizeLeadStatus } = require('../lib/leadState');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('duplicate grouping joins normalized phone/email matches transitively', () => {
  const groups = duplicateGroups([
    { id: 'a', phone: '0100 123 4567', email: 'one@example.com', score: 10, created_at: '2024-01-01' },
    { id: 'b', phone: '+20 1001234567', email: 'two@example.com', score: 30, created_at: '2024-02-01' },
    { id: 'c', phone: '01111111111', email: ' TWO@example.com ', score: 20, created_at: '2024-03-01' },
    { id: 'd', phone: '01222222222', email: 'solo@example.com', score: 99, created_at: '2024-01-01' },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].targetId, 'b');
  assert.deepEqual(new Set(groups[0].leads.map(lead => lead.id)), new Set(['a', 'b', 'c']));
});

test('lead state accepts system statuses and rejects arbitrary values', () => {
  assert.equal(normalizeLeadStatus(' Interested_FollowUp '), 'interested_followup');
  assert.throws(() => normalizeLeadStatus('sql-status'), /Invalid lead status/);
});

test('lead state mutation and timeline audit share one transaction', () => {
  const state = read('lib/leadState.js');
  assert.match(state, /await conn\.beginTransaction\(\)/);
  assert.match(state, /UPDATE leads SET status=\?, updated_at=NOW\(\) WHERE id=\? AND tenant_id=\?/);
  assert.match(state, /INSERT INTO lead_timeline \(id,tenant_id,lead_id/);
  assert.match(state, /await conn\.rollback\(\)/);
});

test('business routes use the central lead transition service', () => {
  for (const file of [
    'routes/admin/leads.js', 'routes/admin/subscribers.js', 'routes/crm-advanced.js',
    // routes/automation.js (manual run) and lib/serverCronJobs.js (daily cron)
    // both delegate to this one engine now instead of each having their own
    // transitionLead() call (MKT-04) — checked once here instead of twice.
    'lib/automationEngine.js', 'routes/payment-proofs.js', 'routes/subscriber-payments.js',
    'routes/public-orders.js', 'server.js',
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /UPDATE leads SET status|UPDATE leads SET[^;]{0,200}status='converted'/, file);
    assert.match(source, /transitionLead/, file);
  }
});

test('lead merge is recoverable, tenant locked and reparents CRM relations', () => {
  const merge = read('lib/leadMerge.js');
  const migration = read('migrations/080_v25_crm_lead_merge.sql');
  assert.match(merge, /WHERE tenant_id=\? AND id IN/);
  assert.match(merge, /FOR UPDATE/);
  assert.match(merge, /\['communications', 'lead_id'\]/);
  assert.match(merge, /\['subscribers', 'lead_id'\]/);
  assert.match(merge, /hidden=1, merged_into_lead_id=\?/);
  assert.match(merge, /INSERT INTO lead_merge_audit/);
  assert.doesNotMatch(merge, /DELETE FROM leads/);
  assert.match(migration, /uq_lead_merge_source \(tenant_id, source_lead_id\)/);
});

test('admin conversion uses one server transaction and the UI waits for persistence', () => {
  const route = read('routes/admin/leads.js');
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'LeadsTab.tsx'), 'utf8');
  assert.match(route, /requestedCourseId/);
  assert.match(route, /LIMIT 1 FOR UPDATE/);
  assert.match(route, /transitionLead\(\{[\s\S]*toStatus: 'converted'/);
  assert.match(route, /await conn\.commit\(\)/);
  assert.match(ui, /await mysqlAdmin\.convertLead\(lead\.id, \{ courseId, accessMode \}\)/);
  assert.match(ui, /await Promise\.all\(\[reloadLeads\(\), reloadSubscribers\(\)\]\)/);
});

test('lead assignments validate tenant staff and persist audit in the same transaction', () => {
  const service = read('lib/leadAssignment.js');
  const admin = read('routes/admin/leads.js');
  const advanced = read('routes/crm-advanced.js');
  // The automation "assign_staff" action lives in lib/automationEngine.js —
  // the one engine both the manual "run" button (routes/automation.js) and
  // the daily cron (lib/serverCronJobs.js) call (MKT-04 unification).
  const automationEngine = read('lib/automationEngine.js');
  assert.match(service, /FROM leads WHERE id=\? AND tenant_id=\?[\s\S]*FOR UPDATE/);
  assert.match(service, /FROM staff WHERE id=\? AND tenant_id=\?[\s\S]*UPPER\(role\)='SALES'/);
  assert.match(service, /UPDATE leads SET assigned_sales_id=\?,assigned_sales_name=\?/);
  assert.match(service, /logLeadEventStrict\([\s\S]*tenantId, conn/);
  assert.match(service, /await conn\.rollback\(\)/);
  assert.match(admin, /bulk-assign'[\s\S]*await conn\.beginTransaction\(\)[\s\S]*logLeadEventStrict[\s\S]*await conn\.commit\(\)/);
  assert.match(advanced, /smart-route'[\s\S]*FOR UPDATE[\s\S]*logLeadEventStrict[\s\S]*await conn\.commit\(\)/);
  assert.match(automationEngine, /assign_staff[\s\S]*await assignLead\(/);
});

test('overdue CRM SLA alerts are tenant-owned, daily-deduped and use the retryable outbox', () => {
  const sla = read('lib/crmSla.js');
  const server = read('server.js');
  assert.match(sla, /s\.tenant_id=l\.tenant_id/);
  assert.match(sla, /l\.next_follow_up_date<CURDATE\(\)/);
  assert.match(sla, /tenantId: row\.tenant_id/);
  assert.match(sla, /dedupeKey: `crm-sla:\$\{row\.tenant_id\}:\$\{row\.id\}:\$\{today\}/);
  assert.match(server, /enqueueOverdueLeadAlerts\(\)/);
});
