'use strict';

// 3 Nov 2026 (second round): a manager's penalty, the leave balance of 21 days, the three kinds of absence, a site account linked to its client by a member of the
// staff, a sharing lock that stays lifted, who archived a client, «واتسابي» for customer service and HR, the directory by department.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

test('the leave balance is 21 days spent by annual leaves, free days and absences marked «من الرصيد»', async () => {
  const { leaveBalances, leaveBalanceOf } = require('../lib/leaveBalance');
  const db = {
    async query(sql) {
      if (/FROM leaves/.test(sql)) return [[{ staff_id: 'a', days: '3' }]];
      return [[{ staff_id: 'a', free_days: '2', balance_days: '1' }, { staff_id: 'b', free_days: '30', balance_days: '0' }]];
    },
  };
  const all = await leaveBalances(db, { tenantId: 't', year: 2026, entitlement: 21 });
  assert.deepEqual(all.get('a'), { entitlement: 21, annualLeaveDays: 3, freeDays: 2, balanceDays: 1, used: 6, remaining: 15 });
  assert.equal(all.get('b').remaining, 0, 'the balance never goes below nothing');
  const nobody = await leaveBalanceOf({ query: async () => [[]] }, { tenantId: 't', staffId: 'z', year: 2026, entitlement: 21 });
  assert.equal(nobody.remaining, 21, 'someone who took nothing has all of it');
});

test('the staff directory goes by department with the lecturers apart, and instructors\' pay has its own tab', () => {
  const { DEPARTMENT_ORDER, departmentOf } = require('../lib/staffDepartment');
  assert.deepEqual([...DEPARTMENT_ORDER].slice(0, 4), ['المبيعات', 'التحصيل أونلاين', 'الدقي', 'التجمع']);
  assert.ok(DEPARTMENT_ORDER.indexOf('خدمة العملاء') > DEPARTMENT_ORDER.indexOf('الحسابات'));
  assert.equal(departmentOf({ role: 'support' }), 'خدمة العملاء');
  const shared = read('shared/staffDepartment.ts');
  assert.match(shared, /export const DEPARTMENT_ORDER = \['المبيعات', 'التحصيل أونلاين', 'الدقي', 'التجمع', 'الإدارة', 'الموارد البشرية', 'الحسابات', 'خدمة العملاء'\]/);
  const hr = read('admin/pages/dashboard/tabs/HRTab.tsx');
  assert.match(hr, /\['lecturers', 'المحاضرون وأجورهم', GraduationCap\]/);
  assert.match(hr, /allStaff\.filter\(s => !isLecturerRole\(s\.role\)\)/);
  assert.doesNotMatch(read('admin/pages/dashboard/tabs/hr-sections/HrPayrollPanel.tsx'), /<HrInstructorPayPanel/);
});

test('a site account is linked to its client by a member of the staff, never by the name alone', async () => {
  const { sharedWords, candidatesFor } = require('../lib/siteAccountLink');
  assert.equal(sharedWords('شعاع حسين محمد صميلى', 'شعاع حسين محمد صميلي'), 4);
  assert.equal(sharedWords('شعاع حسين', 'منى سعيد'), 0);
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push(sql);
      if (/FROM users WHERE/.test(sql)) return [[{ id: 'u1', name: 'شعاع حسين محمد صميلى', email: 'a@x.t', phone: null }]];
      return [[
        { id: 's1', client_code: 'C140492', name: 'شعاع حسين محمد صميلي', phone: '966532190549', email: null, branch: 'ONLINE_SAUDI', firebase_uid: null, has_live_account: 0 },
        { id: 's2', client_code: 'C2', name: 'شعاع محمود', phone: '1', email: null, branch: null, firebase_uid: null, has_live_account: 0 },
      ]];
    },
  };
  const found = await candidatesFor(db, { tenantId: 't', userId: 'u1' });
  assert.deepEqual(found.candidates.map(c => c.clientCode), ['C140492']);
  const resolver = read('api/lib/subscriberIdentity.js');
  assert.doesNotMatch(resolver, /name/i.test('') ? '' : /normalizeArabicName/, 'the sign-in resolver never links by name');
  const route = read('api/routes/misc/clientDbSearch.js');
  assert.match(route, /router\.post\('\/api\/admin\/site-accounts\/:userId\/link', requireAuth, requireAdminOrStaff, requirePermission\('manage_leads'\)/);
  assert.match(read('api/lib/siteAccountLink.js'), /action: 'site_account_linked'/);
  assert.match(read('admin/pages/dashboard/tabs/client-db/LinkAccount.tsx'), /ربطه بعميل/);
});

test('lifting a sharing lock starts the device count over, or the next sign-in locks the account again', () => {
  assert.match(read('api/migrations/358_v26_sharing_unlock_resets_the_count.sql'), /ADD COLUMN IF NOT EXISTS sharing_reset_at DATETIME NULL/);
  assert.match(read('api/lib/accountSharingGuard.js'), /u\.sharing_reset_at IS NULL OR h\.created_at >= u\.sharing_reset_at/);
  assert.match(read('api/routes/misc/analytics.js'), /sharing_lock_reason=NULL, sharing_reset_at=NOW\(\)/);
});

test('archiving a client says who did it, in their history and in the archive list', () => {
  const catalog = read('api/routes/core/catalog.js');
  assert.match(catalog, /action: 'archived', label: 'أرشفة العميل', actor: actorName\(req\)/);
  assert.match(catalog, /AS archived_by/);
  assert.match(read('admin/pages/dashboard/tabs/ArchivedClientsTab.tsx'), /اللي أرشفه/);
  assert.match(read('api/routes/admin/leads/dedup.js'), /action: 'lead\.moved_to_archive'/);
});

test('«واتسابي» belongs to customer service and HR as it does to the Dokki desk', () => {
  const { canUseChannel } = require('../constants/permissions');
  for (const role of ['support', 'hr', 'reception_daqqi', 'daqqi_manager']) assert.equal(canUseChannel({ role }, 'whatsapp'), true, role);
  assert.match(read('admin/pages/dashboard/DashboardNavigation.tsx'), /isSupport && \([\s\S]{0,900}key: 'whatsapp_web'/);
});

test('an employee\'s or a client\'s page is drawn under the dashboard\'s menu bar, which loads nothing for it', () => {
  const app = read('admin/App.tsx');
  assert.match(app, /<UnderTheMenu><StaffProfile \/><\/UnderTheMenu>/);
  assert.match(app, /<UnderTheMenu><ClientProfile \/><\/UnderTheMenu>/);
  assert.match(read('admin/pages/Dashboard.tsx'), /\{page\}\s+\{!page && <DashboardTabContainer/);
  assert.match(read('admin/pages/dashboard/shell/useDashboardModel.tsx'), /if \(onProfilePage\) return;/);
});

test('the contact history of a client includes the contacts made on every lead of the same number or e-mail', () => {
  const route = read('api/routes/admin/subscribers.js');
  assert.match(route, /phone_digits=\?/);
  assert.match(route, /OR c\.lead_id IN \(\?\)/);
});
