'use strict';

// «عملاء الدقي» held the branch's whole client list in the browser and filtered, counted and paged it there
// (OnlineClientsTab with isDaqqiClientsTab); the server does it now (GET /api/admin/dokki/clients, buildView with
// `dokki`, api/lib/staffClientsView.js). This runs both on the same clients and rounds: the screen's rules are the
// screen's live TypeScript, bundled, and the screen's own closures — copied word for word from the file as it was on
// 19 Oct 2026, its Dokki branches only — and every tab, every filter and every figure must come out the same.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const view = require('../lib/staffClientsView');

function bundleScreen() {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    stdin: {
      contents: `
        export { housingNeedOf, isFullyHoused, needsHousing } from './pages/dashboard/tabs/daqqi/daqqiHousingNeeds';
        export { followUpOf, matchesFollowFilter } from './lib/clientFollowUp';
        export { matchesSearch } from './lib/clientSearch';
        export { holdsIn } from './lib/coursePlacement';
        export { subscriberBalance, calcSubscribersPaidEGP, isFullyPaid } from './pages/dashboard/tabs/onlineClientsUtils';
        export { cairoWeekStart, cairoMonthOnly, cairoDay } from '../shared/cairoDate';
      `,
      resolveDir: path.join(ROOT, 'admin'), loader: 'ts',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const addDays = days => new Date(Date.parse(`${TODAY}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COURSES = [
  { id: 'c1', title: 'one', price: { EGP: 1000, SAR: 200, USD: 60 } },
  { id: 'c2', title: 'two', price: { EGP: 2000, SAR: 0, USD: 0 } },
  { id: 'c3', title: 'three', price: { EGP: 500 } },
];
const BUNDLES = [{ id: 'b1', title: 'track', price: { EGP: 2500, SAR: 500, USD: 120 }, courses: [{ id: 'c1' }, { id: 'c2' }] }];
const CATALOGUE = {
  courses: new Map(COURSES.map(course => [course.id, { price: course.price }])),
  bundles: new Map(BUNDLES.map(bundle => [bundle.id, { price: bundle.price, courseIds: bundle.courses.map(c => c.id) }])),
};

function world(count) {
  const next = random(20261019);
  const pick = list => list[Math.floor(next() * list.length)];
  const names = ['أحمد علي', 'احمد محمود', 'سارة حسن', 'Omar Test', 'منى إبراهيم'];
  const clients = Array.from({ length: count }, (_, i) => ({
    id: `s${i}`, name: pick(names), phone: pick(['01012345678', '+201112223334', '0555000111', '']),
    email: pick(['a@test.com', 'b@x.org', '']), clientCode: `C${100 + i}`, nationalId: pick(['', '29001010101010']),
    branch: pick(['DAQQI', 'DAQQI', 'DAQQI', 'TAGAMOA', 'ONLINE_EGYPT', 'ONLINE_SAUDI', 'dokki', 'daqqi']),
    isActive: pick([true, true, true, false]), status: pick([undefined, 'active', 'trial']),
    clientStatus: pick([undefined, undefined, undefined, 'finished', 'paused', 'refunded', 'refund_pending', 'old_data', 'daqqi_old_local', 'old_local']),
    createdAt: new Date(Date.UTC(pick([2024, 2025, 2025, 2026]), Math.floor(next() * 12), 1 + Math.floor(next() * 27), 10)).toISOString(),
    coursePlacements: pick([{}, {}, {}, { c1: 'DAQQI' }, { c2: 'ONLINE_EGYPT' }, { c1: 'daqqi' }, { c3: 'TAGAMOA' }]),
    enrolledCourseIds: pick([[], ['c1'], ['c1', 'c2'], ['c3'], ['c2', 'c3']]), enrolledBundleIds: pick([[], [], ['b1']]),
    customPrices: pick([undefined, {}, { c1: 800 }, { 'bundle:b1': 2000 }]), priorPaid: pick([undefined, {}, { c2: 700 }]),
    market: pick([undefined, undefined, 'saudi']),
    nextFollowUpDate: pick([undefined, null, addDays(-3), TODAY, addDays(1), addDays(5), addDays(20)]),
    communications: pick([undefined, [], [{ date: '2026-10-01', nextFollowUp: addDays(-2) }]]),
    installmentPlans: pick([undefined, [], [{ entries: [{ dueDate: addDays(-5), paidAt: null }, { dueDate: addDays(30) }] }]]),
    certificates: pick([[], [], [{ id: 'x' }]]), assignedCsId: pick([null, 'cs1', 'cs2']),
    paymentHistory: Array.from({ length: Math.floor(next() * 4) }, (_, k) => ({
      id: `p${i}-${k}`, amount: pick([0, 100, 500, 1000, 2500]), currency: pick(['EGP', 'EGP', 'SAR']),
      paymentType: pick([undefined, 'course', 'other', 'certificate']), courseId: pick(['c1', 'c2', 'c3', null]), bundleId: pick([null, null, 'b1']),
      courseExpected: pick([undefined, 0, 900, 3000]), at: addDays(-Math.floor(next() * 60)), status: pick(['paid', 'paid', 'pending', 'refunded']),
    })),
  }));
  const rounds = Array.from({ length: 9 }, (_, i) => ({
    id: `r${i}`, code: `R${i}`, courseId: ['c1', 'c2', 'c3'][i % 3], receptionId: pick(['rec1', 'rec2', '']), receptionName: 'x',
    status: i % 4 === 3 ? 'finished' : 'active',
    attendees: clients.filter(() => next() < 0.1).map(client => ({
      subscriberId: client.id, bookedAt: pick(['2024-03-04', '2025-01-10', '2025-11-02', '2026-02-02', '']),
    })),
  }));
  return { clients, rounds };
}

const norm = value => (value ? String(value).toUpperCase().replace(/[-\s]/g, '_') : '');

/** The screen's Dokki path, as OnlineClientsTab ran it over the loaded list (isDaqqiClientsTab, not paged). */
function screenRun(screen, clients, rounds, f) {
  const isDokkiHere = branch => norm(branch) === 'DAQQI';
  const allCombined = clients.filter(s => screen.holdsIn(s, isDokkiHere));
  // verbatim: the round a client follows
  const housingMap = new Map();
  const chosen = new Map();
  rounds.forEach(round => {
    (round.attendees ?? []).forEach(att => {
      const bookedAt = String(att.bookedAt || '');
      const live = round.status !== 'finished';
      const held = chosen.get(att.subscriberId);
      if (held && (held.live && !live || (held.live === live && held.bookedAt >= bookedAt))) return;
      chosen.set(att.subscriberId, { bookedAt, live });
      housingMap.set(att.subscriberId, { roundId: round.id, receptionId: round.receptionId });
    });
  });
  const housingNeeds = new Map();
  for (const subscriber of clients) housingNeeds.set(subscriber.id, screen.housingNeedOf(rounds, BUNDLES, subscriber));
  const bookingYearsById = new Map();
  rounds.forEach(round => {
    (round.attendees ?? []).forEach(att => {
      const year = Number(String(att.bookedAt || '').slice(0, 4));
      if (!Number.isInteger(year) || year < 1900) return;
      const years = bookingYearsById.get(att.subscriberId) || new Set();
      years.add(year);
      bookingYearsById.set(att.subscriberId, years);
    });
  });
  const bookedInYear = (s, year) => {
    const booked = bookingYearsById.get(s.id);
    if (booked?.size) return booked.has(year);
    return Number(String(s.createdAt || '').slice(0, 4)) === year;
  };
  const balances = new Map();
  const balanceOf = s => {
    if (!balances.has(s.id)) balances.set(s.id, screen.subscriberBalance(s, COURSES, BUNDLES));
    return balances.get(s.id);
  };
  const itemKeyOf = payment => (payment.bundleId ? `bundle:${payment.bundleId}` : (payment.courseId || ''));
  const holdsItem = (s, item) => (item.startsWith('bundle:')
    ? (s.enrolledBundleIds || []).includes(item.slice(7))
    : (s.enrolledCourseIds || []).includes(item))
    || (s.paymentHistory || []).some(payment => itemKeyOf(payment) === item);
  const BOOKING_YEAR_TABS = { booked2024: 2024, booked2025: 2025 };
  const matchesFilters = (s, withFollow) => {
    const clientSt = s.clientStatus || '';
    if (f.view === 'active') {
      if (s.isActive === false) return false;
      if (['finished', 'paused', 'refunded', 'refund_pending'].includes(clientSt)) return false;
      if (['old_data', 'daqqi_old_local', 'daqqi_old_intl'].includes(clientSt)) return false;
    } else if (BOOKING_YEAR_TABS[f.view]) {
      if (!bookedInYear(s, BOOKING_YEAR_TABS[f.view])) return false;
    } else if (f.view === 'refunded') {
      if (clientSt !== 'refunded' && clientSt !== 'refund_pending') return false;
    } else if (f.view === 'old_data') {
      if (!['old_data', 'daqqi_old_local', 'daqqi_old_intl'].includes(clientSt)) return false;
    } else if (clientSt !== f.view) return false;
    if (!screen.matchesSearch(f.q, { name: s.name, phone: s.phone, email: s.email, code: s.clientCode, nationalId: s.nationalId })) return false;
    if (f.from && screen.cairoDay(s.createdAt) < f.from) return false;
    if (f.to && screen.cairoDay(s.createdAt) > f.to) return false;
    if (f.course && !holdsItem(s, f.course)) return false;
    if (f.collector === '__none__') { if (s.assignedCsId) return false; }
    else if (f.collector && s.assignedCsId !== f.collector) return false;
    const _need = housingNeeds.get(s.id);
    if (f.housing === 'housed' && !(_need && screen.isFullyHoused(_need))) return false;
    if (f.housing === 'unhoused' && _need && !screen.needsHousing(_need)) return false;
    if (f.round) { const _h = housingMap.get(s.id); if (!_h || _h.roundId !== f.round) return false; }
    if (f.reception) { const _h = housingMap.get(s.id); if (!_h || _h.receptionId !== f.reception) return false; }
    if (f.status && (s.status || 'active') !== f.status) return false;
    if (f.cert === 'has_cert' && (s.certificates || []).length === 0) return false;
    if (f.cert === 'no_cert' && (s.certificates || []).length > 0) return false;
    if (f.remaining === 'has_remaining' && balanceOf(s).remainingEgp <= 0) return false;
    if (f.remaining === 'paid' && !screen.isFullyPaid(balanceOf(s))) return false;
    if (withFollow && !screen.matchesFollowFilter(screen.followUpOf(s), f.follow)) return false;
    return true;
  };
  const filtered = allCombined.filter(s => matchesFilters(s, true));
  const followCounts = { overdue: 0, today: 0, tomorrow: 0 };
  for (const s of allCombined) {
    if (!matchesFilters(s, false)) continue;
    const status = screen.followUpOf(s).status;
    if (status === 'overdue' || status === 'today' || status === 'tomorrow') followCounts[status] += 1;
  }
  const TERMINAL = ['finished', 'paused', 'refunded', 'refund_pending'];
  // ViewTabsBar's counts and OnlineClientsKpiStrip's, as they counted allCombined.
  const tabCounts = {
    active: allCombined.filter(s => s.isActive !== false && !TERMINAL.includes(s.clientStatus || '') && !['old_data', 'daqqi_old_local', 'daqqi_old_intl'].includes(s.clientStatus || '')).length,
    finished: allCombined.filter(s => s.clientStatus === 'finished').length,
    paused: allCombined.filter(s => s.clientStatus === 'paused').length,
    refunded: allCombined.filter(s => s.clientStatus === 'refunded' || s.clientStatus === 'refund_pending').length,
    booked2024: allCombined.filter(s => bookedInYear(s, 2024)).length,
    booked2025: allCombined.filter(s => bookedInYear(s, 2025)).length,
    old_data: allCombined.filter(s => ['old_data', 'daqqi_old_local', 'daqqi_old_intl'].includes(s.clientStatus || '')).length,
  };
  const figures = {
    total: allCombined.length,
    active: allCombined.filter(s => !TERMINAL.includes(s.clientStatus || '') && !['old_data', 'daqqi_old_local', 'daqqi_old_intl'].includes(s.clientStatus || '')).length,
    finished: allCombined.filter(s => s.clientStatus === 'finished').length,
    paused: allCombined.filter(s => s.clientStatus === 'paused').length,
    today: screen.calcSubscribersPaidEGP(allCombined, TODAY, TODAY),
    week: screen.calcSubscribersPaidEGP(allCombined, screen.cairoWeekStart()),
    month: screen.calcSubscribersPaidEGP(allCombined, `${screen.cairoMonthOnly()}-01`),
    remaining: allCombined.reduce((sum, s) => sum + balanceOf(s).remainingEgp, 0),
    unassigned: allCombined.filter(s => !s.assignedCsId).length,
  };
  // The old-data distribution panel: the matching clients nobody holds, and what each person holds (`subscribers.filter`).
  const assignedCounts = {};
  for (const s of allCombined) if (s.assignedCsId) assignedCounts[s.assignedCsId] = (assignedCounts[s.assignedCsId] || 0) + 1;
  return { ids: filtered.map(s => s.id), followCounts, tabCounts, figures, unassignedMatching: filtered.filter(s => !s.assignedCsId).length, assignedCounts };
}

const BLANK = { view: 'active', q: '', from: '', to: '', course: '', collector: '', status: '', cert: '', remaining: '', follow: '', housing: '', round: '', reception: '' };

test('every tab, filter and figure of «عملاء الدقي» comes out of the server as it did out of the loaded list', () => {
  const screen = bundleScreen();
  if (!screen) return;
  const { clients, rounds } = world(500);
  const serverRounds = rounds.map(round => ({
    id: round.id, courseId: round.courseId, receptionId: round.receptionId, finished: round.status === 'finished',
    attendees: round.attendees,
  }));
  const weekStart = screen.cairoWeekStart();
  const ctx = { today: TODAY, weekStart, monthStart: `${screen.cairoMonthOnly()}-01`, catalogue: CATALOGUE, dokki: { branch: 'DAQQI', rounds: serverRounds } };
  const cases = [{}];
  for (const viewName of ['active', 'finished', 'paused', 'refunded', 'booked2024', 'booked2025', 'old_data']) cases.push({ view: viewName });
  cases.push(
    { q: 'احمد' }, { q: 'omar' }, { q: '0101' }, { q: 'C12' }, { from: '2025-01-01', to: '2025-12-31' },
    { course: 'c1' }, { course: 'bundle:b1' }, { collector: 'cs1' }, { collector: '__none__' }, { status: 'trial' },
    { cert: 'has_cert' }, { cert: 'no_cert' }, { remaining: 'has_remaining' }, { remaining: 'paid' },
    { follow: 'due' }, { follow: 'overdue' }, { follow: 'week' }, { follow: 'none' },
    { housing: 'housed' }, { housing: 'unhoused' }, { round: 'r1' }, { round: 'r4' }, { reception: 'rec1' }, { reception: 'rec2' },
    { view: 'booked2025', housing: 'unhoused', remaining: 'has_remaining' }, { view: 'finished', round: 'r0', follow: 'due' },
    { view: 'old_data', collector: '__none__' }, { housing: 'housed', reception: 'rec1', course: 'c2' },
  );
  let compared = 0;
  for (const change of cases) {
    const filters = { ...BLANK, ...change };
    const expected = screenRun(screen, clients, rounds, filters);
    const got = view.buildView(clients, { ...view.readFilters(filters, { dokki: true }), branch: '' }, ctx);
    const label = JSON.stringify(change);
    assert.deepEqual(got.ids, expected.ids, `the rows ${label}`);
    assert.deepEqual(got.followCounts, expected.followCounts, `the follow-up chips ${label}`);
    assert.deepEqual(got.tabCounts, expected.tabCounts, `the tab counts ${label}`);
    assert.equal(got.unassignedMatching, expected.unassignedMatching, `unassigned among the matching ${label}`);
    assert.deepEqual(got.assignedCounts, expected.assignedCounts, `who holds how many ${label}`);
    for (const key of ['total', 'active', 'finished', 'paused', 'today', 'week', 'month', 'unassigned']) {
      assert.equal(got.figures[key], expected.figures[key], `figure ${key} ${label}`);
    }
    assert.ok(Math.abs(got.figures.remaining - expected.figures.remaining) < 0.01, `remaining ${label}`);
    compared += 1;
  }
  assert.ok(compared >= 35);
  // The fixtures reach every branch of the rules.
  const everything = view.buildView(clients, { ...view.readFilters(BLANK, { dokki: true }), branch: '' }, ctx);
  assert.ok(everything.figures.total > 100 && everything.figures.total < 500, 'the branch is some of the clients');
  assert.ok(everything.tabCounts.booked2024 > 0 && everything.tabCounts.booked2025 > 0 && everything.tabCounts.old_data > 0 && everything.tabCounts.refunded > 0);
});

test('a view the Dokki screen does not have falls back to the active one, and the filters are read as text', () => {
  const odd = view.readFilters({ view: 'real-local', housing: 'whatever', round: 'r1', reception: 'x' }, { dokki: true });
  assert.equal(odd.view, 'active');
  assert.equal(odd.housing, '');
  assert.equal(odd.round, 'r1');
  // The online screen reads none of the Dokki ones.
  const online = view.readFilters({ view: 'booked2025', housing: 'housed', round: 'r1' });
  assert.equal(online.view, 'active');
  assert.equal(online.housing, '');
  assert.equal(online.round, '');
});
