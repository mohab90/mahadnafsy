'use strict';

// 25 Oct 2026 — «الخزائن»: each box's current balance beside today's and yesterday's income, a reset to zero, a correction of a box
// and of the overall balance. And the lecturer portal's third round: the reminder an hour before a consultation, asking to move one,
// the performance numbers and the first-day checklist.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-box-balances-secret-0123456789-abcdefghijklmnopq';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
const flat = sql => String(sql).replace(/\s+/g, ' ').trim();
const boxes = require('../lib/boxBalances');

// A tiny stand-in for the three tables the balances read and write, with a clock the test moves.
function boxDb({ payments }) {
  const state = { balances: new Map(), events: [], clock: 1000 };
  const keyOf = (method, currency) => `${method}|${currency}`;
  return {
    state,
    query: async (sql, params = []) => {
      const text = flat(sql);
      if (/^SELECT method, currency, opening_amount, baseline_at FROM box_balances/.test(text)) {
        return [[...state.balances].map(([key, value]) => ({ method: key.split('|')[0], currency: key.split('|')[1], opening_amount: value.opening, baseline_at: value.baseline }))];
      }
      if (/^SELECT p\.payment_method AS method, p\.currency, SUM\(p\.amount\) AS total FROM payments p/.test(text)) {
        const since = /p\.created_at > \?/.test(text) ? params[1] : null;
        const sums = new Map();
        for (const payment of payments.filter(row => since === null || row.at > since)) {
          const key = `${payment.method}|${payment.currency}`;
          sums.set(key, (sums.get(key) || 0) + payment.amount);
        }
        return [[...sums].map(([key, total]) => ({ method: key.split('|')[0], currency: key.split('|')[1], total }))];
      }
      if (/^INSERT INTO box_balances/.test(text)) {
        const [, method, currency, opening] = params;
        const previous = state.balances.get(keyOf(method, currency));
        state.balances.set(keyOf(method, currency), { opening, baseline: /baseline_at=NOW\(\)/.test(text) || /, NOW\(\), \?\)/.test(text) ? state.clock : (previous?.baseline ?? null) });
        return [{ affectedRows: 1 }];
      }
      if (/^INSERT INTO box_balance_events/.test(text)) { state.events.push({ kind: params[4], before: params[5], after: params[6], method: params[2] }); return [{}]; }
      throw new Error(`unexpected: ${text}`);
    },
  };
}

const spend = (method, amount, at, currency = 'EGP') => ({ method, currency, amount, at });
const balanceOf = async (db, method, currency = 'EGP') => (await boxes.currentBalances(db, { tenantId: 't1' })).get(`${method}|${currency}`)?.balance;

test('a box is one box however its name was typed, and its balance counts everything until it is reset', async () => {
  const db = boxDb({ payments: [spend('فودافون كاش 7722', 500, 1), spend('فودافون كاش  7722', 250, 2), spend('فودافون كاش 7722', -100, 3), spend('كاش', 300, 4)] });
  assert.equal(await balanceOf(db, 'فودافون كاش 7722'), 650, 'two spellings, one refund netted');
  assert.equal(await balanceOf(db, 'خزنة الدقي - كاش'), 300, 'cash has its own box');
  assert.equal(boxes.totalOf(await boxes.currentBalances(db, { tenantId: 't1' }), 'EGP'), 950);
});

test('«تصفير»: the box starts again from zero and only what comes in after counts; the history says what was taken out', async () => {
  const payments = [spend('كاش', 300, 1), spend('كاش', 200, 2)];
  const db = boxDb({ payments });
  db.state.clock = 10;
  const result = await boxes.resetBox(db, { tenantId: 't1', method: 'خزنة الدقي - كاش', currency: 'EGP', note: 'سلّمنا الخزنة', actor: 'منى' });
  assert.deepEqual(result, { before: 500, after: 0 });
  assert.equal(await balanceOf(db, 'خزنة الدقي - كاش'), 0);
  payments.push(spend('كاش', 120, 11));
  assert.equal(await balanceOf(db, 'خزنة الدقي - كاش'), 120, 'a payment after the reset counts, the earlier ones do not');
  assert.deepEqual(db.state.events[0], { kind: 'reset', before: 500, after: 0, method: 'خزنة الدقي - كاش' });
  await assert.rejects(() => boxes.resetBox(db, { tenantId: 't1', method: '', currency: 'EGP' }), /اختار/);
  await assert.rejects(() => boxes.resetBox(db, { tenantId: 't1', method: 'كاش', currency: 'EUR' }), /العملة/);
});

