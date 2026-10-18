'use strict';

// «اشتغل عليه فورا … كل شاشة تقرا من السيرفر بالصفحات» (18 Oct 2026). A sales rep's or a collection officer's
// «عملائي» filtered and paged the whole downloaded list in the browser; the server does it now
// (GET /api/staff/subscribers?paged=1, api/lib/staffClientsView.js). The server's rules are the screen's own written
// once more in JavaScript, so this runs both on the same clients: a change to one that forgets the other fails here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const view = require('../lib/staffClientsView');

function bundleScreen() {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    stdin: {
      contents: `
        export { followUpOf } from './lib/clientFollowUp';
        export { matchesSearch } from './lib/clientSearch';
        export { holdsIn } from './lib/coursePlacement';
        export { branchMatchesFilter } from './pages/dashboard/branchWorkspaceFilters';
        export { subscriberBalance, subscriberMarket, isInternationalSubscriber } from './pages/dashboard/tabs/onlineClientsUtils';
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

const TODAY = '2026-10-18';
const addDays = (days) => new Date(Date.UTC(2026, 9, 18 + days)).toISOString().slice(0, 10);

// A small deterministic generator, so a failure names the same client every run.
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

function fixtures(count) {
  const next = random(20261018);
  const pick = list => list[Math.floor(next() * list.length)];
  const names = ['أحمد علي', 'احمد محمود', 'سارة حسن', 'Omar Test', 'منى إبراهيم', 'ياسمين'];
  return Array.from({ length: count }, (_, i) => {
    const payments = Array.from({ length: Math.floor(next() * 4) }, (_, k) => ({
      id: `p${i}-${k}`, amount: pick([0, 100, 500, 1000, 2500]), currency: pick(['EGP', 'EGP', 'SAR', 'USD']),
      paymentType: pick([undefined, 'course', 'other', 'installment', 'certificate']),
      courseId: pick(['c1', 'c2', 'c3', null]), bundleId: pick([null, null, 'b1']),
      courseExpected: pick([undefined, 0, 900, 3000]), at: addDays(-Math.floor(next() * 60)),
      status: pick(['paid', 'paid', 'pending', 'refunded', 'failed', undefined]),
    }));
    return {
      id: `s${i}`, name: pick(names), phone: pick(['01012345678', '+201112223334', '0555000111', '']),
      email: pick(['a@test.com', 'b@x.org', '']), clientCode: `C${100 + i}`, nationalId: pick(['', '29001010101010']),
      branch: pick(['ONLINE_EGYPT', 'ONLINE_SAUDI', 'ONLINE_ABROAD', 'DAQQI', 'TAGAMOA', null, 'online-saudi', 'خارج مصر']),
      market: pick([undefined, undefined, undefined, 'local', 'saudi', 'intl']),
      isActive: pick([true, true, false]), status: pick([undefined, 'active', 'trial']),
      clientStatus: pick([undefined, undefined, 'finished', 'paused', 'refunded', 'refund_pending', 'old_local', 'old_intl']),
      createdAt: new Date(Date.UTC(2026, 9, 18 - Math.floor(next() * 90), Math.floor(next() * 24))).toISOString(),
      coursePlacements: pick([{}, {}, { c1: 'DAQQI' }, { c2: 'ONLINE_EGYPT' }]),
      enrolledCourseIds: pick([[], ['c1'], ['c1', 'c2'], ['c3']]), enrolledBundleIds: pick([[], [], ['b1']]),
      customPrices: pick([undefined, {}, { c1: 800 }, { 'bundle:b1': 2000 }, { 'multi:x': 5 }]),
      priorPaid: pick([undefined, {}, { c2: 700 }, { 'bundle:b1': 100 }]),
      nextFollowUpDate: pick([undefined, null, addDays(-3), TODAY, addDays(1), addDays(5), addDays(20), `${addDays(-1)}T22:30:00.000Z`]),
      communications: pick([undefined, [], [{ date: '2026-10-01', nextFollowUp: addDays(-2) }, { date: '2026-10-10', nextFollowUp: TODAY }]]),
      installmentPlans: pick([undefined, [], [{ entries: [{ dueDate: addDays(-5), paidAt: null }, { dueDate: addDays(30) }] }], [{ entries: [{ dueDate: addDays(-5), paidAt: '2026-10-01' }] }]]),
      certificates: pick([[], [], [{ id: 'x' }]]), assignedCsId: pick([null, 'cs1', 'cs2']),
      paymentHistory: payments,
    };
  });
}

test('the follow-up, market, balance, search and branch rules answer as the screen\'s own functions do', () => {
  const screen = bundleScreen();
  if (!screen) return;
  for (const client of fixtures(400)) {
    const label = `${client.id} ${JSON.stringify(client.branch)}`;
    assert.equal(view.followUpOf(client, TODAY), screen.followUpOf(client, TODAY).status, `follow-up ${label}`);
    assert.equal(view.marketOf(client), screen.subscriberMarket(client), `market ${label}`);
    assert.equal(view.isInternational(client), screen.isInternationalSubscriber(client), `international ${label}`);
    assert.equal(view.holdsOnline(client), screen.holdsIn(client, branch => !['DAQQI', 'TAGAMOA'].includes(String(branch || '').toUpperCase().replace(/[-\s]/g, '_'))), `holds ${label}`);
    for (const slug of ['', 'all', 'online', 'ONLINE_EGYPT', 'online egypt', 'online-saudi', 'saudi', 'abroad', 'dokki', 'daqqi', 'tagamoa']) {
      assert.equal(view.branchMatchesFilter(client.branch, slug), screen.branchMatchesFilter(client.branch, slug), `branch ${slug} ${label}`);
    }
    const expected = screen.subscriberBalance(client, COURSES, BUNDLES);
    const got = view.balanceOf(client, CATALOGUE);
    assert.equal(got.items, expected.items, `items ${label}`);
    assert.equal(got.paidAnything, expected.paidAnything, `paid anything ${label}`);
    assert.ok(Math.abs(got.remainingEgp - expected.remainingEgp) < 0.001, `remaining ${label}: ${got.remainingEgp} vs ${expected.remainingEgp}`);
    for (const query of ['احمد', 'أحمد', 'omar', '0101', '1012345', '+20111', 'C12', 'a@test', 'x', '555000111', '2900101']) {
      assert.equal(
        view.matchesSearch(query, { name: client.name, phone: client.phone, email: client.email, code: client.clientCode, nationalId: client.nationalId }),
        screen.matchesSearch(query, { name: client.name, phone: client.phone, email: client.email, code: client.clientCode, nationalId: client.nationalId }),
        `search «${query}» ${label}`);
    }
  }
});

const ctx = { today: TODAY, weekStart: '2026-10-18', monthStart: '2026-10-01', catalogue: CATALOGUE, allBranches: false };
const client = (id, extra = {}) => ({ id, name: `n${id}`, branch: 'ONLINE_EGYPT', isActive: true, paymentHistory: [], enrolledCourseIds: [], ...extra });
const filtersOf = (query = {}) => view.readFilters(query);

test('the tabs, the filters and the chips count the same clients the table lists', () => {
  const clients = [
    client('a', { enrolledCourseIds: ['c1'], nextFollowUpDate: addDays(-2) }),
    client('b', { enrolledCourseIds: ['c1'], branch: 'ONLINE_SAUDI', nextFollowUpDate: TODAY, assignedCsId: 'cs1' }),
    client('c', { clientStatus: 'finished' }),
    client('d', { clientStatus: 'paused', nextFollowUpDate: addDays(1) }),
    client('e', { isActive: false }),
    client('f', { branch: 'DAQQI', enrolledCourseIds: ['c1'] }),
    client('g', { branch: 'ONLINE_EGYPT', paymentHistory: [{ id: 'p', amount: 500, currency: 'EGP', courseId: 'c1', at: TODAY, status: 'paid' }] }),
  ];
  const everything = view.buildView(clients, filtersOf(), ctx);
  // A Dokki client is not on the online screen, a disabled one and the finished and paused ones are not «النشطين».
  assert.deepEqual(everything.ids, ['a', 'b', 'g']);
  assert.equal(everything.tabCounts.finished, 1);
  assert.equal(everything.tabCounts.paused, 1);
  // The tab counts a market only for a client with an open course; the list also takes a booking awaiting approval.
  assert.equal(everything.tabCounts['real-local'], 1);
  assert.deepEqual(view.buildView(clients, filtersOf({ view: 'real-local' }), ctx).ids, ['a', 'g']);
  assert.deepEqual(view.buildView(clients, filtersOf({ view: 'real-saudi' }), ctx).ids, ['b']);
  assert.deepEqual(view.buildView(clients, filtersOf({ branch: 'saudi' }), ctx).ids, ['b'], 'a branch workspace link narrows the screen');
  assert.deepEqual(everything.followCounts, { overdue: 1, today: 1, tomorrow: 0 }, 'the chips count what the tab and the other filters let through');
  assert.equal(view.buildView(clients, filtersOf({ view: 'paused' }), ctx).followCounts.tomorrow, 1);
  assert.deepEqual(view.buildView(clients, filtersOf({ follow: 'due' }), ctx).ids, ['a', 'b']);
  assert.deepEqual(view.buildView(clients, filtersOf({ follow: 'none' }), ctx).ids, ['g']);
  assert.deepEqual(view.buildView(clients, filtersOf({ collector: view.NO_COLLECTOR }), ctx).ids, ['a', 'g']);
  assert.deepEqual(view.buildView(clients, filtersOf({ collector: 'cs1' }), ctx).ids, ['b']);
  assert.deepEqual(view.buildView(clients, filtersOf({ course: 'c1' }), ctx).ids, ['a', 'b', 'g'], 'a course held by enrolment or by a payment, as the screen reads it');
  assert.deepEqual(view.buildView(clients, filtersOf({ q: 'n' }), ctx).ids, ['a', 'b', 'g']);
  assert.deepEqual(view.buildView(clients, filtersOf({ q: 'zzzz' }), ctx).ids, []);
  assert.equal(view.buildView(clients, filtersOf({ view: 'paused', follow: 'tomorrow' }), ctx).ids[0], 'd');
  // The figures above the table are over every client of the screen, whatever the filters say.
  const narrowed = view.buildView(clients, filtersOf({ q: 'zzzz' }), ctx);
  assert.deepEqual(narrowed.figures, everything.figures);
  assert.equal(everything.figures.total, 6, 'the Dokki client is not one of this screen\'s');
  assert.equal(everything.figures.today, 500);
  // A rep sees every client they sold, whichever branch studies.
  assert.equal(view.buildView(clients, filtersOf(), { ...ctx, allBranches: true }).figures.total, 7);
  // An unknown view or follow value falls back rather than listing nothing.
  const odd = view.readFilters({ view: 'booked2025', follow: 'whenever', cert: 'x', from: 'tomorrow' });
  assert.equal(odd.view, 'active');
  assert.equal(odd.follow, '');
  assert.equal(odd.cert, '');
  assert.equal(odd.from, '');
});

test('the endpoint answers for the same scope as the list, a page at a time', () => {
  const route = read('api/routes/admin/stafflists.js');
  assert.match(route, /if \(req\.query\.paged === '1'\) return res\.json\(await staffClientsPage\(req, sc\)\);/);
  // The scope is the one rule of the list, the home summary and the payments page.
  assert.match(route, /async function staffClientsPage\(req, sc\)[\s\S]*?\(\$\{sc\.where\}\)/);
  assert.match(route, /rows: await shapeStaffSubscribers\(tenantId, pageRows\),/, 'only the page is shaped in full');
  assert.match(route, /view\.ids\.slice\(offset, offset \+ limit\)/);
  // The unpaged list still answers the refund form and every other caller as before.
  assert.match(route, /res\.json\(await shapeStaffSubscribers\(req\.tenantId, rows\)\);/);
});
