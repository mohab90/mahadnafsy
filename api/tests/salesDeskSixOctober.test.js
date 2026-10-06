'use strict';

// The sales desk's list of 6 Oct 2026, and what the production log showed
// under it.
//
//   «ليه توزيع الداتا مش بيكون بالترتيب المفروض كل عميل جديد بيروح لسيلز جديد
//   لحد ما يخلص الليمت بتاعه» — every distributor went by open load whatever
//   «طريقة التوزيع» said, and a run stamped every rep with the same second.
//   «تقرير السيلز بيقول انه اتوزعلهم داتا اليوم وبدخل بيكون دا مش حقيقي» —
//   a lead handed out today may have arrived weeks ago; the report now says
//   which, lead by lead.
//   «لما السيلز بيعمل اخفاء للعميل بيظهر الايرور دا فشل حفظ البيانات» — 14
//   «Lead not found» on 6 Oct, the whole row re-sent to flip one field.
//   «Doaa Awny عندها عملاء مسئول عنهم 1,948» — 1,921 of them Dokki clients.
//   «Sama Shosha ضافته … وعملته حجز ومظهرش عندها في عملاءها» — a Tagamoa
//   booking, and a booking still waiting for the accounts.
// And from the log: WhatsApp sign-in failing on a require one folder short,
// a six-digit year reaching the database, and the sign-in audit refusing
// every row.
//
// Route handlers run against a scripted database, so a slip in them fails
// here rather than at the desk.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-sales-desk-secret-0123456789-abcdefghijklmnop';
const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const db = {
  calls: [],
  script: [],
  async query(sql, params = []) {
    const flat = String(sql).replace(/\s+/g, ' ').trim();
    db.calls.push({ sql: flat, params });
    for (const [pattern, answer] of db.script) {
      if (pattern.test(flat)) return typeof answer === 'function' ? answer(params, flat) : answer;
    }
    return /^(INSERT|UPDATE|DELETE)/i.test(flat) ? [{ affectedRows: 1 }] : [[]];
  },
  reset(script = []) { db.calls = []; db.script = script; },
  all(pattern) { return db.calls.filter(call => pattern.test(call.sql)); },
};
const conn = {
  query: (...args) => db.query(...args),
  execute: (...args) => db.query(...args),
  async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
};
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: { query: (...args) => db.query(...args), execute: (...args) => db.query(...args), getConnection: async () => conn },
  cached: async (_key, _ttl, fn) => fn(), cacheInvalidate() {},
  dbQuery: (...args) => db.query(...args), dbExecute: (...args) => db.query(...args),
  getStaffIdByEmail: async () => null, requireDb: (_req, _res, next) => next(), isDbDown: () => false,
});

const { createBatchAssigner, createRepRotation, getNextSalesRep } = require('../lib/leadAssignment');

