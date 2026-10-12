'use strict';
/**
 * طلبات الانضمام against a real MariaDB — the owner's list of 12 Oct 2026:
 * every new application is «جديد»; a lecturer's answers and programmes are kept;
 * the Dokki manager sees Dokki's applications and interviews and nobody else's;
 * moving someone to an interview lands them on the interview stage with the time
 * as typed; a call is logged wherever it is made; and the first call is rated.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-joinus-it';
let pool; let publicRouter; let opsRouter; let hrRouter; let cairoToday; let addDaysToDateOnly;

const HR = { id: 'jit-hr', name: 'سلمى HR', role: 'HR', permissions_json: JSON.stringify(['view_join_us', 'manage_join_us', 'view_hr', 'manage_hr']) };
const NASHWA = { id: 'jit-dq', name: 'نشوى', role: 'DAQQI_MANAGER', permissions_json: '[]' };

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
function request(staff, { params = {}, body = {}, query = {} } = {}) {
  return {
    params, body, query, headers: {}, tenantId: TENANT, ip: '127.0.0.1', get: () => undefined,
    user: { uid: `uid-${staff.id}`, email: `${staff.id}@example.test` }, staffRecord: staff, isSuperAdmin: false,
  };
}
/**
 * Runs a route the way Express would, from the guard that decides the reach
 * onward. The three before it (signed in, staff, holds one of the permissions)
 * need a token and are not what is being tested here.
 */
function findRoute(router, method, routePath) {
  for (const item of router.stack) {
    if (item.route?.path === routePath && item.route.methods[method]) return item;
    if (item.handle?.stack) {
      const nested = findRoute(item.handle, method, routePath);
      if (nested) return nested;
    }
  }
  return null;
}
async function call(router, method, routePath, staff, opts) {
  const layer = findRoute(router, method, routePath);
  assert.ok(layer, `${method.toUpperCase()} ${routePath} not found`);
  const handlers = layer.route.stack.map(s => s.handle);
  assert.equal(handlers.length, 5, `${routePath}: expected auth, staff, any-permission, reach, handler`);
  const req = request(staff, opts); const res = mockRes();
  let index = 3;
  const next = async () => { const handler = handlers[index++]; if (handler) await handler(req, res, next); };
  await next();
  return res;
}
async function submit(body) {
  const layer = publicRouter.stack.find(item => item.route?.path === '/api/join-us' && item.route.methods.post);
  const res = mockRes();
  await layer.route.stack.at(-1).handle({ body, params: {}, query: {}, headers: {}, tenantId: TENANT, ip: '127.0.0.1', get: () => undefined }, res);
  return res;
}
const row = async id => (await pool.query('SELECT * FROM join_us_applications WHERE id=? AND tenant_id=?', [id, TENANT]))[0][0];
const applicant = async id => (await pool.query('SELECT * FROM job_applicants WHERE id=? AND tenant_id=?', [id, TENANT]))[0][0];
const base = (name, extra = {}) => ({ name, email: `${Math.random().toString(36).slice(2)}@example.test`, phone: '01012345678', specialty: 'تخصص', ...extra });

