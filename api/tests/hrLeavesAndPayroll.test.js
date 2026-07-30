'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const staffRoute = fs.readFileSync(path.join(root, 'routes', 'staff.js'), 'utf8');
const compensation = fs.readFileSync(path.join(root, 'routes', 'hr', 'compensation.js'), 'utf8');
const attendance = fs.readFileSync(path.join(root, 'routes', 'hr', 'attendance.js'), 'utf8');
const payroll = fs.readFileSync(path.join(root, 'routes', 'hr', 'payroll.js'), 'utf8');
const hrReports = fs.readFileSync(path.join(root, 'routes', 'hr', 'reports.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'routes', 'analytics', 'dashboard.js'), 'utf8');
const rateLimits = fs.readFileSync(path.join(root, 'middleware', 'rateLimits.js'), 'utf8');

test('GET /api/admin/staff gates sensitive fields on req.isSuperAdmin/view_staff, not the never-set req.isAdmin (HR-04/05)', () => {
  assert.doesNotMatch(staffRoute, /=\s*req\.isAdmin\b/);
  assert.match(staffRoute, /req\.isSuperAdmin === true \|\| hasPermission\(req\.staffRecord, PERMISSIONS\.VIEW_STAFF\)/);
});

test('self-service leave request writes to and reads from `leaves` (the table the approval workflow actually watches), not the dead leave_requests table (HR-01/02)', () => {
  assert.match(compensation, /router\.get\('\/api\/staff\/me\/leaves', requireAuth,/);
  assert.match(compensation, /router\.post\('\/api\/staff\/me\/leaves', requireAuth,/);
  const meLeavesWindow = compensation.slice(compensation.indexOf("router.get('/api/staff/me/leaves'"), compensation.indexOf("router.get('/api/staff/me/payslip'"));
  assert.doesNotMatch(meLeavesWindow, /FROM leave_requests/);
  assert.doesNotMatch(meLeavesWindow, /INTO leave_requests/);
  assert.match(meLeavesWindow, /FROM leaves l/);
  assert.match(meLeavesWindow, /INSERT INTO leaves/);
});

test('admin HR leave endpoints and self-service leave endpoints share the same `leaves` table and status vocabulary', () => {
  assert.match(attendance, /FROM leaves l/);
  assert.match(attendance, /INSERT INTO leaves/);
});

test('the monthly attendance report reads canonical leave attendance rows, not the dead leave_requests table', () => {
  const reportWindow = compensation.slice(compensation.indexOf('Monthly Attendance Report'), compensation.indexOf('module.exports'));
  assert.doesNotMatch(reportWindow, /leave_requests/);
  assert.doesNotMatch(reportWindow, /FROM staff_absences/);
  assert.match(reportWindow, /FROM attendance_logs/);
  assert.match(reportWindow, /LEFT JOIN leaves/);
  assert.match(reportWindow, /a\.leave_id IS NOT NULL/);
  assert.match(reportWindow, /getEffectiveHrPolicy/);
});

test('hr/reports.js and analytics/dashboard.js leave stats read from `leaves`, not the dead leave_requests table (HR-02)', () => {
  assert.doesNotMatch(hrReports, /FROM leave_requests/);
  assert.match(hrReports, /FROM leaves\s*\n\s*WHERE tenant_id=\?/);
  assert.doesNotMatch(dashboard, /FROM leave_requests/);
  assert.match(dashboard, /FROM leaves WHERE tenant_id=\? AND status='PENDING'/);
});

test('payroll actor-tracking uses the staff id with authenticated uid fallback and enforces separation of duties (HR-03)', () => {
  assert.doesNotMatch(payroll, /req\.user\.id\b/);
  assert.match(payroll, /const actorId = req\.staffRecord\?\.id \|\| req\.user\?\.uid \|\| null/);
  assert.match(payroll, /status === 'APPROVED'.*prevRun\.calculated_by/s);
  assert.match(payroll, /status === 'PAID'.*prevRun\.approved_by/s);
  assert.match(payroll, /code: 'PAYROLL_SOD'/);
});

test('registerLimiter no longer references a JWT `role` claim that no token issuance ever sets (HR-07)', () => {
  assert.doesNotMatch(rateLimits, /payload\.role/);
  assert.doesNotMatch(rateLimits, /require\('jsonwebtoken'\)/);
});
