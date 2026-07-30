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
const enps = read('routes', 'hr', 'enps.js');
const cron = read('lib', 'hrAuditRetentionJob.js');
const migration = read('migrations', '127_v25_hr_workflow_integrity.sql');
const compensationMigration = read('migrations', '128_v25_hr_compensation_approval.sql');
const feeMigration = read('migrations', '129_v25_hr_instructor_fee_payroll_link.sql');
const appraisalMigration = read('migrations', '131_v25_hr_appraisal_evidence.sql');
const privateFieldsMigration = read('migrations', '142_v25_hr_employee_private_fields.sql');
const recordsIntegrityMigration = read('migrations', '150_v25_hr_records_integrity.sql');
const instructorRateMigration = read('migrations', '152_v25_instructor_rate_approval.sql');
const dashboard = read('..', 'admin', 'pages', 'Dashboard.tsx');
const settings = read('..', 'admin', 'pages', 'dashboard', 'DashboardStaffSettingsPanel.tsx');
const hrTab = read('..', 'admin', 'pages', 'dashboard', 'tabs', 'HRTab.tsx');

test('disabled users are rejected by every authenticated request and cache can be invalidated immediately', () => {
  assert.match(auth, /async function activeIdentity/);
  assert.match(auth, /SELECT is_active,\s*session_version,\s*totp_enabled,\s*active_session_id,\s*active_session_ip_hash,\s*name FROM users/);
  assert.match(auth, /Account disabled or unavailable/);
  assert.match(auth, /function invalidateIdentity/);
});

test('offboarding is atomic, requires completed checklist, transfers open work, and revokes both staff and user access', () => {
  assert.match(offboarding, /beginTransaction/);
  assert.match(offboarding, /finalChecklist\.some\(item => item\?\.done !== true\)/);
  for (const table of ['tasks', 'leads', 'subscribers', 'consultations', 'support_tickets', 'inbox_conversations', 'courses']) {
    assert.match(offboarding, new RegExp(`UPDATE ${table}`));
  }
  assert.match(offboarding, /UPDATE staff[\s\S]*is_active=0[\s\S]*totp_secret=NULL/);
  assert.match(offboarding, /UPDATE users[\s\S]*is_active=0[\s\S]*session_version=session_version\+1/);
  assert.match(offboarding, /UPDATE therapists[\s\S]*is_consultation_enabled=0/);
  assert.match(offboarding, /SUCCESSOR_ROLE_MISMATCH/);
  assert.match(offboarding, /invalidateIdentity\(req\.tenantId, user\.id, user\.email\)/);
  assert.match(offboarding, /hr\.offboarding\.started/);
  assert.match(offboarding, /hr\.offboarding\.completed/);
});

test('leave workflow uses one policy-backed source, legal transitions, balance checks, and reversible attendance links', () => {
  assert.match(attendance, /const transitions = \{ PENDING: \['APPROVED', 'REJECTED'\], APPROVED: \['CANCELLED'\] \}/);
  assert.match(attendance, /LEAVE_SELF_APPROVAL/);
  assert.match(attendance, /LEAVE_BALANCE_EXCEEDED/);
  assert.match(attendance, /ATTENDANCE_CONFLICT/);
  assert.match(attendance, /leave_id/);
  assert.match(attendance, /DELETE FROM attendance_logs WHERE tenant_id=\? AND leave_id=\?/);
  assert.match(compensation, /createLeaveRequest/);
});

test('HR policy and missing staff branch schema are migration-owned', () => {
  assert.match(migration, /ALTER TABLE staff[\s\S]*branch_id/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS hr_policy_versions/);
  assert.match(migration, /ALTER TABLE leaves[\s\S]*policy_id/);
  assert.match(migration, /ALTER TABLE attendance_logs[\s\S]*leave_id/);
});

test('employee HR profile does not expose authentication secrets or permission payloads', () => {
  assert.doesNotMatch(employees, /SELECT s\.\*/);
  const profileSelect = employees.slice(employees.indexOf("router.get('/api/admin/hr/employees/:id'"), employees.indexOf('// Current salary structure'));
  assert.doesNotMatch(profileSelect, /totp_secret|permissions_json|preferences_json/);
});

