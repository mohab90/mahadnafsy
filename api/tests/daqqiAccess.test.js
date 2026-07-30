'use strict';
// Access control for the Daqqi branch (schedules, attendance, rounds) had no
// test coverage, and attendance/Daqqi was the thinnest-covered domain in the
// audit. These pin the authorisation boundary so a future edit can't quietly
// widen it — including the deliberate pass-through cases, which are the easiest
// thing to break by accident.
const { test } = require('node:test');
const assert = require('node:assert');
const { requireDaqqiAccess, requireDaqqiManager } = require('../lib/daqqiAccess');

/** Minimal express-style harness: returns { status, body, nexted }. */
function run(mw, req) {
  const out = { status: null, body: null, nexted: false };
  const res = {
    status(code) { out.status = code; return this; },
    json(payload) { out.body = payload; return this; },
  };
  mw(req, res, () => { out.nexted = true; });
  return out;
}

const ALLOWED_OPERATIONAL = ['MANAGER', 'ADMIN', 'DAQQI_MANAGER', 'RECEPTION_DAQQI', 'INSTRUCTOR', 'TRAINER'];
const ALLOWED_MANAGEMENT = ['MANAGER', 'ADMIN', 'DAQQI_MANAGER'];
const OUTSIDERS = ['SALES', 'COLLECTION', 'SUPPORT', 'HR', 'ACCOUNTANT', 'CONSULTANT', 'EXPERT', 'OTHER', 'ONLINE_MANAGER'];

test('requireDaqqiAccess admits every operational Daqqi role', () => {
  for (const role of ALLOWED_OPERATIONAL) {
    const out = run(requireDaqqiAccess, { staffRecord: { role } });
    assert.ok(out.nexted, `${role} should be allowed`);
    assert.equal(out.status, null);
  }
});

test('requireDaqqiAccess rejects roles outside the branch with 403', () => {
  for (const role of OUTSIDERS) {
    const out = run(requireDaqqiAccess, { staffRecord: { role } });
    assert.equal(out.nexted, false, `${role} should be blocked`);
    assert.equal(out.status, 403);
    assert.equal(out.body.error, 'Access denied');
  }
});

test('requireDaqqiManager is stricter: operational-only roles are blocked', () => {
  for (const role of ALLOWED_MANAGEMENT) {
    assert.ok(run(requireDaqqiManager, { staffRecord: { role } }).nexted, `${role} should manage`);
  }
  for (const role of ['RECEPTION_DAQQI', 'INSTRUCTOR', 'TRAINER']) {
    const out = run(requireDaqqiManager, { staffRecord: { role } });
    assert.equal(out.nexted, false, `${role} must not reach manager-only actions`);
    assert.equal(out.status, 403);
  }
});

test('role matching is case-insensitive', () => {
  assert.ok(run(requireDaqqiAccess, { staffRecord: { role: 'reception_daqqi' } }).nexted);
  assert.ok(run(requireDaqqiManager, { staffRecord: { role: 'daqqi_manager' } }).nexted);
});

test('a super admin bypasses the role check', () => {
  const out = run(requireDaqqiManager, { staffRecord: { role: 'SALES' }, isSuperAdmin: true });
  assert.ok(out.nexted);
});

test('a request with no staff record passes through (admin-by-email path)', () => {
  // Intentional: admins identified by ADMIN_EMAILS have no staff row. Pinned so
  // a refactor that starts attaching empty staffRecords can't silently 403 them,
  // and so removing this branch is a conscious decision rather than a surprise.
  assert.ok(run(requireDaqqiAccess, {}).nexted);
  assert.ok(run(requireDaqqiManager, { staffRecord: null }).nexted);
});

test('a staff record with a missing or empty role is denied, not admitted', () => {
  for (const staffRecord of [{ role: '' }, { role: null }, { role: undefined }, {}]) {
    const out = run(requireDaqqiAccess, { staffRecord });
    assert.equal(out.nexted, false);
    assert.equal(out.status, 403);
  }
});
