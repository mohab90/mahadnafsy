'use strict';

// 25 Oct 2026 — the lecturer portal's second round: the fee a completed consultation earns, the client's own link to rate
// it, the lecturer marking their Dokki round's attendance, a payout request, the landing after sign-in, and the community
// moderation of their own posts.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-lecturer-second-round-secret-0123456789-abcdefghijk';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
const flat = sql => String(sql).replace(/\s+/g, ' ').trim();

const { recordConsultationFee } = require('../lib/instructorPay');
const rating = require('../lib/consultationRating');

// A db that knows one therapist → staff link and one rate row, and records the fee insert.
function feeDb(rate) {
  const inserted = [];
  return {
    inserted,
    query: async (sql, params = []) => {
      const text = flat(sql);
      if (/^SELECT id FROM staff WHERE id=\?/.test(text)) return [[]];
      if (/^SELECT staff_id FROM therapists WHERE id=\?/.test(text)) return [[{ staff_id: 'st1' }]];
      if (/FROM instructor_rates WHERE tenant_id=\? AND staff_id=\?/.test(text)) return [[rate]];
      if (/^INSERT IGNORE INTO instructor_fees/.test(text)) { inserted.push({ text, params }); return [{ affectedRows: 1 }]; }
      throw new Error(`unexpected: ${text}`);
    },
  };
}
const consultation = { id: 'c1', therapist_id: 'th1', client_name: 'منى', amount: 600, currency: 'EGP', session_duration_minutes: 90 };

test('a completed consultation earns the fee the lecturer\'s rate says, once', async () => {
  const session = feeDb({ consultation_rate_type: 'per_session', consultation_rate_value: '150.00', currency: 'EGP' });
  assert.deepEqual(await recordConsultationFee(session, { tenantId: 't1', consultation }), { recorded: true, amount: 150 });
  assert.ok(session.inserted[0].params.includes('consultation:c1'), 'keyed on the consultation, so a replay is one fee');
  assert.ok(session.inserted[0].params.includes('st1'));
  assert.match(session.inserted[0].text, /'consultation'/);

  const percent = feeDb({ consultation_rate_type: 'percentage', consultation_rate_value: '40.00', currency: 'EGP' });
  assert.equal((await recordConsultationFee(percent, { tenantId: 't1', consultation })).amount, 240, '40% of what the client paid');

  const hourly = feeDb({ consultation_rate_type: 'per_hour', consultation_rate_value: '200.00', currency: 'EGP' });
  assert.equal((await recordConsultationFee(hourly, { tenantId: 't1', consultation })).amount, 300, '90 minutes at 200 an hour');
});

test('no rate, no staff account or nothing paid means no fee, and never an error', async () => {
  assert.equal((await recordConsultationFee(feeDb(undefined), { tenantId: 't1', consultation })).reason, 'no_consultation_rate');
  assert.equal((await recordConsultationFee(feeDb({ consultation_rate_type: 'per_session', consultation_rate_value: '0' }), { tenantId: 't1', consultation })).recorded, false);
  const percent = feeDb({ consultation_rate_type: 'percentage', consultation_rate_value: '40' });
  assert.equal((await recordConsultationFee(percent, { tenantId: 't1', consultation: { ...consultation, amount: null } })).reason, 'no_amount');
  const orphan = { query: async () => [[]] };
  assert.equal((await recordConsultationFee(orphan, { tenantId: 't1', consultation })).reason, 'no_staff_account');
});

