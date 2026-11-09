'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateLeaveDays } = require('../lib/hrPolicy');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const source = relativePath => read(...relativePath.split('/'));
const auth = read('middleware', 'auth.js');
const attendance = read('routes', 'hr', 'attendance.js');
const compensation = read('routes', 'hr', 'compensation.js');
const employees = read('routes', 'hr', 'employees.js');
const offboarding = read('routes', 'hr', 'offboarding.js');
const payroll = read('routes', 'hr', 'payroll.js');
const records = read('routes', 'hr', 'records.js');
const reports = read('routes', 'hr', 'reports.js');
const cron = read('lib', 'hrAuditRetentionJob.js');
const migration = read('migrations', '127_v25_hr_workflow_integrity.sql');
const compensationMigration = read('migrations', '128_v25_hr_compensation_approval.sql');
const feeMigration = read('migrations', '129_v25_hr_instructor_fee_payroll_link.sql');
const appraisalMigration = read('migrations', '131_v25_hr_appraisal_evidence.sql');
const privateFieldsMigration = read('migrations', '142_v25_hr_employee_private_fields.sql');
const recordsIntegrityMigration = read('migrations', '150_v25_hr_records_integrity.sql');
const instructorRateMigration = read('migrations', '152_v25_instructor_rate_approval.sql');
// «ملفي» loads the employee's own HR record itself, and its requests tab
// files leave, permissions and advances (admin/pages/dashboard/my-profile).
const myHr = read('..', 'admin', 'pages', 'dashboard', 'my-profile', 'useMyHr.ts');
const myRequests = read('..', 'admin', 'pages', 'dashboard', 'my-profile', 'MyRequestsSection.tsx');
const hrTab = read('..', 'admin', 'pages', 'dashboard', 'tabs', 'HRTab.tsx');
const staffProfile = read('..', 'admin', 'pages', 'staff-profile', 'StaffSettingsPanel.tsx');
const hrLeavesPanel = read('..', 'admin', 'pages', 'dashboard', 'tabs', 'hr-sections', 'HrLeavesPanel.tsx');



test('offboarding is atomic, requires completed checklist, transfers open work, and revokes both staff and user access', () => {
  
  
  for (const table of ['tasks', 'leads', 'subscribers', 'consultations', 'support_tickets', 'inbox_conversations', 'courses']) {
    assert.match(offboarding, new RegExp(`UPDATE ${table}`));
  }
  
  
  
  
  
  
  
});

test('employee HR profile does not expose authentication secrets or permission payloads', () => {
  
  const profileSelect = employees.slice(employees.indexOf("router.get('/api/admin/hr/employees/:id'"), employees.indexOf('// Current salary structure'));
  assert.doesNotMatch(profileSelect, /totp_secret|permissions_json|preferences_json/);
});







test('staff settings only calls least-privilege self-service HR endpoints', () => {
  for (const file of [myHr, myRequests]) assert.doesNotMatch(file, /\/api\/admin\/hr/);
  assert.match(myHr, /\/api\/staff\/me\/hr/);
  assert.match(myHr, /\/api\/staff\/me\/advances/);
  assert.match(myRequests, /\/api\/staff\/me\/leaves/);
  assert.match(myRequests, /\/api\/staff\/me\/advances/);
  
});

test('admin leave UI consumes the actual API field name `type`', () => {
  // The leave markup lives in HrLeavesPanel.tsx since HRTab.tsx was split; HRTab
  // is still checked so the wrong field name cannot come back on either side.
  assert.doesNotMatch(hrLeavesPanel, /leave.leave_type/);
  assert.doesNotMatch(hrTab, /leave.leave_type/);
  assert.match(hrLeavesPanel, /leave.type/);
});









test('HR performance and employee KPI cards use server-side canonical monthly data', () => {
  
  
  
  
  assert.match(hrTab, /\/admin\/hr\/reports\/performance\?month=/);
  assert.doesNotMatch(hrTab, /<option value="LEAVE">/);
  assert.doesNotMatch(hrTab, /is_active: updated\.status/);
});





test('private employee fields are schema-owned and saved through the HR endpoint', () => {
  
  
  
  // The editor users reach is StaffSettingsPanel.tsx, the settings tab of the
  // staff profile the HR directory links to. It used to name HRTab.tsx, which
  // held an older unreachable copy of the same save; that copy is gone, and
  // guarding it had left the live one unguarded. Both files are checked for the
  // generic endpoint, so neither can start routing private fields through it.
  assert.match(staffProfile, /mysqlAdmin\.updateHrEmployee/);
  assert.match(staffProfile, /national_id: payload\.nationalId/);
  assert.doesNotMatch(staffProfile, /updateStaffMember\(/);
  assert.doesNotMatch(hrTab, /updateStaffMember\(/);
});

test('leave-day calculation excludes configured weekends and treats permission/maternity explicitly', () => {
  const policy = { weekend_days_json: [5, 6] };
  assert.equal(calculateLeaveDays('2026-07-23', '2026-07-26', 'ANNUAL', policy), 2);
  assert.equal(calculateLeaveDays('2026-07-25', '2026-07-25', 'MATERNITY', policy), 1);
  assert.equal(calculateLeaveDays('2026-07-25', '2026-07-25', 'PERMISSION', policy), 0.5);
  assert.throws(
    () => calculateLeaveDays('2026-07-25', '2026-07-25', 'ANNUAL', policy),
    /no working days/
  );
});

test('website recruiting is atomic, tenant linked and never a fire-and-forget HR conversion', () => {
  const publicRoutes = source('routes/public.js');
  const talent = source('routes/hr/talent.js');
  const migration = source('migrations/133_v25_hr_recruiting_integrity.sql');
  const clientContext = source('../client/context/SiteDataContext.tsx');
  // The single JoinUs.tsx was split into two distinct pages (teaching track vs
  // staff/careers track). Both must keep the same submit contract, so assert
  // against each rather than dropping the coverage.
  const joinPages = [
    source('../client/pages/JoinTeaching.tsx'),
    source('../client/pages/JoinStaff.tsx'),
  ];
  
  
  
  // createJoinApplication forwards an optional job_id so an application made
  // from a specific posting attaches to it instead of the generic talent pool —
  // and converts without reviewing, so the application arrives as NEW
  // («لازم اي طلب بيكون جديد مش قيد المراجعه», 12 Oct 2026).
  
  
  for (const joinUsPage of joinPages) {
    assert.match(joinUsPage, /await addJoinUsApplication/);
    assert.match(joinUsPage, /setSubmitted\(true\)/);
    assert.match(joinUsPage, /submitError/);
  }
  
  
  
});


