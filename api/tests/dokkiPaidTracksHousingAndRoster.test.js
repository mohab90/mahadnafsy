'use strict';
const { financeRouteSource } = require('./_authRouteSource');

/**
 * Reported from the Dokki desk on 3 Oct 2026:
 *
 *  - «في عملاء بتظهر دافعه 0 وهيا دافعه فلوس … وفي الكورس نفسه قاري 0». A client who
 *    holds every course of a track holds the track: their money moved onto it
 *    (priorPaid['bundle:<id>']) and the roster only looked under the course's own
 *    key. And the round's own «المحصّل» left out everything paid before the system.
 *  - «تسكين»: the button was an emoji, the list named the reception, and a booking
 *    («حجز ودفع») could not seat a client at all.
 *  - The attendees list: the number under the name, a «التواصل» column, and the
 *    actions in the order the desk asked for.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function load(entry) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
const utils = load('admin/pages/dashboard/tabs/daqqi/daqqiScheduleUtils.ts');

const { resolveAttendeeMoney, attachAttendeeMoney } = require('../lib/daqqiAttendeeMoney');

const TRACK = { id: 'bT', title: 'دبلومة', price: 2000, courseCount: 3 };

// ── what a client has paid and owes toward the round ─────────────────────────

test('money paid before the system under the TRACK\'s key is read for every course in the track', () => {
  const money = resolveAttendeeMoney({
    courseId: 'cA', crm: { priorPaid: { 'bundle:bT': 3000 }, customPrices: { 'bundle:bT': 3500 } },
    enrolledBundles: new Set(['bT']), tracks: [TRACK], coursePrice: 900,
  });
  assert.equal(money.priorPaid, 3000, 'it read 0 under the course key');
  assert.equal(money.trackId, 'bT');
  assert.equal(money.trackTitle, 'دبلومة');
  assert.equal(money.agreedPrice, 3500, 'the track\'s agreed price, not the one course\'s');
});

test('a client with only the course key still reads it, and owes the catalogue price', () => {
  const money = resolveAttendeeMoney({ courseId: 'cA', crm: { priorPaid: { cA: 1500 } }, tracks: [TRACK], coursePrice: 900 });
  assert.equal(money.priorPaid, 1500);
  assert.equal(money.trackId, null, 'a track the client has nothing in is not theirs');
  assert.equal(money.agreedPrice, 900);
});

test('a track is the client\'s when a payment, a saved price or an enrolment names it — and not before', () => {
  const base = { courseId: 'cA', tracks: [TRACK], coursePrice: 900 };
  assert.equal(resolveAttendeeMoney({ ...base, payments: [{ bundleId: 'bT', courseId: 'cA', status: 'paid', paymentType: 'COURSE', amount: 1200 }] }).trackId, 'bT');
  assert.equal(resolveAttendeeMoney({ ...base, crm: { customPrices: { 'bundle:bT': 2500 } } }).trackId, 'bT');
  assert.equal(resolveAttendeeMoney({ ...base, enrolledBundles: new Set(['bT']) }).trackId, 'bT');
  assert.equal(resolveAttendeeMoney({ ...base }).trackId, null);
});

test('the biggest track wins, as the clients screen names it', () => {
  const small = { id: 'bS', title: 'صغير', price: 1000, courseCount: 2 };
  const money = resolveAttendeeMoney({
    courseId: 'cA', tracks: [small, TRACK], coursePrice: 900,
    crm: { priorPaid: { 'bundle:bS': 100, 'bundle:bT': 200 } },
  });
  assert.equal(money.trackId, 'bT');
});

test('the price never falls below what was paid for it, and a booking\'s price beats the catalogue', () => {
  const paid = { courseId: 'cA', coursePrice: 900, tracks: [], payments: [{ courseId: 'cA', status: 'paid', paymentType: 'COURSE', amount: 1000, courseExpected: 900 }] };
  assert.equal(resolveAttendeeMoney(paid).agreedPrice, 1000);
  const booked = { courseId: 'cA', coursePrice: 900, tracks: [], payments: [{ courseId: 'cA', status: 'pending', paymentType: 'COURSE', amount: 100, courseExpected: 750 }] };
  assert.equal(resolveAttendeeMoney(booked).agreedPrice, 750);
  const custom = { courseId: 'cA', coursePrice: 900, tracks: [], crm: { customPrices: { cA: 700 } } };
  assert.equal(resolveAttendeeMoney(custom).agreedPrice, 700);
});

test('collected money naming no course belongs to the round only when it is the client\'s only course', () => {
  const only = { courseId: 'cA', coursePrice: 900, tracks: [TRACK], unlinked: 600, otherCourses: new Set(['cA']) };
  assert.equal(resolveAttendeeMoney(only).unlinkedApplied, 600);
  const several = { ...only, otherCourses: new Set(['cA', 'cB']) };
  assert.equal(resolveAttendeeMoney(several).unlinkedApplied, 0, 'which of the two it was for is a guess');
  const track = { ...only, anyTrack: true };
  assert.equal(resolveAttendeeMoney(track).unlinkedApplied, 0, 'a client with a track could have meant any of its courses');
});

test('the roster reads the whole list in a handful of queries, and says what each client holds', async () => {
  const calls = [];
  const db = {
    async query(sql) {
      calls.push(sql.replace(/\s+/g, ' ').trim().slice(0, 60));
      if (/FROM subscribers s WHERE/.test(sql)) {
        return [[
          { id: 's1', prior_paid: '{"bundle:bT":3000}', custom_prices: '{"bundle:bT":3500}' },
          { id: 's2', prior_paid: { cA: 1500 }, custom_prices: null },
          { id: 's3', prior_paid: null, custom_prices: null },
        ]];
      }
      if (/FROM payments/.test(sql)) return [[]];
      if (/FROM enrollments/.test(sql)) return [[{ subscriber_id: 's1', course_id: null, bundle_id: 'bT' }]];
      if (/FROM daqqi_attendees da/.test(sql)) return [[]];
      if (/FROM bundles b/.test(sql)) return [[
        { id: 'bT', title: 'دبلومة', price_egp: '2000', course_id: 'cA' },
        { id: 'bT', title: 'دبلومة', price_egp: '2000', course_id: 'cB' },
      ]];
      if (/FROM courses/.test(sql)) return [[{ id: 'cA', price_egp: '900' }]];
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const rows = [
    { subscriber_id: 's1', course_id: 'cA', unlinked_amount: 0 },
    { subscriber_id: 's2', course_id: 'cA', unlinked_amount: 0 },
    { subscriber_id: 's3', course_id: 'cA', unlinked_amount: 250 },
  ];
  const out = await attachAttendeeMoney(db, 'tenant-default', rows);
  assert.equal(calls.length, 6, 'one query each, not one per client');
  assert.deepEqual(out.map(row => [row.prior_paid, row.agreed_price, row.track_title]), [
    [3000, 3500, 'دبلومة'], [1500, 900, null], [0, 900, null],
  ]);
  assert.equal(out[2].unlinked_applied, 250, 'the client\'s only course');
  assert.deepEqual(await attachAttendeeMoney(db, 'tenant-default', []), []);
});

test('the roster route reads the money in bulk and sends the new fields', () => {
  const route = read('api/routes/daqqi-rounds.js');
  assert.match(route, /await attachAttendeeMoney\(pool, req\.tenantId,\s*await getDaqqiAttendees\(pool, req\.tenantId, rounds\.map\(round => round\.id\)\)\)/);
  for (const field of ['agreedPrice: a.agreed_price == null ? null : Number(a.agreed_price)', 'trackId: a.track_id || null', 'trackTitle: a.track_title || null', 'amountUnlinkedApplied: Number(a.unlinked_applied || 0)']) {
    assert.ok(route.includes(field), field);
  }
  // Revenue reads amountPaid, which is still the payments for the round's course alone.
  assert.match(route, /amountPaid: Number\(a\.amount_paid \|\| 0\),/);
  assert.match(read('api/lib/daqqiAttendees.js'), /SELECT da\.round_id, da\.subscriber_id, dr\.course_id,/);
});

// ── the figures on the screen ────────────────────────────────────────────────

const seat = (subscriberId, extra = {}) => ({ subscriberId, name: subscriberId, phone: '', bookedAt: '2026-09-21', amountPaid: 0, ...extra });

test('a client\'s paid is the payments plus what came before the system, against the price they agreed', { skip: !utils }, () => {
  const money = utils.attendeeMoney(seat('a', { amountPaid: 500, amountPrior: 1000, amountUnlinkedApplied: 100, agreedPrice: 2000 }), 900);
  assert.deepEqual(money, { collected: 500, prior: 1000, applied: 100, paid: 1600, price: 2000, remaining: 400 });
  const catalogue = utils.attendeeMoney(seat('b', { amountPaid: 900 }), 900);
  assert.equal(catalogue.price, 900);
  assert.equal(catalogue.remaining, 0);
  assert.equal(utils.attendeeMoney(seat('c'), 0).remaining, 0, 'no price anywhere is not a debt');
});

test('«في الكورس نفسه قاري 0»: the round\'s paid is its clients\' paid, prior money included', { skip: !utils }, () => {
  const round = { attendees: [seat('a', { amountPrior: 1500 }), seat('b', { amountPaid: 900 }), seat('c', { amountPrior: 4000, agreedPrice: 3500 })] };
  const money = utils.roundMoney(round, 900);
  assert.equal(money.paid, 1500 + 900 + 4000);
  assert.equal(money.prior, 5500);
  // Client by client: c overpaid by 500 and that does not cancel a's balance of 0 or anyone else's.
  assert.equal(money.remaining, 0 + 0 + 0);
  const owing = utils.roundMoney({ attendees: [seat('a', { amountPrior: 200 }), seat('c', { amountPrior: 4000, agreedPrice: 3500 })] }, 900);
  assert.equal(owing.remaining, 700, 'a still owes 700; c\'s extra 500 is not set against it');
});

test('a track holder sitting in three of its rounds is counted once in the strip', { skip: !utils }, () => {
  const holder = { amountPaid: 0, amountPrior: 3000, agreedPrice: 3500, trackId: 'bT' };
  const rounds = ['cA', 'cB', 'cC'].map(courseId => ({ courseId, status: 'active', attendees: [seat('holder', holder)], postponedWeeks: [], heldWeeks: [] }));
  const overview = utils.daqqiOverview({ rounds, clients: [{ id: 'holder', enrolledCourseIds: ['bundle:bT'] }], bundles: [], weekKey: '2026-09-28', priceOf: () => 900 });
  assert.equal(overview.prior, 3000, 'not 9,000');
  assert.equal(overview.remaining, 500, 'not 1,500');
});

test('seating: already there, a move within the same course, or an addition', { skip: !utils }, () => {
  const round = (id, courseId, status, ids) => ({ id, courseId, status, attendees: ids.map(subscriberId => seat(subscriberId)) });
  const rounds = [round('r1', 'cA', 'active', ['x']), round('r2', 'cA', 'new', []), round('r3', 'cB', 'new', []), round('r4', 'cA', 'finished', ['y'])];
  assert.deepEqual(utils.housingDecision(rounds, 'x', rounds[0]), { kind: 'already' });
  const move = utils.housingDecision(rounds, 'x', rounds[1]);
  assert.equal(move.kind, 'move');
  assert.equal(move.from.id, 'r1');
  assert.deepEqual(utils.housingDecision(rounds, 'x', rounds[2]), { kind: 'add' }, 'a second course is added, not moved');
  assert.deepEqual(utils.housingDecision(rounds, 'y', rounds[1]), { kind: 'add' }, 'a finished round is history, not a seat to move from');
});

test('the picker lists the client\'s own courses first, open rounds before finished', { skip: !utils }, () => {
  const rounds = [
    { id: 'a', code: '3001', courseId: 'cB', status: 'new', startDate: '2026-10-01' },
    { id: 'b', code: '3002', courseId: 'cA', status: 'finished', startDate: '2026-01-01' },
    { id: 'c', code: '3003', courseId: 'cA', status: 'new', startDate: '2026-11-01' },
    { id: 'd', code: '3004', courseId: 'cA', status: 'active', startDate: '2026-10-05' },
  ];
  assert.deepEqual(utils.orderRoundsForClient(rounds, ['cA']).map(round => round.id), ['d', 'c', 'b', 'a']);
  assert.equal(utils.roundLabel({ code: '3003', courseId: 'cA', instructorName: 'د. أحمد', dayOfWeek: 'الأحد', timeSlot: 'مساءً' }, [{ id: 'cA', title: 'Course A', titleAr: 'علاج' }]), '3003 — علاج — د. أحمد — الأحد مساءً');
  assert.deepEqual(utils.courseIdsHeldIn(rounds, [{ id: 'bT', courses: [{ id: 'cB' }] }], ['bundle:bT']), ['cB']);
});

test('the latest contact is the one from the list or from what was logged since', { skip: !utils }, () => {
  const sub = { communications: [{ id: '1', type: 'call', date: '2026-10-01', notes: 'قديم' }] };
  assert.equal(utils.lastContactOf(sub, [{ id: '2', type: 'call', date: '2026-10-03', notes: 'جديد' }]).notes, 'جديد');
  assert.equal(utils.lastContactOf(sub).notes, 'قديم');
  assert.equal(utils.lastContactOf(undefined), null);
});

// ── «تسكين»: the button, the list, the booking ───────────────────────────────

test('«تسكين» on «عملاء الدقي» is an icon like the others, and the list names the doctor', () => {
  const table = read('admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx');
  assert.doesNotMatch(table, /<button title=\{rowHousing[^>]*>\s*🏠/, 'the button was an emoji');
  assert.match(table, /<Home size=\{12\}\/>/);
  assert.match(table, /CalendarClock, ExternalLink, Home,/);
  const picker = read('admin/pages/dashboard/tabs/daqqi/DaqqiRoundPicker.tsx');
  assert.match(picker, /round\.instructorName/);
  assert.doesNotMatch(picker, /receptionName/);
  assert.match(picker, /round\.dayOfWeek/);
  assert.match(picker, /round\.code/);
  const housing = read('admin/pages/dashboard/tabs/DaqqiHousingModal.tsx');
  assert.match(housing, /<DaqqiRoundPicker/);
  assert.doesNotMatch(housing, /receptionName\}/);
  assert.doesNotMatch(housing, /<select/);
  // The schedule's two dialogs use the same picker, and no longer print the reception.
  const modals = read('admin/pages/dashboard/tabs/daqqi/DaqqiRoundActionModals.tsx');
  assert.equal((modals.match(/<DaqqiRoundPicker/g) || []).length, 2);
  assert.doesNotMatch(modals, /round\.receptionName/);
});

test('seating writes one row on the server and does not post the whole round back', () => {
  const route = read('api/routes/daqqi-rounds.js');
  assert.match(route, /router\.post\('\/api\/admin\/daqqi-rounds\/:roundId\/attendees', requireAuth, requireAdminOrStaff, requirePermission\('manage_daqqi'\), requireDaqqiAccess/);
  const lib = read('api/lib/daqqiHousing.js');
  assert.match(lib, /FROM daqqi_rounds WHERE id=\? AND tenant_id=\? LIMIT 1 FOR UPDATE/);
  assert.match(lib, /INSERT INTO daqqi_attendees/);
  assert.match(lib, /COALESCE\(NULLIF\(s\.phone,''\), NULLIF\(s\.whatsapp,''\), ''\)/);
  assert.match(lib, /UPDATE subscribers SET branch=\?, branch_id=\?/);
  assert.match(lib, /const roundBranch = round\.branch \|\| 'DAQQI';/);
  assert.match(lib, /DAQQI_ATTENDEE_BOOKED/);
  const tab = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  assert.match(tab, /await bookDaqqiAttendee\(sub\.id, round\.id\)/);
  assert.doesNotMatch(tab, /attendees: \[\.\.\.round\.attendees, newAttendee\]/);
});

test('a booking can name the round and the client is seated when it is recorded', () => {
  const route = read('api/routes/subscriber-payments.js');
  assert.match(route, /const daqqiRoundId = String\(req\.body\.daqqiRoundId \|\| payment\?\.daqqiRoundId \|\| ''\)\.trim\(\);/);
  // Checked before any money is recorded.
  assert.ok(route.indexOf('const daqqiRoundId') < route.indexOf('// ── Begin atomic transaction'));
  assert.match(route, /الروند اللي اخترته مش موجود/);
  // Seated after the commit, in a transaction of its own, so a failure cannot lose the payment.
  assert.ok(route.indexOf('seatInOwnTransaction(pool') > route.indexOf('// End transaction'));
  assert.match(route, /\.\.\.\(housed \? \{ housed \} : \{\}\),/);
  // A collection officer's new client waits for the manager — and so does the seat.
  assert.match(route, /\.\.\.\(daqqiRoundId \? \{ daqqiRoundId \} : \{\}\) \};/);

  const modal = read('admin/components/PaymentModal.tsx');
  assert.match(modal, /daqqiRoundId\?: string;/);
  assert.match(modal, /const canHouse = bookingBranch === 'DAQQI' && d\.bookingType === 'new_booking' && \(daqqiRounds \|\| \[\]\)\.length > 0;/);
  assert.match(modal, /<Home size=\{13\} \/> تسكين في روند/);
  assert.match(modal, /<DaqqiRoundPicker/);
  assert.match(modal, /layer="over"/);

  for (const file of ['admin/lib/createClientWithPayment.ts']) {
    assert.match(read(file), /daqqiRoundId/);
  }
  const handlers = read('admin/pages/dashboard/dashboardPaymentHandlers.ts');
  assert.equal((handlers.match(/daqqiRoundId: (sub|lead)PayDraft\.daqqiRoundId/g) || []).length, 4, 'every entry a booking records carries it');
  assert.match(handlers, /housingOutcome\(results\)/);
  assert.match(read('admin/context/site-data-hooks/useCrmCoreState.ts'), /housed: result\.housed,/);
});

test('the answer about the seating is told to the desk, and the rosters are read again', () => {
  const lib = read('admin/lib/daqqiHousing.ts');
  assert.match(lib, /export const ROUNDS_CHANGED_EVENT = 'daqqi-rounds-changed'/);
  const state = read('admin/context/site-data-hooks/useDaqqiRoundsState.ts');
  assert.match(state, /window\.addEventListener\(ROUNDS_CHANGED_EVENT/);
  assert.match(state, /if \(hasRounds\.current\) void refreshDaqqiRounds\(\)/, 'an account that cannot read the rounds is not sent to ask');
  const { housingOutcome } = (() => {
    try { return load('admin/lib/daqqiHousing.ts'); } catch { return {}; }
  })();
  if (housingOutcome) {
    assert.deepEqual(housingOutcome([{ housed: 'seated' }]), { text: ' واتسكّن في الروند ✓', warning: false, changed: true });
    assert.equal(housingOutcome([{ housed: 'failed' }]).warning, true);
    assert.equal(housingOutcome([{}, undefined]).text, '');
  }
});

// ── the attendees list ───────────────────────────────────────────────────────

test('the attendees list: the number under the name, a contact column, the actions in the asked order', () => {
  const row = read('admin/pages/dashboard/tabs/daqqi/DaqqiRoundRow.tsx');
  const head = row.slice(row.indexOf('<thead>', row.indexOf('قائمة الحاضرين')), row.indexOf('</thead>', row.indexOf('قائمة الحاضرين')));
  const columns = [...head.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map(match => match[1]);
  assert.deepEqual(columns, ['الاسم', 'تاريخ الحجز', 'المدفوع', 'سعر الكورس', 'المتبقي', 'الحضور', 'التواصل', 'إجراءات']);
  assert.ok(!columns.includes('الهاتف'), 'the number is under the name now');
  // ملف العميل ← الدفع ← التواصل ← واتساب ← نقل لروند تانيه ← مسح من الروند
  const actions = row.slice(row.indexOf('title="ملف العميل"'));
  const order = ['title="ملف العميل"', 'title="تسجيل دفعة"', 'title="تواصل"', 'title="واتساب"', 'title="نقل لروند أخرى"', 'title="مسح من الروند"'];
  const positions = order.map(label => actions.indexOf(label));
  assert.ok(positions.every(position => position >= 0), `missing: ${order.filter((_, i) => positions[i] < 0)}`);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'the order of the buttons');
  // The same icons as «عملاء الدقي», WhatsApp included.
  assert.match(row, /<ExternalLink size=\{12\} \/>/);
  assert.match(row, /<Wallet size=\{12\} \/>/);
  assert.match(row, /<Phone size=\{12\} \/>/);
  assert.match(row, /<WhatsAppIcon size=\{13\} \/>/);
  assert.match(row, /<ArrowLeftRight size=\{12\} \/>/);
});

test('«تواصل» logs a real contact — outcome, follow-up, who — in the same dialog as the clients screen', () => {
  const tab = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  assert.match(tab, /import \{ ClientContactDialog \} from '\.\.\/\.\.\/unified-client\/ClientContactLog';/);
  assert.match(tab, /<ClientContactDialog\s+subscriber=\{\{ id: daqqiCommModal\.subscriberId, name: daqqiCommModal\.subscriberName \}\}\s+initialType=\{daqqiCommModal\.type\}/);
  assert.doesNotMatch(tab, /DaqqiCommunicationModal|handleDaqqiAddComm/);
  assert.equal(fs.existsSync(path.join(ROOT, 'admin/pages/dashboard/tabs/daqqi/DaqqiCommunicationModal.tsx')), false);
});

test('the hall column is narrower and the widths still add up', () => {
  const page = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  const start = page.indexOf('<colgroup>');
  const shares = [...page.slice(start, page.indexOf('</colgroup>', start)).matchAll(/<col className="w-\[(\d+)%\]" \/>/g)].map(match => Number(match[1]));
  assert.equal(shares.length, 11);
  assert.equal(shares.reduce((sum, share) => sum + share, 0), 100);
  assert.equal(shares[3], 5, 'القاعة');
});

// ── the review of the rest of the Dokki section ──────────────────────────────

test('a refunded or deleted payment is not read back from the figure stored at booking', () => {
  const sql = read('api/lib/daqqiAttendees.js');
  // The stored figure is only for a client with no payment row of any status for the course.
  const paid = sql.slice(sql.indexOf('AS amount_paid'), sql.indexOf('AS amount_paid') + 10);
  assert.ok(paid);
  assert.match(sql, /\) THEN 0 ELSE da\.amount_paid END, 0\) AS amount_paid,/);
  assert.doesNotMatch(sql, /\), da\.amount_paid, 0\) AS amount_paid/, 'the old fallback read a refund as still paid');
});

test('the reports earn a track\'s money once, split across its courses, not whole on each round', () => {
  const sql = read('api/lib/daqqiAttendees.js');
  assert.match(sql, /AS revenue_share/);
  assert.match(sql, /p\.course_id IS NULL AND p\.bundle_id IS NOT NULL\s+THEN GREATEST\(1, \(SELECT COUNT\(\*\) FROM bundle_courses b2/);
  const route = read('api/routes/daqqi-rounds.js');
  assert.match(route, /m\.revenue \+= Number\(a\.revenue_share \|\| 0\);/);
  assert.doesNotMatch(route, /m\.revenue \+= Number\(a\.amount_paid/);
  const performance = route.slice(route.indexOf("'/api/admin/daqqi-performance'"), route.indexOf("router.get('/api/admin/daqqi-rounds'"));
  assert.doesNotMatch(performance, /SUM\(a\.amount_paid\)|SUM\(amount_paid\)/, 'the team tab summed the figure stored at booking, which was never updated');
  assert.match(performance, /earnedByRound\.set\(seat\.round_id, \(earnedByRound\.get\(seat\.round_id\) \|\| 0\) \+ Number\(seat\.revenue_share \|\| 0\)\)/);
  // The pins in adminAuthority.test.js stay true.
  assert.match(performance, /COUNT\(DISTINCT r\.id\)/);
  assert.match(performance, /WHEN r\.status='ACTIVE'/);
});

test('privacy erasure blanks the attendee phone instead of nulling a NOT NULL column', () => {
  const privacy = read('api/lib/privacyService.js');
  assert.match(privacy, /UPDATE daqqi_attendees SET name=\?,phone='' WHERE tenant_id=\? AND subscriber_id=\?/);
  assert.match(read('api/schema.sql'), /CREATE TABLE `daqqi_attendees` \([\s\S]{0,260}`phone` varchar\(50\) NOT NULL/);
});

test('taking a client off a round asks first, and refuses one who has attendance', () => {
  const route = read('api/routes/daqqi-rounds.js');
  const remove = route.slice(route.indexOf("router.delete('/api/admin/daqqi-rounds/:roundId/attendees/:subscriberId'"), route.indexOf("router.delete('/api/admin/daqqi-rounds/:id'"));
  assert.match(remove, /attended_lectures FROM daqqi_attendees[\s\S]{0,160}FOR UPDATE/);
  assert.match(remove, /An attendee with attendance history cannot be removed from a round/);
  const tab = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  const handler = tab.slice(tab.indexOf('const handleRemoveAttendeeFromRound'), tab.indexOf('const refreshRounds'));
  assert.match(handler, /await confirmDialog\(`مسح /);
  assert.match(handler, /daqqiRuleMessage\(/);
});

test('money taken at the Dokki desk is the Dokki branch\'s', () => {
  const tab = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  // The branch the desk is at — Dokki's, or Tagamoa's when the screen shows it.
  assert.equal((tab.match(/branch: physicalBranch\.key,/g) || []).length >= 2, true, 'both the course payment and the extra items');
});

test('the cockpit\'s Dokki revenue is the branch\'s money, not what one dialog happened to tag', () => {
  const finance = financeRouteSource();
  assert.match(finance, /p\.status='paid' AND p\.deleted_at IS NULL AND p\.branch='DAQQI'\$\{paymentAliasScopeSql\}/);
  assert.doesNotMatch(finance, /p\.source='daqqi'/);
  // A deleted payment is not revenue anywhere on the cockpit.
  assert.match(finance, /p\.status='paid' AND p\.deleted_at IS NULL AND p\.staff_id IS NOT NULL/);
  assert.match(finance, /status='paid' AND deleted_at IS NULL\$\{paymentScopeSql\}\s+GROUP BY payment_method/);
});

test('the roster read does not pay for the report-only revenue lookup', () => {
  const lib = read('api/lib/daqqiAttendees.js');
  assert.match(lib, /\{ withRevenue = false \} = \{\}/);
  const route = read('api/routes/daqqi-rounds.js');
  // Asked for by the two that sum money over rounds, and by nothing else.
  assert.equal((route.match(/\{ withRevenue: true \}/g) || []).length, 2);
  assert.match(route, /router\.get\('\/api\/admin\/daqqi-rounds'[\s\S]{0,1200}attachAttendeeMoney\(pool, req\.tenantId,\s*await getDaqqiAttendees\(pool, req\.tenantId, rounds\.map\(round => round\.id\)\)\)/);
});
