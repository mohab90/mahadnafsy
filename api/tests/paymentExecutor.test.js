'use strict';

// «منفذ العملية» — who recorded a payment — read straight off
// payments.staff_name. On production 207 of 352 payments named nobody, one
// person appeared as «Admin Mohab» and as «mr.mohab1@gmail.com», and 9 rows
// stored a name that disagreed with the staff row their own staff_id named.
// lib/paymentExecutor.js answers from the strongest link first.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolvePaymentExecutors } = require('../lib/paymentExecutor');

/** A pool that answers the resolver's four questions from fixtures. */
function fakeDb({ staff = [], users = [], audit = [] }) {
  return {
    async query(sql, params) {
      if (/FROM staff WHERE tenant_id=\? AND id IN/.test(sql)) {
        const ids = params.slice(1);
        return [staff.filter(s => ids.includes(s.id)).map(s => ({ id: s.id, name: s.name }))];
      }
      if (/FROM payment_audit_log/.test(sql)) {
        const ids = params.slice(1);
        return [audit.filter(a => ids.includes(a.payment_id))];
      }
      if (/FROM staff[\s\S]*LOWER\(TRIM\(email\)\) IN/.test(sql)) {
        const emails = params.slice(1);
        return [staff.filter(s => s.email && emails.includes(s.email.toLowerCase())).map(s => ({ email: s.email.toLowerCase(), name: s.name }))];
      }
      if (/FROM users/.test(sql)) {
        const emails = params.slice(1);
        return [users.filter(u => emails.includes(u.email.toLowerCase())).map(u => ({ email: u.email.toLowerCase(), name: u.name }))];
      }
      throw new Error('unexpected query: ' + sql.slice(0, 60));
    },
  };
}

const db = fakeDb({
  staff: [
    { id: 's-hana', name: 'هنا', email: 'info@mahadnafsy.com' },
    { id: 's-walid', name: 'walid', email: 'walid@mahadnafsy.com' },
  ],
  users: [{ email: 'mr.mohab1@gmail.com', name: 'Admin Mohab' }],
  audit: [
    { payment_id: 'p-audit', actor: 'walid@mahadnafsy.com' },
    { payment_id: 'p-owner-audit', actor: 'mr.mohab1@gmail.com' },
  ],
});

test('the staff id wins over whatever name was stored beside it', async () => {
  const map = await resolvePaymentExecutors(db, 't', [{ id: 'p1', staff_id: 's-hana', staff_name: 'someone else' }]);
  assert.equal(map.get('p1'), 'هنا');
});

test('one person reads as one name: a stored email becomes the account behind it', async () => {
  const map = await resolvePaymentExecutors(db, 't', [
    { id: 'p2', staff_id: null, staff_name: 'mr.mohab1@gmail.com' },
    { id: 'p3', staff_id: null, staff_name: 'Admin Mohab' },
    { id: 'p4', staff_id: null, staff_name: 'info@mahadnafsy.com' },
  ]);
  assert.equal(map.get('p2'), 'Admin Mohab', 'the owner\'s email and his display name are two spellings of one person');
  assert.equal(map.get('p3'), 'Admin Mohab');
  assert.equal(map.get('p4'), 'هنا', 'a staff row is preferred to the login for the same address');
});

test('a row that names nobody is answered by its creation entry in the audit log', async () => {
  const map = await resolvePaymentExecutors(db, 't', [
    { id: 'p-audit', staff_id: null, staff_name: null },
    { id: 'p-owner-audit', staff_id: '', staff_name: '' },
  ]);
  assert.equal(map.get('p-audit'), 'walid');
  assert.equal(map.get('p-owner-audit'), 'Admin Mohab');
});

test('and one that is recorded nowhere says so rather than guessing', async () => {
  const map = await resolvePaymentExecutors(db, 't', [{ id: 'p-none', staff_id: null, staff_name: null }]);
  assert.equal(map.get('p-none'), null);
});

test('every screen that lists payments reads the resolved name, not the column', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  for (const rel of ['routes/payments.js', 'routes/admin/stafflists.js']) {
    const src = read(rel);
    assert.ok(!/staffName: p\.staff_name/.test(src), `${rel} reads staff_name raw again`);
    assert.match(src, /resolvePaymentExecutors\(pool, req\.tenantId,/);
  }
  // And the financial screen keeps what the API sent instead of a literal null.
  const hook = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'financial', 'useFinancialOrdersData.ts'), 'utf8');
  assert.ok(hook.includes('staffName: payment.staffName ?? null,'), 'loaded payments drop their executor again');
});