test('completing queues the rating link on WhatsApp, only for a COMPLETED consultation, and never throws', async () => {
  const outbox = require('../lib/outbox');
  const queued = [];
  const original = outbox.enqueue;
  outbox.enqueue = async message => { queued.push(message); return true; };
  try {
    const { onConsultationCompleted } = require('../lib/consultationCompletion');
    const db = status => ({
      query: async sql => {
        const text = flat(sql);
        if (/^SELECT c\.id, c\.status/.test(text)) return [[{ ...consultation, status, client_phone: '01011112222', therapist_name: 'سارة' }]];
        if (/^SELECT id FROM staff|^SELECT staff_id FROM therapists/.test(text)) return [[]];
        return [[]];
      },
    });
    assert.deepEqual(await onConsultationCompleted(db('PENDING'), { tenantId: 't1', consultationId: 'c1' }), { fee: false, invited: false });
    assert.equal(queued.length, 0);
    const done = await onConsultationCompleted(db('COMPLETED'), { tenantId: 't1', consultationId: 'c1' });
    assert.equal(done.invited, true);
    assert.equal(queued[0].dedupeKey, 'consultation-rating:t1:c1');
    assert.match(queued[0].payload.message, /\/consultation-rating\?id=c1&t=[0-9a-f]{32}/);
    assert.match(queued[0].payload.message, /د\. سارة/);
    const broken = { query: async () => { throw new Error('db down'); } };
    assert.deepEqual(await onConsultationCompleted(broken, { tenantId: 't1', consultationId: 'c1' }), { fee: false, invited: false });
  } finally { outbox.enqueue = original; }
});

test('the rating link names one consultation, and a consultation is rated once, 1 to 5', async () => {
  const token = rating.ratingToken('c1');
  assert.equal(rating.validRatingToken('c1', token), true);
  assert.equal(rating.validRatingToken('c2', token), false, 'another consultation\'s token is no token');
  assert.equal(rating.validRatingToken('c1', 'x'.repeat(32)), false);
  assert.equal(rating.validRatingToken('', ''), false);
  const taken = new Set();
  const db = { query: async (sql, params) => { const key = params[2]; if (taken.has(key)) return [{ affectedRows: 0 }]; taken.add(key); return [{ affectedRows: 1 }]; } };
  assert.equal(await rating.saveConsultationRating(db, { tenantId: 't1', consultation: { id: 'c1', therapist_id: 'th1' }, rating: 5, comment: ' ممتاز ' }), 5);
  await assert.rejects(() => rating.saveConsultationRating(db, { tenantId: 't1', consultation: { id: 'c1' }, rating: 4 }), /اتقيّمت/);
  for (const bad of [0, 6, 2.5, 'x', null]) await assert.rejects(() => rating.saveConsultationRating(db, { tenantId: 't1', consultation: { id: 'c9' }, rating: bad }), /1 لـ 5/);
});

test('every way a consultation is completed — the lecturer, the administration, the old screen — runs the follow-ups', () => {
  assert.match(read('api/routes/lecturer-portal.js'), /status === 'COMPLETED'\) await onConsultationCompleted/);
  assert.match(read('api/routes/core/catalog.js'), /=== 'COMPLETED'\) await onConsultationCompleted/);
  assert.match(read('api/routes/staff.js'), /=== 'COMPLETED'\) await onConsultationCompleted/);
  const route = read('api/routes/lecturer-portal.js');
  for (const method of ['get', 'post']) {
    assert.match(route, new RegExp(`router\\.${method}\\('/api/public/consultation-rating/:id', publicLimiter,`));
  }
  assert.match(read('api/migrations/304_v26_consultation_ratings.sql'), /UNIQUE KEY uq_consultation_rating \(tenant_id, consultation_id\)/);
  assert.match(read('api/schema.sql'), /CREATE TABLE `consultation_ratings`/);
  assert.match(read('client/App.tsx'), /path="\/consultation-rating" element=\{lazyPage\(<ConsultationRating \/>\)\}/);
});

