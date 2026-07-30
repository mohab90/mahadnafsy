'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('printable invoice is permission and tenant scoped and escapes stored data', () => {
  const route = read('routes/misc/billing.js');
  const finance = read('routes/finance.js');
  assert.match(route, /invoice-html'[\s\S]*requirePermission\('view_financial'\)/);
  assert.match(route, /WHERE p\.id = \? AND p\.tenant_id = \?/);
  assert.match(route, /s\.tenant_id = p\.tenant_id/);
  assert.match(route, /const escapeHtml/);
  assert.match(finance, /_loadPaymentForPrint\(paymentId, tenantId\)/);
  assert.match(finance, /WHERE p\.id = \? AND p\.tenant_id = \?/);
  assert.match(finance, /payments\/:id\/receipt'[\s\S]*requirePermission\('view_financial'\)/);
  assert.match(finance, /getBrandSettings\(tenantId\)/);
});

test('finance cockpit, payment links and budget writes are tenant bounded', () => {
  const finance = read('routes/finance.js');
  const migration = read('migrations/108_v25_finance_operational_branch_scope.sql');
  assert.match(finance, /FROM journal_entries je[\s\S]*WHERE je\.tenant_id=\?/);
  assert.match(finance, /payment_proofs WHERE tenant_id=\?/);
  assert.match(finance, /INSERT INTO payment_links \(id, tenant_id, branch, branch_id/);
  assert.match(finance, /WHERE pl\.tenant_id=\?/);
  assert.match(finance, /INSERT INTO budgets \(id, tenant_id, branch, branch_id/);
  assert.match(finance, /await conn\.beginTransaction\(\)[\s\S]*await conn\.commit\(\)/);
  assert.match(finance, /resolveFinancialScope\(req/);
  assert.match(migration, /uq_budget_tenant_branch \(tenant_id, branch_id, month, category\)/);
});

test('outstanding balances use immutable EGP snapshots, one expectation per entitlement and role scope', () => {
  const route = read('routes/crm-tools.js');
  assert.match(route, /MAX\(COALESCE\(course_expected,0\) \* COALESCE\(fx_rate_to_egp,0\)\) AS expected/);
  assert.match(route, /SUM\(CASE WHEN status='paid' THEN COALESCE\(amount_egp,0\) ELSE 0 END\) AS paid/);
  assert.match(route, /WHERE tenant_id=\? AND deleted_at IS NULL/);
  assert.match(route, /b\.subscriber_id=s\.id AND b\.tenant_id=s\.tenant_id/);
  assert.match(route, /resolveFinancialScope\(req,[\s\S]*allowAssigned: true/);
  assert.match(route, /payments\/outstanding'[\s\S]*requirePermission\('view_financial'\)/);
  assert.match(route, /payments\/send-reminder'[\s\S]*requirePermission\('manage_payments'\)/);
  assert.doesNotMatch(route, /SUM\(p\.course_expected\)/);
});

test('lead scoring uses one tenant configuration and tenant-bounded updates', () => {
  const route = read('routes/analytics/leads-scoring.js');
  assert.match(route, /getTenantSetting\('lead_scoring_config'/);
  assert.match(route, /setTenantSetting\('lead_scoring_config'/);
  assert.match(route, /WHERE l\.tenant_id = \?/);
  assert.match(route, /UPDATE leads SET score =[\s\S]*WHERE tenant_id=\?/);
  assert.doesNotMatch(route, /site_config/);
});

test('CRM due reminders preserve tenant and canonical role data boundaries', () => {
  const route = read('routes/misc/reminders.js');
  const shared = read('routes/misc/_shared.js');
  assert.match(route, /WHERE l\.tenant_id = \? AND DATE\(l\.next_follow_up_date\)/);
  assert.match(route, /leadScope\(req, 'l'\)/);
  assert.match(route, /\$\{scope\.sql\}/);
  assert.match(shared, /runFollowUpReminders\(tenantId/);
  assert.match(shared, /WHERE l\.tenant_id = \?/);
  assert.match(shared, /WHERE p\.tenant_id = \?/);
});

test('campaign attribution is role scoped and drip delivery uses the transactional outbox', () => {
  const route = read('routes/analytics/campaigns.js');
  const service = read('lib/dripCampaigns.js');
  const scheduler = read('lib/backgroundScheduler.js');
  const migration = read('migrations/076_tenant_crm_drip.sql');
  assert.match(route, /leadScope\(req, 'l'\)/);
  assert.match(route, /FROM leads l[\s\S]*\$\{scope\.sql\}/);
  assert.match(route, /hasPermission\(req\.staffRecord, 'view_financial'\)/);
  assert.match(route, /INSERT INTO drip_sequences \(id,tenant_id/);
  assert.match(route, /Exactly one lead_id or subscriber_id is required/);
  assert.doesNotMatch(route, /setInterval\(/);
  assert.match(service, /FROM drip_enrollments de[\s\S]*FOR UPDATE/);
  assert.match(service, /filterSuppressed/);
  assert.match(service, /createUnsubscribeToken/);
  assert.match(service, /outbox\.enqueue\([\s\S]*\}, conn\)/);
  assert.match(service, /const dedupeKey = `drip:/);
  assert.match(service, /outbox\.enqueue\([\s\S]*\bdedupeKey,/);
  assert.match(scheduler, /processDripCampaigns/);
  assert.match(migration, /idx_drip_enrollments_tenant_due/);
});

test('Google Sheets sync reads configuration and data inside one tenant', () => {
  const route = read('routes/gsheets.js');
  const sheets = read('lib/sheets.js');
  assert.match(route, /INSERT IGNORE INTO leads \(id, tenant_id/);
  assert.match(route, /syncAllConfiguredSheets\(req\.tenantId\)/);
  assert.match(sheets, /getTenantSetting\('crm_settings', \{ tenantId/);
  assert.match(sheets, /courses WHERE tenant_id=\?/);
  assert.match(sheets, /leads WHERE tenant_id=\?/);
  assert.match(sheets, /INSERT IGNORE INTO leads \(id, tenant_id/);
  assert.doesNotMatch(sheets, /: DEFAULT_GSHEETS/);
});

test('subscriber CRM save is transactional and cannot upsert another tenant', () => {
  const route = read('routes/admin/subscribers.js');
  const migration = read('migrations/077_tenant_subscriber_identity.sql');
  assert.match(route, /requirePermission\('manage_subscribers'\)/);
  assert.match(route, /INSERT INTO subscribers \(id, tenant_id/);
  assert.match(route, /UPDATE subscribers SET[\s\S]*WHERE id=\? AND tenant_id=\?/);
  assert.doesNotMatch(route, /INSERT INTO subscribers[\s\S]{0,900}ON DUPLICATE KEY UPDATE/);
  assert.match(route, /await conn\.beginTransaction\(\)[\s\S]*await conn\.commit\(\)/);
  assert.match(migration, /uq_subs_tenant_email \(tenant_id, email/);
});

test('advanced CRM timeline and sales access are explicit tenant scoped', () => {
  const route = read('routes/crm-advanced.js');
  const state = read('lib/leadState.js');
  const access = read('lib/leadAccess.js');
  assert.match(route, /requirePermission\('manage_leads'\)/);
  assert.match(route, /transitionLead\(\{ tenantId/);
  assert.match(state, /INSERT INTO lead_timeline \(id,tenant_id/);
  assert.match(route, /WHERE tenant_id=\? AND lead_id = \?/);
  assert.match(route, /leadScope\(req, 'l'\)/);
  assert.match(access, /assigned_sales_id=\?/);
  assert.doesNotMatch(route, /tenant_id IS NULL/);
});

test('notifications are tenant/recipient scoped with per-viewer read state', () => {
  const lib = read('lib/notification.js');
  const route = read('routes/notifications.js');
  const inbox = read('routes/misc/analytics.js');
  assert.match(lib, /INSERT INTO notifications[\s\S]*\(id, tenant_id, recipient_staff_id/);
  assert.match(route, /FROM notifications n[\s\S]*WHERE n\.tenant_id=\?/);
  assert.match(route, /INSERT INTO notification_reads[\s\S]*viewer_key/);
  assert.match(route, /recipient_staff_id IS NULL OR n\.recipient_staff_id=\?/);
  assert.match(route, /DELETE FROM notifications WHERE id=\? AND tenant_id=\?/);
  // routes/notifications.js used to have a bulk PUT (up to 400 sequential queries
  // per call, PERF-04) whose own comment claimed a frontend caller that, on closer
  // inspection, actually posts to a different endpoint entirely — removed as dead code.
  assert.doesNotMatch(route, /router\.put\('\/api\/admin\/notifications'/);
  // routes/misc/analytics.js used to have its own parallel notification store
  // (admin_notifications) that no frontend caller ever read (NOT-01) — removed
  // and unified onto the one real table above.
  assert.doesNotMatch(inbox, /admin_notifications/);
  assert.doesNotMatch(inbox, /pushAdminNotif/);
});

test('manual and scheduled automation never select or mutate leads across tenants', () => {
  // The manual "run now" button and the daily cron both delegate to this one
  // engine now (MKT-04) — the tenant-scoping invariant only needs checking
  // once, here, instead of against two independently-drifting copies.
  const engine = read('lib/automationEngine.js');
  const route = read('routes/automation.js');
  const cron = read('lib/backgroundScheduler.js');
  const migration = read('migrations/079_tenant_automation.sql');
  assert.match(engine, /FROM automation_workflows WHERE \$\{where\}/);
  assert.match(engine, /WHERE l\.tenant_id=\? AND l\.hidden/);
  assert.match(engine, /transitionLead\(\{[\s\S]*tenantId: tid/);
  assert.match(engine, /INSERT INTO tasks \(id, tenant_id/);
  assert.match(engine, /UPDATE automation_workflows SET trigger_count = trigger_count \+ \?, last_triggered_at = \? WHERE id = \? AND tenant_id=\?/);
  assert.match(route, /runAutomationWorkflows\(\{ tenantId: req\.tenantId/);
  assert.match(cron, /runAutomationWorkflows\(/);
  assert.match(migration, /idx_automation_workflows_tenant_enabled/);
});

test('CRM tasks validate tenant-owned assignees and related records', () => {
  const route = read('routes/campaigns.js');
  assert.match(route, /FROM tasks[\s\S]*WHERE tenant_id=\? AND \(\?=0 OR assigned_to=\?\)/);
  assert.match(route, /INSERT INTO tasks \(id, tenant_id/);
  assert.match(route, /UPDATE tasks SET[\s\S]*WHERE id=\? AND tenant_id=\?/);
  assert.match(route, /DELETE FROM tasks WHERE id=\? AND tenant_id=\?/);
  assert.match(route, /staff WHERE id=\? AND tenant_id=\?/);
});

test('executive dashboards and funnel cache/query data per tenant', () => {
  const dashboard = read('routes/analytics/dashboard.js');
  const funnel = read('routes/funnel.js');
  assert.match(dashboard, /dashboard_kpi_\$\{req\.tenantId\}/);
  assert.match(dashboard, /FROM payments WHERE tenant_id=\?/);
  assert.match(dashboard, /FROM leads WHERE tenant_id=\?/);
  assert.match(dashboard, /FROM subscribers WHERE tenant_id=\?/);
  assert.match(dashboard, /WHERE p\.tenant_id=\?/);
  assert.match(funnel, /cached\(`funnel:\$\{req\.tenantId\}/);
  assert.match(funnel, /const lw = \['l\.tenant_id=\?'/);
  assert.match(funnel, /l\.tenant_id=\?/);
  assert.match(funnel, /JOIN subscribers s ON s\.lead_id=l\.id AND s\.tenant_id=l\.tenant_id/);
  assert.match(funnel, /JOIN payments p ON p\.subscriber_id=s\.id AND p\.tenant_id=s\.tenant_id/);
  assert.match(funnel, /message_outbox WHERE tenant_id=\?/);
  assert.match(funnel, /WHERE rr\.tenant_id=\?/);
});

test('employee subscriber lists cannot mix CRM ownership or payment history across tenants', () => {
  const route = read('routes/admin/stafflists.js');
  const detail = read('routes/admin/subscribers.js');
  assert.match(route, /FROM payments\s+WHERE tenant_id=\? AND subscriber_id IN/);
  assert.match(route, /FROM enrollments\s+WHERE tenant_id=\? AND status='active' AND subscriber_id IN/);
  assert.match(route, /LEFT JOIN leads l ON l\.id = s\.lead_id AND l\.tenant_id=s\.tenant_id/);
  assert.match(route, /WHERE s\.tenant_id=\? AND s\.deleted_at IS NULL AND s\.branch = 'DAQQI'/);
  assert.match(route, /assign-collection'[^\n]+requirePermission\('manage_subscribers'\)/);
  assert.match(route, /SELECT crm_json FROM subscribers WHERE id=\? AND tenant_id=\?[^\n]+FOR UPDATE/);
  assert.match(route, /staff WHERE tenant_id=\? AND UPPER\(role\)='COLLECTION'/);
  assert.match(route, /subscribers WHERE tenant_id=\? AND \(assigned_cs_id/);
  assert.match(detail, /FROM subscribers\s+WHERE tenant_id=\? AND deleted_at IS NULL AND is_active=1 AND \(id=\? OR client_code=\?\)/);
  assert.match(detail, /FROM payments\s+WHERE tenant_id=\? AND subscriber_id=\?/);
  assert.match(detail, /FROM leads WHERE tenant_id=\? AND deleted_at IS NULL AND \(id=\? OR client_code=\?\)/);
});

test('public lead capture is tenant-deduped, serialized, assigned and audited atomically', () => {
  const route = read('routes/lead-capture-crm.js');
  const leadAssignment = read('lib/leadAssignment.js');
  assert.match(route, /registration:\$\{crypto\.createHash/);
  assert.match(route, /lead-public:\$\{crypto\.createHash/);
  assert.match(route, /FROM leads WHERE tenant_id=\? AND RIGHT\(REGEXP_REPLACE/);
  assert.match(route, /UPDATE leads SET notes[\s\S]*WHERE id = \? AND tenant_id=\?/);
  // Single-lead auto-assignment (CRM-01) is unified in leadAssignment.js's
  // getNextSalesRep(), shared by this route, auth.js register, and the
  // Facebook Lead Ads webhook — assert the tenant-scoping guarantee there.
  assert.match(route, /getNextSalesRep\(tenantId, conn, \{ branch:/);
  assert.match(leadAssignment, /WHERE s\.tenant_id=\? AND s\.is_active=1/);
  assert.match(route, /logLeadEvent\(id, existing \? 'updated' : 'created'/);
  assert.match(route, /getTenantSetting\('crm_rr_index'/);
  assert.match(route, /SELECT id, name FROM staff WHERE tenant_id=\?/);
  assert.match(route, /SELECT id, name, price_egp, price_sar, price_usd FROM therapists[\s\S]*WHERE id=\? AND tenant_id=\?/);
  assert.doesNotMatch(route, /let id = item\.id/);
});