async function clean() {
  await pool.query('UPDATE join_us_applications SET converted_applicant_id=NULL WHERE tenant_id=?', [TENANT]).catch(() => {});
  for (const table of ['recruitment_notes', 'join_us_applications', 'job_applicants', 'job_postings', 'courses',
    'notifications', 'message_outbox', 'audit_logs', 'audit_chain_heads']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  ({ cairoToday, addDaysToDateOnly } = require('../../lib/dates'));
  await clean();
  publicRouter = require('../../routes/public');
  opsRouter = require('../../routes/admin-operations');
  hrRouter = require('../../routes/hr');
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, is_published) VALUES
       ('jit-c1', ?, 'دبلومة العلاج المعرفي السلوكي', '', '', '', '', 'THERAPY', 'LIVE', 1),
       ('jit-c2', ?, 'دبلومة الإرشاد الأسري', '', '', '', '', 'GENERAL', 'LIVE', 1),
       ('jit-c3', ?, 'كورس مش منشور', '', '', '', '', 'GENERAL', 'LIVE', 0)`, [TENANT, TENANT, TENANT]);
  await pool.query(
    `INSERT INTO job_postings (id, tenant_id, title, employment_type, status, branch) VALUES
       ('jit-job-dq', ?, 'استقبال الدقي', 'full_time', 'open', 'DAQQI'),
       ('jit-job-tg', ?, 'استقبال التجمع', 'full_time', 'open', 'TAGAMOA')`, [TENANT, TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a new application starts as «جديد», on the list of the page it came from', { skip }, async () => {
  const res = await submit(base('موظف جديد', { form: 'staff', type: 'instructor', branch: 'tagamoa', jobId: 'jit-job-tg' }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const saved = await row(res.body.id);
  assert.equal(saved.status, 'NEW', 'not «قيد المراجعة»');
  assert.equal(saved.reviewed_at, null);
  assert.equal(saved.type, 'EMPLOYEE', 'the staff page is never filed as a lecturer');
  assert.equal(saved.source_form, 'staff');
  assert.equal(saved.branch, 'tagamoa');
  const linked = await applicant(saved.converted_applicant_id);
  assert.equal(linked.stage, 'applied', 'still in the pipeline from the start');
  assert.equal(linked.job_id, 'jit-job-tg');
  const [[column]] = await pool.query(
    `SELECT COLUMN_DEFAULT d FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name='join_us_applications' AND column_name='status'`);
  assert.match(String(column.d), /NEW/);
});

test('a lecturer must answer both questions, and only offered programmes are kept', { skip }, async () => {
  const missing = await submit(base('محاضر ناقص', { form: 'teaching', type: 'instructor', branch: 'daqqi' }));
  assert.equal(missing.statusCode, 400);

  const res = await submit(base('د. منى', {
    form: 'teaching', type: 'instructor', branch: 'daqqi', lecturedBefore: true, sessionsBefore: 'no',
    programs: ['jit-c1', 'jit-c3', 'not-a-course', 'jit-c2'], programsOther: 'تعديل السلوك للأطفال',
  }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const saved = await row(res.body.id);
  assert.equal(saved.status, 'NEW');
  assert.equal(saved.source_form, 'teaching');
  assert.equal(Number(saved.lectured_before), 1);
  assert.equal(Number(saved.sessions_before), 0);
  assert.deepEqual(JSON.parse(saved.programs_json), [
    { id: 'jit-c1', title: 'دبلومة العلاج المعرفي السلوكي' },
    { id: 'jit-c2', title: 'دبلومة الإرشاد الأسري' },
  ], 'an unpublished or unknown course is not stored');
  assert.equal(saved.programs_other, 'تعديل السلوك للأطفال');

  // And the list sends them to the card.
  const list = await call(opsRouter, 'get', '/api/admin/join-us', HR);
  const card = list.body.find(r => r.id === res.body.id);
  assert.equal(card.source_form, 'teaching');
  assert.equal(card.application_category, 'ACADEMIC');
  assert.equal(card.programs.length, 2);
  assert.equal(card.programs_json, undefined);
});

test('the Dokki manager sees Dokki\'s applications and interviews, and cannot act on others', { skip }, async () => {
  const byChoice = await submit(base('دقي بالاختيار', { form: 'teaching', branch: 'daqqi', lecturedBefore: 1, sessionsBefore: 1 }));
  const byPosting = await submit(base('دقي بالوظيفة', { form: 'staff', jobId: 'jit-job-dq' }));
  const elsewhere = await submit(base('تجمع', { form: 'staff', branch: 'tagamoa' }));

  const list = await call(opsRouter, 'get', '/api/admin/join-us', NASHWA);
  assert.equal(list.statusCode, 200, JSON.stringify(list.body));
  const names = list.body.map(r => r.name);
  assert.ok(names.includes('دقي بالاختيار'), 'the branch the applicant chose');
  assert.ok(names.includes('دقي بالوظيفة'), 'the branch of the posting applied to');
  assert.ok(!names.includes('تجمع'));
  assert.ok(list.body.every(r => r.applicant_branch === 'daqqi'));

  const hrList = await call(opsRouter, 'get', '/api/admin/join-us', HR);
  assert.ok(hrList.body.some(r => r.name === 'تجمع'), 'HR still sees every branch');

  const refused = await call(hrRouter, 'post', '/api/admin/hr/join-us/:id/to-interview', NASHWA,
    { params: { id: elsewhere.body.id }, body: { interviewAt: `${addDaysToDateOnly(cairoToday(), 1)} 11:00` } });
  assert.equal(refused.statusCode, 404);
  assert.equal((await applicant((await row(elsewhere.body.id)).converted_applicant_id)).stage, 'applied', 'nothing moved');

  const moved = await call(hrRouter, 'post', '/api/admin/hr/join-us/:id/to-interview', NASHWA,
    { params: { id: byChoice.body.id }, body: { interviewAt: `${addDaysToDateOnly(cairoToday(), 1)} 11:00` } });
  assert.equal(moved.statusCode, 200, JSON.stringify(moved.body));

  const interviews = await call(hrRouter, 'get', '/api/admin/hr/applicants', NASHWA);
  assert.equal(interviews.statusCode, 200);
  const interviewNames = interviews.body.map(r => r.name);
  assert.ok(interviewNames.includes('دقي بالاختيار'));
  assert.ok(interviewNames.includes('دقي بالوظيفة'));
  assert.ok(!interviewNames.includes('تجمع'));

  const contactElsewhere = await call(hrRouter, 'post', '/api/admin/join-us/:id/contact', NASHWA,
    { params: { id: elsewhere.body.id }, body: {} });
  assert.equal(contactElsewhere.statusCode, 404);
  const notesElsewhere = await call(hrRouter, 'get', '/api/admin/hr/notes/:refType/:refId', NASHWA,
    { params: { refType: 'join_us', refId: elsewhere.body.id } });
  assert.equal(notesElsewhere.statusCode, 404);
  void byPosting;
});

test('moving to an interview lands on the interview stage, under القادم, at the time typed', { skip }, async () => {
  const res = await submit(base('للانترفيو', { form: 'teaching', branch: 'daqqi', lecturedBefore: true, sessionsBefore: true }));
  const id = res.body.id;
  const today = cairoToday();

  const gone = await call(hrRouter, 'post', '/api/admin/hr/join-us/:id/to-interview', HR,
    { params: { id }, body: { interviewAt: `${addDaysToDateOnly(today, -1)} 15:00` } });
  assert.equal(gone.statusCode, 400);
  assert.equal(gone.body.code, 'INTERVIEW_IN_THE_PAST');
  assert.equal((await row(id)).status, 'NEW', 'a refused move changes nothing');

  const ok = await call(hrRouter, 'post', '/api/admin/hr/join-us/:id/to-interview', HR,
    { params: { id }, body: { interviewAt: `${today}T16:30` } });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.applicant.stage, 'interview');
  const saved = await row(id);
  assert.equal(saved.status, 'ACCEPTED');

  // The interviews screen gets the wall clock back, not a UTC instant that
  // prints three hours later.
  const list = await call(hrRouter, 'get', '/api/admin/hr/applicants', HR);
  const listed = list.body.find(r => r.id === saved.converted_applicant_id);
  assert.equal(listed.stage, 'interview');
  assert.equal(listed.interview_at, `${today} 16:30:00`);

  // Someone rejected earlier can still be brought back to an interview.
  const second = await submit(base('مرفوض قبل كده', { form: 'staff', branch: 'daqqi' }));
  const secondApplicant = (await row(second.body.id)).converted_applicant_id;
  await pool.query("UPDATE job_applicants SET stage='rejected' WHERE id=? AND tenant_id=?", [secondApplicant, TENANT]);
  const back = await call(hrRouter, 'post', '/api/admin/hr/join-us/:id/to-interview', HR,
    { params: { id: second.body.id }, body: {} });
  assert.equal(back.statusCode, 200);
  assert.equal((await applicant(secondApplicant)).stage, 'interview');

  // «مقبول + تحديد موعد» reaches the interviews screen too.
  const third = await submit(base('مقبول بموعد', { form: 'staff', branch: 'daqqi' }));
  const accepted = await call(hrRouter, 'post', '/api/admin/join-us/:id/evaluate', HR,
    { params: { id: third.body.id }, body: { decision: 'ACCEPTED', interviewAt: `${addDaysToDateOnly(today, 2)} 10:00` } });
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  const thirdApplicant = await applicant((await row(third.body.id)).converted_applicant_id);
  assert.equal(thirdApplicant.stage, 'interview');
  assert.equal((await row(third.body.id)).status, 'ACCEPTED');
});

test('a call is logged with its time, caller and note, from either screen', { skip }, async () => {
  const res = await submit(base('للتواصل', { form: 'teaching', branch: 'daqqi', lecturedBefore: false, sessionsBefore: true }));
  const id = res.body.id;

  const contacted = await call(hrRouter, 'post', '/api/admin/join-us/:id/contact', NASHWA,
    { params: { id }, body: { body: 'كلمتها ومتاحة الأسبوع الجاي' } });
  assert.equal(contacted.statusCode, 200, JSON.stringify(contacted.body));
  assert.equal(contacted.body.status, 'CONTACTED');
  let saved = await row(id);
  assert.equal(saved.status, 'CONTACTED');
  assert.ok(saved.contacted_at);
  assert.equal(saved.contacted_by, NASHWA.id);

  // From the interviews screen: the applicant's call, stamped by the server.
  const applicantId = saved.converted_applicant_id;
  const invalid = await call(hrRouter, 'post', '/api/admin/hr/applicants/:id/contact', HR, { params: { id: applicantId }, body: { result: 'maybe' } });
  assert.equal(invalid.statusCode, 400);
  const call2 = await call(hrRouter, 'post', '/api/admin/hr/applicants/:id/contact', HR,
    { params: { id: applicantId }, body: { result: 'no_answer', body: 'مردتش — نكلمها بكرة' } });
  assert.equal(call2.statusCode, 200, JSON.stringify(call2.body));
  const after = await applicant(applicantId);
  assert.equal(after.phone_interview_result, 'no_answer');
  assert.ok(after.phone_interview_at, 'the time of the call is recorded');
  const [notes] = await pool.query(
    "SELECT ref_type, kind, body, author_name FROM recruitment_notes WHERE tenant_id=? AND kind='contact' AND ref_id IN (?, ?) ORDER BY CAST(ref_type AS CHAR)",
    [TENANT, id, applicantId]);
  assert.deepEqual(notes.map(n => [n.ref_type, n.author_name]), [['applicant', HR.name], ['join_us', NASHWA.name]]);
  assert.match(notes[0].body, /مردّش — مردتش — نكلمها بكرة/);

  // The application's card shows the latest call, whichever screen logged it.
  const list = await call(opsRouter, 'get', '/api/admin/join-us', HR);
  const card = list.body.find(r => r.id === id);
  assert.ok(card.contacted_at);
  assert.equal(card.phone_interview_result, 'no_answer');
  assert.ok(['مردّش — مردتش — نكلمها بكرة', 'تواصل — مردّش — مردتش — نكلمها بكرة', 'كلمتها ومتاحة الأسبوع الجاي'].includes(card.contact_note));

  // And the history reads both as one timeline.
  const history = await call(hrRouter, 'get', '/api/admin/hr/notes/:refType/:refId', HR, { params: { refType: 'join_us', refId: id } });
  assert.equal(history.body.filter(n => n.kind === 'contact').length, 2);
  saved = await row(id);
  assert.equal(saved.status, 'CONTACTED');
});

test('the first call is rated, kept on the application and written to its history', { skip }, async () => {
  const res = await submit(base('أول مكالمة', { form: 'teaching', branch: 'daqqi', lecturedBefore: true, sessionsBefore: true }));
  const id = res.body.id;
  const bad = await call(hrRouter, 'post', '/api/admin/join-us/:id/first-call', HR, { params: { id }, body: { rating: 9 } });
  assert.equal(bad.statusCode, 400);
  const rated = await call(hrRouter, 'post', '/api/admin/join-us/:id/first-call', HR,
    { params: { id }, body: { rating: 4, tags: ['الصوت والأسلوب', 'الخبرة', 'غير معروف'], notes: 'صوتها واضح' } });
  assert.equal(rated.statusCode, 200, JSON.stringify(rated.body));
  const saved = await row(id);
  assert.equal(Number(saved.first_call_rating), 4);
  assert.deepEqual(JSON.parse(saved.first_call_tags), ['الصوت والأسلوب', 'الخبرة']);
  assert.equal(saved.first_call_notes, 'صوتها واضح');
  assert.equal(saved.first_call_by_name, HR.name);
  assert.equal(saved.status, 'CONTACTED', 'rating a call is having made it');
  const [[note]] = await pool.query(
    "SELECT body FROM recruitment_notes WHERE tenant_id=? AND ref_type='join_us' AND ref_id=? AND kind='first_call'", [TENANT, id]);
  assert.equal(note.body, 'تقييم أول مكالمة: 4/5 — الصوت والأسلوب، الخبرة — صوتها واضح');
  const list = await call(opsRouter, 'get', '/api/admin/join-us', HR);
  const card = list.body.find(r => r.id === id);
  assert.equal(card.first_call_rating, 4);
  assert.deepEqual(card.first_call_tags, ['الصوت والأسلوب', 'الخبرة']);
});

test('a status change from the card keeps the HR note', { skip }, async () => {
  const res = await submit(base('ملاحظة', { form: 'staff', branch: 'daqqi' }));
  await call(opsRouter, 'patch', '/api/admin/join-us/:id', HR, { params: { id: res.body.id }, body: { status: 'NEW', notes: 'مرشح قوي' } });
  const patched = await call(opsRouter, 'patch', '/api/admin/join-us/:id', HR, { params: { id: res.body.id }, body: { status: 'CONTACTED' } });
  assert.equal(patched.statusCode, 200, JSON.stringify(patched.body));
  const saved = await row(res.body.id);
  assert.equal(saved.status, 'CONTACTED');
  assert.equal(saved.admin_note, 'مرشح قوي');
});

test('only applications nobody acted on go back to «جديد» (migration 277)', { skip }, async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '277_v26_join_us_backfill_kind_branch_and_new_status.sql'), 'utf8');
  const reset = sql.slice(sql.lastIndexOf('UPDATE join_us_applications j')).trim().replace(/;\s*$/, '');
  assert.match(reset, /SET j\.status = 'NEW'/);

  const make = async (name) => {
    const res = await submit(base(name, { form: 'staff', branch: 'daqqi' }));
    await pool.query("UPDATE join_us_applications SET status='REVIEWED', reviewed_at=created_at WHERE id=? AND tenant_id=?", [res.body.id, TENANT]);
    return res.body.id;
  };
  const untouched = await make('لم يلمسه أحد');
  const noted = await make('عليه ملاحظة');
  await pool.query("INSERT INTO recruitment_notes (id, tenant_id, ref_type, ref_id, kind, body) VALUES (UUID(), ?, 'join_us', ?, 'note', 'x')", [TENANT, noted]);
  const audited = await make('عليه حدث');
  await require('../../lib/auditTrail').writeAuditEvent({
    action: 'hr.join_application.updated', entityType: 'join_us_application', entityId: audited, req: { tenantId: TENANT },
  });
  const moved = await make('اتنقل');
  await pool.query("UPDATE job_applicants SET stage='screening' WHERE id=(SELECT converted_applicant_id FROM join_us_applications WHERE id=?) AND tenant_id=?", [moved, TENANT]);
  const late = await make('اتراجع بعدين');
  await pool.query('UPDATE join_us_applications SET reviewed_at=DATE_ADD(created_at, INTERVAL 2 HOUR) WHERE id=? AND tenant_id=?', [late, TENANT]);

  // The migration's own statement, held to this test's tenant.
  await pool.query(`${reset} AND j.tenant_id = ?`, [TENANT]);
  assert.equal((await row(untouched)).status, 'NEW');
  assert.equal((await row(untouched)).reviewed_at, null);
  for (const kept of [noted, audited, moved, late]) assert.equal((await row(kept)).status, 'REVIEWED', kept);
});
