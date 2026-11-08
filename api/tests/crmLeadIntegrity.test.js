'use strict';
const { leadsRouteSource, sourceOf } = require('./_authRouteSource');

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

test('business routes use the central lead transition service', () => {
  for (const file of [
    'routes/admin/leads.js', 'routes/admin/subscribers.js', 'routes/crm-advanced.js',
    // routes/automation.js (manual run) and server.js (daily cron)
    // both delegate to this one engine now instead of each having their own
    // transitionLead() call (MKT-04) — checked once here instead of twice.
    'lib/automationEngine.js', 'routes/payment-proofs.js', 'routes/subscriber-payments.js',
    'lib/paymobFinalise.js',
  ]) {
    const source = sourceOf(file);
    assert.doesNotMatch(source, /UPDATE leads SET status|UPDATE leads SET[^;]{0,200}status='converted'/, file);
    // convertLeadOfPayment is transitionLead to «converted» for a payment (8 Oct 2026).
    assert.match(source, /transitionLead|convertLeadOfPayment/, file);
  }
});

test('admin conversion uses one server transaction and the UI waits for persistence', () => {
  const route = leadsRouteSource();
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'leads', 'useLeadActions.ts'), 'utf8');
  
  
  
  
  assert.match(ui, /await mysqlAdmin\.convertLead\(lead\.id, \{ courseId, accessMode \}\)/);
  // Waits for both lists; of the leads only the converted one is fetched again.
  assert.match(ui, /await Promise\.all\(\[reloadLeads\(\{ only: \[lead\.id\] \}\), reloadSubscribers\(\)\]\)/);
});







test('CRM writes, bulk messaging and interaction deletion preserve role data scope', () => {
  const service = read('lib/leadInteractions.js');
  const admin = leadsRouteSource();
  const advanced = read('routes/crm-advanced.js');
  const ops = read('routes/crm-ops.js');

  const daqqi = leadScope({
    tenantId: 'tenant-a',
    staffRecord: { id: 'staff-d', role: 'reception_daqqi' },
    isSuperAdmin: false,
  }, 'l');
  assert.equal(daqqi.scope, 'branch:DAQQI');
  // «الليدات المعينه لفريق الدقي فقط»: the Dokki desk gets the leads handed to
  // its team, not every lead tagged DAQQI.
  assert.match(daqqi.sql, /l\.assigned_sales_id IN \(SELECT id FROM staff WHERE tenant_id=\? AND LOWER\(role\) IN \('daqqi_manager','reception_daqqi'\)\)/);
  assert.match(daqqi.sql, / OR l\.assigned_cs_id IN \(/);
  assert.deepEqual(daqqi.params, ['tenant-a', 'tenant-a']);
  // Any other branch scope is still its branch. IN (…) because a branch scope
  // may list several branches.
  const online = leadScope({
    tenantId: 'tenant-a',
    staffRecord: { id: 'staff-o', role: 'collection', data_scope: 'branch:ONLINE_EGYPT,ONLINE_SAUDI' },
    isSuperAdmin: false,
  }, 'l');
  assert.match(online.sql, /l\.branch IN \(\?,\?\)/);
  assert.deepEqual(online.params, ['ONLINE_EGYPT', 'ONLINE_SAUDI']);

  
  
  
  
  

  
  
  
  

  const leadsTab = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'LeadsTab.tsx'), 'utf8');
  const leadTable = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'LeadTable.tsx'), 'utf8');
  // The form moved out of the الاتصالات view when that view was removed as
  // duplicated data. Same form, mounted beside the leads screen so the pipeline
  // card's button can open it from any tab.
  const communications = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'leads', 'QuickLogContactPanel.tsx'), 'utf8');
  // The account's own permission, by the one rule over the server's table (admin/lib/access.ts).
  assert.match(leadsTab, /const canManageLeads = access\.can\('manage_leads'\);/);
  assert.match(leadTable, /canManageLeads && selectedIds\.length/);
  assert.match(leadTable, /mysqlAdmin\.addLeadInteraction/);
  assert.match(communications, /canManageLeads && showAddComm/);
  assert.match(communications, /setShowAddComm\(false\)/);
});

test('Daqqi import requires both CRM and financial authority', () => {
  const admin = leadsRouteSource();
  assert.match(
    admin,
    /\/api\/admin\/import\/daqqi'[\s\S]{0,250}requirePermission\('manage_leads'\)[\s\S]{0,120}requirePermission\('manage_payments'\)/,
  );
});



test('a lead cannot be marked converted without a customer behind it', () => {
  const state = read('lib/leadState.js');

  // The guard exists and is specific to this status.
  
  
  

  // It runs before the write, or it is not a guard.
  assert.ok(
    state.indexOf("status === 'converted'") < state.indexOf('UPDATE leads SET status=?'),
    'the check must come before the UPDATE it is protecting',
  );

  // The caller's own claim is accepted too. The payment-proof path converts on
  // proof.lead_id while the subscriber it activates may have been linked by
  // identity rather than by that column, so requiring only the link would
  // reject a confirmed payment.
  
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
    const source = sourceOf(file);
    for (const call of source.matchAll(/(?:transitionLead|convertLeadOfPayment)\(\{[\s\S]{0,700}?\}\)/g)) {
      if (!/toStatus:\s*'converted'|^convertLeadOfPayment/.test(call[0])) continue;
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
  assert.match(LIVE_SUBSCRIBER_FOR_LEAD, /s\.email=TRIM\(l\.email\)/,
    'matching by email is what stops it flagging customers linked another way');
  assert.doesNotMatch(LIVE_SUBSCRIBER_FOR_LEAD, /LOWER\(TRIM\(s\.email\)\)/,
    'a function around subscribers.email puts uq_subs_tenant_email out of reach — every lead scans the clients');
  assert.match(LIVE_SUBSCRIBER_FOR_LEAD, /s\.phone=l\.phone/);

  // And both readers use it rather than spelling it out again.
  const payops = read('routes/core/payops.js');
  const checks = read('lib/reconcileChecks.js');
  for (const [name, source] of [['payops', payops], ['reconcileChecks', checks]]) {
    assert.match(source, /NOT \$\{LIVE_SUBSCRIBER_FOR_LEAD\}/,
      `${name} must interpolate the shared predicate, not restate it`);
  }
  
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

