'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveSecret } = require('./secretResolver');

function isPlaceholder(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized
    || normalized.includes('your_')
    || normalized.includes('changeme')
    || normalized.includes('placeholder')
    || ['secret', 'password', 'test'].includes(normalized);
}

function hasReal(value) {
  return !isPlaceholder(value);
}

function resolvedSecret(name, env, errors) {
  try {
    return resolveSecret(name, env);
  } catch (error) {
    errors.push(error.message);
    return '';
  }
}

// How the secrets reach the process. The first three are managed stores, which
// answer "who can read this" with their own access control. `env-file` is the
// fourth honest answer for a single-tenant server that owns its own machine:
// the file on disk is the store, and the operating system is the access
// control. It was missing, so the only way to pass this policy on a VPS was to
// name a vault that does not exist — a false statement in the one config file
// whose entire job is to be true.
const MANAGED_SOURCES = ['secret-manager', 'vault', 'platform-secret'];
const ALL_SOURCES = [...MANAGED_SOURCES, 'env-file'];

// A signing secret older than this refuses the boot (the two deployment
// policies below). The refusal stays: a year-old JWT secret is the one rule
// here that guards against a key nobody remembers leaking.
const SECRET_ROTATION_REFUSE_DAYS = 370;
// …but it used to be the first anyone heard of it. Both dates in the systemd
// unit are 2026-08-03, so around 2027-08-08 the next restart — a deploy, a
// reboot, a crash — would have taken the site down with no warning at all.
// From day 330 the health output, the admin's system card and a weekly
// WhatsApp to the owner say so, which leaves forty days to rotate.
const SECRET_ROTATION_WARN_DAYS = 330;
const DAY_MS = 86400000;

/**
 * `env-file` is a claim about a file, so it is checked against the file.
 * Readable by anyone but its owner is not a secret store, and saying so has to
 * fail exactly as loudly as naming no store at all — otherwise this is a way to
 * opt out of the policy rather than a way to satisfy it honestly.
 */
function envFileProtectionErrors(env, prefix) {
  const errors = [];
  const file = String(env[`${prefix}_SECRET_FILE`] || env.SECRET_ENV_FILE || path.join(__dirname, '..', '.env')).trim();
  let stats;
  try {
    stats = fs.statSync(file);
  } catch {
    errors.push(`${prefix}_SECRET_SOURCE is env-file but ${file} cannot be read`);
    return errors;
  }
  // Windows does not carry POSIX mode bits, so there is nothing to verify and
  // nothing to claim; the check applies where the deployment actually runs.
  if (process.platform !== 'win32' && (stats.mode & 0o077) !== 0) {
    errors.push(`${prefix}_SECRET_SOURCE is env-file but ${file} is readable beyond its owner (chmod 600 it)`);
  }
  return errors;
}

function auditSecretPolicy(env = process.env) {
  const errors = [];
  const secret = resolvedSecret('AUDIT_HMAC_SECRET', env, errors);
  const jwtSecret = resolvedSecret('JWT_SECRET', env, errors);
  if (secret.length < 48) errors.push('AUDIT_HMAC_SECRET must contain at least 48 characters');
  if (/your_|changeme|placeholder|development|test-secret/i.test(secret)) {
    errors.push('AUDIT_HMAC_SECRET must not be a placeholder');
  }
  if (secret && jwtSecret && secret === jwtSecret) {
    errors.push('AUDIT_HMAC_SECRET must be independent from JWT_SECRET');
  }
  return { ok: errors.length === 0, errors };
}

function auditSecretDeploymentPolicy(env = process.env, now = Date.now()) {
  const errors = [];
  const source = String(env.AUDIT_SECRET_SOURCE || '').toLowerCase();
  if (!ALL_SOURCES.includes(source)) {
    errors.push(`AUDIT_SECRET_SOURCE must be one of ${ALL_SOURCES.join(', ')}`);
  }
  if (source === 'env-file') {
    // The file is the store; provider and reference name a service there is none of.
    errors.push(...envFileProtectionErrors(env, 'AUDIT'));
  } else {
    if (!hasReal(env.AUDIT_SECRET_PROVIDER) || /local|dotenv|example/i.test(String(env.AUDIT_SECRET_PROVIDER || ''))) {
      errors.push('AUDIT_SECRET_PROVIDER must identify the production secret service');
    }
    if (!hasReal(env.AUDIT_SECRET_REFERENCE)) {
      errors.push('AUDIT_SECRET_REFERENCE must identify the managed secret/version');
    }
  }
  // Rotation discipline is about the secret, not about where it is kept.
  const rotatedAt = Date.parse(env.AUDIT_SECRET_ROTATED_AT || '');
  if (!Number.isFinite(rotatedAt)) errors.push('AUDIT_SECRET_ROTATED_AT is invalid');
  else if ((now - rotatedAt) / DAY_MS > SECRET_ROTATION_REFUSE_DAYS) errors.push('AUDIT secret rotation is older than 370 days');
  return { ok: errors.length === 0, errors };
}

