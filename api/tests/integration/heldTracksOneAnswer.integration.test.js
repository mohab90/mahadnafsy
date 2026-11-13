'use strict';
/**
 * 13 Nov 2026, «لو عميل حاجز المعالج النفسي المحترف ليه يظهرله كمان مسار التشخيص الإكلينيكي والعلاج النفسي؟ … مينفعش تعرض جزء من الكل … ولا تحولهم لمسار العلاج الكامل»:
 * the tracks a client holds, by ONE rule (lib/heldTracks.js), on the three readings of his money — the list row, GET /api/admin/clients/:id/money and the SQL balance the
 * student's page reads — and track naming (lib/trackNaming.js) that must not join booked tracks. Fixtures: A «التشخيص» (c1,c2), B «العلاج» (c3,c4), P «المحترف»
 * (c1..c4), D «المتقدم» (c5,c6), F «الكامل» (c1..c6). Real MariaDB; runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-held-tracks-it';
let pool;
let seq = 0;

const TRACKS = { A: ['c1', 'c2'], B: ['c3', 'c4'], P: ['c1', 'c2', 'c3', 'c4'], D: ['c5', 'c6'], F: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'] };
const TRACK_PRICE = { A: 2000, B: 2500, P: 5500, D: 3000, F: 9000 };

async function clean() {
  for (const table of ['activity_logs', 'client_item_money', 'payments', 'enrollments', 'bundle_courses', 'bundles', 'courses', 'subscribers']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

async function client(id, { enrolments = [], payments = [] }) {
  await pool.query(
    "INSERT INTO subscribers (tenant_id, id, client_code, name, phone, branch, crm_json) VALUES (?, ?, ?, ?, ?, 'ONLINE_EGYPT', '{}')",
    [T, id, id.toUpperCase(), `عميل ${id}`, `1030${String(200000 + (seq += 1))}`]);
  for (const [course, bundle] of enrolments) {
    await pool.query("INSERT INTO enrollments (id, tenant_id, subscriber_id, course_id, bundle_id, enrolled_at, status) VALUES (?, ?, ?, ?, ?, NOW(), 'active')",
      [`${id}-e${(seq += 1)}`, T, id, course, bundle || null]);
  }
  for (const [bundle, amount, expected, date] of payments) {
    await pool.query(
      `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, bundle_id, amount, currency, fx_rate_to_egp, amount_egp, payment_type, status, course_expected, date)
       VALUES (?, ?, ?, NULL, ?, ?, 'EGP', 1, ?, 'BUNDLE', 'paid', ?, ?)`, [`${id}-p${(seq += 1)}`, T, id, bundle, amount, amount, expected, date]);
  }
}
const rowsOf = (track, bundle = track) => TRACKS[track].map(course => [course, bundle]);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  for (let n = 1; n <= 6; n += 1) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type, price_egp, is_published)
       VALUES (?, ?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', 1000, 1)`, [`c${n}`, T, `c${n}-ht`, `كورس ${n}`]);
  }
  for (const [id, courses] of Object.entries(TRACKS)) {
    await pool.query("INSERT INTO bundles (id, tenant_id, title, description, price_egp, is_published) VALUES (?, ?, ?, '', ?, 1)", [id, T, `مسار ${id}`, TRACK_PRICE[id]]);
    for (const course of courses) await pool.query('INSERT INTO bundle_courses (tenant_id, bundle_id, course_id) VALUES (?, ?, ?)', [T, id, course]);
  }
  await client('sa', { enrolments: rowsOf('P'), payments: [['P', 1000, 5500, '2026-10-01']] });
  await client('sb', { enrolments: [...rowsOf('A'), ...rowsOf('B')], payments: [['A', 500, 2000, '2026-09-01'], ['B', 700, 2500, '2026-10-05']] });
  await client('sc', { enrolments: [...rowsOf('A'), ...rowsOf('B'), ...rowsOf('D')], payments: [['A', 500, 2000, '2026-08-01'], ['B', 700, 2500, '2026-09-05'], ['D', 300, 3000, '2026-10-20']] });
  await client('sd', { enrolments: ['c1', 'c2', 'c3', 'c4'].map(course => [course, null]) });
  await client('se', { enrolments: ['c1', 'c2'].map(course => [course, null]) });
  await client('sf', { enrolments: [...rowsOf('P'), ['c5', null]], payments: [['P', 1000, 5500, '2026-10-01']] });
  await client('sg', { enrolments: rowsOf('P'), payments: [['A', 2000, 2000, '2026-08-01'], ['P', 1000, 5500, '2026-10-01']] });
  await client('sh', { enrolments: [...rowsOf('A'), ...rowsOf('P').filter(([course]) => ['c3', 'c4'].includes(course))] });
  // booked A and B, but the enrolments lost their track id (what the track naming used to join into P)
  await client('si', { enrolments: ['c1', 'c2', 'c3', 'c4'].map(course => [course, null]), payments: [['A', 500, 2000, '2026-09-01'], ['B', 700, 2500, '2026-10-05']] });
  // booked A and B, then the system named the loose courses into P (what trackNaming used to do)
  await client('sj', { enrolments: rowsOf('P'), payments: [['A', 500, 2000, '2026-09-01'], ['B', 700, 2500, '2026-10-05']] });
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

/** The three readings of one client, and that they agree on which items there are. */
async function readings(id) {
  const { clientMoney } = require('../../lib/clientMoney');
  const { itemBalances } = require('../../lib/agreedPrice');
  const { staffClientTools } = require('../../routes/admin/stafflists');
  const [rows] = await pool.query('SELECT * FROM subscribers WHERE tenant_id=? AND id=?', [T, id]);
  const [row] = await staffClientTools.shapeStaffSubscribers(T, rows);
  const route = await clientMoney(pool, { tenantId: T, subscriberId: id });
  const sql = await itemBalances(pool, { tenantId: T, subscriberId: id });
  const listed = new Map(row.moneyItems.map(line => [line.item, line]));
  assert.deepEqual([...new Set(route.items.map(line => line.item))].sort(), [...listed.keys()].sort(), `${id}: list and route name the same items`);
  assert.deepEqual([...sql.keys()].sort(), [...listed.keys()].sort(), `${id}: list and SQL name the same items`);
  for (const [key, line] of listed) {
    assert.equal(Math.round(sql.get(key).remaining * 100), Math.round(line.remaining * 100), `${id} ${key}: remaining`);
    assert.equal(route.items.find(entry => entry.item === key).partOf, line.partOf, `${id} ${key}: partOf`);
    assert.equal(sql.get(key).partOf || null, line.partOf, `${id} ${key}: partOf in SQL`);
  }
  return { listed, route };
}
const shownOf = ({ listed }) => [...listed.values()].filter(line => !line.partOf).map(line => line.item).sort();
const line = (r, key) => r.listed.get(key);
const figures = entry => [entry.expected, entry.paid, entry.remaining];

