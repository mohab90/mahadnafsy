'use strict';
/**
 * طلبات الانضمام — the owner's list of 12 Oct 2026:
 *
 * «في طلبات الانضمام في الموارد البشرية لازم تبقي عارف ان في طلبات انضمام موظف وفي
 * محاضر لازم تفرق بيينهم بشكل كبير ,,,في الفلتر والبحث خلي صفحه طلبات الانضمام
 * للمحاضر غير الموظفين ,,, في صفحه تسجيل محاضر جديد محتاجين نزود سوال صح او غلط هل
 * عملت محاضر من قبل ,, وسوال هل عملت في جلسات نفسيه مع عملاء من قبل ؟؟ … اتاكد ان
 * طلبات الانضمام للدقي والانترفيو للدقي بيظهر لنشوي مدير الدقي ,,, ليه لما بننقل
 * عميل للانترفيو بيظهر في السابق ؟؟؟ ليه التواصل مش بيتجسل صح ولازم اي طلب بيكون
 * جديد مش قيد المراجعه ,, لازم يكون في زر تقييم اول مكالمه»
 *
 * The rules, without a database. The same behaviour against MariaDB is in
 * integration/joinUsApplications.integration.test.js.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const {
  parseFirstCall, parseInterviewAt, parseYesNo, programIdsFrom, readPrograms, resolveApplicationKind,
} = require('../lib/joinApplication');
const { requireRecruiting, joinUsReachSql, applicantReachSql } = require('../lib/branchHr');

/** Bundles an admin module so its logic can be run here, as other tests do. */
function loadAdmin(rel) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, rel)], bundle: true, write: false, format: 'cjs', platform: 'node',
    logLevel: 'silent', jsx: 'automatic', nodePaths: [path.join(ROOT, 'admin', 'node_modules')],
    define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

test('the page an application came through decides its list, not a fallback type', () => {
  // The staff page is always an employee, whatever type it sends.
  assert.deepEqual(resolveApplicationKind({ form: 'staff', type: 'instructor' }), { type: 'EMPLOYEE', sourceForm: 'staff' });
  // The teaching page is never an employee.
  assert.deepEqual(resolveApplicationKind({ form: 'teaching', type: 'employee' }), { type: 'INSTRUCTOR', sourceForm: 'teaching' });
  assert.deepEqual(resolveApplicationKind({ form: 'teaching', type: 'consultant' }), { type: 'CONSULTANT', sourceForm: 'teaching' });
  // A page cached from before `form`: its type, and a posting means the staff page.
  assert.deepEqual(resolveApplicationKind({ type: 'EMPLOYEE' }), { type: 'EMPLOYEE', sourceForm: 'staff' });
  assert.deepEqual(resolveApplicationKind({ jobId: 'job-1' }), { type: 'EMPLOYEE', sourceForm: 'staff' });
  assert.deepEqual(resolveApplicationKind({}), { type: 'INSTRUCTOR', sourceForm: 'teaching' });
});

test('the two yes/no answers are read as answered or not', () => {
  for (const yes of [true, 1, 'yes', 'true', 'نعم', 'آه']) assert.equal(parseYesNo(yes), 1, String(yes));
  for (const no of [false, 0, 'no', 'false', 'لا']) assert.equal(parseYesNo(no), 0, String(no));
  for (const unanswered of [undefined, null, '', 'maybe']) assert.equal(parseYesNo(unanswered), null, String(unanswered));
});

test('programmes are taken as ids, de-duplicated and capped; stored ones read back safely', () => {
  assert.deepEqual(programIdsFrom(['c1', { id: 'c2', title: 'ignored' }, 'c1', '', null]), ['c1', 'c2']);
  assert.deepEqual(programIdsFrom('c1'), [], 'not a list');
  assert.equal(programIdsFrom(Array.from({ length: 200 }, (_, i) => `c${i}`)).length, 80);
  assert.deepEqual(readPrograms('[{"id":"c1","title":"دبلومة العلاج المعرفي"}]'), [{ id: 'c1', title: 'دبلومة العلاج المعرفي' }]);
  assert.deepEqual(readPrograms('not json'), []);
  assert.deepEqual(readPrograms(null), []);
});