function authSecretDeploymentPolicy(env = process.env, now = Date.now()) {
  const errors = [];
  const source = String(env.AUTH_SECRET_SOURCE || '').toLowerCase();
  if (!ALL_SOURCES.includes(source)) {
    errors.push(`AUTH_SECRET_SOURCE must be one of ${ALL_SOURCES.join(', ')}`);
  }
  if (source === 'env-file') {
    errors.push(...envFileProtectionErrors(env, 'AUTH'));
    // The independence requirement below is about the secrets themselves, and
    // criticalProductionPolicy already compares their values directly.
  } else {
    if (!hasReal(env.AUTH_SECRET_PROVIDER) || /local|dotenv|example/i.test(String(env.AUTH_SECRET_PROVIDER || ''))) {
      errors.push('AUTH_SECRET_PROVIDER must identify the production secret service');
    }
    const references = [
      env.JWT_SECRET_REFERENCE,
      env.SESSION_BINDING_SECRET_REFERENCE,
      env.OTP_HMAC_SECRET_REFERENCE,
    ].map(value => String(value || '').trim());
    if (references.some(reference => !hasReal(reference))) {
      errors.push('JWT, session-binding and OTP managed secret references are required');
    } else if (new Set(references).size !== references.length) {
      errors.push('JWT, session-binding and OTP must use independent managed secret references');
    }
  }
  const rotatedAt = Date.parse(env.AUTH_SECRET_ROTATED_AT || '');
  if (!Number.isFinite(rotatedAt)) errors.push('AUTH_SECRET_ROTATED_AT is invalid');
  else if ((now - rotatedAt) / DAY_MS > SECRET_ROTATION_REFUSE_DAYS) errors.push('Auth secret rotation is older than 370 days');
  return { ok: errors.length === 0, errors };
}

/**
 * How close each signing-secret family is to the boot refusal above. Only the
 * dates are read — never a secret — so this is safe to show an admin.
 *
 * state: 'ok' · 'due' (from day 330, rotate now) · 'expired' (past 370: this
 * process is running, but the next start will be refused) · 'unset' (no date
 * configured, as on a development machine, where the policy does not apply).
 */
function secretRotationStatus(env = process.env, now = Date.now()) {
  const families = [
    { key: 'auth', label: 'JWT / الجلسة / OTP', variable: 'AUTH_SECRET_ROTATED_AT' },
    { key: 'audit', label: 'سجل التدقيق', variable: 'AUDIT_SECRET_ROTATED_AT' },
  ];
  const secrets = families.map(({ key, label, variable }) => {
    const raw = String(env[variable] || '').trim();
    const rotatedAt = Date.parse(raw);
    if (!raw || !Number.isFinite(rotatedAt)) {
      return { key, label, variable, state: 'unset', rotatedAt: null, ageDays: null, daysLeft: null, refusesBootAfter: null };
    }
    const ageDays = Math.floor((now - rotatedAt) / DAY_MS);
    const refusesBootAfter = new Date(rotatedAt + SECRET_ROTATION_REFUSE_DAYS * DAY_MS).toISOString().slice(0, 10);
    const state = (now - rotatedAt) / DAY_MS > SECRET_ROTATION_REFUSE_DAYS ? 'expired'
      : ageDays >= SECRET_ROTATION_WARN_DAYS ? 'due' : 'ok';
    return {
      key, label, variable, state,
      rotatedAt: new Date(rotatedAt).toISOString().slice(0, 10),
      ageDays,
      daysLeft: Math.max(SECRET_ROTATION_REFUSE_DAYS - ageDays, 0),
      refusesBootAfter,
    };
  });
  // lib/secretBox.js seals the stored credentials and 2FA secrets with
  // CHANNEL_SECRET_KEY, falling back to JWT_SECRET. On the fallback, rotating
  // JWT_SECRET makes every sealed value unreadable — every enrolled 2FA would
  // stop working at once — so the card says which key it is before anyone
  // rotates. Only whether it is configured is read, never its value.
  const ownKey = Boolean(String(env.CHANNEL_SECRET_KEY || env.CHANNEL_SECRET_KEY_FILE || '').trim());
  const rank = { unset: 0, ok: 1, due: 2, expired: 3 };
  const worst = secrets.reduce((acc, item) => (rank[item.state] > rank[acc] ? item.state : acc), 'unset');
  return {
    state: worst,
    warning: worst === 'due' || worst === 'expired',
    warnFromDays: SECRET_ROTATION_WARN_DAYS,
    refuseAfterDays: SECRET_ROTATION_REFUSE_DAYS,
    sealedDataKey: ownKey ? 'own' : 'jwt-fallback',
    secrets,
  };
}

