'use strict';

// «كارت خطوتك الجاية» (11 Oct 2026): the portal's first card names the next
// session of the client's Dokki or Tagamoa round — its lecture, day, period and
// room — what they still owe for it, and the certificates they earned. Only
// their own, in their own institute.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-next-step-secret-0123456789-abcdefghijklmnop';

const { nextHeldSession, weekMonday } = require('../lib/daqqiLecture');

const seen = [];
let housed = [];
const query = async (sql, params = []) => {
  const flat = String(sql).replace(/\s+/g, ' ');
  seen.push({ sql: flat, params });
  if (/FROM subscribers s WHERE s\.tenant_id=\? AND s\.firebase_uid=\?/.test(flat)) return [[{ id: 's-1' }]];
  if (/FROM course_completions cc/.test(flat)) {
    return [[{ course_id: 'c-1', certificate_code: 'CERT-1', completed_at: new Date('2026-09-30T10:00:00Z'), course_title: 'الإرشاد' }]];
  }
  if (/FROM daqqi_attendees da JOIN daqqi_rounds r/.test(flat)) return [housed];
  // getDaqqiAttendees: the round's whole roster — the route keeps only the caller.
  if (/SELECT da\.round_id, da\.subscriber_id/.test(flat)) {
    return [[
      { round_id: 'r-1', subscriber_id: 's-1', course_id: 'c-2', amount_paid: 500, unlinked_amount: 0 },
      { round_id: 'r-1', subscriber_id: 's-other', course_id: 'c-2', amount_paid: 0, unlinked_amount: 0 },
    ]];
  }
  if (/FROM courses WHERE tenant_id=\? AND id IN/.test(flat)) return [[{ id: 'c-2', price_egp: 2000 }]];
  return [[]];
};
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query, execute: query }, cached: async (_k, _t, fn) => fn(), cacheInvalidate() {},
  requireDb: (_q, _s, n) => n(), isDbDown: () => false,
});

const router = require('../routes/me-next-step');

async function call() {
  seen.length = 0;
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const layer = router.stack.find(l => l.route && l.route.path === '/api/me/next-step');
  await layer.route.stack.slice(-1)[0].handle({ tenantId: 'tenant-a', user: { uid: 'u-1' }, headers: {} }, res);
  return res;
}

test('the next session is the next weekly one, stepping over a postponed week', () => {
  // Saturdays from 5 Sep: 10 Oct was lecture 6, so 17 Oct is 7.
  assert.deepEqual(nextHeldSession('2026-09-05', [], '2026-10-11'), { date: '2026-10-17', lecture: 7 });
  // The week of 12 Oct postponed: the next session is a week later and still lecture 7.
  assert.deepEqual(nextHeldSession('2026-09-05', ['2026-10-12'], '2026-10-11'), { date: '2026-10-24', lecture: 7 });
  // A round that has not begun meets first on its start date.
  assert.deepEqual(nextHeldSession('2026-10-20', [], '2026-10-11'), { date: '2026-10-20', lecture: 1 });
  // A session today is the next one.
  assert.equal(nextHeldSession('2026-09-05', [], '2026-10-10').date, '2026-10-10');
  assert.equal(weekMonday('2026-10-17'), '2026-10-12');
});

test('a housed client gets their round\'s next session, what they owe for it and their certificates', async () => {
  housed = [
    { id: 'r-1', code: '3018', branch: 'TAGAMOA', course_id: 'c-2', course_title: 'العلاج الأسري', instructor_name: 'د. منى',
      day_of_week: 'السبت', start_date: new Date('2026-09-05T00:00:00Z'), time_slot: 'EVENING', room: '2', postponed_weeks_json: '[]' },
    { id: 'r-0', code: '2990', branch: 'DAQQI', course_id: 'c-9', course_title: 'قديم', start_date: new Date('2027-01-02T00:00:00Z'),
      time_slot: 'MORNING', room: '', postponed_weeks_json: null },
  ];
  const res = await call();
  assert.equal(res.statusCode, 200);
  const { session, rounds, certificates } = res.body;
  assert.equal(session.roundId, 'r-1', 'the earliest of the open rounds');
  assert.equal(session.branchLabel, 'التجمع');
  assert.equal(session.timeSlot, 'مساءً');
  assert.equal(session.room, '2');
  assert.match(session.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(session.lecture >= 1);
  assert.equal(rounds.length, 1, 'only the caller\'s row of the roster');
  assert.deepEqual(
    { item: rounds[0].item, price: rounds[0].price, paid: rounds[0].paid, remaining: rounds[0].remaining, currency: rounds[0].currency },
    { item: 'c-2', price: 2000, paid: 500, remaining: 1500, currency: 'EGP' });
  assert.deepEqual(certificates, [{ courseId: 'c-1', courseTitle: 'الإرشاد', code: 'CERT-1', completedAt: '2026-09-30' }]);
});

test('every read is the caller\'s own, in their own institute', async () => {
  await call();
  const reads = seen.filter(entry => /FROM course_completions|JOIN daqqi_rounds r ON r\.id = da\.round_id/.test(entry.sql));
  assert.equal(reads.length, 2);
  for (const entry of reads) {
    assert.ok(entry.params.includes('tenant-a') && entry.params.includes('s-1'), entry.sql);
  }
  assert.match(fs.readFileSync(path.join(__dirname, '../routes/me-next-step.js'), 'utf8'),
    /router\.get\('\/api\/me\/next-step', requireAuth,/);
});

test('a client in no round still gets their certificates, and nothing else', async () => {
  housed = [];
  const res = await call();
  assert.equal(res.body.session, null);
  assert.deepEqual(res.body.rounds, []);
  assert.equal(res.body.certificates.length, 1);
});

test('the card sits at the top of the portal, in its own file, and pays through the existing flow', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../client/pages/UserDashboard.tsx'), 'utf8');
  const overview = page.slice(page.indexOf("activeTab === 'overview'"));
  assert.ok(overview.indexOf('<StudentNextStepCard') < overview.indexOf('Welcome + summary cards'));
  assert.match(overview, /onPay=\{setInstallModal\}/);
  const card = fs.readFileSync(path.join(__dirname, '../../client/components/student-dashboard/StudentNextStepCard.tsx'), 'utf8');
  assert.match(card, /ادفع الباقي/);
  assert.match(card, /كمّل/);
  assert.match(card, /mysqlClient\.getMyNextStep\(\)/);
});
