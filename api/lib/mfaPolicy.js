'use strict';

const { getTenantSetting, setTenantSetting } = require('./tenantSettings');
const { hasPermission, FULL_ACCESS_ROLES } = require('../constants/permissions');

// Who signs in with the code sent to their email (lib/loginEmailCode.js): the accounts that can see money or change who may do what. It
// is on by default; the owner edits the roles and permissions in الأمان ← سياسة MFA. The second step used to be an authenticator app, and
// it came with an enrolment screen and a grace period per account — all of that went with the app: there is nothing to enrol in, the
// code goes to the address the account already signs in with.
//
// The roles are every role whose defaults carry view_financial, manage_financial, approve_refunds or manage_staff
// (constants/permissions.js); the permissions catch an account granted one of those by hand. manage_payments is not on the list: every
// role holds it (recording is not approving), so it would have required the code of every employee on every booking.
const POLICY_VERSION = 2;
const DEFAULT_MFA_POLICY = Object.freeze({
  version: POLICY_VERSION,
  enabled: true,
  required_roles: Object.freeze([
    'admin', 'manager', 'accountant', 'online_manager', 'sales_collection_manager',
    'collection', 'daqqi_manager', 'tagamoa_manager', 'hr',
  ]),
  required_permissions: Object.freeze([
    'view_financial', 'manage_financial', 'approve_refunds',
    'manage_staff', 'manage_security', 'manage_settings',
  ]),
});

const policyCache = new Map();
const CACHE_MS = 30_000;

function normalizeList(value, fallback) {
  return [...new Set((Array.isArray(value) ? value : fallback)
    .map(item => String(item || '').trim().toLowerCase())
    .filter(Boolean))];
}

/**
 * A stored policy written before version 2 is from the days the policy was off unless someone opted in, so it is brought up to the
 * mandatory default: on, with the default roles and permissions added to whatever it named. Its manage_payments entry is dropped (see
 * above). A version-2 policy is the owner's own and is taken as it is.
 */
function normalizeMfaPolicy(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  if (Number(source.version) !== POLICY_VERSION) {
    return {
      version: POLICY_VERSION,
      enabled: true,
      required_roles: normalizeList([...(source.required_roles || []), ...DEFAULT_MFA_POLICY.required_roles], []),
      required_permissions: normalizeList([
        ...(source.required_permissions || []).filter(permission => permission !== 'manage_payments'),
        ...DEFAULT_MFA_POLICY.required_permissions,
      ], []),
    };
  }
  return {
    version: POLICY_VERSION,
    enabled: source.enabled === true,
    required_roles: normalizeList(source.required_roles, DEFAULT_MFA_POLICY.required_roles),
    required_permissions: normalizeList(source.required_permissions, DEFAULT_MFA_POLICY.required_permissions),
  };
}

async function getMfaPolicy(tenantId, { fresh = false } = {}) {
  const key = String(tenantId || 'tenant-default');
  const cached = policyCache.get(key);
  if (!fresh && cached?.expiresAt > Date.now()) return cached.value;
  const stored = await getTenantSetting('security_mfa_policy', { tenantId: key, fallback: null });
  const value = normalizeMfaPolicy(stored || {});
  policyCache.set(key, { value, expiresAt: Date.now() + CACHE_MS });
  return value;
}

// In every API process: an instance still holding the old policy would let a
// session through without the second step for up to half a minute.
const forgetMfaPolicy = require('./cacheBus').shared('mfa-policy', function forgetMfaPolicyHere(tenantId) {
  policyCache.delete(String(tenantId || 'tenant-default'));
});

async function saveMfaPolicy(tenantId, value, actorId) {
  const normalized = normalizeMfaPolicy({ ...value, version: POLICY_VERSION });
  await setTenantSetting('security_mfa_policy', normalized, { tenantId, actorId });
  forgetMfaPolicy(tenantId);
  return normalized;
}

function policyRequiresStaff(policy, staff, requestedPermissions = []) {
  if (!policy.enabled) return false;
  const role = String(staff?.role || '').toLowerCase();
  if (policy.required_roles.includes(role)) return true;
  return requestedPermissions.some(permission =>
    policy.required_permissions.includes(permission)
    && hasPermission(staff, permission)
  );
}

/**
 * Whether the account as a whole is one the policy is about — the question sign-in asks, not a route's. The owner and a full-access
 * role always are; anyone else by role, or by holding one of the listed permissions.
 */
function accountRequiresMfa(policy, { isOwner = false, staff = null } = {}) {
  if (!policy?.enabled) return false;
  if (isOwner) return true;
  if (!staff) return false;
  const role = String(staff.role || '').toLowerCase();
  if (FULL_ACCESS_ROLES.includes(role) || policy.required_roles.includes(role)) return true;
  return policy.required_permissions.some(permission => hasPermission(staff, permission));
}

module.exports = {
  DEFAULT_MFA_POLICY,
  POLICY_VERSION,
  accountRequiresMfa,
  getMfaPolicy,
  normalizeMfaPolicy,
  policyRequiresStaff,
  saveMfaPolicy,
};
