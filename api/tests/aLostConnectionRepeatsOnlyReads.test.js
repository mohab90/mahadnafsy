'use strict';

// lib/db.js, from an outside review on 7 Oct 2026:
//   - after a lost connection it sent any statement again, a write included,
//     though the write may have reached the server before the answer was lost —
//     a counter bumped twice, an insert under a fresh id twice;
//   - a connection that arrived after getConnection's four-second timeout was
//     never handed back, one pool slot gone for good per timeout.
// Run against a scripted mysql2 pool.

const test = require('node:test');
const assert = require('node:assert/strict');

const fake = {
  queries: [], failNext: null, connections: [], connectionGate: null,
  async query(sql) {
    fake.queries.push(sql);
    if (fake.failNext) { const code = fake.failNext; fake.failNext = null; throw Object.assign(new Error(code), { code }); }
    return [[{ ok: 1 }]];
  },
  async getConnection() {
    if (fake.connectionGate) await fake.connectionGate;
    const conn = { released: 0, query: async () => [[]], execute: async () => [[]], release() { conn.released += 1; } };
    fake.connections.push(conn);
    return conn;
  },
};
const mysqlPath = require.resolve('mysql2/promise');
require.cache[mysqlPath] = {
  id: mysqlPath, filename: mysqlPath, loaded: true,
  exports: { createPool: () => ({ query: fake.query, execute: fake.query, getConnection: fake.getConnection, on() {} }) },
};
const { pool } = require('../lib/db');

test('a read is sent again after a lost connection', async () => {
  fake.queries.length = 0;
  fake.failNext = 'ECONNRESET';
  const [[row]] = await pool.query('SELECT 1 AS ok');
  assert.equal(row.ok, 1);
  assert.equal(fake.queries.length, 2);
});

test('a write is not: it may already have been applied', async () => {
  for (const sql of ['UPDATE referral_codes SET uses = uses + 1 WHERE code = ?', 'INSERT INTO payments (id) VALUES (?)']) {
    fake.queries.length = 0;
    fake.failNext = 'ECONNRESET';
    await assert.rejects(pool.query(sql, ['x']), /ECONNRESET/);
    assert.equal(fake.queries.length, 1, sql);
  }
});

test('a connection that arrives after the timeout is handed back', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let open;
  fake.connectionGate = new Promise(resolve => { open = resolve; });
  const waiting = pool.getConnection();
  await Promise.resolve();
  t.mock.timers.tick(4000);
  await assert.rejects(waiting, /getConnection timeout/);
  fake.connectionGate = null;
  open();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fake.connections.length, 1);
  assert.equal(fake.connections[0].released, 1, 'the late connection went back to the pool');
});