test('«تعديل الرصيد»: the box is set to what was counted, and later payments add to it', async () => {
  const payments = [spend('انستاباي 1010', 1000, 1)];
  const db = boxDb({ payments });
  assert.equal((await boxes.setBoxBalance(db, { tenantId: 't1', method: 'انستا باي 1010', currency: 'EGP', amount: 850, note: 'جرد' })).before, 1000);
  assert.equal(await balanceOf(db, 'انستا باي 1010'), 850);
  payments.push(spend('انستاباي 1010', 50, 5));
  assert.equal(await balanceOf(db, 'انستا باي 1010'), 900);
  await assert.rejects(() => boxes.setBoxBalance(db, { tenantId: 't1', method: 'انستا باي 1010', currency: 'EGP', amount: 'abc' }), /رصيد/);
  // A negative balance is allowed to be written: a box can be overdrawn by refunds.
  await boxes.setBoxBalance(db, { tenantId: 't1', method: 'انستا باي 1010', currency: 'EGP', amount: -20 });
  assert.equal(await balanceOf(db, 'انستا باي 1010'), -20);
});

test('«تعديل الرصيد العام»: only the general adjustment moves, no box is rewritten; «تصفير الكل» zeroes every box', async () => {
  const payments = [spend('كاش', 300, 1), spend('انستاباي 1010', 700, 2)];
  const db = boxDb({ payments });
  const before = await boxes.currentBalances(db, { tenantId: 't1' });
  const result = await boxes.setTotalBalance(db, { tenantId: 't1', currency: 'EGP', amount: 5000, note: 'رصيد افتتاحي' });
  assert.deepEqual(result, { before: 1000, after: 5000 });
  const after = await boxes.currentBalances(db, { tenantId: 't1' });
  assert.equal(boxes.totalOf(after, 'EGP'), 5000);
  assert.equal(after.get('خزنة الدقي - كاش|EGP').balance, before.get('خزنة الدقي - كاش|EGP').balance, 'the cash box is as it was');
  assert.equal(after.get(`${boxes.GENERAL}|EGP`).balance, 4000, 'the difference sits in the general adjustment');
  db.state.clock = 50;
  const reset = await boxes.resetAll(db, { tenantId: 't1', currency: 'EGP', note: 'بداية شهر' });
  assert.equal(reset.before, 5000);
  assert.equal(boxes.totalOf(await boxes.currentBalances(db, { tenantId: 't1' }), 'EGP'), 0);
  assert.equal(db.state.events.at(-1).kind, 'reset_all');
});

