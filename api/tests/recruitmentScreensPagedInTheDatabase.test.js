'use strict';
/**
 * «قسم الموارد البشرية تقيل جدا … صفحه انضمام الموظفين والمحاضرين والانترفيو … الصفحه تفتح 50
 * فقط … لما نحدد انترفيو المفروض يتشال الموظف من صفحه طلبات الانضمام ويروح للانترفيو فقط»
 * (17 Oct 2026).
 *
 * Both screens downloaded every row and filtered in the browser. The filters now run in the
 * database and a screen asks for the 50 it draws. The SQL the filters build is pure, so it is
 * tested here without a connection.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const {
  JOIN_US_INBOX_SQL, joinUsFilterSql, interviewFilterSql, interviewHeldSql, experienceSql, likeOf, pageOf,
} = require('../lib/recruitmentFilters');

const marks = sql => (sql.match(/\?/g) || []).length;

test('a filter that is not set adds nothing, and every value it does add is a bound parameter', () => {
  assert.deepEqual(joinUsFilterSql({}), { sql: '', params: [] });
  assert.deepEqual(interviewFilterSql({}), { sql: '', params: [] });
  const all = joinUsFilterSql({
    status: 'contacted', kind: 'consultant', branch: 'DAQQI', job: 'job-1', program: 'دبلومة "أ"',
    lectured: 'yes', sessions: 'no', minExp: '3-5', q: "o'brien",
  });
  assert.equal(marks(all.sql), all.params.length, 'one parameter per placeholder, in order');
  assert.ok(!all.sql.includes("o'brien") && !all.sql.includes('job-1'), 'no value is written into the SQL');
  assert.equal(all.params[0], 'CONTACTED');
  assert.ok(all.params.includes('daqqi'), 'a branch is compared lower-case');
  assert.ok(all.params.includes('%"title":"دبلومة \\"أ\\""%'), 'a programme is matched on its stored JSON title');
  assert.ok(all.params.includes(1) && all.params.includes(0), 'yes is 1 and no is 0');
});

test('a status the database does not hold is ignored, not trusted', () => {
  assert.equal(joinUsFilterSql({ status: 'NEW; DROP TABLE x' }).sql, '');
  assert.equal(joinUsFilterSql({ status: 'approved' }).sql, '');
  assert.equal(joinUsFilterSql({ status: 'new' }).params[0], 'NEW');
});

test('a minimum experience is that band and every band above it', () => {
  assert.deepEqual(experienceSql('a.experience_years', '3-5').params, ['3-5', '5-10', '10plus']);
  assert.deepEqual(experienceSql('a.experience_years', 'under_1').params, ['under_1', '1-3', '3-5', '5-10', '10plus']);
  assert.match(experienceSql('a.experience_years', 'only_none').sql, /= 'none'/);
  assert.deepEqual(experienceSql('a.experience_years', ''), { sql: '', params: [] });
  assert.deepEqual(experienceSql('a.experience_years', 'whatever'), { sql: '', params: [] });
  // The same ladder the admin uses.
  const labels = read('admin/pages/dashboard/tabs/hr-sections/applicantLabels.ts');
  assert.match(labels, /EXPERIENCE_ORDER = \['none', 'under_1', '1-3', '3-5', '5-10', '10plus'\]/);
});

test('a search word is matched literally', () => {
  assert.equal(likeOf(' 50%_ '), '%50\\%\\_%');
  const search = joinUsFilterSql({ q: 'سارة' });
  assert.equal(search.params.length, 6, 'name, email, phone, specialty, other programmes, programme titles');
  assert.ok(search.params.every(value => value === '%سارة%'));
});

test('lecturers split into instructors and consultants by the type column', () => {
  // No UPPER() on the column: the collation is case-insensitive, and a function on it would defeat its index.
  assert.match(joinUsFilterSql({ kind: 'consultant' }).sql, / j\.type IN \(\?,\?,\?,\?\)/);
  assert.match(joinUsFilterSql({ kind: 'instructor' }).sql, /NOT IN \(\?,\?,\?,\?\)/);
  assert.equal(joinUsFilterSql({ kind: 'staff' }).sql, '', 'the staff list is not narrowed by a lecturer kind');
});

test('a page is at most 200 rows and never negative', () => {
  assert.deepEqual(pageOf({}), { limit: 50, offset: 0 });
  assert.deepEqual(pageOf({ limit: '50', offset: '100' }), { limit: 50, offset: 100 });
  assert.deepEqual(pageOf({ limit: '99999', offset: '-5' }), { limit: 200, offset: 0 });
  assert.deepEqual(pageOf({ limit: 'abc', offset: 'x' }), { limit: 50, offset: 0 });
});

test('an interview is held once graded or once its day is over; undated is upcoming', () => {
  const held = interviewHeldSql('a');
  assert.match(held, /a\.interview_grade IS NOT NULL OR a\.second_interview_grade IS NOT NULL/);
  assert.match(held, /DATE\(a\.interview_at\) < \?/);
  assert.equal(marks(held), 1, 'the Cairo day is the only parameter');
  // The same rule the admin states for its warning on a card.
  const filters = read('admin/pages/dashboard/tabs/interviews-sections/InterviewFilters.tsx');
  assert.match(filters, /if \(options\.graded\) return true;[\s\S]*?if \(!interviewAt\) return false;/);
});

test('the interviews filters narrow by stage, posting, branch, grade and search', () => {
  assert.match(interviewFilterSql({ view: 'offer' }).sql, /a\.stage = \?/);
  assert.equal(interviewFilterSql({ view: 'hired' }).sql, '', 'only interview and offer are views here');
  assert.match(interviewFilterSql({ grade: 'none' }).sql, /interview_grade IS NULL AND a\.second_interview_grade IS NULL/);
  const graded = interviewFilterSql({ grade: 'A+' });
  assert.deepEqual(graded.params, ['A+', 'A+']);
  assert.equal(interviewFilterSql({ grade: "A'; --" }).sql, '');
  const everything = interviewFilterSql({ view: 'interview', job: 'j', branch: 'Daqqi', minExp: '1-3', grade: 'B', q: 'x' });
  assert.equal(marks(everything.sql), everything.params.length);
});

test('an application moved to the interviews leaves the applications page, but only that page', () => {
  assert.match(JOIN_US_INBOX_SQL, /a\.stage IS NULL OR a\.stage NOT IN \('interview','offer'\)/);
  const routes = read('api/routes/admin-operations.js');
  const where = routes.slice(routes.indexOf('function joinUsWhere(req)'), routes.indexOf('const JOIN_US_FROM'));
  assert.match(where, /if \(req\.query\.inbox === '1'\) where \+= JOIN_US_INBOX_SQL;/, 'asked for with ?inbox=1');
  // The list, its counts and its pickers all use the same scope, so what is counted is what is listed.
  for (const route of ["'/api/admin/join-us/counts'", "'/api/admin/join-us/facets'", "router.get('/api/admin/join-us', "]) {
    const start = routes.indexOf(route);
    assert.ok(start > 0, route);
    assert.match(routes.slice(start, start + 900), /joinUsWhere\(req\)/, `${route} uses the shared scope`);
  }
  // Moving or accepting an application walks its applicant to 'interview', which is what hides it.
  const talent = read('api/routes/hr/talent.js');
  assert.match(talent.slice(talent.indexOf('async function advanceToInterview')), /interview/);
  const ui = read('admin/lib/mysqlapi.ts');
  assert.match(ui, /joinUsInboxCounts[\s\S]*?counts\?inbox=1&form=/);
  assert.match(ui, /listJoinUsInbox[\s\S]*?paged: '1', inbox: '1'/);
});

test('the list answers rows and a total, and counts only when the page was full', () => {
  const routes = read('api/routes/admin-operations.js');
  const list = routes.slice(routes.indexOf("router.get('/api/admin/join-us', "), routes.indexOf("router.get('/api/admin/join-us/facets'"));
  assert.match(list, /const paged = req\.query\.paged === '1';/);
  assert.match(list, /if \(!paged\) return res\.json\(mapped\);/, 'the other screens still get the plain array');
  assert.match(list, /if \(mapped\.length === limit\)/);
  assert.match(list, /res\.json\(\{ rows: mapped, total \}\)/);
});

test('the interviews come from their own endpoint, split by tab and paged', () => {
  const recruiting = read('api/routes/hr/recruiting.js');
  const route = recruiting.slice(recruiting.indexOf("router.get('/api/admin/hr/interviews', "), recruiting.indexOf("router.get('/api/admin/hr/interviews/summary'"));
  assert.match(route, /\$\{past \? '' : 'NOT '\}\$\{held\}/, 'upcoming is the negation of held');
  assert.match(route, /order = `\(a\.interview_at IS NULL\), a\.interview_at \$\{past \? 'DESC' : 'ASC'\}/);
  assert.match(route, /ORDER BY \$\{order\}/);
  assert.match(route, /LIMIT \$\{limit\} OFFSET \$\{offset\}/);
  assert.match(recruiting, /INTERVIEW_STAGES_SQL = "a\.stage IN \('interview','offer'\)"/);
  assert.match(recruiting, /requireRecruiting\('view_hr'\)\]/, 'a branch manager still sees only their branch');
  const tab = read('admin/pages/dashboard/tabs/InterviewsTab.tsx');
  assert.match(tab, /mysqlAdmin\.listHrInterviews\(/);
  assert.doesNotMatch(tab, /listHrApplicants/, 'it no longer downloads every stage');
  assert.match(tab, /const PAGE_SIZE = 50;/);
});

test('both pages draw 50 cards, two to a row, and ask for 50 more', () => {
  const board = read('admin/pages/dashboard/tabs/join-us/ApplicationsBoard.tsx');
  const interviews = read('admin/pages/dashboard/tabs/InterviewsTab.tsx');
  assert.match(board, /export const PAGE_SIZE = 50;/);
  for (const source of [board, interviews]) {
    assert.match(source, /grid items-start gap-3 lg:grid-cols-2/);
    assert.match(source, /offset: rows\.length/);
  }
  const cards = ['join-us/ApplicationCard.tsx', 'interviews-sections/InterviewCard.tsx'].map(file => read(`admin/pages/dashboard/tabs/${file}`));
  for (const card of cards) assert.match(card, /export default React\.memo\(/, 'a change to one card does not redraw the rest');
});

test('the lecturers\' interviews and the employees\' are kept apart by the form the candidate came through', () => {
  const { interviewFormSql } = require('../lib/recruitmentFilters');
  assert.equal(interviewFormSql(''), '');
  assert.equal(interviewFormSql('whatever'), '');
  const staff = interviewFormSql('staff');
  const teaching = interviewFormSql('teaching');
  assert.match(staff, /COALESCE\(js\.source_form,''\) = 'staff'/);
  assert.match(staff, /js\.source_form IS NULL AND a\.applicant_type IN \('staff','employee','hr','admin','ops','support'\)/);
  assert.equal(teaching, staff.replace(' AND (', ' AND NOT ('), 'a lecturer is whoever is not an employee, as kindOfApplicant says');
  assert.equal(marks(staff), 0, 'constants only, no value from the request reaches the SQL');
  // The same rule as the admin's.
  const ui = read('admin/pages/dashboard/tabs/join-us/joinUsUi.tsx');
  assert.match(ui, /\['staff', 'employee', 'hr', 'admin', 'ops', 'support'\]\.includes\(kind\)/);
  // The lecturers' page holds the lecturers' interviews as a tab; the interviews page is the employees'.
  const page = read('admin/pages/dashboard/tabs/JoinUsAdminTab.tsx');
  assert.match(page, /<InterviewsTab notify=\{notify\} group="teaching" embedded \/>/);
  assert.match(read('admin/pages/dashboard/tabs/InterviewsTab.tsx'), /group = 'staff', embedded = false/);
});
