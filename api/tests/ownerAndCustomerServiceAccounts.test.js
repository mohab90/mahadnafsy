'use strict';

// «حسابي عاوز اغير الباسورد بتاعه لازم تخليه يظهرلي كاونر للسيستم»، «حساب خدمه
// العملاء خليه يقدر يشوف جدول الدقي وعملاء الدقي وعملاء الاونلاين فقط … يشوف
// المشاكل الاستردادات والشهادات»، and hana's «wrong password» after her
// password was changed from her staff page.

const { authRouteSource } = require('./_authRouteSource');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROLE_PERMS, DATA_SCOPE, hasPermission } = require('../constants/permissions');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('a password typed on a staff page is set, and a reset shows what it set', () => {
  const panel = read('admin/pages/staff-profile/StaffSettingsPanel.tsx');
  assert.match(panel, /if \(draft\.firebaseUid && newPassword\) \{\s*await mysqlAdmin\.adminPost\(`\/admin\/staff\/\$\{draft\.id\}\/set-password`, \{ password: newPassword \}\)/,
    'a new password for an account that already signs in was dropped');
  assert.match(panel, /newPassword\.length < 8/, 'the server\'s minimum is said before the save');
  assert.ok(panel.includes('تعيين كلمة مرور مؤقتة'));
  const reset = panel.slice(panel.indexOf('const handlePasswordReset'), panel.indexOf('const [draft, setDraft]'));
  assert.ok(reset.includes('temporaryPassword') && !reset.includes('setTimeout'),
    'the temporary password vanished before it could be copied');
  assert.match(authRouteSource(), /res\.json\(\{ ok: true, temporaryPassword: newPassword \}\)/);
});

test('every account changes its own password, the owner included', () => {
  const card = read('admin/pages/dashboard/my-profile/ChangePasswordCard.tsx');
  assert.match(card, /await mysqlAuth\.updatePassword\(current, next\)/);
  assert.match(card, /setTimeout\(logout, 1500\)/, 'the server ends the session, so the page signs out');
  assert.ok(read('admin/pages/dashboard/my-profile/MySettingsSection.tsx').includes('<ChangePasswordCard notify={notify} />'));
  // A wrong current password is a 401 about the request; it signed the user out.
  assert.match(read('admin/lib/mysqlapi.ts'), /path\.startsWith\('\/auth\/update-password'\)\) return;/);

  const dashboard = read('admin/pages/Dashboard.tsx');
  assert.match(dashboard, /isProfileTab\(activeTab\) && !currentStaff && \([\s\S]{0,120}<OwnerProfilePage[\s\S]{0,200}isOwner=\{isAdmin\}/);
  assert.ok(!dashboard.includes('صفحات الموظف غير متاحة لحسابك'));
  const owner = read('admin/pages/dashboard/my-profile/OwnerProfilePage.tsx');
  assert.ok(owner.includes('مالك النظام — صلاحيات كاملة'));
  assert.ok(owner.includes('<ChangePasswordCard notify={notify} />'));
});

test('customer service works both branches\' clients and its three desks, and nothing else', () => {
  const perms = new Set(ROLE_PERMS.support);
  for (const p of ['view_subscribers', 'manage_daqqi', 'manage_inbox', 'manage_certificates', 'manage_payments']) {
    assert.ok(perms.has(p), `support lost ${p}`);
  }
  // «حساب مسئول خدمه العملاء الاونلاين خلي يظهرها قاعده البيانات كامله …
  // واظهرلها صفحه المدفوعات»: the client database (read-only search) and the
  // payments page. Still no lead management, reports, ledgers or HR.
  assert.ok(perms.has('view_client_db'), 'support searches the whole client database');
  assert.ok(perms.has('view_orders'), 'support sees the payments page');
  for (const p of ['view_leads', 'view_reports', 'view_financial', 'approve_refunds', 'view_hr', 'view_staff']) {
    assert.ok(!perms.has(p), `support holds ${p}`);
  }
  assert.equal(DATA_SCOPE.support, 'all');

  const nav = read('admin/pages/dashboard/DashboardNavigation.tsx');
  assert.match(nav, /const hasRoleBar = [^;]*\|\| isSupport\n/, 'without its own bar it gets the management one');
  const bar = nav.slice(nav.indexOf('{isSupport && ('), nav.indexOf('{/* ── Daqqi Manager horizontal nav'));
  const tabs = [...bar.matchAll(/\{ key: '([a-z_]+)'/g)].map(m => m[1]);
  // «خليهم يشوفو الاستشارات … جزء الدعم والجودة كله».
  assert.deepEqual(tabs, ['daqqi_schedule', 'daqqi_clients', 'online_clients', 'client', 'orders', 'customer_inbox', 'refund_requests', 'cert_requests', 'consultations', 'service_hub']);
  for (const p of ['view_consultations', 'manage_consultations', 'view_contacts', 'manage_contacts']) {
    assert.ok(perms.has(p), `support cannot open ${p}`);
  }
  assert.match(read('api/routes/campaigns.js'), /router\.get\('\/api\/admin\/nps', requireAuth, requireAdminOrStaff, requireAnyPermission\('view_reports', 'manage_inbox'\)/);

  const dashboard = read('admin/pages/Dashboard.tsx');
  assert.ok(dashboard.includes('canViewDaqqiClients={isDaqqiManager || isReceptionDaqqi || isSupport || isAdmin}'));
  assert.match(read('admin/pages/dashboard/DashboardCustomerServiceTabs.tsx'), /activeTab === 'refund_requests' && \(isCollectionRole \|\| isSupport \|\|/);
});

test('customer service reads and escalates refunds; deciding them stays with accounts', () => {
  const finance = read('api/routes/finance.js');
  assert.match(finance, /router\.get\('\/api\/admin\/finance\/refunds', requireAuth, requireAdminOrStaff, requireAnyPermission\('view_financial', 'manage_inbox'\)/);
  assert.match(finance, /refunds\/:id\/escalate', requireAuth, requireAdminOrStaff, requireAnyPermission\('view_financial', 'manage_inbox'\)/);
  assert.match(finance, /router\.put\('\/api\/admin\/finance\/refunds\/:id', requireAuth, requireAdminOrStaff, requirePermission\('approve_refunds'\)/);
  assert.equal(hasPermission({ role: 'support' }, 'approve_refunds'), false);

  const panel = read('admin/pages/dashboard/tabs/financial/FinancialRefundsPanel.tsx');
  assert.match(panel, /\{isPending && canDecide && \(/);
  assert.match(panel, /\{status === 'APPROVED' && canDecide && \(/);
  assert.match(panel, /\{canDecide && <button onClick=\{\(\) => setAddOpen\(true\)\}/);
});

test('the Dokki desk\'s leads are the ones it was handed, from every lead route', () => {
  const lists = read('api/routes/admin/stafflists.js');
  assert.match(lists, /const branchScope = leadScope\(req, 'leads'\);/,
    'the staff lead list kept its own branch rule');
  const leads = read('api/routes/admin/leads.js');
  assert.match(leads, /else if \(isNew && !salesId && !csId && DAQQI_TEAM_ROLES\.includes\(staffRole\)\) \{\s*[\s\S]{0,200}salesId = req\.staffRecord\.id;/,
    'a lead the desk adds went to the next sales rep and left its list');
});