function criticalProductionPolicy(env = process.env) {
  if (env.NODE_ENV !== 'production') return { ok: true, errors: [] };
  const errors = [
    ...auditSecretPolicy(env).errors,
    ...auditSecretDeploymentPolicy(env).errors,
    ...authSecretDeploymentPolicy(env).errors,
  ];
  const jwtSecret = resolvedSecret('JWT_SECRET', env, errors);
  const sessionSecret = resolvedSecret('SESSION_BINDING_SECRET', env, errors);
  const otpSecret = resolvedSecret('OTP_HMAC_SECRET', env, errors);
  const auditSecret = resolvedSecret('AUDIT_HMAC_SECRET', env, errors);
  if (!hasReal(jwtSecret) || jwtSecret.length < 48) {
    errors.push('JWT_SECRET must contain at least 48 non-placeholder characters');
  }
  if (!hasReal(sessionSecret) || sessionSecret.length < 48) {
    errors.push('SESSION_BINDING_SECRET must contain at least 48 non-placeholder characters');
  } else if (sessionSecret === jwtSecret) {
    errors.push('SESSION_BINDING_SECRET must be independent from JWT_SECRET');
  }
  if (!hasReal(otpSecret) || otpSecret.length < 48) {
    errors.push('OTP_HMAC_SECRET must contain at least 48 non-placeholder characters');
  } else if ([jwtSecret, sessionSecret, auditSecret].includes(otpSecret)) {
    errors.push('OTP_HMAC_SECRET must be independent from other signing secrets');
  }
  if (!ALL_SOURCES.includes(String(env.AUDIT_SECRET_SOURCE || '').toLowerCase())) {
    errors.push(`AUDIT_SECRET_SOURCE must be one of ${ALL_SOURCES.join(', ')}`);
  }
  return { ok: errors.length === 0, errors };
}

