'use strict';
// The recruitment workflow decides who gets hired and, through the hire path,
// who gets a staff login. These pin the properties that make it auditable and
// tenant-safe — the parts that cannot be checked by reading the screen.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const workflow = read('routes/hr/recruitment-workflow.js');
const talent = read('routes/hr/talent.js');
const migration = read('migrations/199_v25_recruitment_and_hr_controls.sql');

test('every workflow write is permission gated and tenant scoped', () => {
  // Reading a candidate list and deciding someone's employment are different
  // privileges; the decision endpoints must not settle for view_hr.
  assert.match(workflow, /const view = \[requireAuth, requireAdminOrStaff, requirePermission\('view_hr'\)\]/);
  assert.match(workflow, /const manage = \[requireAuth, requireAdminOrStaff, requirePermission\('manage_hr'\)\]/);
  for (const route of ['/contact', '/evaluate', '/grade']) {
    const at = workflow.indexOf(route);
    assert.ok(at > 0, `${route} must exist`);
    assert.match(workflow.slice(at, at + 120), /\.\.\.manage/, `${route} must require manage_hr`);
  }
  // Every statement that touches a row must carry the tenant.
  const statements = workflow.match(/(SELECT|UPDATE|INSERT INTO)[\s\S]*?`/g) || [];
  const scoped = statements.filter(s => /tenant_id/.test(s));
  assert.equal(scoped.length, statements.length, 'every query must be tenant scoped');
});

test('a grade is rejected unless it is one of the eight the desk uses', () => {
  // Free text here would make the filter meaningless and the column unusable.
  assert.match(workflow, /GRADES = new Set\(\['A\+', 'A', 'B\+', 'B', 'C\+', 'C', 'R', 'W'\]\)/);
  assert.match(workflow, /if \(!GRADES\.has\(grade\)\)[\s\S]{0,80}status\(400\)/);
});

test('each interview round records its own grader and time', () => {
  // Stamping only the last edit loses who ran the first interview once a second
  // one happens, which is exactly the question the screen has to answer.
  assert.match(workflow, /second_interview_grade=\?, second_interviewed_by=\?, second_interviewed_at=NOW\(\)/);
  assert.match(workflow, /interview_grade=\?, interviewed_by=\?, interviewed_at=NOW\(\)/);
});

test('contacting an applicant cannot drag them backwards in the pipeline', () => {
  // Re-contacting someone already accepted or rejected must not reset them to
  // CONTACTED and lose the decision.
  assert.match(workflow, /const advances = row\.status === 'NEW' \|\| row\.status === 'REVIEWED'/);
  assert.match(workflow, /advances \? ", status='CONTACTED'" : ''/);
});

test('every workflow action leaves an attributed note', () => {
  // admin_note is a single overwritable field, so without this the reason for a
  // rejection — and who decided it — is destroyed by the next edit.
  assert.match(workflow, /INSERT INTO recruitment_notes[\s\S]*author_id, author_name/);
  for (const kind of ["kind: 'contact'", "kind: 'evaluation'"]) {
    assert.ok(workflow.includes(kind), `${kind} must be recorded`);
  }
  assert.ok(!/UPDATE recruitment_notes|DELETE FROM recruitment_notes/.test(workflow),
    'the note trail must be append-only');
});

test('the decision writes both outcomes through one transaction', () => {
  const at = workflow.indexOf("'/api/admin/join-us/:id/evaluate'");
  const route = workflow.slice(at, workflow.indexOf('/grade'));
  assert.match(route, /beginTransaction\(\)/);
  assert.match(route, /FOR UPDATE/);
  assert.match(route, /rollback\(\)/);
  assert.match(route, /conn\.release\(\)/);
  // "accepted, no date yet" is a real state, so interview_at must be allowed to
  // stay null on an ACCEPTED row rather than being forced.
  assert.match(route, /decision === 'ACCEPTED' && req\.body\?\.interviewAt[\s\S]{0,120}: null/);
});

test('hiring is reachable from the interview stage but not from nothing', () => {
  // The interviews screen hires off the back of a good interview; requiring a
  // separate hop to 'offer' first meant its hire button could only answer 409.
  assert.match(talent, /a\.stage !== 'offer' && a\.stage !== 'interview'/);
  assert.match(talent, /OFFER_STAGE_REQUIRED/);
});

test('the migration only ever adds, and appends enum members', () => {
  // MySQL stores enums by ordinal: inserting a member in the middle silently
  // relabels existing rows.
  assert.ok(!/DROP COLUMN|DROP TABLE/i.test(migration), 'nothing may be dropped');
  assert.match(migration, /ENUM\('NEW','REVIEWED','ACCEPTED','REJECTED','CONTACTED'\)/);
  assert.match(migration, /ENUM\('ANNUAL','SICK','UNPAID','MATERNITY','EMERGENCY','PERMISSION','OTHER','LATE_PERMIT','EARLY_LEAVE'\)/);
  // interview_rating holds real 1-5 values on a different scale; it must survive.
  assert.ok(!/interview_rating/.test(migration.replace(/--[^\n]*/g, '')),
    'the existing numeric rating column must be left alone');
});

test('the permission types land on the table the approval screen actually reads', () => {
  // `leave_requests` was abandoned because no approval screen ever looked at it
  // (HR-02) — self-service writes to `leaves`, and hr/attendance.js approves
  // from `leaves`. A permission type added to the dead table would be
  // un-approvable, which is that same bug a second time.
  assert.match(migration, /ALTER TABLE IF EXISTS leaves\s*\n\s*MODIFY COLUMN type/);
  assert.ok(!/ALTER TABLE IF EXISTS leave_requests/.test(migration),
    'the dead leave_requests table must not be extended');

  const compensation = read('routes/hr/compensation.js');
  const attendance = read('routes/hr/attendance.js');
  assert.match(compensation, /INSERT INTO leaves\b/, 'self-service must write to leaves');
  assert.match(attendance, /\bleaves\b/, 'the approval route must read leaves');
});

// ── Employee file: documents + pay ──────────────────────────────────────────
const staffFile = read('routes/hr/staff-file.js');
const hrPolicy = read('lib/hrPolicy.js');

test('the document checklist reports the papers that are missing, not just the ones on file', () => {
  // A list built only from stored rows can never answer "what is he still
  // missing?", which is the only reason the checklist exists.
  assert.match(staffFile, /DOC_TYPES\.map\(type =>/);
  assert.match(staffFile, /received: Boolean\(row\?\.received\)/);
  assert.match(staffFile, /recorded: Boolean\(row\)/,
    '"never asked" must stay distinguishable from "asked and not delivered"');
  for (const doc of ['NATIONAL_ID', 'PHOTOS', 'QUALIFICATION', 'BIRTH_CERT',
    'WORK_STUB', 'INSURANCE_PRINT', 'MILITARY']) {
    assert.ok(staffFile.includes(doc), `${doc} must be part of the checklist`);
  }
});

test('ticking a document twice updates it instead of stacking rows', () => {
  assert.match(staffFile, /ON DUPLICATE KEY UPDATE received=VALUES\(received\)/);
});

test('pay is gated on the financial permission, not merely on HR', () => {
  // Setting someone's salary is a money operation; manage_hr is the wrong bar.
  assert.match(staffFile, /const managePay = \[requireAuth, requireAdminOrStaff, requirePermission\('manage_financial'\)\]/);
  assert.match(staffFile, /put\('\/api\/admin\/hr\/staff\/:staffId\/pay', \.\.\.managePay/);
});

test('a commission setup that would overpay is refused', () => {
  // A rate over 100 pays out more than the sale was worth, and it is a typo
  // every time it happens.
  assert.match(staffFile, /commissionType === 'PERCENT' && \(commissionRate == null \|\| commissionRate > 100\)/);
  assert.match(staffFile, /commissionType === 'TARGET' && monthlyTarget == null/);
});

test('every staff-file query carries the tenant', () => {
  const statements = staffFile.match(/(SELECT|UPDATE|INSERT INTO)[\s\S]*?`/g) || [];
  assert.ok(statements.length > 0);
  for (const statement of statements) {
    assert.match(statement, /tenant_id/, `not tenant scoped: ${statement.slice(0, 60)}`);
  }
});

test('a late permit does not come out of the annual leave balance', () => {
  // These ride the leave approval flow, but they are not days off. Counting
  // them would drain the balance of anyone who ever asked to come in late.
  assert.match(hrPolicy, /'LATE_PERMIT', 'EARLY_LEAVE',/);
  assert.match(hrPolicy, /type === 'LATE_PERMIT' \|\| type === 'EARLY_LEAVE'\) return 0;/);
});