test('the lecturer\'s reviews carry the consultation stars', async () => {
  const { reviewsOf } = require('../lib/lecturerPortal');
  const db = {
    query: async sql => {
      const text = flat(sql);
      if (/FROM client_ratings cr/.test(text) || /FROM course_ratings r/.test(text)) return [[]];
      if (/FROM consultation_ratings r/.test(text)) return [[
        { id: 'a', rating: 5, comment: 'مريحة', created_at: '2026-10-20', client_name: 'منى علي' },
        { id: 'b', rating: 3, comment: '', created_at: '2026-10-21', client_name: 'أحمد سمير' },
      ]];
      throw new Error(`unexpected: ${text}`);
    },
  };
  const reviews = await reviewsOf(db, { tenantId: 't1', staffId: 'st1', name: 'سارة', therapistId: 'th1' });
  assert.equal(reviews.summary.consultationStars, 4);
  assert.equal(reviews.summary.consultationRatings, 2);
  assert.deepEqual(reviews.items.map(item => item.kind), ['consultation', 'consultation']);
  assert.equal(JSON.stringify(reviews).includes('علي'), false, 'first names only');
});

test('a lecturer marks attendance only in a round that is theirs, through the same function as the desk', () => {
  const route = read('api/routes/lecturer-portal.js');
  assert.match(route, /WHERE r\.id=\? AND r\.tenant_id=\? AND r\.instructor_id=\?/);
  for (const handler of ["router.get('/api/staff/lecturer/rounds/:roundId/attendance'", "router.post('/api/staff/lecturer/rounds/:roundId/attendance'", "router.delete('/api/staff/lecturer/rounds/:roundId/attendance/:subscriberId/:sessionNumber'"]) {
    const body = route.slice(route.indexOf(handler), route.indexOf(handler) + 600);
    assert.match(body, /ownRound\(me, req\.params\.roundId\)/, handler);
  }
  assert.match(route, /markRoundAttendance\(conn, \{ tenantId: me\.tenantId, roundId: round\.id/);
  assert.match(read('api/routes/daqqi-rounds.js'), /await markRoundAttendance\(conn, \{/);
  assert.match(read('api/routes/daqqi-rounds.js'), /await unmarkRoundAttendance\(conn, \{/);
  assert.doesNotMatch(read('api/routes/daqqi-rounds.js'), /INSERT INTO daqqi_attendance_events/, 'one place writes the mark');
});

test('a payout request tells the accounts team once every three days and only when something is approved', () => {
  const route = read('api/routes/lecturer-portal.js');
  assert.match(route, /totals\.approved > 0\)\) throw bad\(/);
  assert.match(route, /created_at >= NOW\(\) - INTERVAL 3 DAY/);
  assert.match(route, /createNotification\('payroll', PAYOUT_TITLE/);
  assert.match(read('admin/pages/lecturer/LecturerEarnings.tsx'), /اطلب صرف المعتمد/);
  assert.match(read('admin/pages/lecturer/LecturerEarnings.tsx'), /طباعة كشف الحساب/);
});

test('a lecturer lands on the portal after signing in, and the two role lists agree', () => {
  assert.match(read('admin/pages/Auth.tsx'), /LECTURER_ROLES\.includes\(String\(r\.role \|\| ''\)\.toLowerCase\(\)\) \? '\/lecturer-portal' : '\/dashboard'/);
  const api = read('api/lib/lecturerPortal.js').match(/LECTURER_ROLES = Object\.freeze\(\[([^\]]*)\]/)[1].replace(/['\s]/g, '');
  const admin = read('admin/constants/permissions.ts').match(/LECTURER_ROLES: readonly string\[\] = \[([^\]]*)\]/)[1].replace(/['\s]/g, '');
  assert.equal(admin, api);
});

test('a lecturer takes down comments on their own posts and their own comments, nothing else', () => {
  const route = read('api/routes/lecturer-portal.js');
  assert.match(route, /WHERE c\.tenant_id=\? AND c\.id=\? AND \(c\.subscriber_id=\? OR p\.staff_id=\?\)/);
  assert.match(route, /router\.post\('\/api\/staff\/lecturer\/media\/image', \.\.\.guard/);
  assert.match(route, /me\.therapist\?\.image \|\| null/, 'their posts carry their own photo');
});
