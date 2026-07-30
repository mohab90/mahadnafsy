'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const scope = read('lib/tenantScope.js');
const quota = read('middleware/tenantQuota.js');
const saas = read('routes/saas-admin.js');
const auth = read('routes/auth.js');
const staff = read('routes/staff.js');
const catalog = read('routes/admin/catalog.js');
const talent = read('routes/hr/talent.js');
const config = read('routes/config.js');
const integrityMigration = read('migrations/146_v25_saas_control_plane_integrity.sql');

test('plan feature switches are enforced by the API and tenant overrides win over global flags', () => {
  assert.match(scope, /planLimits\.features/);
  assert.match(scope, /ORDER BY tenant_id IS NOT NULL ASC/);
  assert.match(scope, /code: 'PLAN_FEATURE_DISABLED'/);
  assert.match(read('lib/adminFeatureGate.js'), /requireTenantFeature\(feature\)/);
  assert.match(read('lib/httpApp.js'), /adminFeatureGate/);
  assert.match(scope, /tenant\?\.status === 'active' && entitlementIsCurrent/);
  assert.doesNotMatch(scope, /\.catch\(\(\) => \[\[null\]\]\)/);
});

test('staff, course and user creation paths use the server-side quota guard', () => {
  assert.match(staff, /requireTenantQuota\('staff'\)/);
  assert.match(talent, /requireTenantQuota\('staff'\)/);
  assert.match(catalog, /requireTenantQuota\('courses'\)/);
  assert.ok((auth.match(/requireTenantQuota\('users'/g) || []).length >= 4);
});

test('quota checks are concurrency-safe and report machine-readable usage', () => {
  assert.match(quota, /SELECT GET_LOCK\(\?, 5\) AS acquired/);
  assert.match(quota, /SELECT RELEASE_LOCK\(\?\)/);
  assert.match(quota, /code: 'PLAN_QUOTA_EXCEEDED'/);
  assert.match(quota, /requested/);
  assert.match(quota, /WHERE tenant_id=\?/);
});

test('tenant plan changes update both display metadata and the effective subscription atomically', () => {
  const patch = saas.slice(
    saas.indexOf("router.patch('/api/admin/saas/tenants/:id'"),
    saas.indexOf('// ── DB backups')
  );
  assert.match(patch, /beginTransaction\(\)/);
  assert.match(patch, /UPDATE tenants SET/);
  assert.match(patch, /UPDATE tenant_subscriptions SET plan_id=\?/);
  assert.match(patch, /commit\(\)/);
  assert.match(patch, /rollback\(\)/);
});

test('platform plan API validates and persists limits plus module entitlements', () => {
  assert.match(saas, /router\.patch\('\/api\/admin\/saas\/plans\/:id'/);
  assert.match(saas, /allowedLimits = new Set\(\['branches', 'staff', 'courses', 'users'\]\)/);
  assert.match(saas, /DEFAULT_FEATURES/);
  assert.match(saas, /feature_limits_json=\?/);
  assert.match(saas, /clearTenantContextCache\(\)/);
});

test('branch settings update the canonical branch catalog atomically and enforce the plan quota', () => {
  assert.match(config, /saveContentAndBranchCatalog/);
  assert.match(config, /context\.planLimits\?\.branches/);
  assert.match(config, /UPDATE branches SET is_active=0 WHERE tenant_id=\?/);
  assert.match(config, /INSERT INTO branches[\s\S]*ON DUPLICATE KEY UPDATE/);
  assert.match(config, /db: conn/);
});

test('SaaS schema prevents duplicate global flags and concurrent effective subscriptions', () => {
  assert.match(integrityMigration, /uq_feature_flags_scope_key/);
  assert.match(integrityMigration, /uq_tenant_subscription_active/);
  assert.match(integrityMigration, /chk_feature_flags_scope/);
  assert.match(integrityMigration, /chk_tenant_subscription_active_scope/);
  assert.doesNotMatch(integrityMigration, /GENERATED ALWAYS/i);
  assert.match(saas, /tenantId \|\| '__global__'/);
  assert.match(saas, /active_tenant_id/);
  assert.match(saas, /SELECT GET_LOCK\(\?, 5\) AS acquired/);
});