test('payroll and sensitive HR adjustments prevent self approval or mutation', () => {
  assert.match(payroll, /PAYROLL_SOD/);
  assert.match(payroll, /HR_SELF_MUTATION/);
  assert.match(attendance, /HR_SELF_MUTATION/);
  assert.match(compensation, /HR_SELF_MUTATION/);
  assert.match(records, /HR_SELF_APPROVAL/);
  assert.match(compensation, /BONUS_SOD/);
  assert.match(compensation, /INSTRUCTOR_FEE_SOD/);
  assert.match(attendance, /SALARY_SOD/);
});

test('compensation changes are approval-owned and only approved values enter payroll', () => {
  assert.match(compensationMigration, /salary_structures[\s\S]*status ENUM/);
  assert.match(compensationMigration, /employee_bonuses[\s\S]*status ENUM/);
  assert.match(payroll, /employee_bonuses[\s\S]*status='APPROVED'/);
  assert.match(payroll, /salary_structures ss[\s\S]*ss\.status='APPROVED'/);
  assert.match(feeMigration, /payroll_run_id/);
  assert.match(payroll, /included_in_payroll/);
  assert.match(payroll, /UPDATE salary_advances a[\s\S]*a\.status='DEDUCTED'/);
});

test('performance appraisals require evidence and a separate approver before staff visibility', () => {
  assert.match(appraisalMigration, /evidence_json/);
  assert.match(compensation, /Evidence is required before appraisal submission/);
  assert.match(compensation, /APPRAISAL_SOD/);
  assert.match(compensation, /status IN \('submitted','approved'\)/);
});

test('HR audit retention is tenant-policy driven and bounded', () => {
  assert.match(cron, /runHrAuditRetention/);
  assert.match(cron, /audit_retention_days/);
  assert.match(cron, /LIMIT 5000/);
  assert.match(read('lib/backgroundScheduler.js'), /scheduleHrAuditRetention\(\{ pool, logger \}\)/);
});

test('staff settings only calls least-privilege self-service HR endpoints', () => {
  const selfServiceWindow = dashboard.slice(dashboard.indexOf('Fetch HR self-service data'), dashboard.indexOf('Any non-admin staff member'));
  assert.doesNotMatch(selfServiceWindow, /\/api\/admin\/hr/);
  assert.match(selfServiceWindow, /\/api\/staff\/me\/hr/);
  assert.match(selfServiceWindow, /\/api\/staff\/me\/advances/);
  assert.doesNotMatch(settings, /\/api\/admin\/hr\/(leaves|advances|employees)/);
  assert.match(settings, /\/api\/staff\/me\/leaves/);
  assert.match(settings, /\/api\/staff\/me\/advances/);
  assert.match(reports, /leaveBalance/);
});

test('admin leave UI consumes the actual API field name `type`', () => {
  assert.doesNotMatch(hrTab, /leave\.leave_type/);
  assert.match(hrTab, /leave\.type/);
});

