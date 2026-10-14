'use strict';

// «بحث» (13 Oct 2026): the button at the foot of every screen finds EVERY client
// from the second letter — whoever owns them — and says who has them, so a rep
// does not register a client who is already someone else's. The file itself
// stays behind its own check: canOpen says whether the caller may open it.

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

const queries = [];
let subscriberRows = [];
let leadRows = [];
stub('../lib/db', {
  pool: {
    query: async (sql, params) => {
      queries.push({ sql: String(sql).replace(/\s+/g, ' '), params });
      if (/FROM subscribers s/.test(sql)) return [subscriberRows];
      if (/FROM leads l/.test(sql)) return [leadRows];
      return [[]];
    },
  },
});
stub('../lib/logger', { error() {}, warn() {}, info() {} });
const pass = (req, res, next) => next();
stub('../middleware/auth', {
  requireAuth: pass, requireAdminOrStaff: pass, requirePermission: () => pass,
});

const router = require('../routes/misc/clientDbSearch');
const layer = router.stack.find(l => l.route && l.route.path === '/api/admin/client-lookup');
const handler = layer.route.stack[layer.route.stack.length - 1].handle;

async function call(req) {
  let body;
  const res = { status() { return this; }, json(value) { body = value; return this; } };
  await handler({ tenantId: 't1', query: {}, ...req }, res);
  return body;
}

const rep = { id: 'rep1', role: 'sales', permissions_json: null };

test('under two letters nothing is searched', async () => {
  queries.length = 0;
  const answer = await call({ query: { q: 'ا' }, staffRecord: rep });
  assert.deepEqual(answer.rows, []);
  assert.equal(queries.length, 0);
});

test('the route is registered for staff, behind the permission every role holds', () => {
  assert.ok(layer, 'GET /api/admin/client-lookup exists');
  assert.equal(layer.route.methods.get, true);
  const { hasPermission, ROLES } = require('../constants/permissions');
  for (const role of Object.values(ROLES)) assert.ok(hasPermission({ role }, 'manage_payments'), `${role} holds manage_payments, so the button works for it`);
});

test("a rep finds somebody else's client, told whose it is, and may not open the file", async () => {
  queries.length = 0;
  subscriberRows = [
    { id: 's1', client_code: 'C1', name: 'أحمد علي', phone: '1012345678', branch: 'ONLINE_EGYPT', is_active: 1,
      assigned_sales_id: 'someone-else', assigned_cs_id: null, owner_name: 'منى', lead_sales_id: null, lead_cs_id: null },
    { id: 's2', client_code: 'C2', name: 'أحمد حسن', phone: '1099999999', branch: 'ONLINE_EGYPT', is_active: 1,
      assigned_sales_id: 'rep1', assigned_cs_id: null, owner_name: 'أنا', lead_sales_id: null, lead_cs_id: null },
  ];
  leadRows = [];
  const answer = await call({ query: { q: 'احمد' }, staffRecord: rep });
  assert.equal(answer.rows.length, 2);
  const theirs = answer.rows.find(r => r.id === 's1');
  const mine = answer.rows.find(r => r.id === 's2');
  assert.equal(answer.rows[0].id, 's2', 'the caller’s own come first');
  assert.equal(theirs.owner, 'منى');
  assert.equal(theirs.canOpen, false);
  assert.equal(theirs.mine, false);
  assert.equal(mine.canOpen, true);
  assert.equal(mine.mine, true);
  // Never scoped by the caller's own clients, always by tenant.
  const subQuery = queries.find(q => /FROM subscribers s/.test(q.sql));
  assert.doesNotMatch(subQuery.sql, /assigned_sales_id\s*=\s*\?/);
  assert.equal(subQuery.params[0], 't1');
});

