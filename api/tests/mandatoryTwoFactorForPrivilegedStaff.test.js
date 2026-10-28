'use strict';
/**
 * Two-factor is mandatory for the accounts that see money or change
 * permissions (lib/mfaPolicy.js). It used to ship switched off. Now, after the
 * password:
 *   - enrolled (and verified at sign-in) → in, as before;
 *   - not enrolled, inside the account's grace period → in, and told until when
 *     (X-MFA-Enrolment-Due; GET /api/auth/2fa/requirement for the panel);
 *   - not enrolled, grace over → every staff route answers 403
 *     MFA_ENROLLMENT_REQUIRED; only the enrolment routes (requireAuth alone)
 *     still answer.
 * Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-mfa-secret-0123456789-abcdefghijklmnopqrstuvw';
process.env.ADMIN_EMAILS = 'owner@x.test';

const DAY = 24 * 60 * 60 * 1000;
const ROLLOUT = new Date(Date.now() - 30 * DAY).toISOString();
let storedPolicy = {
  version: 2, enabled: true, grace_days: 7, enforced_from: ROLLOUT,
  required_roles: ['admin', 'manager', 'accountant', 'hr'],
  required_permissions: ['manage_financial'],
};
const writes = [];
let staffRow = null;

const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: {
    async query(sql, params) {
      writes.push({ sql, params });
      if (/FROM staff/.test(sql)) return [[staffRow]];
      return [{ affectedRows: 1 }];
    },
  },
});
stub('../lib/tenantSettings', {
  getTenantSetting: async () => storedPolicy,
  setTenantSetting: async (_key, value) => { storedPolicy = value; },
});

const mfa = require('../lib/mfaPolicy');
const { requireAdmin, requireAdminOrStaff } = require('../middleware/auth');

function fakeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
  };
}
async function through(guard, user, tenantId = 'tenant-default') {
  const res = fakeRes();
  let passed = false;
  await guard({ user: { tenant_id: tenantId, ...user }, tenantId }, res, () => { passed = true; });
  return { passed, res };
}
const owner = extra => ({ uid: 'u-owner', email: 'owner@x.test', ...extra });

test('enrolled and verified at sign-in: in, with nothing to say', async () => {
  const { passed, res } = await through(requireAdmin, owner({ mfa_enrolled: true, mfa_verified: true }));
  assert.equal(passed, true);
  assert.equal(res.headers['x-mfa-enrolment-due'], undefined);
});

test('not enrolled, inside the grace period: in, and told until when', async () => {
  const started = new Date(Date.now() - 2 * DAY);
  const { passed, res } = await through(requireAdmin, owner({ mfa_enrolled: false, mfa_grace_started_at: started }));
  assert.equal(passed, true);
  const due = Date.parse(res.headers['x-mfa-enrolment-due']);
  assert.ok(Math.abs(due - (started.getTime() + 7 * DAY)) < 1000, 'seven days from when the account was first told');
});

test('the first time an account is found without 2FA its grace period starts, once', async () => {
  writes.length = 0;
  const user = owner({ mfa_enrolled: false, mfa_grace_started_at: null });
  const { passed, res } = await through(requireAdmin, user);
  assert.equal(passed, true);
  assert.ok(res.headers['x-mfa-enrolment-due']);
  const stamp = writes.find(w => /SET mfa_grace_started_at=NOW\(\)/.test(w.sql));
  assert.ok(stamp, 'the start is written down');
  assert.match(stamp.sql, /mfa_grace_started_at IS NULL/, 'and never moved once written');
});

test('not enrolled, grace over: refused with the enrolment code', async () => {
  const { passed, res } = await through(requireAdmin, owner({ mfa_enrolled: false, mfa_grace_started_at: new Date(Date.now() - 10 * DAY) }));
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'MFA_ENROLLMENT_REQUIRED');
  assert.ok(res.body.graceEndedAt);
});

test('enrolled but signed in without the code (e.g. by WhatsApp): asked for the code, no grace', async () => {
  const { passed, res } = await through(requireAdmin, owner({ mfa_enrolled: true, mfa_verified: false }));
  assert.equal(passed, false);
  assert.equal(res.body.code, 'MFA_REQUIRED');
});

test('a privileged role is held to it on every staff route; a role without money is not', async () => {
  staffRow = { id: 'st-1', role: 'ACCOUNTANT', permissions_json: null, tenant_id: 'tenant-default' };
  const late = { uid: 'u-acc', email: 'acc@x.test', mfa_enrolled: false, mfa_grace_started_at: new Date(Date.now() - 9 * DAY) };
  const refused = await through(requireAdminOrStaff, late);
  assert.equal(refused.passed, false);
  assert.equal(refused.res.body.code, 'MFA_ENROLLMENT_REQUIRED');

  staffRow = { id: 'st-2', role: 'SALES', permissions_json: null, tenant_id: 'tenant-default' };
  const sales = await through(requireAdminOrStaff, { ...late, uid: 'u-sales', email: 'sales@x.test' });
  assert.equal(sales.passed, true);
  staffRow = null;
});

test('the enrolment routes answer to a signed-in account alone, so a blocked one can still enrol', () => {
  // Read as text: loading the router here would need the real database module.
  const { authRouteSource } = require('./_authRouteSource');
  const source = authRouteSource();
  const guards = /requireAdmin|requireSuperAdmin|requireAdminOrStaff|requireAdminOrOnlineManager|requirePlatformAdmin|requirePermission/;
  for (const [method, path] of [['get', '/api/auth/2fa/requirement'], ['get', '/api/auth/2fa/status'], ['post', '/api/auth/2fa/setup'], ['post', '/api/auth/2fa/enable'], ['get', '/api/auth/me'], ['post', '/api/auth/logout']]) {
    const declared = source.match(new RegExp(`router\\.${method}\\('${path.replace(/\//g, '\\/')}',([^\\n]*?)async \\(req`));
    assert.ok(declared, `${method.toUpperCase()} ${path} exists`);
    assert.match(declared[1], /requireAuth/, `${path} needs a session`);
    assert.doesNotMatch(declared[1], guards, `${path} must not sit behind a staff guard`);
  }
});

test('the panel is told required / grace / blocked', async () => {
  const policy = mfa.normalizeMfaPolicy(storedPolicy);
  const inGrace = await mfa.mfaStatusFor({ policy, required: true, tenantId: 't', user: { uid: 'a', mfa_enrolled: false, mfa_grace_started_at: new Date() } });
  assert.equal(inGrace.blocked, false);
  assert.ok(Date.parse(inGrace.graceEndsAt) > Date.now());
  const over = await mfa.mfaStatusFor({ policy, required: true, tenantId: 't', user: { uid: 'a', mfa_enrolled: false, mfa_grace_started_at: new Date(Date.now() - 8 * DAY) } });
  assert.equal(over.blocked, true);
  const enrolled = await mfa.mfaStatusFor({ policy, required: true, tenantId: 't', user: { uid: 'a', mfa_enrolled: true, mfa_verified: true } });
  assert.deepEqual([enrolled.blocked, enrolled.graceEndsAt], [false, null]);
});

test('who the policy is about: owner, full-access roles, listed roles, listed permissions', () => {
  const policy = mfa.normalizeMfaPolicy(storedPolicy);
  assert.equal(mfa.accountRequiresMfa(policy, { isOwner: true }), true);
  assert.equal(mfa.accountRequiresMfa(policy, { staff: { role: 'manager' } }), true);
  assert.equal(mfa.accountRequiresMfa(policy, { staff: { role: 'hr' } }), true);
  assert.equal(mfa.accountRequiresMfa(policy, { staff: { role: 'sales' } }), false);
  assert.equal(mfa.accountRequiresMfa(policy, { staff: { role: 'sales', permissions_json: JSON.stringify(['manage_financial']) } }), true);
  assert.equal(mfa.accountRequiresMfa({ ...policy, enabled: false }, { isOwner: true }), false);
  assert.equal(mfa.accountRequiresMfa(policy, {}), false, 'a customer is not staff');
});

test('the default is on, for every role that sees money or changes permissions; an old stored policy is brought up to it', () => {
  const fresh = mfa.normalizeMfaPolicy({});
  assert.equal(fresh.enabled, true);
  for (const role of ['admin', 'manager', 'accountant', 'collection', 'online_manager', 'daqqi_manager', 'tagamoa_manager', 'sales_collection_manager', 'hr']) {
    assert.ok(fresh.required_roles.includes(role), role);
  }
  assert.ok(!fresh.required_roles.includes('sales'));
  assert.equal(fresh.grace_days, 7);
  const legacy = mfa.normalizeMfaPolicy({ enabled: false, required_roles: ['admin'], required_permissions: ['manage_payments', 'manage_staff'] });
  assert.equal(legacy.enabled, true, 'the old off-by-default value does not survive the upgrade');
  assert.ok(!legacy.required_permissions.includes('manage_payments'), 'every role holds manage_payments');
  const ownersChoice = mfa.normalizeMfaPolicy({ version: 2, enabled: false, required_roles: ['admin'], grace_days: 3 });
  assert.equal(ownersChoice.enabled, false, 'once the owner has chosen on version 2, the choice stands');
  assert.equal(ownersChoice.grace_days, 3);
  assert.equal(mfa.normalizeMfaPolicy({ version: 2, grace_days: 99 }).grace_days, 30);
});

test('the grace period counts from the later of the rollout and the account being told', () => {
  const policy = { grace_days: 7, enforced_from: new Date(Date.now() - DAY).toISOString() };
  const ends = mfa.graceEndsAt(policy, new Date(Date.now() - 20 * DAY));
  assert.ok(Math.abs(ends - (Date.now() + 6 * DAY)) < 1000, 'switched on yesterday: six days left, not overdue');
});
