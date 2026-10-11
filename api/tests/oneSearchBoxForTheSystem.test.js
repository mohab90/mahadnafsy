'use strict';

// «سيرش واحد للسيستم كله» (11 Oct 2026): the header's box finds clients, leads,
// payments by transaction number, certificates and tickets — each only for an
// account that may open it, inside its own scope, and always inside the tenant.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let mfaPolicy = { enabled: false, required_roles: [], required_permissions: [] };
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/mfaPolicy', {
  getMfaPolicy: async () => mfaPolicy,
  policyRequiresStaff: (policy, staff, permissions) => policy.enabled && permissions.some(p => policy.required_permissions.includes(p)),
});
stub('../routes/support', {
  ticketScope: req => (req.isSuperAdmin ? { sql: '1=1', params: [] } : { sql: '(t.department IN (?) OR t.assigned_to=?)', params: ['support', req.staffRecord.id] }),
});

const { searchSystem, searchableKinds, personMatch } = require('../lib/systemSearch');

function recorder(rows = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      const flat = String(sql).replace(/\s+/g, ' ');
      calls.push({ sql: flat, params });
      const table = (/FROM (\w+)/.exec(flat) || [])[1];
      return [rows[table] || []];
    },
  };
}
const ROOT = path.join(__dirname, '..', '..');

test('under two letters nothing is searched', async () => {
  const db = recorder();
  const answer = await searchSystem({ tenantId: 't1', isSuperAdmin: true }, 'ا', db);
  assert.deepEqual(answer.clients, []);
  assert.equal(db.calls.length, 0);
});

test('every kind is asked inside the tenant, and the owner gets all five', async () => {
  const db = recorder({
    subscribers: [{ id: 's1', client_code: 'C1', name: 'أحمد', phone: '1012345678' }],
    payments: [{ id: 'p1', amount: 1500, currency: 'EGP', transaction_id: 'TX778899', payment_no: 41, subscriber_id: 's1', client_code: 'C1', subscriber_name: 'أحمد' }],
    support_tickets: [{ id: 'tk1', ticket_code: 'TK-9', subject: 'مشكلة دخول' }],
  });
  const answer = await searchSystem({ tenantId: 't1', isSuperAdmin: true }, 'احمد', db);
  assert.deepEqual(answer.kinds, ['clients', 'leads', 'payments', 'certificates', 'tickets']);
  assert.equal(db.calls.length, 6, 'clients, leads, payments, two certificate reads, tickets');
  for (const call of db.calls) {
    assert.match(call.sql, /WHERE \w+\.tenant_id = \?/);
    assert.equal(call.params[0], 't1', call.sql);
  }
  assert.deepEqual(answer.clients[0].open, { client: 'C1' });
  assert.match(answer.payments[0].subtitle, /رقم العملية TX778899/);
  assert.deepEqual(answer.payments[0].open, { client: 'C1' }, 'a payment opens its client');
  assert.deepEqual(answer.tickets[0].open, { tab: 'tickets', ticket: 'tk1' });
});

test('each kind needs the permission its own screen asks for', async () => {
  const sales = { tenantId: 't1', staffRecord: { id: 'rep-1', role: 'sales', permissions_json: null } };
  const kinds = await searchableKinds(sales);
  assert.equal(kinds.leads, true);
  assert.equal(kinds.payments, false, 'a sales rep cannot open the payments register');
  assert.equal(kinds.certificates, false);
  const db = recorder();
  await searchSystem(sales, '0101', db);
  assert.ok(!db.calls.some(call => /FROM payments/.test(call.sql)));
  assert.ok(!db.calls.some(call => /FROM course_completions/.test(call.sql)));
  // Tickets it may answer (manage_inbox), but only its own department's queue.
  const tickets = db.calls.find(call => /FROM support_tickets/.test(call.sql));
  assert.match(tickets.sql, /t\.department IN \(\?\) OR t\.assigned_to=\?/);
  assert.ok(tickets.params.includes('rep-1'));
  // And the leads it does search are its own.
  const leads = db.calls.find(call => /FROM leads/.test(call.sql));
  assert.match(leads.sql, /l\.assigned_sales_id=\?/);
  assert.ok(leads.params.includes('rep-1'));
});

test('a kind behind a second factor waits for a verified session', async () => {
  mfaPolicy = { enabled: true, required_roles: [], required_permissions: ['view_financial'] };
  const accountant = { tenantId: 't1', user: { mfa_verified: false }, staffRecord: { id: 'acc', role: 'accountant' } };
  assert.equal((await searchableKinds(accountant)).payments, false);
  assert.equal((await searchableKinds({ ...accountant, user: { mfa_verified: true } })).payments, true);
  mfaPolicy = { enabled: false, required_roles: [], required_permissions: [] };
});

test('a phone needs three digits; a full number is matched in every spelling', () => {
  assert.doesNotMatch(personMatch('01', 's').sql, /REGEXP_REPLACE/, 'two digits are not a phone');
  assert.match(personMatch('010', 's').sql, /REGEXP_REPLACE\(COALESCE\(s\.phone/);
  const full = personMatch('+20 101 234 5678', 's');
  assert.match(full.sql, /s\.phone IN \(\?\)/);
  assert.ok(full.params[0].includes('1012345678'));
  assert.ok(personMatch('أحمد', 'l').params.every(param => param === '%احمد%'));
});

test('payments are found by transaction number, or by the system\'s payment number', async () => {
  const db = recorder();
  await searchSystem({ tenantId: 't1', isSuperAdmin: true }, '4417', db);
  const payments = db.calls.find(call => /FROM payments/.test(call.sql));
  assert.match(payments.sql, /LOWER\(COALESCE\(p\.transaction_id, ''\)\) LIKE \? OR p\.payment_no = \?/);
  assert.deepEqual(payments.params.slice(0, 3), ['t1', '%4417%', '4417']);
});

test('the route: staff only, private, and the public catalogue untouched', () => {
  const route = fs.readFileSync(path.join(ROOT, 'api/routes/public.js'), 'utf8');
  assert.match(route, /const SYSTEM_SEARCH_GUARD = \[requireAuth, requireAdminOrStaff, requireAnyPermission\(\.\.\.SYSTEM_SEARCH_PERMISSIONS\)\]/);
  assert.match(route, /if \(req\.query\.scope === 'system'\) return runGuards\(SYSTEM_SEARCH_GUARD/);
  assert.match(route, /res\.set\('Cache-Control', 'private, no-store'\)/);
  // The admin header opens it, with Ctrl+K.
  const header = fs.readFileSync(path.join(ROOT, 'admin/pages/dashboard/GlobalSearch.tsx'), 'utf8');
  assert.match(header, /\/search\?scope=system&q=/);
  assert.match(header, /event\.ctrlKey \|\| event\.metaKey\) && event\.key\.toLowerCase\(\) === 'k'/);
  assert.match(header, /q\.length < SEARCH_MIN_CHARS/);
  const nav = fs.readFileSync(path.join(ROOT, 'admin/pages/dashboard/DashboardNavigation.tsx'), 'utf8');
  assert.equal((nav.match(/<GlobalSearch /g) || []).length, 2, 'in the admin bar and in the role bar');
});