test('a manager opens every file, and a converted lead is not listed twice', async () => {
  queries.length = 0;
  subscriberRows = [
    { id: 's1', client_code: 'C1', name: 'سارة', phone: '1011111111', branch: 'DAQQI', is_active: 1,
      assigned_sales_id: 'x', assigned_cs_id: null, owner_name: 'x', lead_sales_id: null, lead_cs_id: null },
  ];
  leadRows = [
    { id: 'l1', client_code: 'L1', name: 'سارة', phone: '1011111111', branch: 'DAQQI', status: 'converted', can_open: 1, owner_name: 'x', assigned_sales_id: 'x' },
    { id: 'l2', client_code: 'L2', name: 'سارة محمد', phone: '1022222222', branch: 'DAQQI', status: 'new', can_open: 0, owner_name: 'y', assigned_sales_id: 'y' },
  ];
  const answer = await call({ query: { q: 'سارة' }, staffRecord: { id: 'm1', role: 'daqqi_manager' } });
  assert.deepEqual(answer.rows.map(r => r.id), ['l2', 's1'], 'a lead before a subscriber on a tie; the converted one once, as the client');
  assert.equal(answer.rows.find(r => r.id === 's1').canOpen, true, 'a branch manager opens any client');
  assert.equal(answer.rows.find(r => r.id === 'l2').canOpen, false, "a lead outside the caller's lead scope stays closed");
});

test('the lead scope is asked of the same SQL the lists use, and never hides the row', async () => {
  queries.length = 0;
  subscriberRows = [];
  leadRows = [];
  await call({ query: { q: 'محمد' }, staffRecord: rep });
  const leadQuery = queries.find(q => /FROM leads l/.test(q.sql));
  assert.match(leadQuery.sql, /\(1=1 AND l\.assigned_sales_id=\?\) AS can_open/);
  assert.doesNotMatch(leadQuery.sql, /WHERE[^]*l\.assigned_sales_id=\?[^]*ORDER BY/, 'the scope is a column, not a filter');
  assert.equal(leadQuery.params[0], 'rep1', 'the scope parameter comes first, as it appears first in the SQL');
  assert.equal(leadQuery.params[1], 't1');
});

test('every row says what it is — a lead, or a subscriber of online, Dokki or Tagamoa — and hidden leads are found', async () => {
  queries.length = 0;
  subscriberRows = [
    { id: 'a', client_code: 'C1', name: 'مها أونلاين', phone: '1', email: 'm@x.test', branch: 'ONLINE_EGYPT', is_active: 1, assigned_sales_id: null, assigned_cs_id: null, owner_name: null, lead_sales_id: null, lead_cs_id: null },
    { id: 'b', client_code: 'C2', name: 'مها الدقي', phone: '2', branch: 'DAQQI', is_active: 1, assigned_sales_id: null, assigned_cs_id: null, owner_name: null, lead_sales_id: null, lead_cs_id: null },
    { id: 'c', client_code: 'C3', name: 'مها التجمع', phone: '3', branch: 'TAGAMOA', is_active: 1, assigned_sales_id: null, assigned_cs_id: null, owner_name: null, lead_sales_id: null, lead_cs_id: null },
  ];
  leadRows = [{ id: 'l', client_code: 'L9', name: 'مها ليد', phone: '4', branch: 'ONLINE_EGYPT', status: 'new', hidden: 1, can_open: 1, owner_name: 'z', assigned_sales_id: 'z' }];
  const answer = await call({ query: { q: 'مها' }, staffRecord: { id: 'm1', role: 'admin' } });
  const byId = Object.fromEntries(answer.rows.map(r => [r.id, r]));
  assert.deepEqual([byId.l.type, byId.a.type, byId.b.type, byId.c.type], ['lead', 'online', 'daqqi', 'tagamoa']);
  assert.deepEqual([byId.l.typeLabel, byId.a.typeLabel, byId.b.typeLabel, byId.c.typeLabel], ['ليد', 'مشترك أونلاين', 'مشترك الدقي', 'مشترك التجمع']);
  assert.equal(byId.c.place, 'عميل التجمع');
  assert.equal(byId.l.place, 'ليد مخفي', 'a hidden lead is still a person — the one a rep would register twice');
  assert.equal(byId.l.canOpen, false, 'a hidden lead has no file page — it is shown, not opened');
  assert.equal(byId.a.email, 'm@x.test');
  const leadQuery = queries.find(q => /FROM leads l/.test(q.sql));
  assert.doesNotMatch(leadQuery.sql, /hidden, 0\) = 0/, 'hidden leads are not filtered out');
});
