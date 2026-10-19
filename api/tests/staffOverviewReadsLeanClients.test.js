'use strict';

// «إحصائياتي» of the manager took 0.9 s at 30,000 clients because the overview shaped every client in full (placements,
// certificates, contact history) to add up money and balances (GET /api/staff/overview-summary). It reads the few columns
// it needs now (lib/staffOverview.js readOverviewClients). This runs the old way — the clients list as the clients screen
// shapes it, through buildOverview — and the new one on the same rows, for every size of scope the loader has a path for:
// the whole tenant, a large scope read table-wide and a small one read by id. A figure that moves fails here.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'overview-lean-test-secret-0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

const TENANT = 't1';
const TABLES = {};
const queries = [];
const tableOf = sql => (/\bFROM\s+`?(\w+)`?/i.exec(sql) || [])[1];
const fakePool = {
  async query(sql, params = []) {
    queries.push({ sql, params });
    const table = tableOf(sql);
    let rows = TABLES[table] || [];
    if (table === 'subscribers') {
      // The scope's own condition, for the two the test uses.
      if (/s\.assigned_cs_id = \?/.test(sql)) rows = rows.filter(row => row.assigned_cs_id === params[1]);
      rows = [...rows].sort((a, b) => (b.created_at - a.created_at) || (a.id < b.id ? 1 : -1));
    } else if (/subscriber_id IN \(/.test(sql)) {
      const wanted = new Set(params);
      rows = rows.filter(row => wanted.has(row.subscriber_id));
    }
    // The clients list reads a client's payments oldest first (ORDER BY date ASC), as the database would.
    if (/ORDER BY `date` ASC/.test(sql)) rows = [...rows].sort((a, b) => a.date - b.date);
    return [rows];
  },
};
const stub = (rel, exports) => {
  const resolved = require.resolve(path.join(__dirname, rel));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
const real = require('../lib/db');
stub('../lib/db', { ...real, pool: fakePool, cached: async (_key, _ttl, load) => load() });
const pass = (_req, _res, next) => next();
const realAuth = require('../middleware/auth');
stub('../middleware/auth', { ...realAuth, requireAuth: pass, requireAdminOrStaff: pass, requirePermission: () => pass, requireAnyPermission: () => pass });
const router = require('../routes/admin/stafflists');
const { buildOverview } = require('../lib/staffOverview');
const { cairoToday, addDaysToDateOnly } = require('../lib/dates');

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

const TODAY = cairoToday();
const COUNT = 2600;
function seed() {
  const next = random(20261019);
  const pick = list => list[Math.floor(next() * list.length)];
  const day = back => new Date(Date.parse(`${TODAY}T10:00:00Z`) - back * 86400000);
  TABLES.courses = [
    { id: 'c1', price_egp: 1000, price_sar: 200, price_usd: 60 },
    { id: 'c2', price_egp: 2000, price_sar: 0, price_usd: 0 },
    { id: 'c3', price_egp: 500, price_sar: 0, price_usd: 0 },
  ];
  TABLES.bundles = [{ id: 'b1', price_egp: 2500, price_sar: 500, price_usd: 120, course_ids: 'c1,c2' }];
  TABLES.subscribers = []; TABLES.payments = []; TABLES.enrollments = []; TABLES.installment_plans = [];
  for (let i = 0; i < COUNT; i += 1) {
    const id = `s${String(i).padStart(4, '0')}`;
    const crm = {
      market: pick([undefined, undefined, 'local', 'saudi', 'intl']),
      customPrices: pick([undefined, {}, { c1: 800 }, { 'bundle:b1': 2000 }, { 'multi:x': 5 }]),
      priorPaid: pick([undefined, {}, { c2: 700 }, { 'bundle:b1': 100 }]),
      leadId: pick([undefined, `lead${i % 40}`]),
      branch: pick([undefined, 'online-saudi']),
      installmentPlans: pick([undefined, undefined, [{ currency: 'EGP', entries: [{ dueDate: addDaysToDateOnly(TODAY, -4), amount: 300 }] }]]),
    };
    TABLES.subscribers.push({
      id, tenant_id: TENANT, name: `client ${i}`, client_code: pick([null, `C${i}`]), lead_id: pick([null, null, `lead${i % 40}`]),
      branch: pick(['ONLINE_EGYPT', 'ONLINE_SAUDI', 'ONLINE_ABROAD', 'DAQQI', 'TAGAMOA', null, 'online-saudi']),
      crm_json: pick([JSON.stringify(crm), JSON.stringify(crm), '', 'not json']),
      assigned_cs_id: i < 2300 ? 'cs1' : (i < 2500 ? 'cs2' : null),
      created_at: day(Math.floor(next() * 90)),
    });
    for (let k = Math.floor(next() * 4); k > 0; k -= 1) {
      TABLES.payments.push({
        id: `p${i}-${k}`, subscriber_id: id, course_id: pick(['c1', 'c2', 'c3', null]), bundle_id: pick([null, null, 'b1']),
        amount: pick([0, 100, 500, 1000, 2500.5]), currency: pick(['EGP', 'EGP', 'SAR', 'USD']),
        payment_type: pick([null, 'COURSE', 'OTHER', 'CERTIFICATE', 'BUNDLE']), course_expected: pick([null, 0, 900, 3000]),
        date: day(Math.floor(next() * 45)), status: pick(['paid', 'paid', 'pending', 'refunded', 'failed']),
        staff_id: pick([null, 'st1', 'st2']),
      });
    }
    for (const course of pick([[], ['c1'], ['c1', 'c2'], ['c3']])) TABLES.enrollments.push({ subscriber_id: id, course_id: course, bundle_id: null });
    if (next() < 0.05) TABLES.enrollments.push({ subscriber_id: id, course_id: null, bundle_id: 'b1' });
    if (next() < 0.1) {
      TABLES.installment_plans.push({
        id: `ip${i}`, subscriber_id: id, course_id: 'c1', bundle_id: null, title: 't', total_amount: 900, currency: pick(['EGP', 'SAR']),
        installments_count: 3, installment_amounts: '[300,300,300]', due_dates: JSON.stringify([-9, 2, 20].map(d => addDaysToDateOnly(TODAY, d))),
        paid_dates: JSON.stringify([addDaysToDateOnly(TODAY, -8), null, null]), paid_amounts: '[300,null,null]', notes: null, created_at: day(30),
        course_title: 'c',
      });
    }
  }
}

async function get(url, req) {
  const app = express();
  app.use((request, _res, next) => { request.tenantId = TENANT; Object.assign(request, req); next(); });
  app.use(router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
    return { status: response.status, body: await response.json() };
  } finally { server.close(); }
}

const CATALOGUE = () => ({
  courses: new Map(TABLES.courses.map(row => [row.id, { price: { EGP: row.price_egp, SAR: row.price_sar, USD: row.price_usd } }])),
  bundles: new Map(TABLES.bundles.map(row => [row.id, { price: { EGP: row.price_egp, SAR: row.price_sar, USD: row.price_usd }, courseIds: row.course_ids.split(',') }])),
});

async function bothWays(request) {
  const oldWay = await get('/api/staff/subscribers?limit=10000', request);
  assert.equal(oldWay.status, 200);
  const weekStart = addDaysToDateOnly(TODAY, -new Date(`${TODAY}T00:00:00Z`).getUTCDay());
  const expected = buildOverview(oldWay.body, { today: TODAY, weekStart, monthStart: `${TODAY.slice(0, 7)}-01`, catalogue: CATALOGUE() });
  queries.length = 0;
  const newWay = await get('/api/staff/overview-summary', request);
  assert.equal(newWay.status, 200);
  return { expected: JSON.parse(JSON.stringify(expected)), got: newWay.body, newQueries: [...queries] };
}

test('the overview adds up the same clients the clients list shapes, for the whole tenant', async () => {
  seed();
  const { expected, got, newQueries } = await bothWays({ isSuperAdmin: true, staffRecord: null });
  assert.equal(got.clients, COUNT);
  assert.ok(got.money.total > 0 && got.money.remaining > 0 && got.installments.overdue.count > 0, 'the fixtures exercise the figures');
  assert.deepEqual(got, expected);
  // Whole tables, not an id list of every client: the point of reading it this way.
  assert.ok(newQueries.every(query => query.params.length < 20), 'no query carries a list of client ids');
  assert.ok(!newQueries.some(query => /subscriber_course_branches|course_completions|certificate_requests/.test(query.sql)), 'the placements and certificates are not read');
});

test('a large scope is read table-wide and picked out by client, a small one by id', async () => {
  seed();
  const large = await bothWays({ isSuperAdmin: false, staffRecord: { id: 'cs1', role: 'collection' } });
  assert.equal(large.got.clients, 2300);
  assert.deepEqual(large.got, large.expected);
  assert.ok(large.newQueries.every(query => query.params.length < 20));
  const small = await bothWays({ isSuperAdmin: false, staffRecord: { id: 'cs2', role: 'collection' } });
  assert.equal(small.got.clients, 200);
  assert.deepEqual(small.got, small.expected);
  assert.ok(small.newQueries.some(query => /FROM payments/.test(query.sql) && query.params.length > 100), 'a few clients are asked for by id');
});
