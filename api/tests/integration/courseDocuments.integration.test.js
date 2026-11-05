'use strict';
/**
 * 5 Nov 2026: three PDFs per course, each opened by what the client has paid — FREE for anybody, FIRST_PAYMENT after a booking and a first payment, EIGHTY_PERCENT after
 * 80% of the price. Against a real MariaDB and real files: the admin's upload (checked as a PDF, replacing the one before, removing the file), who may list and who may
 * download at every step of paying (the exact 80% boundary, a pending payment, a course held through a track), what a screen is never told (the file's place), and
 * that a locked file is refused with the right status. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const DOCS_DIR = fs.mkdtempSync(path.join(process.env.TEST_TMP_BASE || path.join(__dirname, '..', 'support'), '_docs_'));
process.env.COURSE_DOCUMENT_DIR = DOCS_DIR;
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-course-documents-it';
let pool, router, docs;

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const students = {
  nobody: { id: 'cd-u0', email: 'cd-nobody@x.t' },
  booked: { id: 'cd-u1', email: 'cd-booked@x.t' },
  track: { id: 'cd-u2', email: 'cd-track@x.t' },
};

const clean = async () => {
  for (const table of ['course_documents', 'payments', 'enrollments', 'bundle_courses', 'bundles', 'subscribers', 'users', 'courses']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
};
async function call(method, routePath, { params = {}, user = null, query = {} } = {}) {
  const layer = router.stack.find(entry => entry.route?.path === routePath && entry.route.methods[method]);
  const res = {
    statusCode: 200, body: undefined, headers: {}, chunks: [], finished: null,
    set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; },
    // the file route pipes a stream into the response
    write(chunk) { this.chunks.push(Buffer.from(chunk)); return true; }, end(chunk) { if (chunk) this.chunks.push(Buffer.from(chunk)); this.finished?.(); return this; },
    on() { return this; }, once() { return this; }, emit() { return true; }, removeListener() { return this; }, destroy() {},
  };
  const done = new Promise(resolve => { res.finished = resolve; });
  const req = { params, query, body: {}, headers: {}, tenantId: T, ip: '1', get: () => undefined, ...(user ? { user: { uid: user.id, email: user.email, session_id: 's' } } : {}) };
  await layer.route.stack.at(-1).handle(req, res, error => { if (error) throw error; });
  if (res.body === undefined && res.statusCode < 400) await Promise.race([done, new Promise(resolve => setTimeout(resolve, 1500))]);
  return res;
}
async function uploadPdf(tier, name = 'دليل.pdf', title = 'عنوان', bytes = PDF) {
  const tempPath = path.join(docs.TEMP_DIR, `t-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.writeFileSync(tempPath, bytes);
  const req = { params: { id: 'cd-c1', tier }, body: { title }, file: { path: tempPath, originalname: name }, tenantId: T, user: { uid: 'admin' }, ip: '1', headers: {}, get: () => undefined };
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await router.afterUpload(req, res);
  return { res, tempPath };
}
const pay = (id, sub, amount, status = 'paid', bundle = null) => pool.query(
  `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, bundle_id, amount, currency, fx_rate_to_egp, amount_egp, payment_type, status, course_expected, date)
   VALUES (?, ?, ?, ?, ?, ?, 'EGP', 1, ?, ?, ?, ?, '2026-10-01')`, [id, T, sub, bundle ? null : 'cd-c1', bundle, amount, amount, bundle ? 'BUNDLE' : 'COURSE', status, bundle ? 2000 : 1000]);
const documentsFor = async user => (await call('get', '/api/courses/:course/documents', { params: { course: 'cd-c1' }, user })).body.documents;
const openTiers = async user => Object.fromEntries((await documentsFor(user)).map(row => [row.tier, row.open]));

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/course-documents');
  docs = require('../../lib/courseDocuments');
  await clean();
  for (const [index, key] of Object.keys(students).entries()) {
    const user = students[key];
    await pool.query("INSERT INTO users (id, tenant_id, email, phone, name, password_hash) VALUES (?, ?, ?, ?, 'م', 'x')", [user.id, T, user.email, `10198000${index}1`]);
    await pool.query("INSERT INTO subscribers (id, tenant_id, firebase_uid, client_code, name, email, phone, branch) VALUES (?, ?, ?, ?, 'طالب', ?, ?, 'ONLINE_EGYPT')", [`cd-s${index}`, T, user.id, `CD${index}`, user.email, `10198000${index}1`]);
  }
  for (const [id, price] of [['cd-c1', 1000], ['cd-c2', 1000]]) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type, price_egp, is_published)
       VALUES (?, ?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', ?, 1)`, [id, T, `${id}-it`, id, price]);
  }
  await pool.query("INSERT INTO bundles (id, tenant_id, title, description, price_egp, is_published) VALUES ('cd-b1', ?, 'مسار', '', 2000, 1)", [T]);
  await pool.query("INSERT INTO bundle_courses (tenant_id, bundle_id, course_id, sort_order) VALUES (?, 'cd-b1', 'cd-c1', 1), (?, 'cd-b1', 'cd-c2', 2)", [T, T]);
  // s1 booked the course alone; s2 holds both courses through the track
  await pool.query("INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, enrolled_at, status) VALUES (UUID(), ?, 'cd-s1', 'cd-c1', NOW(), 'active')", [T]);
  await pool.query("INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, bundle_id, enrolled_at, status) VALUES (UUID(), ?, 'cd-s2', 'cd-c1', 'cd-b1', NOW(), 'active'), (UUID(), ?, 'cd-s2', 'cd-c2', 'cd-b1', NOW(), 'active')", [T, T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); fs.rmSync(DOCS_DIR, { recursive: true, force: true }); } });

test('the admin uploads a PDF per tier; a file that is not a PDF is refused and nothing is kept', { skip }, async () => {
  for (const tier of docs.TIERS) {
    const { res } = await uploadPdf(tier, `${tier}.pdf`, `ملف ${tier}`);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.document.tier, tier);
    assert.equal(res.body.document.size, PDF.length);
  }
  const fake = await uploadPdf('FREE', 'evil.pdf', 'x', Buffer.from('<html>not a pdf</html>'));
  assert.equal(fake.res.statusCode, 400);
  assert.match(fake.res.body.error, /not a PDF/i);
  assert.equal(fs.existsSync(fake.tempPath), false, 'the refused upload is removed from the disk');
  const empty = await uploadPdf('FREE', 'empty.pdf', 'x', Buffer.alloc(0));
  assert.equal(empty.res.statusCode, 400);
  const [rows] = await pool.query('SELECT tier, title FROM course_documents WHERE tenant_id=? AND course_id=? ORDER BY tier', [T, 'cd-c1']);
  assert.deepEqual(rows.map(row => row.tier), ['FREE', 'FIRST_PAYMENT', 'EIGHTY_PERCENT'], 'three tiers, the refused ones changed nothing');
  assert.equal(rows.find(row => row.tier === 'FREE').title, 'ملف FREE', 'the refused upload did not overwrite the good one');
});

test('replacing a tier\'s PDF removes the old file from the disk', { skip }, async () => {
  const before = (await pool.query("SELECT stored_name FROM course_documents WHERE tenant_id=? AND course_id='cd-c1' AND tier='FIRST_PAYMENT'", [T]))[0][0];
  const oldFile = path.join(docs.courseDirectory(T, 'cd-c1'), before.stored_name);
  assert.equal(fs.existsSync(oldFile), true);
  const { res } = await uploadPdf('FIRST_PAYMENT', 'new.pdf', 'جديد', Buffer.concat([PDF, Buffer.from('% newer\n')]));
  assert.equal(res.statusCode, 200);
  assert.equal(fs.existsSync(oldFile), false, 'the file that was replaced is gone');
  assert.equal((await pool.query("SELECT COUNT(*) n FROM course_documents WHERE tenant_id=? AND course_id='cd-c1' AND tier='FIRST_PAYMENT'", [T]))[0][0].n, 1, 'still one row for the tier');
});

test('a visitor and a client who has not booked see the free file open and the others locked', { skip }, async () => {
  for (const user of [null, students.nobody]) {
    assert.deepEqual(await openTiers(user), { FREE: true, FIRST_PAYMENT: false, EIGHTY_PERCENT: false }, user ? 'signed in, nothing booked' : 'anonymous');
  }
});

test('what a screen is told never says where a file is', { skip }, async () => {
  const body = JSON.stringify((await call('get', '/api/courses/:course/documents', { params: { course: 'cd-c1' }, user: students.booked })).body);
  for (const word of ['stored_name', 'storedName', 'sha256', 'uploads', DOCS_DIR.replace(/\\/g, '\\\\')]) assert.equal(body.includes(word), false, word);
  const res = await call('get', '/api/courses/:course/documents', { params: { course: 'cd-c1' }, user: students.booked });
  assert.match(res.headers['Cache-Control'], /private, no-store/, 'it depends on who is looking, so no shared cache may keep it');
});

test('booked but nothing paid: still only the free file; a first payment opens the second; 80% opens the third — exactly', { skip }, async () => {
  assert.deepEqual(await openTiers(students.booked), { FREE: true, FIRST_PAYMENT: false, EIGHTY_PERCENT: false }, 'booked, nothing paid');
  await pay('cd-p0', 'cd-s1', 400, 'pending');
  assert.equal((await openTiers(students.booked)).FIRST_PAYMENT, false, 'a pending payment is not a payment');
  await pay('cd-p1', 'cd-s1', 300);
  assert.deepEqual(await openTiers(students.booked), { FREE: true, FIRST_PAYMENT: true, EIGHTY_PERCENT: false }, 'first payment of 300 of 1000');
  await pay('cd-p2', 'cd-s1', 499);
  assert.equal((await openTiers(students.booked)).EIGHTY_PERCENT, false, '799 of 1000 is not 80%');
  await pay('cd-p3', 'cd-s1', 1);
  assert.deepEqual(await openTiers(students.booked), { FREE: true, FIRST_PAYMENT: true, EIGHTY_PERCENT: true }, '800 of 1000 is');
});

test('a course held through a track is read through the track: 85% of the track opens its courses\' full document', { skip }, async () => {
  assert.deepEqual(await openTiers(students.track), { FREE: true, FIRST_PAYMENT: false, EIGHTY_PERCENT: false }, 'holds the track, nothing paid');
  await pay('cd-p4', 'cd-s2', 1700, 'paid', 'cd-b1');
  assert.deepEqual(await openTiers(students.track), { FREE: true, FIRST_PAYMENT: true, EIGHTY_PERCENT: true }, '1700 of the track\'s 2000');
});

test('the file itself: free to anybody, the others refused with the right status until earned', { skip }, async () => {
  const fileOf = (tier, user) => call('get', '/api/courses/:course/documents/:tier/file', { params: { course: 'cd-c1', tier }, user });
  const free = await fileOf('FREE', null);
  assert.equal(free.statusCode, 200);
  assert.equal(free.headers['Content-Type'], 'application/pdf');
  assert.equal(free.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(free.headers['Cache-Control'], /public/);
  assert.equal(Buffer.concat(free.chunks).subarray(0, 5).toString(), '%PDF-', 'it is the PDF');
  const anonymousLocked = await fileOf('FIRST_PAYMENT', null);
  assert.equal(anonymousLocked.statusCode, 401);
  assert.equal(anonymousLocked.body.code, 'SIGN_IN_REQUIRED');
  const locked = await fileOf('EIGHTY_PERCENT', students.nobody);
  assert.equal(locked.statusCode, 403);
  assert.equal(locked.body.code, 'DOCUMENT_LOCKED');
  assert.equal(locked.chunks.length, 0, 'nothing of the file is sent to a refused client');
  const earned = await fileOf('EIGHTY_PERCENT', students.booked);
  assert.equal(earned.statusCode, 200);
  assert.equal(earned.headers['Cache-Control'], 'private, no-store', 'a paid-for file is the client\'s alone');
  assert.equal((await fileOf('SECRET', students.booked)).statusCode, 404, 'a tier that does not exist');
});

test('removing a tier\'s file deletes its row and the file', { skip }, async () => {
  const row = (await pool.query("SELECT stored_name FROM course_documents WHERE tenant_id=? AND course_id='cd-c1' AND tier='EIGHTY_PERCENT'", [T]))[0][0];
  const file = path.join(docs.courseDirectory(T, 'cd-c1'), row.stored_name);
  assert.equal(fs.existsSync(file), true);
  assert.equal(await docs.removeDocument(pool, { tenantId: T, courseId: 'cd-c1', tier: 'EIGHTY_PERCENT' }), true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(await docs.removeDocument(pool, { tenantId: T, courseId: 'cd-c1', tier: 'EIGHTY_PERCENT' }), false, 'nothing left to remove');
  assert.equal((await documentsFor(students.booked)).some(item => item.tier === 'EIGHTY_PERCENT'), false);
});

test('another tenant\'s course is not there: no list, no file', { skip }, async () => {
  const layer = router.stack.find(entry => entry.route?.path === '/api/courses/:course/documents' && entry.route.methods.get);
  const res = { statusCode: 200, body: undefined, set() { return this; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({ params: { course: 'cd-c1' }, query: {}, headers: {}, tenantId: 'another-tenant', ip: '1', get: () => undefined }, res, () => {});
  assert.equal(res.statusCode, 404);
});
