'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('profile identity and interest lead writes are tenant scoped and retry safe', () => {
  const profile = read('routes/profile.js');

  assert.match(profile, /FROM staff[\s\S]{0,120}tenant_id = \?/);
  assert.match(profile, /INSERT INTO leads \(id, tenant_id/);
  assert.match(profile, /update\(`\$\{req\.tenantId\}:\$\{uid \|\| normalizedEmail\}`\)/);
  assert.match(profile, /ON DUPLICATE KEY UPDATE/);
  assert.match(profile, /deleted_at=NULL/);
});

test('loyalty balances, mutations and ledger reads require the owning tenant', () => {
  const library = read('lib/loyalty.js');
  const route = read('routes/loyalty.js');

  assert.match(library, /async function getBalance\(tenantId, subscriberId\)/);
  assert.match(library, /WHERE id = \? AND tenant_id = \? AND deleted_at IS NULL/);
  assert.match(library, /async function awardPoints\(tenantId, subscriberId, points/);
  assert.match(library, /async function redeemPoints\(tenantId, subscriberId, points/);
  assert.match(library, /WHERE subscriber_id = \? AND tenant_id = \?/);
  assert.match(library, /UPDATE subscribers SET loyalty_points = \? WHERE id = \? AND tenant_id = \?/);
  // The lookup itself moved into the shared resolver (routes/loyalty.js and
  // routes/push.js had drifting copies of it). The guarantee is the same: every
  // branch of it is scoped to the caller's tenant.
  assert.match(route, /require\('\.\.\/lib\/subscriberIdentity'\)/);
  const identity = read('lib/subscriberIdentity.js');
  const selects = identity.match(/FROM subscribers s[\s\S]*?LIMIT 1/g) || [];
  assert.ok(selects.length >= 3, 'expected the linked, email and phone lookups');
  for (const sql of selects) assert.match(sql, /s\.tenant_id=\?/);
  assert.match(route, /getBalance\(req\.tenantId,/);
  assert.match(route, /awardPoints\(req\.tenantId,/);
  assert.match(route, /redeemPoints\(req\.tenantId,/);
});

test('maintenance and payment proof duplicate checks cannot use another tenant', () => {
  const maintenance = read('routes/client-maintenance.js');
  const proofs = read('routes/payment-proofs.js');

  assert.match(maintenance, /FROM staff WHERE tenant_id=\? AND is_active=1 AND deleted_at IS NULL/);
  assert.doesNotMatch(maintenance, /DELETE FROM subscribers WHERE tenant_id=\? AND LOWER\(email\)/);
  assert.match(maintenance, /UPDATE subscribers[\s\S]{0,150}deleted_at=NOW\(\), is_active=0/);
  assert.match(proofs, /FROM payment_proofs[\s\S]{0,100}order_id=\? AND tenant_id=\?/);
});

test('Daqqi rounds and attendee reports are tenant native', () => {
  const route = read('routes/daqqi-rounds.js');
  const migration = read('migrations/110_v25_daqqi_tenant_integrity.sql');

  assert.match(route, /FROM daqqi_rounds WHERE tenant_id=\?/);
  assert.match(route, /UPDATE daqqi_rounds[\s\S]{0,300}WHERE id=\? AND tenant_id=\?/);
  assert.match(route, /INSERT INTO daqqi_rounds[\s\S]{0,400}tenant_id\)/);
  assert.match(route, /DELETE FROM daqqi_attendees WHERE round_id=\? AND tenant_id=\?/);
  assert.match(route, /FROM daqqi_attendees WHERE tenant_id=\?/);
  assert.match(route, /DELETE FROM daqqi_rounds WHERE id=\? AND tenant_id=\?/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS tenant_id/);
  assert.match(migration, /uq_daqqi_rounds_tenant_code \(tenant_id, code\)/);
});

test('Dokki classroom, check-in and inventory operations validate tenant ownership', () => {
  const route = read('routes/dokki-operations.js');

  assert.match(route, /FROM physical_classrooms c[\s\S]{0,100}c\.tenant_id=\?/);
  assert.match(route, /classroom_id = \? AND tenant_id=\?/);
  assert.match(route, /FROM subscribers[\s\S]{0,100}tenant_id=\?/);
  assert.match(route, /FROM inventory_items WHERE tenant_id=\?/);
  assert.match(route, /verifyAttendanceQr\(qr, tenantId\)/);
  assert.match(route, /requirePermission\('manage_daqqi'\)/);
  assert.match(route, /FROM inventory_items WHERE id=\? AND tenant_id=\? AND is_active=1 FOR UPDATE/);
  assert.match(route, /UPDATE inventory_items SET stock_quantity=\? WHERE id=\? AND tenant_id=\?/);
  assert.match(route, /Number\.isInteger\(qty\)/);
  assert.match(route, /writeAuditEvent\(\{[\s\S]{0,300}db: conn/);
  assert.doesNotMatch(route, /INSERT INTO activity_logs \(entity_type/);
});

test('subscription plans and recurring billing are tenant scoped, atomic and idempotent', () => {
  const route = read('routes/misc/billing.js');
  const billing = read('lib/subscriptionBilling.js');
  const scheduler = read('lib/backgroundScheduler.js');
  const migration = read('migrations/111_v25_subscription_billing_tenant_scope.sql');

  assert.match(route, /FROM subscription_plans WHERE tenant_id=\?/);
  assert.match(route, /UPDATE subscription_plans SET is_active=0 WHERE id=\? AND tenant_id=\?/);
  assert.match(route, /WHERE ss\.tenant_id=\?/);
  assert.match(route, /INSERT INTO subscriber_subscriptions[\s\S]{0,180}tenant_id/);
  assert.doesNotMatch(route, /ROUTE_LOCAL_BILLING_CRON_ENABLED|Auto-billing plan/);
  assert.match(billing, /await conn\.beginTransaction\(\)/);
  assert.match(billing, /INSERT IGNORE INTO payments[\s\S]{0,200}tenant_id/);
  assert.match(billing, /transactionId = `subscription:/);
  assert.match(billing, /UPDATE subscriber_subscriptions[\s\S]{0,160}tenant_id=\?/);
  assert.match(scheduler, /subscription_billing: \(\) => subscriptionBilling\.runSubscriptionBilling\(\)/);
  assert.match(migration, /subscriber_subscriptions[\s\S]*tenant_id/);
});

test('NPS and CSAT delivery identities cannot cross tenants or be guessed by ticket id', () => {
  const reminders = read('routes/misc/reminders.js');
  const campaigns = read('routes/campaigns.js');
  const support = read('routes/support.js');
  const migration = read('migrations/112_v25_support_csat_token.sql');
  const client = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'pages', 'TicketRating.tsx'), 'utf8');

  assert.match(reminders, /n\.tenant_id=s\.tenant_id/);
  assert.match(reminders, /INSERT INTO nps_responses[\s\S]{0,120}tenant_id/);
  assert.match(reminders, /filterSuppressed\(req\.tenantId, 'email', subs, 'email'\)/);
  assert.match(reminders, /await conn\.beginTransaction\(\)/);
  assert.match(reminders, /await outbox\.enqueue\([\s\S]{0,900}tenantId: req\.tenantId[\s\S]{0,400}, conn\)/);
  assert.match(campaigns, /Number\.isInteger\(numScore\)/);
  assert.match(campaigns, /INSERT INTO nps_responses \(id,tenant_id,branch_id/);
  assert.match(campaigns, /await outbox\.enqueue\([\s\S]{0,1400}, conn\)/);
  assert.match(support, /randomBytes\(32\)/);
  assert.match(support, /csat_token_hash=\?/);
  assert.match(support, /csat_token_expires_at>=NOW\(\)/);
  assert.match(support, /Number\.isInteger\(numScore\)/);
  assert.match(migration, /uq_support_csat_token_hash/);
  assert.match(client, /get\('token'\)/);
  assert.match(client, /\?token=\$\{encodeURIComponent\(token\)\}/);
});

test('support reply updates the locked ticket on the same transaction connection', () => {
  const support = read('routes/support.js');
  const replyRoute = support.slice(
    support.indexOf("router.post('/api/admin/tickets/:id/reply'"),
    support.indexOf("router.put('/api/admin/tickets/:id/status'")
  );

  assert.match(replyRoute, /FOR UPDATE/);
  assert.match(replyRoute, /await conn\.query\(\s*`UPDATE support_tickets/);
  assert.doesNotMatch(replyRoute, /await pool\.query\(\s*`UPDATE support_tickets/);
});

test('subscriber maintenance cannot hard-delete partial customer history', () => {
  const maintenance = read('routes/client-maintenance.js');

  assert.doesNotMatch(maintenance, /DELETE FROM subscribers/);
  assert.doesNotMatch(maintenance, /DELETE FROM enrollments WHERE subscriber_id/);
  assert.match(maintenance, /duplicatesPending/);
  assert.match(maintenance, /duplicateSubscribersPending/);
  assert.match(maintenance, /SET deleted_at=NOW\(\), is_active=0/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'lib', 'startupTasks.js')), false);
});

test('subscriber to lead reversal is atomic and refuses detached customer history', () => {
  const subscribers = read('routes/admin/subscribers.js');
  const route = subscribers.slice(
    subscribers.indexOf("router.post(\n  '/api/admin/subscribers/:id/convert-to-lead'"),
    subscribers.indexOf('// POST /api/admin/subscribers\n')
  );

  assert.match(route, /await conn\.beginTransaction\(\)/);
  assert.match(route, /LIMIT 1 FOR UPDATE/);
  assert.match(route, /FROM payments[\s\S]*FROM enrollments[\s\S]*FROM orders[\s\S]*FROM certificate_requests/);
  assert.match(route, /return res\.status\(409\)/);
  assert.match(route, /INSERT INTO leads/);
  assert.match(route, /UPDATE subscribers[\s\S]*is_active=0,\s*deleted_at=NOW\(\)/);
  assert.match(route, /await conn\.commit\(\)/);
  assert.match(route, /await conn\.rollback\(\)/);
});

test('archived subscribers are excluded from canonical lists and client-code lookup', () => {
  const catalog = read('routes/core/catalog.js');
  const staffLists = read('routes/admin/stafflists.js');
  const subscribers = read('routes/admin/subscribers.js');

  assert.match(catalog, /SET is_active=0, deleted_at=NOW\(\), updated_at=NOW\(\)/);
  assert.match(staffLists, /s\.deleted_at IS NULL AND s\.is_active=1/);
  assert.match(subscribers, /deleted_at IS NULL AND is_active=1 AND \(id=\? OR client_code=\?\)/);
});
