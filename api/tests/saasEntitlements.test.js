'use strict';
const { authRouteSource } = require('./_authRouteSource');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const scope = read('lib/tenantScope.js');
const quota = read('middleware/tenantQuota.js');
const saas = read('routes/saas-admin.js');
const auth = authRouteSource();
const staff = read('routes/staff.js');
const catalog = read('routes/admin/catalog.js');
const talent = read('routes/hr/talent.js');
const config = read('routes/config.js');
const integrityMigration = read('migrations/146_v25_saas_control_plane_integrity.sql');



test('staff, course and user creation paths use the server-side quota guard', () => {
  assert.match(staff, /requireTenantQuota\('staff'\)/);
  assert.match(talent, /requireTenantQuota\('staff'\)/);
  assert.match(catalog, /requireTenantQuota\('courses'\)/);
  assert.ok((auth.match(/requireTenantQuota\('users'/g) || []).length >= 4);
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






