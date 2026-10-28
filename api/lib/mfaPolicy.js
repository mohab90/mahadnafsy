'use strict';

const { getTenantSetting, setTenantSetting } = require('./tenantSettings');
const { hasPermission, FULL_ACCESS_ROLES } = require('../constants/permissions');
const logger = require('./logger');

// Two-factor sign-in for the accounts that can see money or change who may do
// what. It used to ship switched off, so in practice nobody had it: the owner
// and every manager signed in with a password alone. It is on by default now,
// with a grace period per account (grace_days from when that account was first
// told, or from when the policy was switched on, whichever is later): during
// it a privileged account without 2FA is let in and told how long it has left,
// after it only the enrolment routes answer until it enrols.
//
// The roles are every role whose defaults carry view_financial,
// manage_financial, approve_refunds or manage_staff (constants/permissions.js);
// the permissions catch an account granted one of those by hand. manage_payments
// is not on the list: every role holds it (recording is not approving), so it
// would have required 2FA of every employee on every booking.
const POLICY_VERSION = 2;
const DEFAULT_GRACE_DAYS = 7;
const MAX_GRACE_DAYS = 30;
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
  grace_days: DEFAULT_GRACE_DAYS,
  enforced_from: null,
});

const policyCache = new Map();
const CACHE_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeList(value, fallback) {
  return [...new Set((Array.isArray(value) ? value : fallback)
    .map(item => String(item || '').trim().toLowerCase())
    .filter(Boolean))];
}

function normalizeGraceDays(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_GRACE_DAYS;
  const days = Number(value);
  if (!Number.isFinite(days)) return DEFAULT_GRACE_DAYS;
  return Math.min(MAX_GRACE_DAYS, Math.max(0, Math.round(days)));
}

function normalizeInstant(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/**
 * A stored policy written before version 2 is from the days the policy was off
 * unless someone opted in, so it is brought up to the mandatory default: on,
 * with the default roles and permissions added to whatever it named. Its
 * manage_payments entry is dropped (see above). A version-2 policy is the
 * owner's own and is taken as it is.
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
      grace_days: normalizeGraceDays(source.grace_days),
      enforced_from: normalizeInstant(source.enforced_from),
    };
  }
  return {
    version: POLICY_VERSION,
    enabled: source.enabled === true,
    required_roles: normalizeList(source.required_roles, DEFAULT_MFA_POLICY.required_roles),
    required_permissions: normalizeList(source.required_permissions, DEFAULT_MFA_POLICY.required_permissions),
    grace_days: normalizeGraceDays(source.grace_days),
    enforced_from: normalizeInstant(source.enforced_from),
  };
}

async function getMfaPolicy(tenantId, { fresh = false } = {}) {
  const key = String(tenantId || 'tenant-default');
  const cached = policyCache.get(key);
  if (!fresh && cached?.expiresAt > Date.now()) return cached.value;
  const stored = await getTenantSetting('security_mfa_policy', { tenantId: key, fallback: null });
  const value = normalizeMfaPolicy(stored || {});
  // The rollout is the first time this institute's policy is read on this
  // version: the grace period counts from then, so it is written down once.
  if (value.enabled && !value.enforced_from) {
    value.enforced_from = new Date().toISOString();
    await setTenantSetting('security_mfa_policy', value, { tenantId: key, actorId: 'mfa-rollout' })
      .catch(error => logger.warn('[mfa] could not record the policy rollout', { tenantId: key, err: error.message }));
  }
  policyCache.set(key, { value, expiresAt: Date.now() + CACHE_MS });
  return value;
}

// In every API process: an instance still holding the old policy would let a
// session through without the second step for up to half a minute.
const forgetMfaPolicy = require('./cacheBus').shared('mfa-policy', function forgetMfaPolicyHere(tenantId) {
  policyCache.delete(String(tenantId || 'tenant-default'));
});

async function saveMfaPolicy(tenantId, value, actorId) {
  const previous = await getMfaPolicy(tenantId, { fresh: true });
  const normalized = normalizeMfaPolicy({ ...value, version: POLICY_VERSION });
  // Switching it on (again) starts a fresh grace period for everybody; a save
  // that leaves it on keeps the date it was first enforced from.
  normalized.enforced_from = normalized.enabled
    ? (previous.enabled && previous.enforced_from) || new Date().toISOString()
    : null;
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
 * Whether the account as a whole is one the policy is about — the question the
 * panel asks after sign-in, not a route's. The owner and a full-access role
 * always are; anyone else by role, or by holding one of the listed permissions.
 */
function accountRequiresMfa(policy, { isOwner = false, staff = null } = {}) {
  if (!policy?.enabled) return false;
  if (isOwner) return true;
  if (!staff) return false;
  const role = String(staff.role || '').toLowerCase();
  if (FULL_ACCESS_ROLES.includes(role) || policy.required_roles.includes(role)) return true;
  return policy.required_permissions.some(permission => hasPermission(staff, permission));
}

/** When an account's grace period ends (ms since the epoch). */
function graceEndsAt(policy, graceStartedAt) {
  const started = graceStartedAt ? new Date(graceStartedAt).getTime() : Date.now();
  const enforced = Date.parse(policy?.enforced_from || '') || 0;
  return Math.max(Number.isFinite(started) ? started : Date.now(), enforced)
    + normalizeGraceDays(policy?.grace_days) * DAY_MS;
}

/**
 * The account's grace period, started the first time the account is found
 * without 2FA. The UPDATE only ever fills an empty column, so concurrent
 * requests agree on one start.
 * @returns {Promise<number>} when it ends, ms since the epoch
 */
async function enrolmentGraceEndsAt(policy, user, tenantId, db = null) {
  let started = user?.mfa_grace_started_at || null;
  if (!started && user?.uid) {
    const conn = db || require('./db').pool;
    await conn.query(
      'UPDATE users SET mfa_grace_started_at=NOW() WHERE tenant_id=? AND id=? AND mfa_grace_started_at IS NULL',
      [tenantId, user.uid]
    ).catch(error => logger.warn('[mfa] could not start the grace period', { err: error.message }));
    started = new Date();
    user.mfa_grace_started_at = started;
  }
  return graceEndsAt(policy, started);
}

/**
 * What the panel needs to choose between the dashboard, a «set up 2FA» notice
 * with a countdown, and the enrolment screen alone.
 */
async function mfaStatusFor({ policy, user, tenantId, required, db = null }) {
  const enrolled = Boolean(user?.mfa_enrolled);
  const verified = Boolean(user?.mfa_verified);
  const base = { required: Boolean(required), enrolled, verified, graceEndsAt: null, blocked: false, graceDays: policy?.grace_days ?? null };
  if (!required || enrolled) return base;
  const ends = await enrolmentGraceEndsAt(policy, user, tenantId, db);
  return { ...base, graceEndsAt: new Date(ends).toISOString(), blocked: ends <= Date.now() };
}

module.exports = {
  DEFAULT_MFA_POLICY,
  POLICY_VERSION,
  accountRequiresMfa,
  enrolmentGraceEndsAt,
  getMfaPolicy,
  graceEndsAt,
  mfaStatusFor,
  normalizeMfaPolicy,
  policyRequiresStaff,
  saveMfaPolicy,
};
