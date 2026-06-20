'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { tenantDb } = require('../lib/tenantDb');

function fakePool() {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return [[], {}]; } };
}

test('select is always scoped by tenant_id', async () => {
  const pool = fakePool();
  await tenantDb(pool, 'acme').select('leads');
  assert.match(pool.calls[0].sql, /WHERE tenant_id = \?/);
  assert.deepEqual(pool.calls[0].params, ['acme']);
});

test('select appends extra predicates after the tenant filter', async () => {
  const pool = fakePool();
  await tenantDb(pool, 'acme').select('leads', 'status = ?', ['new']);
  assert.match(pool.calls[0].sql, /tenant_id = \? AND \(status = \?\)/);
  assert.deepEqual(pool.calls[0].params, ['acme', 'new']);
});

test('insert forces tenant_id onto the row', async () => {
  const pool = fakePool();
  await tenantDb(pool, 'acme').insert('leads', { id: '1', name: 'x' });
  assert.ok(pool.calls[0].sql.includes('tenant_id'));
  assert.ok(pool.calls[0].params.includes('acme'));
});

test('update is scoped by tenant_id', async () => {
  const pool = fakePool();
  await tenantDb(pool, 'acme').update('leads', { name: 'y' }, 'id = ?', ['1']);
  assert.match(pool.calls[0].sql, /WHERE tenant_id = \? AND \(id = \?\)/);
});

test('assertOwned blocks cross-tenant rows but allows same tenant', () => {
  const db = tenantDb(fakePool(), 'acme');
  assert.throws(() => db.assertOwned({ tenant_id: 'other' }), /cross-tenant/);
  assert.doesNotThrow(() => db.assertOwned({ tenant_id: 'acme' }));
  assert.doesNotThrow(() => db.assertOwned(null));
});

test('defaults to the mahad tenant when none supplied', () => {
  assert.equal(tenantDb(fakePool()).tenantId, 'mahad');
});

test('table/column identifiers are sanitised', async () => {
  const pool = fakePool();
  await tenantDb(pool, 't').select('leads; DROP TABLE x');
  assert.ok(!pool.calls[0].sql.includes('DROP TABLE'));
});