test('the boxes report carries balance, today and yesterday; only the institute\'s books can change a balance', () => {
  const route = read('api/routes/finance/budgets.js');
  assert.match(route, /AS total_y,/);
  assert.match(route, /yesterday, yesterday, req\.tenantId/);
  assert.match(route, /if \(!scope\.branchId\) \{\s*const current = await currentBalances\(pool/, 'a branch sees no balances');
  assert.match(route, /const mainBooks = \[requireAuth, requireAdminOrStaff, requirePermission\('manage_financial'\)\];/);
  assert.match(route, /BOXES_MAIN_BOOKS_ONLY/);
  for (const action of ['reset', 'balance', 'total', 'reset-all']) assert.match(route, new RegExp(`router\\.post\\('/api/admin/finance/boxes/${action}', \\.\\.\\.mainBooks, boxChange\\(`), action);
  assert.match(route, /entityType: 'cash_box'[\s\S]{0,400}strict: true/, 'every change is audited');
  const panel = read('admin/pages/dashboard/tabs/financial/BoxesReportPanel.tsx');
  for (const text of ['الرصيد الحالي', 'دخل امبارح', 'تصفير', 'تعديل الرصيد العام', 'تصفير الكل', 'سجل تعديلات الخزائن']) assert.ok(panel.includes(text), text);
  assert.match(read('api/migrations/305_v26_box_balances.sql'), /CREATE TABLE IF NOT EXISTS box_balances[\s\S]*CREATE TABLE IF NOT EXISTS box_balance_events/);
});

// ── The consultation reminder ───────────────────────────────────────────────────────────────────────────────────────────

test('the reminder window is built on Cairo\'s wall clock, and the messages carry the hour and the link', () => {
  const reminders = require('../lib/consultationReminders');
  const now = new Date('2026-06-10T10:00:00Z'); // 13:00 in Cairo (summer)
  assert.equal(reminders.cairoWall(now, 45), '2026-06-10 13:45:00');
  assert.equal(reminders.cairoWall(now, 75), '2026-06-10 14:15:00');
  assert.equal(reminders.cairoWall(new Date('2026-06-10T20:50:00Z'), 30), '2026-06-11 00:20:00', 'across midnight');
  const messages = reminders.reminderMessages({ clientName: 'منى', therapistName: 'سارة', at: '2026-06-10 14:00:00', meetingLink: 'https://meet.example.com/x', changeLink: 'https://site/consultation-reschedule?c=1' });
  assert.match(messages.lecturer, /الساعة 2:00 م/);
  assert.match(messages.client, /د\. سارة/);
  assert.match(messages.client, /https:\/\/meet\.example\.com\/x/);
  assert.match(messages.client, /consultation-reschedule\?c=1/);
});

test('a session is reminded once per time it is at, and a moved one again for its new time', async () => {
  const outbox = require('../lib/outbox');
  const seen = new Set();
  const queued = [];
  const original = outbox.enqueue;
  outbox.enqueue = async message => { if (seen.has(message.dedupeKey)) return false; seen.add(message.dedupeKey); queued.push(message); return true; };
  try {
    const { sendDueConsultationReminders } = require('../lib/consultationReminders');
    const notices = [];
    let at = '2026-06-10 14:00:00';
    const db = {
      query: async (sql, params = []) => {
        const text = flat(sql);
        if (/^SELECT c\.id, c\.client_name/.test(text)) return [[{ id: 'c1', client_name: 'منى', client_phone: '01011112222', meeting_link: null, at, therapist_name: 'سارة', staff_id: 'st1', staff_phone: '01099998888' }]];
        if (/^INSERT INTO notifications/.test(text)) { notices.push(params); return [{}]; }
        throw new Error(`unexpected: ${text}`);
      },
    };
    const now = new Date('2026-06-10T10:00:00Z');
    assert.equal(await sendDueConsultationReminders(db, { tenantId: 't1', now }), 1);
    assert.equal(queued.length, 2, 'the lecturer and the client');
    assert.equal(notices.length, 1, 'one portal notice');
    assert.equal(await sendDueConsultationReminders(db, { tenantId: 't1', now }), 0, 'the next sweep sees the same session and sends nothing');
    assert.equal(notices.length, 1);
    at = '2026-06-10 15:00:00';
    assert.equal(await sendDueConsultationReminders(db, { tenantId: 't1', now }), 1, 'moved to 15:00 — reminded for the new time');
  } finally { outbox.enqueue = original; }
  const shared = read('api/routes/misc/_shared.js');
  assert.match(shared, /scheduleConsultationReminders\(\);/);
  assert.match(read('api/lib/consultationReminders.js'), /c\.status = 'CONFIRMED'[\s\S]{0,80}'site_express'/, 'confirmed sessions with an hour only');
});

// ── Moving a consultation ───────────────────────────────────────────────────────────────────────────────────────────────

const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function moveDb({ blocked = false, taken = false, request = null } = {}) {
  const writes = [];
  return {
    writes,
    query: async (sql, params = []) => {
      const text = flat(sql);
      if (/^SELECT c\.id, c\.tenant_id, c\.therapist_id, c\.status/.test(text)) return [[{ id: 'c1', tenant_id: 't1', therapist_id: 'th1', status: 'CONFIRMED', client_name: 'منى', client_phone: '01011112222', slot_id: 's0', at: '2026-06-01 18:00:00', therapist_name: 'سارة', staff_id: 'st1' }]];
      if (/^SELECT s\.id, s\.day, s\.start_time/.test(text)) return [[params[0] === 's1' ? { id: 's1', day: WEEK[new Date(`${moveDb.date}T12:00:00Z`).getUTCDay()], start_time: '20:00', timezone: 'Africa/Cairo', meeting_link: null } : undefined]];
      if (/^SELECT 1 AS ok FROM therapist_blocked_dates/.test(text)) return [[blocked ? { ok: 1 } : undefined]];
      if (/^SELECT 1 AS ok FROM consultations WHERE tenant_id=\? AND therapist_id=\? AND id<>\?/.test(text)) return [[taken ? { ok: 1 } : undefined]];
      if (/^SELECT \* FROM consultation_reschedules/.test(text)) return [[request]];
      if (/^(INSERT|UPDATE)/.test(text)) { writes.push({ text, params }); return [{ affectedRows: 1 }]; }
      throw new Error(`unexpected: ${text}`);
    },
  };
}

test('a proposal is checked like a booking: a lecturer\'s hour, an open day, a free hour — and nothing moves until it is accepted', async () => {
  const { addDaysToDateOnly, cairoToday } = require('../lib/dates');
  const { consultationSettings } = require('../lib/consultationRequests');
  const outbox = require('../lib/outbox');
  const sent = [];
  const original = outbox.enqueue;
  outbox.enqueue = async message => { sent.push(message); return true; };
  try {
    const { proposeReschedule } = require('../lib/consultationReschedule');
    moveDb.date = addDaysToDateOnly(cairoToday(), 4);
    const base = { tenantId: 't1', consultationId: 'c1', by: 'lecturer', date: moveDb.date, slotId: 's1', settings: consultationSettings({}) };
    const db = moveDb();
    const made = await proposeReschedule(db, { ...base, reason: 'ظرف طارئ' });
    assert.equal(made.at, `${moveDb.date} 20:00:00`);
    assert.ok(db.writes.some(w => /^INSERT INTO consultation_reschedules/.test(w.text)));
    assert.ok(!db.writes.some(w => /^UPDATE consultations SET session_date/.test(w.text)), 'the consultation has not moved');
    assert.equal(sent.length, 1);
    assert.match(sent[0].payload.message, /consultation-reschedule\?r=[^&]+&t=[0-9a-f]{32}/);
    await assert.rejects(() => proposeReschedule(moveDb(), { ...base, slotId: 'nope' }), /اختار ميعاد/);
    await assert.rejects(() => proposeReschedule(moveDb({ blocked: true }), base), /مش متاح/);
    await assert.rejects(() => proposeReschedule(moveDb({ taken: true }), base), /محجوز/);
    await assert.rejects(() => proposeReschedule(moveDb(), { ...base, date: addDaysToDateOnly(cairoToday(), -2) }), /مضى/);
  } finally { outbox.enqueue = original; }
});

test('the other side answers: accepting moves the consultation, declining leaves it, and nobody answers their own proposal', async () => {
  const outbox = require('../lib/outbox');
  const original = outbox.enqueue;
  outbox.enqueue = async () => true;
  try {
    const { decideReschedule } = require('../lib/consultationReschedule');
    const { addDaysToDateOnly, cairoToday } = require('../lib/dates');
    moveDb.date = addDaysToDateOnly(cairoToday(), 4);
    const request = { id: 'r1', tenant_id: 't1', consultation_id: 'c1', proposed_by: 'lecturer', status: 'pending', new_slot_id: 's1', new_session_at: new Date(`${moveDb.date}T20:00:00Z`) };
    const accepted = moveDb({ request });
    const result = await decideReschedule(accepted, { tenantId: 't1', id: 'r1', by: 'client', answer: 'accept' });
    assert.deepEqual([result.status, result.at], ['accepted', `${moveDb.date} 20:00:00`]);
    const move = accepted.writes.find(w => /^UPDATE consultations SET session_date=\?, slot_id=\?/.test(w.text));
    assert.deepEqual(move.params.slice(0, 2), [`${moveDb.date} 20:00:00`, 's1']);
    const declined = moveDb({ request });
    assert.equal((await decideReschedule(declined, { tenantId: 't1', id: 'r1', by: 'client', answer: 'decline', note: 'مش فاضي' })).status, 'declined');
    assert.ok(!declined.writes.some(w => /^UPDATE consultations SET session_date/.test(w.text)));
    await assert.rejects(() => decideReschedule(moveDb({ request }), { tenantId: 't1', id: 'r1', by: 'lecturer', answer: 'accept' }), /الطرف التاني/);
    await assert.rejects(() => decideReschedule(moveDb({ request: { ...request, status: 'accepted' } }), { tenantId: 't1', id: 'r1', by: 'client', answer: 'accept' }), /اتردّ/);
    await assert.rejects(() => decideReschedule(moveDb({ request }), { tenantId: 't1', id: 'r1', by: 'client', answer: 'maybe' }), /موافقة أو اعتذار/);
    // The hour was closed or taken between the proposal and the answer.
    await assert.rejects(() => decideReschedule(moveDb({ request, taken: true }), { tenantId: 't1', id: 'r1', by: 'client', answer: 'accept' }), /محجوز/);
  } finally { outbox.enqueue = original; }
});

test('the reschedule links are keyed, public routes are limited, and both sides have a screen', () => {
  const { respondToken, requestToken, validRespondToken, validRequestToken } = require('../lib/consultationReschedule');
  assert.equal(validRespondToken('r1', respondToken('r1')), true);
  assert.equal(validRespondToken('r2', respondToken('r1')), false);
  assert.equal(validRequestToken('c1', respondToken('c1')), false, 'a proposal\'s token does not open a consultation');
  assert.equal(validRequestToken('c1', requestToken('c1')), true);
  const route = read('api/routes/lecturer-portal.js');
  for (const spec of ['get', 'post']) {
    assert.match(route, new RegExp(`router\\.${spec}\\('/api/public/consultation-reschedule/respond/:id', publicLimiter,`));
    assert.match(route, new RegExp(`router\\.${spec}\\('/api/public/consultation-reschedule/request/:id', publicLimiter,`));
  }
  assert.match(route, /router\.post\('\/api\/staff\/lecturer\/consultations\/:id\/reschedule', \.\.\.guard/);
  assert.match(route, /router\.post\('\/api\/staff\/lecturer\/reschedules\/:id\/answer', \.\.\.guard/);
  assert.match(read('client/App.tsx'), /path="\/consultation-reschedule" element=\{lazyPage\(<ConsultationReschedule \/>\)\}/);
  assert.match(read('admin/pages/lecturer/LecturerConsultations.tsx'), /<PendingReschedule item=\{item\}/);
  assert.match(read('api/migrations/306_v26_consultation_reschedules.sql'), /proposed_by ENUM\('lecturer','client'\)/);
});

// ── Performance and the first-day checklist ─────────────────────────────────────────────────────────────────────────────

test('the performance numbers divide what there is and say nothing when there is nothing', async () => {
  const { performanceOf } = require('../lib/lecturerPortal');
  const db = totals => ({
    query: async sql => {
      const text = flat(sql);
      if (/FROM daqqi_attendees a JOIN daqqi_rounds r/.test(text)) return [[totals.attendance]];
      if (/COUNT\(DISTINCT p\.course_id\)/.test(text)) return [[totals.retention]];
      if (/FROM consultations WHERE tenant_id=\? AND therapist_id=\?/.test(text)) return [[totals.consultations]];
      if (/FROM live_streams l/.test(text)) return [[totals.lives]];
      throw new Error(`unexpected: ${text}`);
    },
  });
  const full = await performanceOf(db({ attendance: { attended: 45, held: 60 }, retention: { clients: 20, repeaters: 5 }, consultations: { completed: 9, cancelled: 1 }, lives: { lives: 4, attended: 130 } }), { tenantId: 't1', staffId: 'st1', therapistId: 'th1' });
  assert.deepEqual([full.attendanceRate, full.retentionRate, full.consultationCompletionRate, full.avgLiveAttendance], [75, 25, 90, 33]);
  const empty = await performanceOf(db({ attendance: { attended: 0, held: 0 }, retention: { clients: 0, repeaters: 0 }, consultations: { completed: 0, cancelled: 0 }, lives: { lives: 0, attended: 0 } }), { tenantId: 't1', staffId: 'st1' });
  assert.deepEqual([empty.attendanceRate, empty.retentionRate, empty.consultationCompletionRate, empty.avgLiveAttendance], [null, null, null, null]);
});

test('the first-day checklist asks only what applies to this lecturer', async () => {
  const { onboardingOf } = require('../lib/lecturerPortal');
  const db = counts => ({
    query: async sql => {
      const text = flat(sql);
      if (/FROM therapist_slots s/.test(text)) return [[{ n: counts.slots }]];
      if (/FROM live_streams WHERE/.test(text)) return [[{ n: counts.lives }]];
      if (/FROM community_posts WHERE/.test(text)) return [[{ n: counts.posts }]];
      throw new Error(`unexpected: ${text}`);
    },
  });
  const therapist = { id: 'th1', image: '', bio: 'نبذة', is_consultation_enabled: 1 };
  const ready = await onboardingOf(db({ slots: 0, lives: 1, posts: 0 }), { tenantId: 't1', staffId: 'st1', phone: '0100', therapist });
  assert.deepEqual(ready.steps.map(step => [step.id, step.done]), [['phone', true], ['photo', false], ['bio', true], ['hours', false], ['live', true], ['post', false]]);
  assert.deepEqual([ready.done, ready.total], [3, 6]);
  const plain = await onboardingOf(db({ slots: 0, lives: 0, posts: 0 }), { tenantId: 't1', staffId: 'st1', phone: '', therapist: null });
  assert.deepEqual(plain.steps.map(step => step.id), ['phone', 'live', 'post'], 'no consultation profile: no photo, bio or hours step');
  assert.match(read('admin/pages/lecturer/LecturerOverview.tsx'), /ابدأ من هنا/);
  assert.match(read('admin/pages/lecturer/LecturerOverview.tsx'), /مؤشرات أدائي/);
});
