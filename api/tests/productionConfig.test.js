'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  authSecretDeploymentPolicy,
  auditSecretPolicy,
  auditSecretDeploymentPolicy,
  criticalProductionPolicy,
  dataResidencyPolicy,
  geoProxyPolicy,
  httpsUrlIsValid,
  managedDatabasePolicy,
  productClaimPolicy,
  redisDeploymentPolicy,
  sentryDsnIsValid,
} = require('../lib/productionConfig');

test('auth secrets require distinct managed references and current evidence', () => {
  const now = Date.parse('2026-07-28T00:00:00Z');
  const valid = {
    AUTH_SECRET_SOURCE: 'secret-manager',
    AUTH_SECRET_PROVIDER: 'provider-secret-service',
    JWT_SECRET_REFERENCE: 'projects/prod/secrets/jwt/versions/7',
    SESSION_BINDING_SECRET_REFERENCE: 'projects/prod/secrets/session/versions/4',
    OTP_HMAC_SECRET_REFERENCE: 'projects/prod/secrets/otp/versions/2',
    AUTH_SECRET_ROTATED_AT: '2026-07-01',
  };
  assert.equal(authSecretDeploymentPolicy(valid, now).ok, true);
  assert.equal(authSecretDeploymentPolicy({
    ...valid,
    OTP_HMAC_SECRET_REFERENCE: valid.JWT_SECRET_REFERENCE,
  }, now).ok, false);
  assert.equal(authSecretDeploymentPolicy({ ...valid, AUTH_SECRET_PROVIDER: 'local-file' }, now).ok, false);
});

test('audit HMAC secret is long, non-placeholder and independent from JWT', () => {
  const secret = 'a'.repeat(48);
  assert.equal(auditSecretPolicy({ AUDIT_HMAC_SECRET: secret, JWT_SECRET: 'b'.repeat(48) }).ok, true);
  assert.equal(auditSecretPolicy({ AUDIT_HMAC_SECRET: secret, JWT_SECRET: secret }).ok, false);
  assert.equal(auditSecretPolicy({ AUDIT_HMAC_SECRET: 'your_placeholder_secret', JWT_SECRET: 'b'.repeat(48) }).ok, false);
});

test('audit secret deployment requires current non-local Secret Manager evidence', () => {
  const now = Date.parse('2026-07-28T00:00:00Z');
  const valid = {
    AUDIT_SECRET_SOURCE: 'secret-manager',
    AUDIT_SECRET_PROVIDER: 'provider-secret-service',
    AUDIT_SECRET_REFERENCE: 'projects/prod/secrets/audit/versions/7',
    AUDIT_SECRET_ROTATED_AT: '2026-07-01',
  };
  assert.equal(auditSecretDeploymentPolicy(valid, now).ok, true);
  assert.equal(auditSecretDeploymentPolicy({ ...valid, AUDIT_SECRET_PROVIDER: 'local-file' }, now).ok, false);
  assert.equal(auditSecretDeploymentPolicy({ ...valid, AUDIT_SECRET_ROTATED_AT: '2024-01-01' }, now).ok, false);
});

test('production startup fails closed unless managed JWT and audit secrets are ready', () => {
  const valid = {
    NODE_ENV: 'production',
    JWT_SECRET: 'j'.repeat(48),
    SESSION_BINDING_SECRET: 's'.repeat(48),
    OTP_HMAC_SECRET: 'o'.repeat(48),
    AUTH_SECRET_SOURCE: 'secret-manager',
    AUTH_SECRET_PROVIDER: 'provider-secret-service',
    JWT_SECRET_REFERENCE: 'projects/prod/secrets/jwt/versions/7',
    SESSION_BINDING_SECRET_REFERENCE: 'projects/prod/secrets/session/versions/4',
    OTP_HMAC_SECRET_REFERENCE: 'projects/prod/secrets/otp/versions/2',
    AUTH_SECRET_ROTATED_AT: '2026-07-01',
    AUDIT_HMAC_SECRET: 'a'.repeat(48),
    AUDIT_SECRET_SOURCE: 'secret-manager',
    AUDIT_SECRET_PROVIDER: 'provider-secret-service',
    AUDIT_SECRET_REFERENCE: 'projects/prod/secrets/audit/versions/7',
    AUDIT_SECRET_ROTATED_AT: '2026-07-01',
  };
  assert.equal(criticalProductionPolicy(valid).ok, true);
  assert.equal(criticalProductionPolicy({ ...valid, AUDIT_HMAC_SECRET: valid.JWT_SECRET }).ok, false);
  assert.equal(criticalProductionPolicy({ ...valid, AUDIT_SECRET_SOURCE: 'dotenv' }).ok, false);
  assert.equal(criticalProductionPolicy({ ...valid, OTP_HMAC_SECRET: valid.JWT_SECRET }).ok, false);
  assert.equal(criticalProductionPolicy({ NODE_ENV: 'development' }).ok, true);
});

