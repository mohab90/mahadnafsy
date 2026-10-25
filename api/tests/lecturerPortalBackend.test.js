'use strict';

// 25 Oct 2026 — «حساب محاضر»: the lecturer's own portal — weekly hours that repeat with days they can close, the
// consultation notice in the portal and on WhatsApp, and every read scoped to the lecturer's own staff id.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-lecturer-portal-secret-0123456789-abcdefghijklmn';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
const availability = require('../lib/therapistAvailability');
const { consultationNotice } = require('../lib/lecturerNotices');

const flat = sql => String(sql).replace(/\s+/g, ' ').trim();

test('weekly hours are checked: a weekday, an hour that ends after it starts, nothing overlapping', () => {
  const clean = availability.normalizeSlots([
    { day: 'Monday', startTime: '18:00', endTime: '19:00' },
    { day: 'saturday', startTime: '10:00', endTime: '11:30', meetingLink: 'https://meet.example.com/x' },
    { day: 'monday', startTime: '09:00', endTime: '10:00' },
  ]);
  assert.deepEqual(clean.map(slot => `${slot.day} ${slot.startTime}`), ['saturday 10:00', 'monday 09:00', 'monday 18:00'], 'in week order');
  for (const bad of [
    [{ day: 'someday', startTime: '10:00', endTime: '11:00' }],
    [{ day: 'monday', startTime: '25:00', endTime: '26:00' }],
    [{ day: 'monday', startTime: '11:00', endTime: '10:00' }],
    [{ day: 'monday', startTime: '10:00', endTime: '12:00' }, { day: 'monday', startTime: '11:00', endTime: '13:00' }],
    [{ day: 'monday', startTime: '10:00', endTime: '11:00', meetingLink: 'javascript:alert(1)' }],
    'monday',
  ]) assert.throws(() => availability.normalizeSlots(bad), /./, JSON.stringify(bad));
  assert.throws(() => availability.normalizeSlots(Array.from({ length: 61 }, () => ({ day: 'monday', startTime: '10:00', endTime: '11:00' }))), /60/);
});

test('saving the weekly hours keeps the id of an hour that stays, adds new ones and switches the rest off', async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql: flat(sql), params });
      if (/^SELECT s\.id FROM therapist_slots/.test(flat(sql))) return [[{ id: 'keep-1' }, { id: 'drop-1' }]];
      return [{ affectedRows: 1 }];
    },
  };
  await availability.replaceWeeklySlots(db, {
    tenantId: 't1', therapistId: 'th1',
    slots: availability.normalizeSlots([{ id: 'keep-1', day: 'monday', startTime: '18:00', endTime: '19:00' }, { day: 'tuesday', startTime: '10:00', endTime: '11:00' }]),
  });
  assert.ok(calls.some(call => /^UPDATE therapist_slots s JOIN therapists t/.test(call.sql) && call.params.includes('keep-1')), 'kept in place');
  assert.ok(calls.some(call => /^INSERT INTO therapist_slots/.test(call.sql) && call.params.includes('tuesday')), 'added');
  const off = calls.find(call => /SET s\.is_active=0/.test(call.sql));
  assert.ok(off && off.params.includes('drop-1') && !off.params.includes('keep-1'), 'switched off, never deleted');
  assert.ok(!calls.some(call => /^DELETE/.test(call.sql)), 'no slot is deleted');
  assert.ok(calls.filter(call => !/^INSERT/.test(call.sql)).every(call => /tenant_id/.test(call.sql)),
    'every read and update names the tenant (a new slot belongs to a therapist the caller owns)');
});

test('a day can be closed from today on, once, and the bookings already on it are counted not cancelled', async () => {
  const { cairoToday, addDaysToDateOnly } = require('../lib/dates');
  const today = cairoToday();
  const writes = [];
  const db = {
    query: async (sql, params = []) => {
      const text = flat(sql);
      writes.push({ text, params });
      if (/COUNT\(\*\) AS n FROM therapist_blocked_dates/.test(text)) return [[{ n: 3 }]];
      if (/COUNT\(\*\) AS n FROM consultations/.test(text)) return [[{ n: 2 }]];
      return [{ affectedRows: 1 }];
    },
  };
  const result = await availability.blockDay(db, { tenantId: 't1', therapistId: 'th1', date: addDaysToDateOnly(today, 5), reason: ' سفر ', actor: 'st1' });
  assert.equal(result.alreadyBooked, 2);
  assert.ok(writes.some(w => /ON DUPLICATE KEY UPDATE reason/.test(w.text)), 'closing a closed day is not an error');
  assert.ok(!writes.some(w => /UPDATE consultations|DELETE/.test(w.text)), 'no booking is touched');
  await assert.rejects(() => availability.blockDay(db, { tenantId: 't1', therapistId: 'th1', date: addDaysToDateOnly(today, -1) }), /عدّى/);
  await assert.rejects(() => availability.blockDay(db, { tenantId: 't1', therapistId: 'th1', date: 'tomorrow' }), /التاريخ/);
  const blocked = { query: async () => [[{ ok: 1 }]] };
  assert.equal(await availability.isDayBlocked(blocked, { tenantId: 't1', therapistId: 'th1', date: addDaysToDateOnly(today, 5) }), true);
  assert.equal(await availability.isDayBlocked(blocked, { tenantId: 't1', therapistId: null, date: today }), false);
});

