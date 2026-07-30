'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rotateSingleSession, closeSingleSession } = require('../lib/singleSession');

function fakePool() {
  const state = { version: 4, sessionId: null, ipHash: null, committed: false };
  const conn = {
    beginTransaction: async () => {},
    commit: async () => { state.committed = true; },
    rollback: async () => {},
    release: () => {},
    query: async (sql, params) => {
      if (sql.includes('SELECT session_version')) return [[{ session_version: state.version }]];
      if (sql.includes('UPDATE users')) {
        state.version = params[0];
        state.sessionId = params[1];
        state.ipHash = params[2];
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return {
    state,
    getConnection: async () => conn,
    query: async (sql, params) => {
      assert.match(sql, /active_session_id=\?/);
      assert.equal(params[2], state.sessionId);
      state.version += 1;
      state.sessionId = null;
      state.ipHash = null;
      return [{ affectedRows: 1 }];
    },
  };
}

test('a successful login atomically replaces the previous session and binds the new IP', async () => {
  const oldJwt = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'j'.repeat(48);
  const pool = fakePool();
  try {
    const session = await rotateSingleSession(pool, {
      userId: 'user-1',
      tenantId: 'tenant-1',
      req: { ip: '203.0.113.10' },
      countryCode: 'EG',
      currency: 'EGP',
    });
    assert.equal(session.sessionVersion, 5);
    assert.equal(session.sessionId, pool.state.sessionId);
    assert.equal(session.ipHash, pool.state.ipHash);
    assert.equal(pool.state.committed, true);
    assert.equal(await closeSingleSession(pool, {
      userId: 'user-1', tenantId: 'tenant-1', sessionId: session.sessionId,
    }), true);
    assert.equal(pool.state.sessionId, null);
  } finally {
    if (oldJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldJwt;
  }
});
