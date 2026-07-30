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
  if (!['secret-manager', 'vault', 'platform-secret'].includes(source)) {
    errors.push('AUDIT_SECRET_SOURCE must identify managed injection');
  }
  if (!hasReal(env.AUDIT_SECRET_PROVIDER) || /local|dotenv|example/i.test(String(env.AUDIT_SECRET_PROVIDER || ''))) {
    errors.push('AUDIT_SECRET_PROVIDER must identify the production secret service');
  }
  if (!hasReal(env.AUDIT_SECRET_REFERENCE)) {
    errors.push('AUDIT_SECRET_REFERENCE must identify the managed secret/version');
  }
  const rotatedAt = Date.parse(env.AUDIT_SECRET_ROTATED_AT || '');
  if (!Number.isFinite(rotatedAt)) errors.push('AUDIT_SECRET_ROTATED_AT is invalid');
  else if ((now - rotatedAt) / 86400000 > 370) errors.push('AUDIT secret rotation is older than 370 days');
  return { ok: errors.length === 0, errors };
}

function authSecretDeploymentPolicy(env = process.env, now = Date.now()) {
  const errors = [];
  const source = String(env.AUTH_SECRET_SOURCE || '').toLowerCase();
  if (!['secret-manager', 'vault', 'platform-secret'].includes(source)) {
    errors.push('AUTH_SECRET_SOURCE must identify managed injection');
  }
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
  const rotatedAt = Date.parse(env.AUTH_SECRET_ROTATED_AT || '');
  if (!Number.isFinite(rotatedAt)) errors.push('AUTH_SECRET_ROTATED_AT is invalid');
  else if ((now - rotatedAt) / 86400000 > 370) errors.push('Auth secret rotation is older than 370 days');
  return { ok: errors.length === 0, errors };
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
  if (!['secret-manager', 'vault', 'platform-secret'].includes(String(env.AUDIT_SECRET_SOURCE || '').toLowerCase())) {
    errors.push('AUDIT_SECRET_SOURCE must be secret-manager, vault or platform-secret');
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
  sentryDsnIsValid,
};