test('a booking on a closed day is refused and the booking page greys it out', () => {
  assert.match(read('api/routes/lead-capture-crm.js'), /isDayBlocked\(conn, \{ tenantId, therapistId, date: sessionDate \}\)[\s\S]{0,120}THERAPIST_DAY_BLOCKED/);
  assert.match(read('api/routes/public.js'), /blockedDatesByTherapist\(pool, \{ tenantId: req\.tenantId, therapistIds: ids \}\)/);
  assert.match(read('api/lib/mappers.js'), /blockedDates: r\.blocked_dates \|\| \[\]/);
  for (const file of ['client/lib/consultations.ts', 'admin/lib/consultations.ts']) {
    assert.match(read(file), /blockedDates\?\.includes\(dateValue\)\) return \[\]/, file);
  }
});

test('the lecturer\'s notice says urgent or scheduled, with the hour', () => {
  const urgent = consultationNotice({ clientName: 'منى', source: 'site_express', sessionAt: '2026-10-25 12:00:00', sessionType: 'INDIVIDUAL' });
  assert.match(urgent.title, /عاجلة/);
  assert.match(urgent.whatsapp, /60 دقيقة/);
  const scheduled = consultationNotice({ clientName: 'منى', source: 'site_regular', sessionAt: '2026-11-02 18:30:00', sessionType: 'COUPLE' });
  assert.match(scheduled.message, /2026-11-02 18:30/);
  assert.match(scheduled.message, /زوجية/);
  assert.doesNotMatch(scheduled.whatsapp, /عاجلة/);
});

test('a new consultation tells the lecturer in the portal and on WhatsApp, once', async () => {
  const outbox = require('../lib/outbox');
  const queued = [];
  const original = outbox.enqueue;
  outbox.enqueue = async (message) => { queued.push(message); return true; };
  try {
    const { tellLecturerOfConsultation } = require('../lib/lecturerNotices');
    const inserted = [];
    const db = {
      query: async (sql, params = []) => {
        const text = flat(sql);
        if (/^SELECT s\.id, s\.name, s\.phone FROM therapists t JOIN staff s/.test(text)) return [[{ id: 'st1', name: 'سارة', phone: '01012345678' }]];
        if (/^INSERT INTO notifications/.test(text)) { inserted.push(params); return [{}]; }
        throw new Error(`unexpected: ${text}`);
      },
    };
    const told = await tellLecturerOfConsultation(db, {
      tenantId: 't1', consultationId: 'c1', therapistId: 'th1', clientName: 'منى', source: 'site_express', sessionAt: '2026-10-25 12:00:00', sessionType: 'INDIVIDUAL',
    });
    assert.deepEqual(told, { notified: true, whatsapp: true });
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0][1], 't1');
    assert.equal(inserted[0][2], 'st1', 'to the lecturer\'s staff id');
    assert.equal(queued.length, 1);
    assert.equal(queued[0].channel, 'whatsapp');
    assert.equal(queued[0].dedupeKey, 'consultation-lecturer:t1:c1');
    assert.match(queued[0].payload.message, /سارة/);
    // Not linked to a staff account: nobody to tell, and no error.
    const nobody = { query: async () => [[undefined]] };
    assert.deepEqual(await tellLecturerOfConsultation(nobody, { tenantId: 't1', consultationId: 'c2', therapistId: 'th9' }), { notified: false, whatsapp: false });
  } finally { outbox.enqueue = original; }
  assert.match(read('api/lib/consultationRequests.js'), /await tellLecturerOfConsultation\(db, \{/);
});

test('only a lecturer\'s account passes, and the context carries their own staff id', async () => {
  const { lecturerContext, requireLecturer } = require('../lib/lecturerPortal');
  const db = role => ({ query: async () => [[role === 'with-profile' ? { id: 'th1', is_consultation_enabled: 1 } : undefined]] });
  const req = role => ({ tenantId: 't1', staffRecord: { id: 'st1', name: 'سارة', role, phone: '0100' } });
  assert.equal((await lecturerContext(db(), req('instructor'))).staffId, 'st1');
  assert.equal((await lecturerContext(db(), req('consultant'))).role, 'consultant');
  assert.equal(await lecturerContext(db(), req('sales')), null, 'a sales account is not a lecturer');
  assert.equal((await lecturerContext(db('with-profile'), req('sales'))).therapist.id, 'th1', 'unless a consultation profile is linked to it');
  assert.equal(await lecturerContext(db(), { tenantId: 't1' }), null);
  const refused = { status: null, body: null };
  const res = { status(code) { refused.status = code; return this; }, json(body) { refused.body = body; return this; } };
  let passed = false;
  await requireLecturer(db())({ ...req('sales') }, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, 'LECTURER_ONLY');
  const ok = { ...req('trainer') };
  await requireLecturer(db())(ok, res, () => { passed = true; });
  assert.ok(passed && ok.lecturer.staffId === 'st1');
});