test('production auth policy accepts independent Secret Manager mounted files', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mahad-auth-secrets-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const files = Object.fromEntries(['jwt', 'session', 'otp', 'audit'].map((name, index) => {
    const file = path.join(directory, name);
    fs.writeFileSync(file, String.fromCharCode(97 + index).repeat(64), 'utf8');
    return [name, file];
  }));
  const result = criticalProductionPolicy({
    NODE_ENV: 'production',
    JWT_SECRET_FILE: files.jwt,
    SESSION_BINDING_SECRET_FILE: files.session,
    OTP_HMAC_SECRET_FILE: files.otp,
    AUDIT_HMAC_SECRET_FILE: files.audit,
    AUTH_SECRET_SOURCE: 'secret-manager',
    AUTH_SECRET_PROVIDER: 'provider-secret-service',
    JWT_SECRET_REFERENCE: 'projects/prod/secrets/jwt/versions/7',
    SESSION_BINDING_SECRET_REFERENCE: 'projects/prod/secrets/session/versions/4',
    OTP_HMAC_SECRET_REFERENCE: 'projects/prod/secrets/otp/versions/2',
    AUTH_SECRET_ROTATED_AT: '2026-07-01',
    AUDIT_SECRET_SOURCE: 'secret-manager',
    AUDIT_SECRET_PROVIDER: 'provider-secret-service',
    AUDIT_SECRET_REFERENCE: 'projects/prod/secrets/audit/versions/7',
    AUDIT_SECRET_ROTATED_AT: '2026-07-01',
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('data residency requires fresh dated evidence and provider identity', (t) => {
  const now = Date.parse('2026-07-28T00:00:00Z');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mahad-residency-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const evidenceFile = path.join(directory, 'residency.txt');
  fs.writeFileSync(evidenceFile, 'provider region evidence', 'utf8');
  const evidenceSha = crypto.createHash('sha256').update(fs.readFileSync(evidenceFile)).digest('hex');
  const valid = {
    DATA_RESIDENCY_REGION: 'eg-cairo',
    DATA_RESIDENCY_PROVIDER: 'provider-a',
    DATA_RESIDENCY_EVIDENCE: 'contract-region-42',
    DATA_RESIDENCY_EVIDENCE_FILE: evidenceFile,
    DATA_RESIDENCY_EVIDENCE_SHA256: evidenceSha,
    DATA_RESIDENCY_VERIFIED_AT: '2026-07-01',
  };
  assert.equal(dataResidencyPolicy(valid, now).ok, true);
  assert.equal(dataResidencyPolicy({ ...valid, DATA_RESIDENCY_VERIFIED_AT: '2024-01-01' }, now).ok, false);
  assert.equal(dataResidencyPolicy({ ...valid, DATA_RESIDENCY_EVIDENCE: '' }, now).ok, false);
  assert.equal(dataResidencyPolicy({ ...valid, DATA_RESIDENCY_EVIDENCE_SHA256: 'not-a-hash' }, now).ok, false);
  assert.equal(dataResidencyPolicy({
    ...valid,
    DATA_RESIDENCY_REGION: 'local-development',
    DATA_RESIDENCY_PROVIDER: 'local-staging-mysql',
  }, now).ok, false);
});

test('Redis deployment requires managed provider metadata and TLS outside local development', () => {
  assert.equal(redisDeploymentPolicy({
    NODE_ENV: 'production',
    RATE_LIMIT_REDIS_ENABLED: 'true',
    REDIS_URL: 'redis://cache.internal:6379',
    REDIS_PROVIDER: 'managed-cache',
    REDIS_REGION: 'me-central-1',
  }).ok, false);
  assert.equal(redisDeploymentPolicy({
    NODE_ENV: 'production',
    RATE_LIMIT_REDIS_ENABLED: 'true',
    REDIS_URL: 'rediss://cache.internal:6379',
    REDIS_PROVIDER: 'managed-cache',
    REDIS_REGION: 'me-central-1',
  }).ok, true);
  assert.equal(redisDeploymentPolicy({
    NODE_ENV: 'production',
    RATE_LIMIT_REDIS_ENABLED: 'true',
    REDIS_URL: 'rediss://cache.internal:6379',
    REDIS_PROVIDER: 'local-test',
    REDIS_REGION: 'local',
  }).ok, false);
  assert.equal(redisDeploymentPolicy({
    NODE_ENV: 'test',
    RATE_LIMIT_REDIS_ENABLED: 'true',
    REDIS_URL: 'redis://127.0.0.1:6380',
    REDIS_PROVIDER: 'local-test',
    REDIS_REGION: 'local',
  }).ok, true);
});

test('managed MySQL requires CA verification, pinned region and recent PITR restore evidence', (t) => {
  const now = Date.parse('2026-07-28T00:00:00Z');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mahad-managed-db-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const caFile = path.join(directory, 'mysql-ca.pem');
  const evidenceFile = path.join(directory, 'restore-drill.json');
  fs.writeFileSync(caFile, 'test ca material', 'utf8');
  fs.writeFileSync(evidenceFile, '{"restored":true}', 'utf8');
  const evidenceSha = crypto.createHash('sha256').update(fs.readFileSync(evidenceFile)).digest('hex');
  const valid = {
    DB_PROVIDER: 'managed-mysql',
    DB_REGION: 'me-central-1',
    DB_SSL_MODE: 'verify-ca',
    DB_SSL_CA_PATH: caFile,
    DB_PITR_ENABLED: 'true',
    DB_BACKUP_EVIDENCE: 'restore-drill-2026-07',
    DB_BACKUP_EVIDENCE_FILE: evidenceFile,
    DB_BACKUP_EVIDENCE_SHA256: evidenceSha,
    DB_BACKUP_VERIFIED_AT: '2026-07-15',
  };
  assert.equal(managedDatabasePolicy(valid, now).ok, true);
  assert.equal(managedDatabasePolicy({ ...valid, DB_SSL_MODE: 'disabled' }, now).ok, false);
  assert.equal(managedDatabasePolicy({ ...valid, DB_PROVIDER: 'local-mysql' }, now).ok, false);
  assert.equal(managedDatabasePolicy({ ...valid, DB_BACKUP_VERIFIED_AT: '2025-01-01' }, now).ok, false);
});

test('geo and proxy policy requires exact hops and current production evidence', (t) => {
  const now = Date.parse('2026-07-28T00:00:00Z');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mahad-geo-policy-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const evidenceFile = path.join(directory, 'edge.json');
  fs.writeFileSync(evidenceFile, '{"trustedProxyHops":1}', 'utf8');
  const evidenceSha = crypto.createHash('sha256').update(fs.readFileSync(evidenceFile)).digest('hex');
  const valid = {
    NODE_ENV: 'production',
    TRUST_PROXY_HOPS: '1',
    TRUST_GEO_HEADERS: 'true',
    GEO_DEFAULT_COUNTRY_CODE: '',
    GEO_POLICY_PROVIDER: 'cloud-edge',
    GEO_POLICY_EVIDENCE: 'edge-config-export-17',
    GEO_POLICY_EVIDENCE_FILE: evidenceFile,
    GEO_POLICY_EVIDENCE_SHA256: evidenceSha,
    GEO_POLICY_VERIFIED_AT: '2026-07-01',
  };
  assert.equal(geoProxyPolicy(valid, now).ok, true);
  assert.equal(geoProxyPolicy({ ...valid, TRUST_PROXY_HOPS: '0' }, now).ok, false);
  assert.equal(geoProxyPolicy({ ...valid, GEO_DEFAULT_COUNTRY_CODE: 'EG' }, now).ok, false);
  assert.equal(geoProxyPolicy({
    ...valid,
    TRUST_GEO_HEADERS: 'false',
    GEOIP_API_URL: 'https://geo.provider.test/{ip}',
  }, now).ok, true);
  assert.equal(geoProxyPolicy({ ...valid, GEO_POLICY_EVIDENCE_SHA256: '' }, now).ok, false);
});

test('product claim boundary rejects enterprise SaaS and full ERP labels', () => {
  assert.equal(productClaimPolicy({ PRODUCT_CAPABILITY_TIER: 'multi-tenant-pilot' }).ok, true);
  assert.equal(productClaimPolicy({ PRODUCT_CAPABILITY_TIER: 'institute-suite' }).ok, true);
  assert.equal(productClaimPolicy({ PRODUCT_CAPABILITY_TIER: 'enterprise-saas' }).ok, false);
  assert.equal(productClaimPolicy({ PRODUCT_CAPABILITY_TIER: 'full-erp' }).ok, false);
});

test('observability endpoints require valid HTTPS URLs', () => {
  assert.equal(sentryDsnIsValid('https://public@example.ingest.sentry.io/12345'), true);
  assert.equal(sentryDsnIsValid('http://public@example.test/12345'), false);
  assert.equal(httpsUrlIsValid('https://alerts.example.test/hook'), true);
  assert.equal(httpsUrlIsValid('not-a-url'), false);
});
