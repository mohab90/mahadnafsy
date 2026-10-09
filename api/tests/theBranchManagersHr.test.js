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
  assert.match(accounts, /if \(reach && !reach\.all && reach\.newRoles\.includes\(asked\) && !req\.body\?\.staffId\) return next\(\);/, 'a new reception account, nothing else');
  assert.match(read('admin/pages/dashboard/DashboardNavigation.tsx'), /\{ key: 'branch_hr', label: `موارد بشرية \$\{staffBranchLabel\}`/);
});