test('a first-call rating is 1–5 with known tags only', () => {
  assert.equal(parseFirstCall({ rating: 0 }).error, 'التقييم لازم يكون من 1 لـ 5');
  assert.equal(parseFirstCall({ rating: 6 }).error, 'التقييم لازم يكون من 1 لـ 5');
  assert.equal(parseFirstCall({ rating: 2.5 }).error, 'التقييم لازم يكون من 1 لـ 5');
  const ok = parseFirstCall({ rating: '4', tags: ['الخبرة', 'bogus', 'الخبرة', 'الالتزام بالمواعيد'], notes: '  صوته واضح ' });
  assert.deepEqual(ok, { rating: 4, tags: ['الخبرة', 'الالتزام بالمواعيد'], notes: 'صوته واضح' });
});

test('an interview time must parse and must not be a day already gone', () => {
  // 12 Oct 2026, 09:00 in Cairo.
  const now = new Date('2026-10-12T06:00:00Z');
  assert.deepEqual(parseInterviewAt('', now), { value: null }, 'no date is allowed');
  assert.deepEqual(parseInterviewAt('2026-10-12 16:00', now), { value: '2026-10-12 16:00:00' });
  assert.deepEqual(parseInterviewAt('2026-10-14T09:30', now), { value: '2026-10-14 09:30:00' });
  // Earlier today still counts as today: the day, not the minute, decides.
  assert.deepEqual(parseInterviewAt('2026-10-12 03:00', now), { value: '2026-10-12 03:00:00' });
  assert.equal(parseInterviewAt('2026-10-11 16:00', now).code, 'INTERVIEW_IN_THE_PAST');
  assert.ok(parseInterviewAt('12/10/2026 4pm', now).error);
  assert.ok(parseInterviewAt('2026-10-14 25:00', now).error);
});

test('a branch manager reaches their branch\'s recruitment; others need the permission', () => {
  const run = req => {
    let status = 200; let nexted = false;
    const res = { status(code) { status = code; return this; }, json() { return this; } };
    requireRecruiting('view_join_us')(req, res, () => { nexted = true; });
    return { status, nexted, reach: req.recruitReach };
  };
  const nashwa = run({ staffRecord: { role: 'DAQQI_MANAGER', permissions_json: '[]' } });
  assert.equal(nashwa.nexted, true);
  assert.equal(nashwa.reach.all, false);
  assert.equal(nashwa.reach.key, 'daqqi');
  const tagamoa = run({ staffRecord: { role: 'tagamoa_manager' } });
  assert.equal(tagamoa.reach.key, 'tagamoa');
  const hr = run({ staffRecord: { role: 'HR', permissions_json: JSON.stringify(['view_join_us']) } });
  assert.equal(hr.reach.all, true);
  assert.equal(run({ isSuperAdmin: true }).reach.all, true);
  const sales = run({ staffRecord: { role: 'SALES', permissions_json: '[]' } });
  assert.equal(sales.status, 403);
  assert.equal(sales.nexted, false);

  // The narrowing: the applicant's chosen branch, else the posting's, lower-case.
  assert.deepEqual(joinUsReachSql({ all: true }), { sql: '', params: [] });
  const scoped = joinUsReachSql(nashwa.reach);
  assert.match(scoped.sql, /LOWER\(COALESCE\(NULLIF\(j\.branch,''\), NULLIF\(a\.branch,''\), NULLIF\(jp\.branch,''\), ''\)\) = \?/);
  assert.deepEqual(scoped.params, ['daqqi']);
  assert.deepEqual(applicantReachSql(nashwa.reach).params, ['daqqi']);
});