test('ratings average the marks, show first names only, and money adds up by status', async () => {
  const { reviewsOf, earningsOf } = require('../lib/lecturerPortal');
  const db = {
    query: async (sql) => {
      const text = flat(sql);
      if (/FROM client_ratings cr/.test(text)) return [[
        { id: 'a', instructor_score: 8, material_score: 7, delivery_score: 9, note: 'ممتاز', created_at: '2026-10-02', course_title: 'CBT', client_name: 'منى علي حسن' },
        { id: 'b', instructor_score: 10, material_score: 9, delivery_score: 9, note: '', created_at: '2026-10-03', course_title: 'CBT', client_name: 'أحمد سمير' },
      ]];
      if (/FROM course_ratings r/.test(text)) return [[{ id: 'c', rating: 5, comment: 'شرح رائع', created_at: '2026-10-05', course_title: 'CBT', client_name: 'سارة محمود' }]];
      if (/FROM instructor_fees f/.test(text)) return [[
        { id: 'f1', fee_type: 'lecture', total_amount: '500.00', currency: 'EGP', status: 'pending', period_month: 10, period_year: 2026, course_title: 'CBT' },
        { id: 'f2', fee_type: 'retention', total_amount: '120.50', currency: 'EGP', status: 'approved', period_month: 10, period_year: 2026, course_title: 'CBT' },
        { id: 'f3', fee_type: 'lecture', total_amount: '700.00', currency: 'EGP', status: 'paid', period_month: 9, period_year: 2026, course_title: 'CBT' },
        { id: 'f4', fee_type: 'lecture', total_amount: '999.00', currency: 'EGP', status: 'rejected', period_month: 9, period_year: 2026, course_title: 'CBT' },
      ]];
      if (/FROM payroll_items pi/.test(text)) return [[{ month: 9, year: 2026, status: 'PAID', net_salary: '700.00', commission: '0', bonus: '0' }]];
      throw new Error(`unexpected: ${text}`);
    },
  };
  const reviews = await reviewsOf(db, { tenantId: 't1', staffId: 'st1', name: 'سارة' });
  assert.equal(reviews.summary.instructorScore, 9);
  assert.equal(reviews.summary.courseStars, 5);
  assert.equal(reviews.summary.roundRatings, 2);
  assert.deepEqual(reviews.items.map(item => item.client).sort(), ['أحمد', 'سارة', 'منى'], 'first names only');
  assert.equal(JSON.stringify(reviews).includes('حسن'), false, 'no surname leaves the server');
  const earnings = await earningsOf(db, { tenantId: 't1', staffId: 'st1' });
  assert.deepEqual(earnings.totals, { waiting: 500, approved: 120.5, paid: 700, retention: 120.5 });
  assert.equal(earnings.byType.find(row => row.type === 'lecture').total, 1200, 'a rejected fee is not counted');
  assert.equal(earnings.byType.find(row => row.type === 'retention').label, 'مكافأة تدوير عميل');
  assert.equal(earnings.payslips[0].net, 700);
});

test('every query of the portal names the tenant and keys on the lecturer\'s own id', () => {
  const route = read('api/routes/lecturer-portal.js');
  const lib = read('api/lib/lecturerPortal.js');
  const queries = [...(route + lib).matchAll(/\.query\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g)].map(match => match[1]);
  assert.ok(queries.length > 30, `found ${queries.length} queries`);
  // Statements on tables that carry a tenant must name it; the few that only join a tenant-scoped parent say so.
  const unscoped = queries.filter(q => /FROM (live_streams|consultations|notifications|community_posts|courses|enrollments|instructor_fees|daqqi_rounds|client_ratings|payroll_items)\b|UPDATE (live_streams|consultations|notifications|community_posts|therapists)\b|DELETE FROM (live_streams|community_posts)\b/.test(q) && !/tenant_id/.test(q));
  assert.deepEqual(unscoped, []);
  assert.doesNotMatch(route, /req\.(query|body|params)\.(staffId|instructorId|therapistId)/, 'the lecturer is never named by the caller');
  assert.match(route, /const guard = \[requireAuth, requireAdminOrStaff, requireLecturer\(pool\)\];/);
  assert.match(read('api/lib/registerRoutes.js'), /'\.\.\/routes\/lecturer-portal'/);
});

test('hours can be set only while consultations are on for the lecturer', () => {
  const route = read('api/routes/lecturer-portal.js');
  assert.match(route, /CONSULTATIONS_DISABLED/);
  for (const handler of ["'/api/lecturer/availability/slots'", "'/api/lecturer/availability/blocked'", "'/api/lecturer/availability/blocked/:id'"]) {
    const body = route.slice(route.indexOf(handler), route.indexOf(handler) + 700);
    assert.match(body, /enabledTherapist\(me\)/, handler);
  }
});