function sentryDsnIsValid(value) {
  if (!hasReal(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.username) && /^\d+$/.test(url.pathname.replace(/\//g, ''));
  } catch {
    return false;
  }
}

function httpsUrlIsValid(value) {
  if (!hasReal(value)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function redisDeploymentPolicy(env = process.env) {
  const errors = [];
  const production = env.NODE_ENV === 'production';
  if (env.RATE_LIMIT_REDIS_ENABLED !== 'true') {
    errors.push('RATE_LIMIT_REDIS_ENABLED must be true');
  }
  if (!hasReal(env.REDIS_PROVIDER)) errors.push('REDIS_PROVIDER is missing');
  if (!hasReal(env.REDIS_REGION)) errors.push('REDIS_REGION is missing');
  if (production && /local|localhost|development|example/i.test(String(env.REDIS_PROVIDER || ''))) {
    errors.push('REDIS_PROVIDER must identify a managed production service');
  }
  if (production && /local|localhost|development|example/i.test(String(env.REDIS_REGION || ''))) {
    errors.push('REDIS_REGION must identify the pinned production region');
  }
  try {
    const url = new URL(env.REDIS_URL || '');
    const localPlaintext = !production
      && url.protocol === 'redis:'
      && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    if (url.protocol !== 'rediss:' && !localPlaintext) {
      errors.push('REDIS_URL must use rediss:// outside local development');
    }
  } catch {
    errors.push('REDIS_URL is invalid');
  }
  return { ok: errors.length === 0, errors };
}

function managedDatabasePolicy(env = process.env, now = Date.now()) {
  const errors = [];
  if (!hasReal(env.DB_PROVIDER) || /local|localhost|development|example/i.test(String(env.DB_PROVIDER || ''))) {
    errors.push('DB_PROVIDER must identify the managed production database');
  }
  if (!hasReal(env.DB_REGION) || /local|localhost|development|example/i.test(String(env.DB_REGION || ''))) {
    errors.push('DB_REGION must identify the pinned production database region');
  }
  if (String(env.DB_SSL_MODE || '').toLowerCase().replace('_', '-') !== 'verify-ca') {
    errors.push('DB_SSL_MODE must be verify-ca in production');
  }
  if (!env.DB_SSL_CA_PATH || !path.isAbsolute(env.DB_SSL_CA_PATH)) {
    errors.push('DB_SSL_CA_PATH must be an absolute mounted CA path');
  } else {
    try {
      if (!fs.statSync(env.DB_SSL_CA_PATH).isFile()) throw new Error('not a file');
    } catch {
      errors.push('DB_SSL_CA_PATH is not readable');
    }
  }
  if (String(env.DB_PITR_ENABLED || '').toLowerCase() !== 'true') {
    errors.push('DB_PITR_ENABLED must confirm managed point-in-time recovery');
  }
  if (!hasReal(env.DB_BACKUP_EVIDENCE)) errors.push('DB_BACKUP_EVIDENCE is missing');
  if (!/^[a-f0-9]{64}$/i.test(String(env.DB_BACKUP_EVIDENCE_SHA256 || ''))) {
    errors.push('DB_BACKUP_EVIDENCE_SHA256 must identify the reviewed backup evidence');
  } else {
    errors.push(...evidenceFileErrors(
      'DB_BACKUP_EVIDENCE',
      env.DB_BACKUP_EVIDENCE_FILE,
      env.DB_BACKUP_EVIDENCE_SHA256
    ));
  }
  const verifiedAt = Date.parse(env.DB_BACKUP_VERIFIED_AT || '');
  if (!Number.isFinite(verifiedAt)) errors.push('DB_BACKUP_VERIFIED_AT is invalid');
  else {
    const ageDays = (now - verifiedAt) / 86400000;
    if (ageDays < -1) errors.push('DB_BACKUP_VERIFIED_AT is in the future');
    if (ageDays > 90) errors.push('Backup/restore evidence is older than 90 days');
  }
  return { ok: errors.length === 0, errors };
}

function productClaimPolicy(env = process.env) {
  const tier = String(env.PRODUCT_CAPABILITY_TIER || '').trim().toLowerCase();
  const allowed = new Set(['institute-suite', 'multi-tenant-pilot']);
  return {
    ok: allowed.has(tier),
    errors: allowed.has(tier)
      ? []
      : ['PRODUCT_CAPABILITY_TIER must be institute-suite or multi-tenant-pilot until enterprise SaaS/ERP gates pass'],
  };
}

function evidenceFileErrors(label, file, expectedSha256) {
  const errors = [];
  if (!file || !path.isAbsolute(file)) return [`${label}_FILE must be an absolute path`];
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 1 || stat.size > 10 * 1024 * 1024) {
      errors.push(`${label}_FILE must be a non-empty artifact no larger than 10MB`);
    } else {
      const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      if (actual.toLowerCase() !== String(expectedSha256 || '').toLowerCase()) {
        errors.push(`${label}_FILE SHA-256 does not match the reviewed evidence`);
      }
    }
  } catch {
    errors.push(`${label}_FILE is not readable`);
  }
  return errors;
}

function dataResidencyPolicy(env = process.env, now = Date.now()) {
  const errors = [];
  if (!hasReal(env.DATA_RESIDENCY_REGION)) errors.push('DATA_RESIDENCY_REGION is missing');
  if (!hasReal(env.DATA_RESIDENCY_PROVIDER)) errors.push('DATA_RESIDENCY_PROVIDER is missing');
  if (/local|localhost|development|example/i.test(String(env.DATA_RESIDENCY_REGION || ''))) {
    errors.push('DATA_RESIDENCY_REGION must identify the production data region');
  }
  if (/local|localhost|development|example/i.test(String(env.DATA_RESIDENCY_PROVIDER || ''))) {
    errors.push('DATA_RESIDENCY_PROVIDER must identify the production hosting provider');
  }
  if (!hasReal(env.DATA_RESIDENCY_EVIDENCE)) errors.push('DATA_RESIDENCY_EVIDENCE is missing');
  if (!/^[a-f0-9]{64}$/i.test(String(env.DATA_RESIDENCY_EVIDENCE_SHA256 || ''))) {
    errors.push('DATA_RESIDENCY_EVIDENCE_SHA256 must identify the reviewed evidence artifact');
  } else {
    errors.push(...evidenceFileErrors(
      'DATA_RESIDENCY_EVIDENCE',
      env.DATA_RESIDENCY_EVIDENCE_FILE,
      env.DATA_RESIDENCY_EVIDENCE_SHA256
    ));
  }
  const verifiedAt = Date.parse(env.DATA_RESIDENCY_VERIFIED_AT || '');
  if (!Number.isFinite(verifiedAt)) errors.push('DATA_RESIDENCY_VERIFIED_AT is invalid');
  else {
    const ageDays = (now - verifiedAt) / 86400000;
    if (ageDays < -1) errors.push('DATA_RESIDENCY_VERIFIED_AT is in the future');
    if (ageDays > 370) errors.push('Data residency evidence is older than 370 days');
  }
  return { ok: errors.length === 0, errors };
}

function geoProxyPolicy(env = process.env, now = Date.now()) {
  const errors = [];
  const proxyHops = Number(env.TRUST_PROXY_HOPS);
  const trustedHeaders = String(env.TRUST_GEO_HEADERS || '').toLowerCase() === 'true';
  const providerUrl = String(env.GEOIP_API_URL || '');
  if (!Number.isInteger(proxyHops) || proxyHops < 0) {
    errors.push('TRUST_PROXY_HOPS must be the exact non-negative proxy count');
  } else if (trustedHeaders && proxyHops < 1) {
    errors.push('Trusted edge geo headers require at least one trusted proxy hop');
  }
  if (!trustedHeaders && !httpsUrlIsValid(providerUrl.replace('{ip}', '203.0.113.1'))) {
    errors.push('Customer geo requires trusted edge headers or an explicit HTTPS provider');
  }
  if (!hasReal(env.GEO_POLICY_PROVIDER) || /local|example|development/i.test(String(env.GEO_POLICY_PROVIDER || ''))) {
    errors.push('GEO_POLICY_PROVIDER must identify the production edge or geo provider');
  }
  if (!hasReal(env.GEO_POLICY_EVIDENCE)) errors.push('GEO_POLICY_EVIDENCE is missing');
  if (!/^[a-f0-9]{64}$/i.test(String(env.GEO_POLICY_EVIDENCE_SHA256 || ''))) {
    errors.push('GEO_POLICY_EVIDENCE_SHA256 must identify the reviewed proxy/geo evidence');
  } else {
    errors.push(...evidenceFileErrors(
      'GEO_POLICY_EVIDENCE',
      env.GEO_POLICY_EVIDENCE_FILE,
      env.GEO_POLICY_EVIDENCE_SHA256
    ));
  }
  const verifiedAt = Date.parse(env.GEO_POLICY_VERIFIED_AT || '');
  if (!Number.isFinite(verifiedAt)) errors.push('GEO_POLICY_VERIFIED_AT is invalid');
  else {
    const ageDays = (now - verifiedAt) / 86400000;
    if (ageDays < -1) errors.push('GEO_POLICY_VERIFIED_AT is in the future');
    if (ageDays > 370) errors.push('Geo/proxy evidence is older than 370 days');
  }
  if (env.NODE_ENV === 'production' && String(env.GEO_DEFAULT_COUNTRY_CODE || '').trim()) {
    errors.push('GEO_DEFAULT_COUNTRY_CODE must be empty in production');
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  authSecretDeploymentPolicy,
  auditSecretPolicy,
  auditSecretDeploymentPolicy,
  criticalProductionPolicy,
  dataResidencyPolicy,
  geoProxyPolicy,
  hasReal,
  httpsUrlIsValid,
  isPlaceholder,
  managedDatabasePolicy,
  productClaimPolicy,
  redisDeploymentPolicy,
  secretRotationStatus,
  sentryDsnIsValid,
  SECRET_ROTATION_REFUSE_DAYS,
  SECRET_ROTATION_WARN_DAYS,
};