test('every join-us and interview route a branch manager may use checks the row is theirs', () => {
  const ops = read('api/routes/admin-operations.js');
  const talent = read('api/routes/hr/talent.js');
  const workflow = read('api/routes/hr/recruitment-workflow.js');
  const recruiting = read('api/routes/hr/recruiting.js');
  assert.match(ops, /router\.get\('\/api\/admin\/join-us', requireAuth, requireAdminOrStaff, requireAnyPermission\('view_join_us', 'branch_hr'\), requireRecruiting\('view_join_us'\)/);
  assert.match(ops, /const reach = joinUsReachSql\(req\.recruitReach, 'j', 'a', 'jp'\);/);
  assert.match(ops, /router\.patch\('\/api\/admin\/join-us\/:id'[^\n]*requireRecruiting\('manage_join_us'\)/);
  // Deleting stays with HR.
  assert.match(ops, /router\.delete\('\/api\/admin\/join-us\/:id', requireAuth, requireAdminOrStaff, requirePermission\('manage_join_us'\)/);
  assert.match(recruiting, /router\.get\('\/api\/admin\/hr\/applicants', requireAuth, requireAdminOrStaff, requireAnyPermission\('view_hr', 'branch_hr'\), requireRecruiting\('view_hr'\)/);
  // Hiring creates a staff account and stays with manage_hr.
  assert.match(talent, /'\/api\/admin\/hr\/applicants\/:appId\/hire',\n\s*requireAuth, requireAdminOrStaff, requirePermission\('manage_hr'\)/);
  for (const [name, src, check] of [
    ['to-interview', talent, 'joinUsInReach(conn, req, j.id)'],
    ['contact', workflow, 'joinUsInReach(conn, req, row.id)'],
    ['first-call', workflow, 'joinUsInReach(conn, req, row.id)'],
    ['grade', workflow, 'applicantInReach(conn, req, row.id)'],
    ['applicant update', recruiting, 'applicantInReach(conn, req, appId)'],
  ]) assert.ok(src.includes(check), `${name} must check the row is within reach`);
});

test('the Dokki manager is shown the applications and interviews screens', () => {
  const nav = read('admin/pages/dashboard/DashboardNavigation.tsx');
  const daqqiNav = nav.slice(nav.indexOf('Daqqi Manager horizontal nav'), nav.indexOf('Sales & Collection Manager horizontal nav'));
  assert.match(daqqiNav, /\{ key: 'join_us', label: 'انضمام الموظفين'/);
  assert.match(daqqiNav, /\{ key: 'lecturer_applications', label: 'انضمام المحاضرين'/);
  assert.match(daqqiNav, /\{ key: 'interviews', label: 'الانترفيوهات'/);
  const shared = read('admin/pages/dashboard/dashboardShared.tsx');
  assert.match(shared, /join_us: {12}\['view_join_us', 'branch_hr'\]/);
  assert.match(shared, /interviews: {9}\['view_hr', 'branch_hr'\]/);
  assert.match(shared, /lecturer_applications: \['view_join_us', 'branch_hr'\]/);
  // The redirect of a branch manager's HR to branch_hr leaves these two alone.
  const dashboard = read('admin/pages/Dashboard.tsx');
  assert.match(dashboard, /branchHrOnly && \['hr', 'hr_analytics'\]\.includes\(activeScreen\) \? 'branch_hr' : activeScreen/);
  // And the admin's own permission check opens them for the role.
  const { hasPermission } = require('../constants/permissions');
  assert.equal(hasPermission({ role: 'daqqi_manager', permissions_json: '[]' }, 'branch_hr'), true);
});

test('a new application is written NEW and the arrival conversion does not review it', () => {
  const talent = read('api/routes/hr/talent.js');
  assert.match(talent, /status, source_form, branch, lectured_before, sessions_before, programs_json, programs_other\)\n\s*VALUES \(\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?, 'NEW',/);
  assert.match(talent, /convertJoinUs\(data, \{ jobId: data\.job_id \|\| undefined, db: conn, review: false \}\)/);
  const migration = read('api/migrations/276_v26_join_us_kind_branch_lecturer_answers.sql');
  assert.match(migration, /ALTER COLUMN status SET DEFAULT 'NEW'/);
  const schema = read('api/schema.sql');
  assert.match(schema, /`status` enum\('NEW','REVIEWED','ACCEPTED','REJECTED','CONTACTED'\) NOT NULL DEFAULT 'NEW'/);
  assert.match(schema, /`source_form` enum\('teaching','staff'\) DEFAULT NULL/);
});

test('the lecturer form asks the two questions and lists the programmes with tick boxes', () => {
  const page = read('client/pages/JoinTeaching.tsx');
  assert.ok(page.includes('هل اشتغلت محاضر قبل كده؟ *'));
  assert.ok(page.includes('هل اشتغلت في جلسات نفسية مع عملاء قبل كده؟ *'));
  assert.match(page, /if \(lecturedBefore === null \|\| sessionsBefore === null\) \{/);
  assert.match(page, /const offered = courses\.filter\(course => course\.id && course\.title\);/);
  assert.match(page, /type="checkbox" checked=\{on\} onChange=\{\(\) => toggleProgram\(course\.id\)\}/);
  assert.ok(page.includes('برامج تانية بتقدّمها'));
  assert.match(page, /form: 'teaching',\n\s*lecturedBefore,\n\s*sessionsBefore,\n\s*programs,/);
  assert.match(read('client/pages/JoinStaff.tsx'), /form: 'staff',/);
  // The server requires the answers from the teaching page and stores only
  // published courses as programmes.
  const route = read('api/routes/public.js');
  assert.match(route, /String\(form \|\| ''\)\.toLowerCase\(\) === 'teaching' && \(lecturedBefore === null \|\| sessionsBefore === null\)/);
  assert.match(route, /SELECT id, title FROM courses WHERE tenant_id=\? AND is_published=1 AND id IN/);
});

test('an interview booked for later today is upcoming; one held or gone is past', () => {
  const filters = loadAdmin('admin/pages/dashboard/tabs/interviews-sections/InterviewFilters.tsx');
  if (!filters) return;
  const { isPastInterview } = filters;
  const now = new Date('2026-10-12T12:00:00Z'); // 15:00 in Cairo
  assert.equal(isPastInterview('2026-10-12 10:00:00', { now }), false, 'this morning is still today');
  assert.equal(isPastInterview('2026-10-12 18:00:00', { now }), false);
  assert.equal(isPastInterview('2026-10-11 18:00:00', { now }), true);
  assert.equal(isPastInterview(null, { now }), false, 'undated is not past');
  assert.equal(isPastInterview('2026-10-14 10:00:00', { graded: true, now }), true, 'graded means held');
});

test('an interview time is printed as the wall clock it was typed as', () => {
  const labels = loadAdmin('admin/pages/dashboard/tabs/hr-sections/applicantLabels.ts');
  if (!labels) return;
  assert.match(labels.fmtDateTime('2026-10-14 15:00:00'), /3:00|15:00/);
  assert.doesNotMatch(labels.fmtDateTime('2026-10-14 15:00:00'), /6:00|18:00/);
  assert.equal(labels.cairoDayOf('2026-10-14 23:30:00'), '2026-10-14');
  // An instant still converts: 22:30 UTC on the 13th is the 14th in Cairo.
  assert.equal(labels.cairoDayOf('2026-10-13T22:30:00.000Z'), '2026-10-14');
});

test('the admin reads the kind from the form, and «تم التواصل» is a status of its own', () => {
  const ui = loadAdmin('admin/pages/dashboard/tabs/join-us/joinUsUi.tsx');
  const normalize = loadAdmin('admin/context/site-data-hooks/normalizeApplicants.ts');
  if (!ui || !normalize) return;
  assert.equal(ui.kindOfApplicant('INSTRUCTOR', 'staff'), 'staff');
  assert.equal(ui.kindOfApplicant('EMPLOYEE', 'teaching'), 'instructor');
  assert.equal(ui.kindOfApplicant('CONSULTANT', 'teaching'), 'consultant');
  assert.equal(ui.kindOfApplicant('EMPLOYEE', null), 'staff');
  // CONTACTED used to fall through to «جديد», so logging a call looked like nothing.
  assert.equal(ui.statusOf('CONTACTED'), 'contacted');
  assert.equal(ui.STATUS.contacted.label, 'تم التواصل');
  const [row] = normalize.normalizeApplicants([{
    id: 'a', type: 'EMPLOYEE', status: 'NEW', lectured_before: 1, sessions_before: 0,
    programs: [{ id: 'c1', title: 'دبلومة' }], first_call_rating: 4, first_call_tags: ['الخبرة'],
  }]);
  assert.equal(row.sourceForm, 'staff');
  assert.equal(row.lecturedBefore, true);
  assert.equal(row.sessionsBefore, false);
  assert.equal(row.firstCallRating, 4);
  assert.deepEqual(row.programs, [{ id: 'c1', title: 'دبلومة' }]);
});
