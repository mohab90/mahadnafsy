'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { duplicateGroups } = require('../lib/leadMerge');
const { leadScope } = require('../lib/leadAccess');
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
  for (const status of ['postpone_month', 'with_colleague', 'other']) {
    assert.equal(normalizeLeadStatus(status), status);
  }
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
    // routes/automation.js (manual run) and server.js (daily cron)
    // both delegate to this one engine now instead of each having their own
    // transitionLead() call (MKT-04) — checked once here instead of twice.
    'lib/automationEngine.js', 'routes/payment-proofs.js', 'routes/subscriber-payments.js',
    'routes/public-orders.js',
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
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'leads', 'useLeadActions.ts'), 'utf8');
  assert.match(route, /requestedCourseId/);
  assert.match(route, /LIMIT 1 FOR UPDATE/);
  assert.match(route, /transitionLead\(\{[\s\S]*toStatus: 'converted'/);
  assert.match(route, /await conn\.commit\(\)/);
  assert.match(ui, /await mysqlAdmin\.convertLead\(lead\.id, \{ courseId, accessMode \}\)/);
  assert.match(ui, /await Promise\.all\(\[reloadLeads\(\), reloadSubscribers\(\)\]\)/);
});

test('lead assignments validate tenant staff and persist audit in the same transaction', () => {
  const service = read('lib/leadAssignment.js');
  const repository = read('lib/leadRepository.js');
  const admin = read('routes/admin/leads.js');
  const advanced = read('routes/crm-advanced.js');
  // The automation "assign_staff" action lives in lib/automationEngine.js —
  // the one engine both the manual "run" button (routes/automation.js) and
  // the daily cron (server.js) calls (MKT-04 unification).
  const automationEngine = read('lib/automationEngine.js');
  assert.match(service, /findLeadById\(\{ tenantId, leadId, db: conn, forUpdate: true \}\)/);
  assert.match(repository, /FROM leads[\s\S]*WHERE tenant_id=\? AND id=\?[\s\S]*FOR UPDATE/);
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
  const runtime = read('lib/backgroundScheduler.js');
  assert.match(sla, /s\.tenant_id=l\.tenant_id/);
  assert.match(sla, /l\.next_follow_up_date<CURDATE\(\)/);
  assert.match(sla, /tenantId: row\.tenant_id/);
  assert.match(sla, /dedupeKey: `crm-sla:\$\{row\.tenant_id\}:\$\{row\.id\}:\$\{today\}/);
  assert.match(runtime, /enqueueOverdueLeadAlerts\(\)/);
});

test('CRM interactions use one tenant-owned transactional service', () => {
  const service = read('lib/leadInteractions.js');
  const admin = read('routes/admin/leads.js');
  const advanced = read('routes/crm-advanced.js');
  const ops = read('routes/crm-ops.js');
  const migration = read('migrations/114_v25_crm_communications_tenant_scope.sql');
  assert.match(migration, /communications[\s\S]*tenant_id[\s\S]*idx_comm_tenant_lead_date/);
  assert.match(service, /INSERT IGNORE INTO communications[\s\S]*tenant_id/);
  assert.match(service, /await conn\.beginTransaction\(\)/);
  assert.match(service, /outbox\.enqueue\([\s\S]*\}, conn\)/);
  assert.match(service, /logLeadEventStrict\([\s\S]*tenantId, conn/);
  assert.match(admin, /appendLeadInteraction/);
  assert.match(advanced, /appendLeadInteraction/);
  assert.match(advanced, /requestedStatus[\s\S]*transitionLead\(\{[\s\S]*db: conn/);
  assert.match(advanced, /interaction: \{ type, notes, outcome, date, nextFollowUp \}/);
  assert.match(ops, /queueLeadWhatsAppBatch/);
});

test('CRM writes, bulk messaging and interaction deletion preserve role data scope', () => {
  const service = read('lib/leadInteractions.js');
  const admin = read('routes/admin/leads.js');
  const advanced = read('routes/crm-advanced.js');
  const ops = read('routes/crm-ops.js');

  const daqqi = leadScope({
    tenantId: 'tenant-a',
    staffRecord: { id: 'staff-d', role: 'reception_daqqi' },
    isSuperAdmin: false,
  }, 'l');
  assert.equal(daqqi.scope, 'branch:DAQQI');
  // IN (…) rather than = ? because a branch scope may now list several branches;
  // for a single-branch scope like DAQQI the matched rows are identical.
  assert.match(daqqi.sql, /l\.branch IN \(\?\)/);
  assert.deepEqual(daqqi.params, ['DAQQI']);
  assert.deepEqual(daqqi.params, ['DAQQI']);

  assert.match(admin, /WHERE l\.tenant_id=\? AND l\.id=\?\$\{writeScope\.sql\}/);
  assert.match(admin, /Lead branch is outside your data scope/);
  assert.match(admin, /accessScope: leadScope\(req, 'l'\)/);
  assert.match(ops, /accessScope: leadScope\(req, 'l'\)/);
  assert.match(service, /l\.phone!=''\$\{scope\.sql \|\| ''\}/);

  assert.match(advanced, /router\.delete\('\/api\/admin\/crm\/leads\/:leadId\/interactions\/:interactionId'/);
  assert.match(advanced, /loadAccessibleLead\(req, req\.params\.leadId, conn, true\)/);
  assert.match(service, /DELETE FROM communications WHERE tenant_id=\? AND lead_id=\? AND id=\?/);
  assert.match(service, /'interaction_deleted'/);

  const leadsTab = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'LeadsTab.tsx'), 'utf8');
  const leadTable = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'LeadTable.tsx'), 'utf8');
  // The form moved out of the الاتصالات view when that view was removed as
  // duplicated data. Same form, mounted beside the leads screen so the pipeline
  // card's button can open it from any tab.
  const communications = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'leads', 'QuickLogContactPanel.tsx'), 'utf8');
  assert.match(leadsTab, /hasStaffPermission\(permissionSubject, 'manage_leads'\)/);
  assert.match(leadTable, /canManageLeads && selectedIds\.length/);
  assert.match(leadTable, /mysqlAdmin\.addLeadInteraction/);
  assert.match(communications, /canManageLeads && showAddComm/);
  assert.match(communications, /setShowAddComm\(false\)/);
});

test('Daqqi import requires both CRM and financial authority', () => {
  const admin = read('routes/admin/leads.js');
  assert.match(
    admin,
    /\/api\/admin\/import\/daqqi'[\s\S]{0,250}requirePermission\('manage_leads'\)[\s\S]{0,120}requirePermission\('manage_payments'\)/,
  );
});

test('scheduled and manual CRM automation share one engine', () => {
  const runtime = read('lib/backgroundScheduler.js');
  const manual = read('routes/automation.js');
  assert.match(runtime, /automationEngine[\s\S]*runAutomationWorkflows/);
  assert.match(manual, /runAutomationWorkflows/);
  assert.doesNotMatch(runtime, /SELECT id, tenant_id, name, `trigger`, action[\s\S]*FROM automation_workflows/);
});

test('lead merges are tenant-scoped and reversible for new audit snapshots', () => {
  const merge = read('lib/leadMerge.js');
  const migration = read('migrations/115_v25_crm_reversible_merge.sql');
  assert.match(merge, /SELECT id FROM \$\{table\} WHERE tenant_id=\? AND \$\{column\}=\?/);
  assert.match(merge, /JSON\.stringify\(\{ lead: source, relations \}\)/);
  assert.match(merge, /async function unmergeLead/);
  assert.match(merge, /UPDATE \$\{table\} SET \$\{column\}=\?[\s\S]*WHERE tenant_id=\?/);
  assert.match(merge, /hidden=0,merged_into_lead_id=NULL/);
  assert.match(migration, /reverted_at[\s\S]*reverted_by/);
});

// "converted" has to mean a customer exists.
//
// Production carries 34 real leads at status 'converted' with no subscriber
// behind them — Sheet imports with no email, all stamped within a second of
// each other. Converted leads are excluded from the pipeline, so each of those
// people left the sales list without arriving anywhere: nobody is chasing them
// and no customer record answers for them. Invisible in exactly the way that
// keeps anyone from noticing.
//
// The routes cannot write leads.status directly (pinned above), so this service
// is the single door. It was not checking. All nine callers that convert a lead
// already hold a subscriber and already name it, so the check costs them
// nothing — what it stops is the tenth caller reopening the hole.
test('a lead cannot be marked converted without a customer behind it', () => {
  const state = read('lib/leadState.js');

  // The guard exists and is specific to this status.
  assert.match(state, /status === 'converted'/,
    'the converted status must be checked, not every transition');
  assert.match(state, /FROM subscribers[\s\S]{0,120}lead_id=\?/,
    'it has to look for the customer, not merely comment about one');
  assert.match(state, /statusCode = 409/,
    'a refusal is a conflict, not a 500');

  // It runs before the write, or it is not a guard.
  assert.ok(
    state.indexOf("status === 'converted'") < state.indexOf('UPDATE leads SET status=?'),
    'the check must come before the UPDATE it is protecting',
  );

  // The caller's own claim is accepted too. The payment-proof path converts on
  // proof.lead_id while the subscriber it activates may have been linked by
  // identity rather than by that column, so requiring only the link would
  // reject a confirmed payment.
  assert.match(state, /metadata\?\.subscriberId/,
    'the caller-supplied subscriber id must be honoured, or approved proofs start failing');
});

test('every caller that converts a lead names the customer it converted into', () => {
  // The guard above accepts metadata.subscriberId, which is only worth
  // accepting if the callers actually send it. A caller that stops sending it
  // still passes today — the lead_id link usually covers it — and then fails
  // the day it converts on a lead whose subscriber was matched by identity.
  const callers = [
    'routes/admin/leads.js', 'routes/admin/subscribers.js', 'routes/payment-proofs.js',
    'routes/subscriber-payments.js', 'routes/public-orders.js', 'routes/core/financepay.js',
    'lib/orderPaymentConfirmation.js',
  ];
  for (const file of callers) {
    const source = read(file);
    for (const call of source.matchAll(/transitionLead\(\{[\s\S]{0,700}?\}\)/g)) {
      if (!/toStatus:\s*'converted'/.test(call[0])) continue;
      assert.match(call[0], /subscriberId/,
        `${file}: a conversion that does not name its subscriber cannot be checked`);
    }
  }
});

// The nightly job and the dashboard answer the same question the same way.
//
// They were two hand-written copies of "does this converted lead have a
// customer", and they had drifted in both directions: the job matched on
// lead_id alone and ignored whether the subscriber was deleted, so it
// over-reported people who exist under a different link and under-reported
// leads whose customer had been removed. Two numbers for one question, and the
// smaller one was the one acted on — it cost real time in this engagement.
test('the converted-lead check is defined once and used by both readers', async () => {
  const { LIVE_SUBSCRIBER_FOR_LEAD } = require('../lib/reconcileChecks');

  // The definition covers all three ways a lead is tied to a customer, and only
  // counts a customer that still exists.
  assert.match(LIVE_SUBSCRIBER_FOR_LEAD, /s\.deleted_at IS NULL/,
    'a deleted customer is not a customer');
  assert.match(LIVE_SUBSCRIBER_FOR_LEAD, /s\.lead_id=l\.id/);
  assert.match(LIVE_SUBSCRIBER_FOR_LEAD, /LOWER\(TRIM\(s\.email\)\)=LOWER\(TRIM\(l\.email\)\)/,
    'matching by email is what stops it flagging customers linked another way');
  assert.match(LIVE_SUBSCRIBER_FOR_LEAD, /s\.phone=l\.phone/);

  // And both readers use it rather than spelling it out again.
  const payops = read('routes/core/payops.js');
  const checks = read('lib/reconcileChecks.js');
  for (const [name, source] of [['payops', payops], ['reconcileChecks', checks]]) {
    assert.match(source, /NOT \$\{LIVE_SUBSCRIBER_FOR_LEAD\}/,
      `${name} must interpolate the shared predicate, not restate it`);
  }
  assert.match(payops, /require\('\.\.\/\.\.\/lib\/reconcileChecks'\)/,
    'the dashboard has to import the definition to share it');
});

// A missing name stays missing.
//
// The Google Sheet import wrote `name || phone`, so a row with no name arrived
// carrying its own phone number in the name column — production has leads
// literally called "1096203090". The phone is stored in its own column one
// argument along, so this never added information; it only made an absent name
// look like a present one, which is worse, because nobody goes looking for a
// name that appears to be there.
//
// 34 leads and 155 subscribers carry a contact detail where a name belongs. The
// legacy ones cannot be repaired without inventing names; what this stops is
// the pile growing.
test('imports never put a phone or email in the name column', () => {
  // Comments out first. The comment explaining this fix necessarily quotes the
  // expression it replaced, and an assertion a comment can satisfy — or defeat —
  // is not an assertion about the code. Caught by this test failing on its own
  // explanation.
  const gsheets = read('routes/gsheets.js')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
  assert.doesNotMatch(gsheets, /name \|\| phone/,
    'a blank name must stay blank, not become the phone number');
  assert.match(gsheets, /name \|\| null/,
    'the import should write NULL for a missing name');
});