test('attendance self service is idempotent and checkout cannot precede check-in', () => {
  assert.match(attendance, /DATE_FORMAT\(CURDATE\(\),'%Y-%m-%d'\).*DATE_FORMAT\(NOW\(\),'%H:%i'\)/);
  assert.match(attendance, /SELECT check_in,status,late_minutes FROM attendance_logs/);
  assert.match(attendance, /ON DUPLICATE KEY UPDATE[\s\S]*check_in=COALESCE\(check_in,VALUES\(check_in\)\)/);
  assert.match(attendance, /check_out IS NULL/);
  assert.match(attendance, /SELECT check_in,check_out,total_hours FROM attendance_logs[\s\S]{0,180}FOR UPDATE/);
  assert.match(attendance, /if \(!row\?\.check_in\) \{[\s\S]{0,180}conn\.rollback\(\)/);
});

test('approved leave attendance cannot be overwritten by manual entry, import or self check-in', () => {
  assert.match(attendance, /LEAVE_ATTENDANCE_LOCKED/);
  assert.match(attendance, /ATTENDANCE_DAY_LOCKED/);
  assert.doesNotMatch(attendance, /VALID_STATUSES = \[[^\]]*'LEAVE'/);
  assert.match(attendance, /leave\.type === 'PERMISSION' \? 'HALF_DAY' : 'LEAVE'/);
  assert.match(payroll, /req\.body\.csv \?\? req\.body\.csvText/);
  assert.match(payroll, /approved leave attendance is locked/);
  assert.match(payroll, /FROM work_schedules WHERE tenant_id=\?/);
  assert.match(payroll, /date must be inside/);
});

test('employee identity changes are atomic, audited and keep auth email aligned', () => {
  assert.match(employees, /beginTransaction/);
  assert.match(employees, /UPDATE users[\s\S]*session_version=session_version\+1/);
  assert.match(employees, /hr\.employee\.updated/);
  assert.match(employees, /USE_OFFBOARDING_WORKFLOW/);
  assert.match(employees, /Employee cannot manage themselves/);
});

test('self-service leave balance is aggregated from all approved annual leaves', () => {
  assert.match(reports, /SELECT COALESCE\(SUM\(total_days\),0\) AS used_days[\s\S]*type='ANNUAL' AND status='APPROVED'/);
  assert.doesNotMatch(reports, /const usedDays = leaves\s*\.filter/);
});

test('HR performance and employee KPI cards use server-side canonical monthly data', () => {
  assert.match(reports, /\/api\/admin\/hr\/reports\/performance/);
  assert.match(reports, /SUM\(amount_egp\) revenue/);
  assert.match(reports, /SUM\(commission_amount\) commission/);
  assert.match(reports, /revenue_generated/);
  assert.match(hrTab, /\/api\/admin\/hr\/reports\/performance\?month=/);
  assert.doesNotMatch(hrTab, /<option value="LEAVE">/);
  assert.doesNotMatch(hrTab, /is_active: updated\.status/);
});

test('unpaid leave affects payroll and instructor fee settlement stays ledger-owned', () => {
  assert.match(payroll, /l\.type='UNPAID'/);
  assert.match(payroll, /unpaidLeaveDays/);
  assert.match(payroll, /PAYROLL_SALARY_MISSING/);
  assert.match(compensation, /PAYROLL_SETTLEMENT_REQUIRED/);
  assert.match(compensation, /INSTRUCTOR_FEE_IMMUTABLE/);
  assert.match(instructorRateMigration, /instructor_rate_change_requests/);
  assert.match(compensation, /RATE_CHANGE_PENDING/);
  assert.match(compensation, /RATE_SOD/);
  assert.match(compensation, /hr\.instructor_rate\.\$\{status\.toLowerCase\(\)\}/);
});

test('salary advances are currency-safe, separation-of-duties controlled and payroll-settled only', () => {
  assert.match(recordsIntegrityMigration, /requested_by/);
  assert.match(recordsIntegrityMigration, /deducted_payroll_run_id/);
  assert.match(records, /PAYROLL_SETTLEMENT_REQUIRED/);
  assert.match(records, /\/api\/admin\/hr\/advances\/:advId\/disburse/);
  assert.match(records, /ADVANCE_SOD/);
  assert.match(records, /account_code: '1300'/);
  assert.match(records, /\[advance\.staff_id, advance\.requested_by\]/);
  assert.match(records, /action: `hr\.advance\.\$\{status\.toLowerCase\(\)\}`/);
  assert.match(payroll, /GROUP BY staff_id,currency/);
  assert.match(payroll, /fxRates\[currency\]/);
  assert.match(payroll, /a\.status='DISBURSED'/);
  assert.match(payroll, /a\.deducted_payroll_run_id=\?/);
});

test('disciplinary records require employee acknowledgement, support appeal and stay immutable', () => {
  assert.match(recordsIntegrityMigration, /appeal_note/);
  assert.match(records, /\/api\/staff\/me\/disciplinary\/:recId\/acknowledge/);
  assert.match(records, /\/api\/staff\/me\/disciplinary\/:recId\/appeal/);
  assert.match(records, /EMPLOYEE_ACK_REQUIRED/);
  assert.match(records, /DISCIPLINARY_IMMUTABLE/);
  assert.doesNotMatch(records, /DELETE FROM disciplinary_records/);
  assert.match(records, /hr\.disciplinary\.appealed/);
});

test('eNPS protects small cohorts and does not expose score/timestamp beside comments', () => {
  assert.match(enps, /MIN_ANONYMOUS_COHORT = 5/);
  assert.match(enps, /privacySuppressed/);
  assert.match(enps, /SELECT comment,period FROM enps_responses/);
  assert.doesNotMatch(enps, /SELECT score, comment, period, created_at FROM enps_responses/);
});

test('private employee fields are schema-owned and saved through the HR endpoint', () => {
  assert.match(privateFieldsMigration, /ALTER TABLE staff[\s\S]*national_id[\s\S]*address[\s\S]*hr_notes/);
  assert.match(employees, /national_id/);
  assert.match(employees, /hr_notes/);
  assert.match(hrTab, /mysqlAdmin\.updateHrEmployee/);
  assert.doesNotMatch(hrTab, /updateStaffMember\(updated\.id/);
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
  const joinUsPage = source('../client/pages/JoinUs.tsx');
  assert.match(publicRoutes, /await require\('\.\/hr\/talent'\)\.createJoinApplication/);
  assert.doesNotMatch(publicRoutes, /join-us→pipeline/);
  assert.match(talent, /createJoinApplication/);
  assert.match(talent, /convertJoinUs\(data, \{ db: conn \}\)/);
  assert.match(clientContext, /const addJoinUsApplication = async[\s\S]{0,180}await mysqlForms\.submitJoinUs/);
  assert.match(joinUsPage, /await addJoinUsApplication/);
  assert.match(joinUsPage, /setSubmitted\(true\)/);
  assert.match(joinUsPage, /submitError/);
  assert.match(migration, /fk_job_applicants_job_tenant/);
  assert.match(migration, /fk_join_us_applicant_tenant/);
  assert.match(migration, /fk_onboarding_items_parent_tenant/);
});

test('recruiting mutations use management permission, legal states and immutable audit history', () => {
  const recruiting = source('routes/hr/recruiting.js');
  const talent = source('routes/hr/talent.js');
  const adminOps = source('routes/admin-operations.js');
  assert.match(talent, /join-us\/:id\/to-applicant'[\s\S]{0,180}requirePermission\('manage_hr'\)/);
  assert.match(recruiting, /APPLICANT_TRANSITIONS/);
  assert.match(recruiting, /HIRE_ACTION_REQUIRED/);
  assert.match(recruiting, /APPLICANT_IMMUTABLE/);
  assert.match(recruiting, /ACTIVE_ONBOARDING_EXISTS/);
  assert.match(recruiting, /ONBOARDING_TASK_REQUIRED/);
  assert.match(adminOps, /SET status=\?,admin_note=\?,reviewed_at=/);
  assert.doesNotMatch(adminOps, /SET status=\?, message=/);
});

test('HR recruiting UI uses schema-valid employment types and persists join-us actions', () => {
  const jobs = source('../admin/pages/dashboard/tabs/JobPostingsPanel.tsx');
  const hr = source('../admin/pages/dashboard/tabs/HRTab.tsx');
  const joinUs = source('../admin/pages/dashboard/tabs/JoinUsAdminTab.tsx');
  const pipeline = source('../admin/pages/dashboard/tabs/hr-sections/RecruitmentPipelinePanel.tsx');
  const onboarding = source('../admin/pages/dashboard/tabs/hr-sections/OnboardingPanel.tsx');
  const crmState = source('../admin/context/site-data-hooks/useCrmCoreState.ts');
  assert.match(jobs, /\['intern', 'تدريب'\]/);
  assert.doesNotMatch(jobs, /\['remote'|\['internship'/);
  assert.match(hr, /subTab === 'recruitment'[\s\S]{0,500}<JobPostingsPanel/);
  assert.match(joinUs, /convertedApplicantId/);
  assert.match(pipeline, /\/api\/admin\/hr\/applicants/);
  assert.match(pipeline, /\/hire/);
  assert.match(onboarding, /\/api\/admin\/hr\/onboarding\/start/);
  assert.match(onboarding, /\/api\/admin\/hr\/onboarding\/items/);
  assert.match(crmState, /mysqlAdmin\.updateJoinUs/);
  assert.match(crmState, /mysqlAdmin\.deleteJoinUs/);
});
