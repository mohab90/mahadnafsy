'use strict';
/**
 * GET /admin/leads/table filters in SQL what the CRM's main table used to filter
 * in the browser. This bundles the browser's own predicate
 * (admin/pages/dashboard/tabs/leads/useLeadFilteringData.ts) and checks the
 * server returns exactly the leads it would, filter by filter, on a fixture that
 * has every spelling the predicate handles: branches in crm_json and in notes,
 * course lists in either place, follow-ups in either place, archive and online
 * sources, unassigned and nameless leads. Runs only with DB_* (or TEST_DB_*) and
 * the admin's esbuild installed.
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
const T = 'tenant-lead-table-it';
let pool, router, B, cairoToday, addDaysToDateOnly;

const h = p => router.stack.find(l => l.route?.path === p && l.route.methods.get).route.stack.at(-1).handle;
async function call(p, query) {
  let body; const res = { status() { return this; }, json(b) { body = b; return this; }, set() { return this; } };
  await h(p)({ params: {}, query, body: {}, headers: {}, tenantId: T, user: { uid: 'a' }, staffRecord: null, isSuperAdmin: true, ip: '1', get: () => undefined }, res);
  return body;
}

function bundleBrowserFilter() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-table-'));
  fs.writeFileSync(path.join(dir, 'react.js'), 'export const useMemo = fn => fn(); export const useCallback = fn => fn; export default { useMemo, useCallback };');
  const tabs = path.join(ADMIN, 'pages', 'dashboard', 'tabs');
  fs.writeFileSync(path.join(dir, 'entry.ts'), [
    `export { useLeadFilteringData } from ${JSON.stringify(path.join(tabs, 'leads', 'useLeadFilteringData'))};`,
    `export { useLeadEffectiveRecords } from ${JSON.stringify(path.join(tabs, 'leads', 'useLeadEffectiveRecords'))};`,
    `export { setStaleDays } from ${JSON.stringify(path.join(tabs, 'leadUtils'))};`,
  ].join('\n'));
  execFileSync(ESBUILD, [path.join(dir, 'entry.ts'), '--bundle', '--platform=node', '--format=cjs',
    `--alias:react=${path.join(dir, 'react.js')}`, `--outfile=${path.join(dir, 'browser.cjs')}`, '--log-level=error']);
  return require(path.join(dir, 'browser.cjs'));
}

let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; const pick = a => a[Math.floor(rnd() * a.length)];
async function fixture() {
  for (const t of ['communications', 'leads', 'staff']) await pool.query(`DELETE FROM ${t} WHERE tenant_id=?`, [T]);
  await pool.query(`INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('lt-1',?,'R1','lt1@x.t','1018000091','SALES',1,'2025-01-01'),('lt-2',?,'R2','lt2@x.t','1018000092','SALES',1,'2025-01-01')`, [T, T]);
  const today = cairoToday();
  const rows = []; const comms = [];
  for (let i = 0; i < 700; i++) {
    const crm = {};
    if (rnd() < 0.2) crm.tags = [pick(['vip', 'hot', 'x'])];
    if (rnd() < 0.15) crm.branch = pick(['DAQQI', 'online egypt']);
    if (rnd() < 0.15) crm.rawBranch = pick(['الدقي', 'التجمع']);
    if (rnd() < 0.2) crm.interestedCourseIds = [pick(['c1', 'c2'])];
    if (rnd() < 0.15) crm.nextFollowUpDate = addDaysToDateOnly(today, Math.floor(rnd() * 40) - 20);
    const created = new Date(Date.now() - Math.floor(rnd() * 60) * 86400000 - i * 1000);
    const nf = rnd() < 0.4 ? addDaysToDateOnly(today, Math.floor(rnd() * 40) - 20) + ' 00:00:00' : null;
    rows.push([`lt-${String(i).padStart(4, '0')}`, T, `CP${i}`, rnd() < 0.05 ? '' : `${pick(['Ahmed Ali', 'منى حسن', 'Sara Adel', 'ياسمين'])} ${i}`,
      rnd() < 0.3 ? `p${i}@m.t` : null, rnd() < 0.05 ? null : `10${String(18100000 + i)}`,
      pick(['facebook', 'website', 'أونلاين 2025', 'محلي قديم — موزّع', 'استيراد يناير', '']),
      pick(['new', 'contacted', 'interested', 'converted', 'lost', 'not_interested', 'wrong_number', 'follow_up']),
      rnd() < 0.85 ? pick(['lt-1', 'lt-2']) : pick([null, '']),
      pick(['ONLINE_EGYPT', 'DAQQI', 'TAGAMOA', null, null]),
      rnd() < 0.3 ? `ملاحظة ${pick(['اتصال', 'حجز'])} | الفرع: ${pick(['الدقي', 'التجمع'])} | x` : (rnd() < 0.2 ? 'notes special word' : null),
      rnd() < 0.3 ? JSON.stringify([pick(['c1', 'c2'])]) : (rnd() < 0.2 ? '[]' : null),
      Object.keys(crm).length ? JSON.stringify(crm) : null, nf, created, created, rnd() < 0.08 ? 1 : 0]);
    const n = Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) comms.push([`ltc-${i}-${k}`, T, rows[i][0], 'CALL', new Date(Date.now() - Math.floor(rnd() * 40) * 86400000), 'n', 'lt-1']);
  }
  await pool.query(`INSERT INTO leads (id, tenant_id, client_code, name, email, phone, source, status, assigned_sales_id, branch, notes, interested_course_ids_json, crm_json, next_follow_up_date, created_at, updated_at, hidden) VALUES ?`, [rows]);
  if (comms.length) await pool.query('INSERT INTO communications (id, tenant_id, lead_id, type, date, notes, staff_id) VALUES ?', [comms]);
}

before(async () => {
  if (skip) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/admin/leads');
  ({ cairoToday, addDaysToDateOnly } = require('../../lib/dates'));
  B = bundleBrowserFilter();
  await fixture();
});
after(async () => {
  if (skip) return;
  for (const t of ['communications', 'leads', 'staff']) await pool.query(`DELETE FROM ${t} WHERE tenant_id=?`, [T]);
  await pool.end();
});
test('the server table returns exactly what the browser predicate selected', { skip }, async () => {
  const leads = JSON.parse(JSON.stringify(await call('/api/admin/leads', { limit: '5000' })));
  B.setStaleDays([7, 15, 30, 90]);
  const { effectiveLeads } = B.useLeadEffectiveRecords({ leads, subscribers: [], isSalesOnly: false });
  const branches = [{ id: 'DAQQI', label: 'الدقي' }];
  const base = { effectiveLeads, leads, salesReps: [], selectedId: null, isSalesOnly: false, assignFilter: new Set(), searchTerm: '', tagFilter: null, sourceFilter: new Set(), courseFilter: null, branchFilter: null, singleStatus: '', showHiddenLeads: false, rottenFilter: false, salesSourceFilter: '', leadsFollowupFilter: 'all', statusFilter: new Set(), instituteBranches: branches };
  const cases = [
    ['default', {}, {}],
    ['source', { sourceFilter: new Set(['facebook']) }, { sources: 'facebook' }],
    ['assign', { assignFilter: new Set(['lt-2']) }, { assigned: 'lt-2' }],
    ['assign none', { assignFilter: new Set(['__none__']) }, { assigned: '__none__' }],
    ['tag', { tagFilter: 'vip' }, { tag: 'vip' }],
    ['course c1', { courseFilter: 'c1' }, { course: 'c1' }],
    ['course none', { courseFilter: '__none__' }, { course: '__none__' }],
    ['branch DAQQI', { branchFilter: 'DAQQI' }, { branch: 'DAQQI', branchLabel: 'الدقي' }],
    ['branch ONLINE_EGYPT', { branchFilter: 'ONLINE_EGYPT' }, { branch: 'ONLINE_EGYPT' }],
    ['branch none', { branchFilter: '__none__' }, { branch: '__none__' }],
    ['status', { singleStatus: 'contacted' }, { status: 'contacted' }],
    ['rotten', { rottenFilter: true }, { rotten: '1', staleDays: '7' }],
    ['salesSource none', { salesSourceFilter: '__none__' }, { salesSource: '__none__' }],
    ...['no_followup', 'today', 'overdue', 'past3d', 'past7d', 'past30d', 'next3d', 'next7d'].map(f => [`followup ${f}`, { leadsFollowupFilter: f }, { followup: f }]),
    ['search name', { searchTerm: 'Ahmed' }, { q: 'Ahmed' }],
    ['search arabic', { searchTerm: 'منى' }, { q: 'منى' }],
    ['search digits', { searchTerm: '1810012' }, { q: '1810012' }],
    ['search short', { searchTerm: 'Sa' }, { q: 'Sa' }],
    ['search notes', { searchTerm: 'special' }, { q: 'special' }],
    ['search email', { searchTerm: 'p1' }, { q: 'p1' }],
  ];
  for (const [label, browserArgs, query] of cases) {
    const expected = B.useLeadFilteringData({ ...base, ...browserArgs }).scoredLeads.map(l => l.id).sort();
    const got = [];
    let total = 0;
    for (let page = 0; ; page++) {
      const r = await call('/api/admin/leads/table', { ...query, page: String(page), pageSize: '200' });
      total = r.total;
      got.push(...r.rows.map(x => x.id));
      if (!r.rows.length || got.length >= r.total) break;
    }
    assert.equal(total, expected.length, `${label}: total`);
    assert.deepEqual(got.sort(), expected, label);
  }
});

test('the pipeline board: each column\'s count and first cards are the browser\'s', { skip }, async () => {
  const leads = JSON.parse(JSON.stringify(await call('/api/admin/leads', { limit: '5000' })));
  const { effectiveLeads } = B.useLeadEffectiveRecords({ leads, subscribers: [], isSalesOnly: false });
  const base = { effectiveLeads, leads, salesReps: [], selectedId: null, isSalesOnly: false, assignFilter: new Set(), searchTerm: '', tagFilter: null, sourceFilter: new Set(), courseFilter: null, branchFilter: null, singleStatus: '', showHiddenLeads: false, rottenFilter: false, salesSourceFilter: '', leadsFollowupFilter: 'all', statusFilter: new Set(), instituteBranches: [] };
  for (const [label, browserArgs, query] of [['default', {}, {}], ['source', { sourceFilter: new Set(['facebook']) }, { sources: 'facebook' }]]) {
    const { scoredLeads } = B.useLeadFilteringData({ ...base, ...browserArgs });
    const statuses = [...new Set(scoredLeads.map(l => l.status))];
    assert.ok(statuses.length >= 4, 'fixture spreads over columns');
    const board = await call('/api/admin/leads/board', { ...query, statuses: statuses.join(','), limits: `${statuses[0]}:40` });
    for (const status of statuses) {
      const column = scoredLeads.filter(l => l.status === status);
      assert.equal(board.counts[status], column.length, `${label} ${status}: count`);
      const limit = status === statuses[0] ? 40 : 15;
      assert.deepEqual(board.rows.filter(r => r.status === status).map(r => r.id), column.slice(0, limit).map(l => l.id), `${label} ${status}: first cards`);
    }
  }
});
