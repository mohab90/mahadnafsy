'use strict';

// «نضيف لحساب مدير الدقي نظام الموارد البشريه ولكن فقط علي موظفين الدقي يقدر
// ينشأ حساب ويقدر يشوف الاذونات والغيابات … علي نطاق الدقي» (9 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hrReach, staffInReach, staffReachSql } = require('../lib/branchHr');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

test('the Dokki manager reaches the Dokki staff; HR reaches everyone; reception nobody', () => {
  assert.deepEqual(hrReach({ staffRecord: { role: 'HR' } }), { all: true });
  assert.deepEqual(hrReach({ isSuperAdmin: true }), { all: true });
  const dokki = hrReach({ staffRecord: { role: 'daqqi_manager' } });
  assert.equal(dokki.all, false);
  assert.equal(dokki.branch, 'DAQQI');
  assert.equal(hrReach({ staffRecord: { role: 'RECEPTION_DAQQI' } }), null);
  assert.equal(hrReach({ staffRecord: { role: 'SALES' } }), null);
  const scope = staffReachSql(dokki, 's');
  assert.equal(scope.sql, ' AND (s.role IN (?,?) OR s.branch_id = ?)');
  assert.deepEqual(scope.params, ['RECEPTION_DAQQI', 'DAQQI_MANAGER', 'branch-daqqi']);
});

test('another branch\'s employee is out of reach', async () => {
  const req = { tenantId: 't', staffRecord: { role: 'DAQQI_MANAGER' } };
  const db = staff => ({ query: async (_sql, params) => [[params[0] === staff ? { id: staff } : undefined].filter(Boolean)] });
  assert.equal(await staffInReach(db('st-donia'), req, 'st-donia'), true);
  assert.equal(await staffInReach(db('st-donia'), req, 'st-sales'), false);
});

test('the routes it opens narrow to the branch; pay and the rest of HR stay closed', () => {
  const employees = read('api/routes/hr/employees.js');
  assert.match(employees, /router\.get\('\/api\/admin\/hr\/employees', requireAuth, requireAdminOrStaff, requireAnyPermission\('view_hr', 'branch_hr'\), requireHr\('view'\)/);
  const { hasPermission } = require('../constants/permissions');
  assert.ok(hasPermission({ role: 'DAQQI_MANAGER' }, 'branch_hr') && hasPermission({ role: 'TAGAMOA_MANAGER' }, 'branch_hr'));
  assert.ok(!hasPermission({ role: 'RECEPTION_DAQQI' }, 'branch_hr'));
  const attendance = read('api/routes/hr/attendance.js');
  for (const route of [/router\.get\('\/api\/admin\/hr\/leaves', [^\n]*requireHr\('view'\)/, /router\.post\('\/api\/admin\/hr\/leaves', [^\n]*requireHr\('manage'\)/,
    /router\.put\('\/api\/admin\/hr\/leaves\/:id\/status', [^\n]*requireHr\('manage'\)/, /router\.post\('\/api\/admin\/hr\/attendance', [^\n]*requireHr\('manage'\)/]) {
    assert.match(attendance, route);
  }
  assert.match(attendance, /if \(!leave \|\| !\(await staffInReach\(conn, req, leave\.staff_id\)\)\)/);
  assert.match(read('api/routes/hr/payroll.js'), /router\.get\('\/api\/admin\/hr\/attendance\/summary', [^\n]*requireHr\('view'\)/);
  assert.match(attendance, /router\.post\('\/api\/admin\/hr\/salary', requireAuth, requireAdminOrStaff, requirePermission\('manage_hr'\)/, 'pay is not theirs');
  const accounts = read('api/routes/auth/staffAccounts.js');
  assert.match(accounts, /if \(reach && !reach\.all && reach\.newRoles\.includes\(asked\) && !req\.body\?\.staffId\) \{ req\.branchAccountReach = reach; return next\(\); \}/, 'a new reception account, nothing else');
  assert.match(read('admin/pages/dashboard/DashboardNavigation.tsx'), /\{ key: 'branch_hr', label: `موارد بشرية \$\{staffBranchLabel\}`/);
});

// «لسه نظام الموارد البشرية للدقي مش بيظهر في حساب المدير … برغم اني فتحت
// الصلاحيات» (10 Oct 2026): a grid saved before branch_hr existed, and HR boxes
// ticked to «open» it.
test('a branch manager\'s old grid still opens the branch HR, and HR boxes do not widen it past the branch', () => {
  const { hasPermission } = require('../constants/permissions');
  const oldGrid = { role: 'DAQQI_MANAGER', permissions_json: JSON.stringify(['manage_daqqi', 'view_leads']) };
  assert.ok(hasPermission(oldGrid, 'branch_hr'), 'the role runs its branch\'s HR whatever the grid says');
  assert.ok(!hasPermission(oldGrid, 'view_hr'));
  const withHr = { role: 'daqqi_manager', permissions_json: JSON.stringify(['manage_daqqi', 'view_hr', 'manage_hr']) };
  const reach = hrReach({ staffRecord: withHr }, 'manage');
  assert.equal(reach.all, false, 'still the branch\'s staff only');
  assert.equal(reach.branch, 'DAQQI');
  // Nor do the HR boxes open the institute-wide routes (an employee's file, payroll).
  assert.ok(!hasPermission(withHr, 'view_hr'));
  assert.ok(!hasPermission(withHr, 'manage_hr'));
  assert.ok(!hasPermission({ role: 'SALES', permissions_json: '[]' }, 'branch_hr'));
  const admin = read('admin/constants/permissions.ts');
  assert.match(admin, /\['daqqi_manager', 'tagamoa_manager'\]\.includes\(String\(staff\.role[\s\S]{0,200}permission === 'branch_hr'\) return true;[\s\S]{0,200}permission === 'view_hr' \|\| permission === 'manage_hr'\) return false;/);
});

test('a branch manager opening «الموارد البشرية» from any link lands on their branch\'s HR', () => {
  // The institute's HR tab refuses them (view_hr does not apply to the role), and
  // links and saved addresses (/dashboard/hr, /dashboard/hr/attendance) led there.
  const dashboard = read('admin/pages/Dashboard.tsx');
  assert.match(dashboard, /const branchHrOnly = \['daqqi_manager', 'tagamoa_manager'\]\.includes\(String\(currentStaff\?\.role \|\| ''\)\.toLowerCase\(\)\);/);
  assert.match(dashboard, /branchHrOnly && \['hr', 'hr_analytics'\]\.includes\(activeScreen\) \? 'branch_hr' : activeScreen/);
});