const handlerOf = (router, method, route) => {
  const layer = router.stack.find(item => item.route && item.route.path === route && item.route.methods[method]);
  assert.ok(layer, `${method} ${route} is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};
async function call(handler, { body = {}, params = {}, query = {}, staffRecord = null, isSuperAdmin = false }) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  const req = { body, params, query, staffRecord, isSuperAdmin, user: { uid: 'u', email: 'desk@example.com' }, tenantId: 'tenant-default', headers: {}, ip: '127.0.0.1', get: () => undefined };
  await handler(req, res);
  return res;
}

// ── every require resolves ───────────────────────────────────────────────────

test('every relative require in the API resolves — the split route files sit a folder deeper', () => {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'tests'].includes(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.c?js$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(ROOT, 'api'));
  const broken = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      try { require.resolve(path.resolve(path.dirname(file), match[1])); } catch { broken.push(`${path.relative(ROOT, file)}: ${match[1]}`); }
    }
  }
  assert.deepEqual(broken, [], 'WhatsApp sign-in answered 500 «Cannot find module ../lib/lifecycle» on 5–6 Oct');
});

// ── in turn ──────────────────────────────────────────────────────────────────

const rosterDb = (rows, { mode = 'rr', loads = [] } = {}) => ({
  calls: [],
  async query(sql, params) {
    this.calls.push({ sql: String(sql).replace(/\s+/g, ' '), params });
    if (/FROM tenant_settings/.test(sql)) return [[{ config_json: JSON.stringify({ autoAssign: mode }) }]];
    if (/FROM staff s/.test(sql)) return [rows];
    if (/COUNT\(\*\) active_leads/.test(sql)) return [loads];
    return /^\s*UPDATE/i.test(sql) ? [{ affectedRows: 1 }] : [[]];
  },
});
const member = (id, lastAt, extra = {}) => ({
  id, name: id.toUpperCase(), policy_id: `p-${id}`, branch_key: '*', weight: 1, max_open_leads: null, is_available: 1,
  last_assigned_at: lastAt, intake_limit: null, intake_period: 'day', course_ids_json: null, sources_json: null, ...extra,
});

test('a lead arriving goes to whoever was handed one longest ago, whatever they hold', async () => {
  // Rawan holds the fewest open leads; by load she took every one until her cap.
  const rows = [member('rawan', '2026-10-06 10:00:03'), member('sama', '2026-10-06 10:00:01'), member('donia', '2026-10-06 10:00:02')];
  const loads = [{ assigned_sales_id: 'rawan', active_leads: 1 }, { assigned_sales_id: 'sama', active_leads: 900 }, { assigned_sales_id: 'donia', active_leads: 500 }];
  const fake = rosterDb(rows, { loads });
  assert.deepEqual(await getNextSalesRep('t', fake), { id: 'sama', name: 'SAMA' });
  assert.ok(fake.calls.some(call => /last_assigned_at=NOW\(3\)/.test(call.sql) && call.params[0] === 'p-sama'));
  // «الأقل تحميلاً» still means least loaded.
  assert.deepEqual(await getNextSalesRep('t', rosterDb(rows, { mode: 'least', loads })), { id: 'rawan', name: 'RAWAN' });
  // «بدون توزيع تلقائي»: nobody.
  assert.equal(await getNextSalesRep('t', rosterDb(rows, { mode: 'none', loads })), null);
});

test('a batch goes round the reps in turn, skips whoever reached their limit, and saves the order', async () => {
  const rows = [
    member('rawan', '2026-10-06 09:00:00.003'), member('sama', '2026-10-06 09:00:00.001'),
    member('donia', '2026-10-06 09:00:00.002', { intake_limit: 1 }),
  ];
  const fake = rosterDb(rows);
  const assigner = await createBatchAssigner('t', fake);
  const handed = Array.from({ length: 6 }, () => assigner.next()?.id ?? null);
  assert.deepEqual(handed, ['sama', 'donia', 'rawan', 'sama', 'rawan', 'sama'], 'Donia stops at her one');
  await assigner.flush();
  const saved = fake.calls.filter(call => /SET last_assigned_at=NOW\(3\) \+ INTERVAL \? MICROSECOND/.test(call.sql));
  // Saved in the order they were last served, a millisecond apart: Donia, Rawan, Sama.
  assert.deepEqual(saved.map(call => [call.params[1], call.params[0]]), [['p-donia', 0], ['p-rawan', 1000], ['p-sama', 2000]]);
});

test('a bulk distribution carries on from the turns on record instead of the first name', () => {
  const reps = [
    { id: 'a', name: 'A', weight: 1, activeLeads: 0, taken: 0, maxOpenLeads: null, intakeLimit: null, lastAssignedAt: '2026-10-06T10:00:02Z' },
    { id: 'b', name: 'B', weight: 1, activeLeads: 0, taken: 0, maxOpenLeads: null, intakeLimit: null, lastAssignedAt: '2026-10-06T10:00:01Z' },
  ];
  const rotation = createRepRotation(reps);
  assert.deepEqual([rotation.next().id, rotation.next().id, rotation.next().id], ['b', 'a', 'b']);
  assert.equal(typeof rotation.flush, 'function');
  const bulk = read('api/routes/admin/leads/assignment.js');
  assert.match(bulk, /await rotation\.flush\(conn, req\.tenantId\);/);
  assert.match(read('api/routes/gsheets.js'), /await rotation\.flush\(pool, req\.tenantId\)/);
  assert.match(read('api/migrations/251_v26_assignment_turns_to_the_millisecond.sql'), /MODIFY COLUMN last_assigned_at DATETIME\(3\) NULL/);
});

// ── the report ───────────────────────────────────────────────────────────────

test('«ليدز استلمها» says how many were new and lists the leads behind it', async () => {
  const { buildTeamDailyReport, listReceivedLeads } = require('../lib/teamDailyReport');
  db.reset([
    [/FROM staff/, [[{ id: 'sama', name: 'Sama Shosha' }]]],
    [/COUNT\(\*\) AS newLeads/, [[{ rep: 'sama', newLeads: 22, freshLeads: 13 }]]],
  ]);
  const report = await buildTeamDailyReport({ tenantId: 't', from: '2026-10-06', to: '2026-10-06', today: '2026-10-06' });
  assert.equal(report.reps[0].newLeads, 22);
  assert.equal(report.reps[0].freshLeads, 13);
  db.reset([[/FROM leads l/, [[{ id: 'l1', name: 'هاله', phone: '010', source: 'فيسبوك', status: 'new',
    created_at: new Date('2026-09-20T10:00:00Z'), assigned_at: new Date('2026-10-06T14:18:00Z'), fresh: 0, how: 'تعيين لـ: Sama Shosha' }]]]]);
  const rows = await listReceivedLeads({ tenantId: 't', repId: 'sama', from: '2026-10-06', to: '2026-10-06' });
  assert.deepEqual(rows.map(row => [row.id, row.fresh, row.how]), [['l1', false, 'تعيين لـ: Sama Shosha']]);
  const sql = db.calls[0].sql;
  assert.match(sql, /l\.assigned_sales_id=\? AND l\.assigned_at >= \? AND l\.assigned_at < \?/);
  const ui = read('admin/pages/dashboard/tabs/leads/TeamDailyReport.tsx');
  assert.match(ui, /\/admin\/crm\/team-report\/received\?rep=/);
  assert.match(ui, /جديدة · \{n\(rep\.newLeads - rep\.freshLeads\)\} من القديم/);
});

test('the online collection report counts the online desk\'s clients only', async () => {
  const { buildOnlineTeamReport } = require('../lib/teamReports');
  db.reset([
    [/FROM staff/, [[{ id: 'doaa', name: 'Doaa Awny', role: 'COLLECTION' }]]],
  ]);
  await buildOnlineTeamReport({ tenantId: 't', from: '2026-10-06', to: '2026-10-06', today: '2026-10-06' });
  const load = db.calls.find(call => /COUNT\(\*\) AS clients/.test(call.sql));
  assert.match(load.sql, /COALESCE\(sub\.branch, ''\) NOT IN \('DAQQI','TAGAMOA'\)/, 'Doaa Awny: 1,921 of 1,948 were Dokki clients');
  const collected = db.calls.find(call => /AS payments, SUM\(p\.is_installment=1\)/.test(call.sql) && /assigned_cs_id/.test(call.sql));
  assert.match(collected.sql, /NOT IN \('DAQQI','TAGAMOA'\)/);
  assert.match(read('api/routes/collection-distribution.js'), /AND COALESCE\(branch, ''\) NOT IN \('DAQQI','TAGAMOA'\) GROUP BY assigned_cs_id/);
  assert.doesNotMatch(read('api/routes/admin/stafflists.js'), /ONLINE_INTERNATIONAL/, 'the branch is ONLINE_ABROAD');
});

// ── hiding a lead ────────────────────────────────────────────────────────────

test('hiding a lead is one small request that says why when it cannot', async () => {
  const router = require('../routes/admin/leads');
  const hide = handlerOf(router, 'post', '/api/admin/leads/:id/visibility');
  const rep = { id: 'sama', name: 'Sama Shosha', role: 'SALES' };

  db.reset([[/SELECT l\.id, l\.hidden FROM leads l/, [[{ id: 'L1', hidden: 0 }]]]]);
  let res = await call(hide, { params: { id: 'L1' }, body: { hidden: true }, staffRecord: rep });
  assert.equal(res.statusCode, 200);
  const read1 = db.calls.find(call => /SELECT l\.id, l\.hidden FROM leads l/.test(call.sql));
  assert.match(read1.sql, /l\.assigned_sales_id=\?/, 'within the rep\'s own leads');
  assert.ok(db.all(/^UPDATE leads SET hidden=\?/).some(call => call.params[0] === 1));
  assert.ok(db.all(/INSERT INTO lead_timeline/).some(call => call.params.includes('hidden')));

  // Handed to someone else since the rep's screen loaded.
  db.reset([[/SELECT l\.id, l\.hidden FROM leads l/, [[]]], [/SELECT id FROM leads WHERE tenant_id=\? AND id=\?/, [[{ id: 'L1' }]]]]);
  res = await call(hide, { params: { id: 'L1' }, body: { hidden: true }, staffRecord: rep });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'LEAD_MOVED');
  assert.match(res.body.error, /مبقاش معاك/);
  assert.equal(db.all(/^UPDATE leads/).length, 0);

  res = await call(hide, { params: { id: 'L1' }, body: {}, staffRecord: rep });
  assert.equal(res.statusCode, 400);

  const table = read('admin/pages/dashboard/tabs/LeadTable.tsx');
  assert.match(table, /mysqlAdmin\.setLeadHidden\(row\.id, !row\.hidden\)/);
  assert.doesNotMatch(table, /updateLead\(\{ \.\.\.row, hidden: !row\.hidden \}\)/);
  // Any other refused lead save says what the server said.
  assert.match(read('admin/context/site-data-hooks/useCrmCoreState.ts'), /detail: \{ field: 'lead', name: item\.name, reason \}/);
});

// ── a rep's clients ──────────────────────────────────────────────────────────

test('a rep\'s «عملائي» holds every client they sold, a booking awaiting the accounts included', () => {
  const tab = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
  assert.match(tab, /: isSalesStaff \? branchScopedMasterList : branchScopedMasterList\.filter\(isOnlineClient\);/);
  assert.match(tab, /if \(\(s\.enrolledCourseIds\|\|\[\]\)\.length === 0 && !hasBooking\(s\)\) return false;/);
});

// ── errors the log found ─────────────────────────────────────────────────────

test('a course end date with a six-digit year is refused, not sent to the database', async () => {
  const router = require('../routes/core/content');
  const update = handlerOf(router, 'put', '/api/admin/subscribers/:id/course-access/:enrollmentId');
  db.reset([
    [/FROM subscribers/, [[{ id: 's1', branch: 'ONLINE_EGYPT', assigned_sales_id: null, assigned_cs_id: null, lead_id: null }]]],
    [/SELECT id, course_id, expiry_date FROM enrollments/, [[{ id: 'e1', course_id: 'c1', expiry_date: null }]]],
  ]);
  const res = await call(update, { params: { id: 's1', enrollmentId: 'e1' }, body: { expiresAt: '20266-10-06' }, isSuperAdmin: true });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /راجع السنة/);
  assert.equal(db.all(/UPDATE enrollments SET expiry_date/).length, 0);
});

test('a reactivated account takes its courses and first payment even when its record has another address', () => {
  const route = read('api/routes/auth/staffAccounts.js');
  assert.match(route, /if \(!reSub && phoneVal\) \{/);
  assert.match(route, /'SELECT id, tenant_id, branch, branch_id FROM subscribers WHERE tenant_id=\? AND id=\? LIMIT 1',\s*\[tenantId, targetSubId\]/);
  assert.doesNotMatch(route, /FROM subscribers WHERE tenant_id=\? AND LOWER\(TRIM\(email\)\)=\? LIMIT 1',\s*\[tenantId, normEmail\]\s*\);\s*if \(!paySub\)/);
});

test('the student assistant reads what a student studies from enrollments', () => {
  const route = read('api/routes/student-ai.js');
  assert.doesNotMatch(route, /'enrolled_courses'/);
  assert.match(route, /SELECT course_id FROM enrollments WHERE tenant_id=\? AND subscriber_id=\?/);
});

test('the sign-in audit can store a text account id, and lead names follow the rep', () => {
  assert.match(read('api/migrations/250_v26_login_history_user_id_text.sql'), /MODIFY COLUMN user_id VARCHAR\(100\) NULL/);
  assert.match(read('api/schema.sql'), /CREATE TABLE `login_history` \([\s\S]{0,200}`user_id` varchar\(100\) DEFAULT NULL/);
  const names = read('api/migrations/252_v26_lead_rep_name_follows_the_rep.sql');
  assert.match(names, /CREATE OR REPLACE TRIGGER trg_leads_assigned_at_update BEFORE UPDATE ON leads/);
  assert.match(names, /NEW\.assigned_sales_name = IF\(COALESCE\(NEW\.assigned_sales_id, ''\) = '', NEW\.assigned_sales_name,/);
  assert.match(names, /SET l\.assigned_sales_name = s\.name, l\.updated_at = l\.updated_at/);
});
