'use strict';
// Four routes decide "is this incoming customer someone we already know?" and
// then act on the answer: reuse the matched lead's id and client_code, mark it
// converted, or write a paid total onto its deal_value. A false match therefore
// moves one customer's money, pipeline status and sales assignment onto another
// customer's record — so what these queries consider "the same number" is the
// whole safety property.
const { test } = require('node:test');
const assert = require('node:assert');
const { findLeadByContact, phoneIdentityClause } = require('../lib/leadMatching');

// Minimal stand-in: records the SQL and params, returns whatever rows are set.
function fakeDb(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) { calls.push({ sql, params }); return [rows]; },
  };
}

test('phoneIdentityClause never matches a number by its tail', () => {
  const clause = phoneIdentityClause('66501234567');
  assert.ok(clause, 'a plausible number must produce a clause');
  assert.ok(!/LIKE/i.test(clause.sql), 'no wildcard matching');
  assert.ok(!/RIGHT\s*\(/i.test(clause.sql), 'no last-N-digits truncation');
  // The Saudi number this tail belongs to must not be among the values.
  assert.ok(!clause.params.includes('966501234567'));
});

test('phoneIdentityClause keeps two different numbers apart', () => {
  // Egyptian 201012345678 and UK 441012345678 share their last 10 digits, which
  // is exactly what RIGHT(digits,10) compared.
  const eg = phoneIdentityClause('201012345678');
  const uk = phoneIdentityClause('441012345678');
  const overlap = eg.params.filter(value => uk.params.includes(value));
  assert.deepEqual(overlap, [], `these must share no spelling, got ${overlap.join()}`);
});

test('phoneIdentityClause matches every spelling of one number', () => {
  const clause = phoneIdentityClause('+20 101 234 5678');
  for (const spelling of ['1012345678', '01012345678', '201012345678']) {
    assert.ok(clause.params.includes(spelling), `missing spelling ${spelling}`);
  }
});

test('phoneIdentityClause returns null rather than a match-everything clause', () => {
  assert.equal(phoneIdentityClause(''), null);
  assert.equal(phoneIdentityClause('123'), null);
  assert.equal(phoneIdentityClause(null), null);
});

test('findLeadByContact does not search for a blank email', async () => {
  // `email || ''` matched any lead stored with an empty email, and
  // ORDER BY created_at DESC then picked whichever stranger was newest.
  const db = fakeDb([]);
  await findLeadByContact(db, { tenantId: 't1', phone: '01012345678', email: null });
  const { sql, params } = db.calls[0];
  assert.ok(!/email = \?/.test(sql), 'no email term when there is no email');
  assert.ok(!params.includes(''), 'an empty string must never be a search value');
});

test('findLeadByContact returns null without querying when it has nothing to match', async () => {
  const db = fakeDb([{ id: 'lead-1' }]);
  const found = await findLeadByContact(db, { tenantId: 't1', phone: '', email: '  ' });
  assert.equal(found, null);
  assert.equal(db.calls.length, 0, 'must not run a query that could match anything');
});

test('findLeadByContact still includes legacy rows for the default tenant', async () => {
  // Rows written before tenanting carry NULL/'' tenant_id. appendTenantScope
  // treats those as the default tenant's, and narrowing that here would orphan
  // them from all four callers at once.
  const db = fakeDb([]);
  await findLeadByContact(db, { tenantId: 'tenant-default', phone: '01012345678' });
  assert.match(db.calls[0].sql, /tenant_id IS NULL/);
});

test('findLeadByContact scopes a real tenant strictly', async () => {
  const db = fakeDb([]);
  await findLeadByContact(db, { tenantId: 'tenant-abc', phone: '01012345678' });
  assert.ok(!/tenant_id IS NULL/.test(db.calls[0].sql), 'a named tenant must not see untenanted rows');
  assert.equal(db.calls[0].params[0], 'tenant-abc');
});

test('findLeadByContact runs on the connection it is given', async () => {
  // The subscriber-save caller is mid-transaction; querying the pool instead
  // would read outside it and miss its own uncommitted writes.
  const conn = fakeDb([]);
  await findLeadByContact(conn, { tenantId: 't1', email: 'a@b.c' });
  assert.equal(conn.calls.length, 1);
});
