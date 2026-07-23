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
  const migration = read('migrations/075_tenant_finance_budgets.sql');
  assert.match(finance, /payments WHERE tenant_id=\? AND DATE\(date\)=\?/);
  assert.match(finance, /payment_proofs WHERE tenant_id=\?/);
  assert.match(finance, /INSERT INTO payment_links \(id, tenant_id/);
  assert.match(finance, /WHERE pl\.tenant_id=\?/);
  assert.match(finance, /INSERT INTO budgets \(id, tenant_id/);
  assert.match(finance, /await conn\.beginTransaction\(\)[\s\S]*await conn\.commit\(\)/);
  assert.match(migration, /uq_budget_tenant \(tenant_id, month, category\)/);
});

test('outstanding balances use one expected amount per entitlement and tenant-safe paid totals', () => {
  const route = read('routes/crm-tools.js');
  assert.match(route, /MAX\(COALESCE\(course_expected,0\)\) AS expected/);
  assert.match(route, /SUM\(CASE WHEN status='paid' THEN amount ELSE 0 END\) AS paid/);
  assert.match(route, /WHERE tenant_id=\? AND deleted_at IS NULL/);
  assert.match(route, /b\.subscriber_id=s\.id AND b\.tenant_id=s\.tenant_id/);
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

test('CRM due reminders preserve tenant and sales ownership boundaries', () => {
  const route = read('routes/misc/reminders.js');
  const shared = read('routes/misc/_shared.js');
  assert.match(route, /WHERE l\.tenant_id = \? AND DATE\(l\.next_follow_up_date\)/);
  assert.match(route, /l\.assigned_sales_id = \?/);
  assert.match(shared, /runFollowUpReminders\(tenantId/);
  assert.match(shared, /WHERE l\.tenant_id = \?/);
  assert.match(shared, /WHERE p\.tenant_id = \?/);
});

test('campaign attribution and drip delivery stay tenant scoped and retry failures', () => {
  const route = read('routes/analytics/campaigns.js');
  const migration = read('migrations/076_tenant_crm_drip.sql');
  assert.match(route, /FROM leads\s+WHERE tenant_id=\? AND DATE\(created_at\)/);
  assert.match(route, /INSERT INTO drip_sequences \(id,tenant_id/);
  assert.match(route, /INSERT INTO drip_enrollments \(id,tenant_id/);
  assert.match(route, /de\.tenant_id=\?/);
  assert.match(route, /retry_count=\?, last_error=\?/);
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
  assert.match(route, /requirePermission\('manage_leads'\)/);
  assert.match(route, /transitionLead\(\{ tenantId/);
  assert.match(state, /INSERT INTO lead_timeline \(id,tenant_id/);
  assert.match(route, /WHERE tenant_id=\? AND lead_id = \?/);
  assert.match(route, /lead\.assigned_sales_id !== req\.staffRecord\.id/);
  assert.doesNotMatch(route, /tenant_id IS NULL/);
});

test('admin notification stores and readers share tenant ownership', () => {
  const lib = read('lib/notification.js');
  const route = read('routes/notifications.js');
  const inbox = read('routes/misc/analytics.js');
  assert.match(lib, /INSERT INTO notifications \(id, tenant_id/);
  assert.match(route, /FROM notifications WHERE tenant_id=\?/);
  assert.match(route, /await conn\.beginTransaction\(\)[\s\S]*await conn\.commit\(\)/);
  // routes/misc/analytics.js used to have its own parallel notification store
  // (admin_notifications) that no frontend caller ever read (NOT-01) — removed
  // and unified onto the one real table above.
  assert.doesNotMatch(inbox, /admin_notifications/);
  assert.doesNotMatch(inbox, /pushAdminNotif/);
});

test('manual and scheduled automation never select or mutate leads across tenants', () => {
  const route = read('routes/automation.js');
  const cron = read('lib/serverCronJobs.js');
  const server = read('server.js');
  const migration = read('migrations/079_tenant_automation.sql');
  assert.match(route, /FROM automation_workflows WHERE tenant_id=\?/);
  assert.match(route, /WHERE l\.tenant_id=\? AND l\.hidden/);
  assert.match(route, /transitionLead\(\{[\s\S]*tenantId: req\.tenantId/);
  assert.match(route, /INSERT INTO tasks \(id, tenant_id/);
  assert.match(cron, /SELECT id, tenant_id, name,/);
  assert.match(cron, /WHERE l\.tenant_id=\?/);
  assert.match(cron, /WHERE id=\? AND tenant_id=\?/);
  assert.match(server, /SELECT id, tenant_id, name,/);
  assert.match(server, /transitionLead\(\{[\s\S]*tenantId: wf\.tenant_id/);
  assert.match(server, /UPDATE automation_workflows SET trigger_count=trigger_count\+\?,last_triggered_at=\? WHERE id=\? AND tenant_id=\?/);
  assert.match(migration, /idx_automation_workflows_tenant_enabled/);
});

test('CRM tasks validate tenant-owned assignees and related records', () => {
  const route = read('routes/campaigns.js');
  assert.match(route, /FROM tasks \$\{where\}/);
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
  assert.match(funnel, /const lw = \['tenant_id=\?'/);
  assert.match(funnel, /l\.tenant_id=\?/);
  assert.match(funnel, /message_outbox WHERE tenant_id=\?/);
  assert.match(funnel, /WHERE rr\.tenant_id=\?/);
});

test('employee subscriber lists cannot mix CRM ownership or payment history across tenants', () => {
  const route = read('routes/admin/stafflists.js');
  const detail = read('routes/admin/subscribers.js');
  assert.match(route, /FROM payments WHERE tenant_id=\? AND subscriber_id IN/);
  assert.match(route, /FROM enrollments WHERE tenant_id=\? AND subscriber_id IN/);
  assert.match(route, /LEFT JOIN leads l ON l\.id = s\.lead_id AND l\.tenant_id=s\.tenant_id/);
  assert.match(route, /WHERE s\.tenant_id=\? AND s\.branch = 'DAQQI'/);
  assert.match(route, /assign-collection'[^\n]+requirePermission\('manage_subscribers'\)/);
  assert.match(route, /SELECT crm_json FROM subscribers WHERE id=\? AND tenant_id=\?[^\n]+FOR UPDATE/);
  assert.match(route, /staff WHERE tenant_id=\? AND UPPER\(role\)='COLLECTION'/);
  assert.match(route, /subscribers WHERE tenant_id=\? AND \(assigned_cs_id/);
  assert.match(detail, /FROM subscribers WHERE tenant_id=\? AND \(id=\? OR client_code=\?\)/);
  assert.match(detail, /FROM payments WHERE tenant_id=\? AND subscriber_id=\?/);
  assert.match(detail, /FROM leads WHERE tenant_id=\? AND \(id=\? OR client_code=\?\)/);
});

test('public lead capture is tenant-deduped, serialized, assigned and audited atomically', () => {
  const route = read('routes/lead-capture-crm.js');
  assert.match(route, /registration:\$\{crypto\.createHash/);
  assert.match(route, /lead-public:\$\{crypto\.createHash/);
  assert.match(route, /FROM leads WHERE tenant_id=\? AND RIGHT\(REGEXP_REPLACE/);
  assert.match(route, /UPDATE leads SET notes[\s\S]*WHERE id = \? AND tenant_id=\?/);
  assert.match(route, /WHERE s\.tenant_id=\? AND s\.is_active=1/);
  assert.match(route, /logLeadEvent\(id, existing \? 'updated' : 'created'/);
  assert.match(route, /getTenantSetting\('crm_rr_index'/);
  assert.match(route, /SELECT id, name FROM staff WHERE tenant_id=\?/);
  assert.match(route, /SELECT id, name, price_egp FROM therapists WHERE id=\? AND tenant_id=\?/);
  assert.doesNotMatch(route, /let id = item\.id/);
});
