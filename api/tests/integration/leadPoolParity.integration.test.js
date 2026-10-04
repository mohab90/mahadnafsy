'use strict';
/**
 * The pool tabs («محلي جديد», «داتا سعودي», «محلي قديم») are filtered by the
 * server now (GET /api/admin/leads/pool, lib/leadPoolFilter.js) instead of in
 * the browser. This bundles the browser's own predicates
 * (admin/pages/dashboard/tabs/leads/leadSourceGroups.ts), runs them over every
 * lead of a random fixture as the browser received them, and checks the server
 * returns exactly the same leads for each tab — and the same «بدون مندوب»
 * breakdown. Runs only with DB_* and the admin's esbuild installed.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const ADMIN = path.join(__dirname, '..', '..', '..', 'admin');
const ESBUILD = path.join(ADMIN, 'node_modules', '.bin', 'esbuild');
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED ? 'no DB_* configured' : !fs.existsSync(ESBUILD) && 'admin dependencies not installed';
const T = 'tenant-lead-pool-it';
let pool, router, B;

const h = p => router.stack.find(l => l.route?.path === p && l.route.methods.get).route.stack.at(-1).handle;
async function call(p, query) {
  let body; const res = { status() { return this; }, json(b) { body = b; return this; }, set() { return this; } };
  await h(p)({ params: {}, query, body: {}, headers: {}, tenantId: T, user: { uid: 'a' }, staffRecord: null, isSuperAdmin: true, ip: '1', get: () => undefined }, res);
  return body;
}

function bundleBrowserPredicates() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-pool-'));
  const file = path.join(ADMIN, 'pages', 'dashboard', 'tabs', 'leads', 'leadSourceGroups');
  fs.writeFileSync(path.join(dir, 'entry.ts'), `export * from ${JSON.stringify(file)};`);
  execFileSync(ESBUILD, [path.join(dir, 'entry.ts'), '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${path.join(dir, 'browser.cjs')}`, '--log-level=error']);
  return require(path.join(dir, 'browser.cjs'));
}

let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; const pick = a => a[Math.floor(rnd() * a.length)];
async function fixture() {
  await pool.query('DELETE FROM leads WHERE tenant_id=?', [T]);
  const rows = [];
  for (let i = 0; i < 900; i++) {
    const crm = rnd() < 0.15 ? { branch: pick(['ONLINE_SAUDI', 'online abroad', 'DAQQI', ' ONLINE-SAUDI ']) } : null;
    const created = new Date(Date.now() - i * 60000);
    rows.push([`lp-${String(i).padStart(4, '0')}`, T, `LP${i}`, `name ${i}`, `10${String(19100000 + i)}`,
      pick(['facebook', 'website', 'محلي قديم', 'محلي قديم — موزّع', 'دولي قديم', 'استيراد يناير', 'دولي — سعودية', ' محلي قديم', '']),
      pick(['new', 'NEW', 'contacted', 'interested', 'converted', 'lost', 'archived', 'wrong_number', 'not_interested', 'follow_up', ' new']),
      rnd() < 0.45 ? pick(['s-1', 's-2']) : pick([null, '']),
      rnd() < 0.15 ? 'cs-1' : pick([null, '']),
      // The column is an ENUM; loose spellings live in crm_json.branch, above.
      pick(['ONLINE_EGYPT', 'DAQQI', 'ONLINE_SAUDI', 'ONLINE_ABROAD', null, null]),
      crm ? JSON.stringify(crm) : null, created, created, rnd() < 0.1 ? 1 : 0]);
  }
  await pool.query(`INSERT INTO leads (id, tenant_id, client_code, name, phone, source, status, assigned_sales_id, assigned_cs_id, branch, crm_json, created_at, updated_at, hidden) VALUES ?`, [rows]);
}

before(async () => {
  if (skip) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/admin/leads');
  B = bundleBrowserPredicates();
  await fixture();
});
after(async () => { if (!skip) { await pool.query('DELETE FROM leads WHERE tenant_id=?', [T]); await pool.end(); } });

/** Every lead as the browser received them (hidden included), via the list route. */
async function everyLead() {
  const visible = await call('/api/admin/leads', { limit: '5000' });
  // The list hides hidden rows; the browser predicates reject them anyway, and
  // reading them straight lets the test prove that.
  const [hidden] = await pool.query("SELECT id FROM leads WHERE tenant_id=? AND hidden=1", [T]);
  return [...visible, ...hidden.map(r => ({ id: r.id, hidden: true }))];
}

test('each pool tab returns exactly the leads the browser\'s own rules pick', { skip }, async () => {
  const leads = await everyLead();
  const browser = {
    localNew: leads.filter(B.isLocalNewLead),
    dawli: leads.filter(lead => B.isDawliNewLead(lead) || (!lead.hidden && B.isArchiveSource(lead.source) && B.isInternationalLead(lead))),
    archive: leads.filter(lead => !lead.hidden && B.isArchiveSource(lead.source) && !B.isInternationalLead(lead)),
  };
  for (const [view, expected] of Object.entries(browser)) {
    const body = await call('/api/admin/leads/pool', { view });
    assert.ok(expected.length > 10, `fixture covers ${view}`);
    assert.deepEqual(body.rows.map(r => r.id).sort(), expected.map(r => r.id).sort(), view);
    assert.equal(body.total, expected.length);
    assert.equal(body.truncated, false);
    assert.deepEqual(await call('/api/admin/leads/pool', { view, countOnly: '1' }), { total: expected.length }, `${view} badge`);
  }
});

test('the «بدون مندوب» breakdown matches explainUnassigned', { skip }, async () => {
  const leads = await everyLead();
  const expected = B.explainUnassigned(leads);
  const { breakdown } = await call('/api/admin/leads/pool', { view: 'localNew' });
  assert.equal(breakdown.withoutOwner, expected.withoutOwner);
  assert.equal(breakdown.localNew, expected.localNew);
  assert.equal(breakdown.dawliNew, expected.dawliNew);
  assert.equal(breakdown.archiveSource, expected.archiveSource);
  assert.deepEqual(
    Object.fromEntries(breakdown.terminal.map(t => [t.status, t.count])),
    Object.fromEntries(expected.terminal.map(t => [t.status, t.count])));
});