test('a. booked P shows P only', { skip }, async () => {
  const r = await readings('sa');
  assert.deepEqual(shownOf(r), ['bundle:P']);
  assert.equal(r.listed.size, 1);
  assert.deepEqual(figures(line(r, 'bundle:P')), [5500, 1000, 4500]);
});

test('b. A then B booked stay A and B — not turned into P, and no P debt appears', { skip }, async () => {
  const r = await readings('sb');
  assert.deepEqual(shownOf(r), ['bundle:A', 'bundle:B']);
  assert.equal(r.listed.size, 2);
  assert.deepEqual(figures(line(r, 'bundle:A')), [2000, 500, 1500]);
  assert.deepEqual(figures(line(r, 'bundle:B')), [2500, 700, 1800]);
});

test('c. A and B booked earlier, then D: A, B, D — not F', { skip }, async () => {
  const r = await readings('sc');
  assert.deepEqual(shownOf(r), ['bundle:A', 'bundle:B', 'bundle:D']);
  assert.equal(r.listed.size, 3);
  assert.deepEqual(figures(line(r, 'bundle:D')), [3000, 300, 2700]);
});

test('d. no track recorded, c1..c4 one by one: the track that fits (P), not A and B too', { skip }, async () => {
  const r = await readings('sd');
  assert.deepEqual([...r.listed.keys()], ['bundle:P']);
});

test('e. no track recorded, c1 and c2 only: A', { skip }, async () => {
  const r = await readings('se');
  assert.deepEqual([...r.listed.keys()], ['bundle:A']);
});

test('f. booked P and one loose course c5: P and the course, not D', { skip }, async () => {
  const r = await readings('sf');
  assert.deepEqual(shownOf(r), ['bundle:P', 'c5']);
  assert.equal(r.listed.size, 2);
});

test('g. A booked, then P (an upgrade): P only is shown; A keeps its money line, flagged as a part of P, and no balance moves', { skip }, async () => {
  const r = await readings('sg');
  assert.deepEqual(shownOf(r), ['bundle:P']);
  // what was booked and paid on A stays on A (2000 of 2000), what was booked on P stays on P (1000 of 5500): the same figures as before the rule
  assert.equal(line(r, 'bundle:A').partOf, 'bundle:P');
  assert.deepEqual(figures(line(r, 'bundle:A')), [2000, 2000, 0]);
  assert.deepEqual(figures(line(r, 'bundle:P')), [5500, 1000, 4500]);
  assert.equal(r.listed.size, 2);
});

