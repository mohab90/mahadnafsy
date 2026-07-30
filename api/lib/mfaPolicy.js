'use strict';

const { getTenantSetting, setTenantSetting } = require('./tenantSettings');
const { hasPermission } = require('../constants/permissions');

const DEFAULT_MFA_POLICY = Object.freeze({
  enabled: false,
  required_roles: ['admin', 'manager', 'accountant'],
  required_permissions: [
    'manage_financial', 'manage_payments', 'approve_refunds',
    'manage_staff', 'manage_security', 'manage_settings',
  ],
});

const policyCache = new Map();
const CACHE_MS = 30_000;

function normalizeList(value, fallback) {
  return [...new Set((Array.isArray(value) ? value : fallback)
    .map(item => String(item || '').trim().toLowerCase())
    .filter(Boolean))];
}

function normalizeMfaPolicy(value = {}) {
  return {
    enabled: value.enabled === true,
    required_roles: normalizeList(value.required_roles, DEFAULT_MFA_POLICY.required_roles),
    required_permissions: normalizeList(value.required_permissions, DEFAULT_MFA_POLICY.required_permissions),
  };
}

async function getMfaPolicy(tenantId, { fresh = false } = {}) {
  const key = String(tenantId || 'tenant-default');
  const cached = policyCache.get(key);
  if (!fresh && cached?.expiresAt > Date.now()) return cached.value;
  const value = normalizeMfaPolicy(await getTenantSetting('security_mfa_policy', {
    tenantId: key,
    fallback: DEFAULT_MFA_POLICY,
  }));
  policyCache.set(key, { value, expiresAt: Date.now() + CACHE_MS });
  return value;
}

async function saveMfaPolicy(tenantId, value, actorId) {
  const normalized = normalizeMfaPolicy(value);
  await setTenantSetting('security_mfa_policy', normalized, { tenantId, actorId });
  policyCache.delete(String(tenantId || 'tenant-default'));
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

module.exports = {
  DEFAULT_MFA_POLICY,
  getMfaPolicy,
  normalizeMfaPolicy,
  policyRequiresStaff,
  saveMfaPolicy,
};