test('h. enrolments carrying both P and A on different rows: P only, and no row is rewritten', { skip }, async () => {
  const before = JSON.stringify((await pool.query('SELECT course_id, bundle_id FROM enrollments WHERE tenant_id=? AND subscriber_id=? ORDER BY course_id', [T, 'sh']))[0]);
  const r = await readings('sh');
  assert.deepEqual([...r.listed.keys()], ['bundle:P']);
  assert.equal(JSON.stringify((await pool.query('SELECT course_id, bundle_id FROM enrollments WHERE tenant_id=? AND subscriber_id=? ORDER BY course_id', [T, 'sh']))[0]), before);
});

test('track naming does not join booked tracks into the bigger one, and leaves entitlements and balances as they were', { skip }, async () => {
  const { nameCompletedTracks } = require('../../lib/trackNaming');
  for (const id of ['si', 'sb', 'sc', 'sa', 'sg', 'sf']) {
    const state = async () => JSON.stringify([
      (await pool.query('SELECT course_id, bundle_id, status, access_type FROM enrollments WHERE tenant_id=? AND subscriber_id=? ORDER BY course_id', [T, id]))[0],
      (await pool.query('SELECT id, bundle_id, amount, course_expected FROM payments WHERE tenant_id=? AND subscriber_id=? ORDER BY id', [T, id]))[0],
    ]);
    const was = await state();
    const conn = await pool.getConnection();
    try { await conn.beginTransaction(); await nameCompletedTracks(conn, { tenantId: T, subscriberId: id }); await conn.commit(); } finally { conn.release(); }
    assert.equal(await state(), was, `${id}: nothing was written`);
  }
  const si = await readings('si');
  assert.deepEqual(shownOf(si), ['bundle:A', 'bundle:B']);
  assert.deepEqual(figures(line(si, 'bundle:A')), [2000, 500, 1500]);
});

test('track naming still names a client enrolled course by course (rule 4) and his balance does not move', { skip }, async () => {
  const { nameCompletedTracks } = require('../../lib/trackNaming');
  const { itemBalances } = require('../../lib/agreedPrice');
  const total = async id => [...(await itemBalances(pool, { tenantId: T, subscriberId: id })).values()].map(entry => [entry.item, entry.expected, entry.paid, entry.remaining]);
  const access = async id => JSON.stringify((await pool.query('SELECT course_id, status, access_type, lecture_limit FROM enrollments WHERE tenant_id=? AND subscriber_id=? ORDER BY course_id', [T, id]))[0]);
  const beforeBalances = await total('sd'); const beforeAccess = await access('sd');
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); const named = await nameCompletedTracks(conn, { tenantId: T, subscriberId: 'sd' }); await conn.commit(); assert.deepEqual(named.map(entry => entry.trackId), ['P']); } finally { conn.release(); }
  assert.deepEqual(await total('sd'), beforeBalances);
  assert.equal(await access('sd'), beforeAccess);
  const [rows] = await pool.query('SELECT DISTINCT bundle_id FROM enrollments WHERE tenant_id=? AND subscriber_id=?', [T, 'sd']);
  assert.deepEqual(rows.map(row => row.bundle_id), ['P']);
  assert.deepEqual([...(await readings('sd')).listed.keys()], ['bundle:P']);
});

test('the read-only audit lists the clients with a part beside its whole, and those booked small who now carry a bigger track', { skip }, async () => {
  await pool.query("INSERT INTO activity_logs (id, tenant_id, action, entity, entity_id, label, at) VALUES ('ht-log', ?, 'track_named', 'subscriber', 'sj', 'x', '2026-10-30 10:00:00')", [T]);
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  let status = 0; let stdout = '';
  try { stdout = execFileSync(process.execPath, [path.join(__dirname, '../../tools/held-tracks-audit.cjs'), '--tenant', T, '--json'], { env: { ...process.env, DB_PASSWORD: process.env.DB_PASSWORD ?? '' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }); } catch (error) { status = error.status; stdout = error.stdout; }
  assert.equal(status, 1);
  const found = JSON.parse(stdout);
  const kinds = found.map(entry => `${entry.kind}:${entry.code}`).sort();
  assert.deepEqual(kinds, ['booked_small:SJ', 'both_tracks:SG', 'both_tracks:SH', 'both_tracks:SJ']);
  assert.equal(found.find(entry => entry.code === 'SJ' && entry.kind === 'booked_small').named_by_system, '2026-10-30');
  assert.deepEqual(found.find(entry => entry.code === 'SJ' && entry.kind === 'booked_small').bookings.map(booking => booking.date), ['2026-09-01', '2026-10-05']);
  const { assertReadOnly, requireDbEnv } = require('../../tools/held-tracks-audit.cjs');
  assert.throws(() => assertReadOnly('UPDATE enrollments SET status=1'));
  assert.throws(() => requireDbEnv({}), /refusing to run/);
});
