'use strict';
/**
 * Who may reach the money routes, asked of the real routers: a caller with each permission, one with every OTHER permission, one with none.
 * (These were regular expressions over the route files, `requirePermission('x')` next to a path; a guard moved to a middleware list or a
 * helper made them fail with nothing changed for the caller.)
 *
 * Tenant scoping of the same routes' SQL is held by the quality gate's check «tenant-scope violations» (tools/tenant-scope-scan.mjs, baseline 0
 * over every query in api/routes) and, over HTTP with two institutes, by tests/integration/tenantIsolation.integration.test.js.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { guard, staffWith } = require('./support/routes');

/** [router, method, path, permissions that open it (any one of them)] */
const ROUTES = [
  ['../routes/core/financepay', 'patch', '/api/admin/payments/:id/status', ['manage_financial', 'confirm_transfers']],
  ['../routes/finance/refunds', 'put', '/api/admin/finance/refunds/:id', ['approve_refunds']],
  ['../routes/misc/billing', 'get', '/api/admin/payments/:id/invoice-html', ['view_financial']],
  ['../routes/crm-tools', 'get', '/api/admin/payments/outstanding', ['view_financial']],
  ['../routes/crm-tools', 'post', '/api/admin/payments/send-reminder', ['manage_payments']],
  ['../routes/admin/stafflists', 'put', '/api/admin/subscribers/:id/assign-collection', ['manage_subscribers']],
  ['../routes/crm-advanced', 'put', '/api/admin/crm/leads/:id/status', ['manage_leads']],
  ['../routes/config', 'post', '/api/admin/fx-rates/refresh', ['manage_financial']],
  ['../routes/hr/staff-file', 'put', '/api/admin/hr/staff/:staffId/pay', ['manage_financial']],
  ['../routes/hr/talent', 'post', '/api/admin/hr/join-us/:id/to-applicant', ['manage_hr']],
];

for (const [file, method, routePath, opens] of ROUTES) {
  test(`${method.toUpperCase()} ${routePath} opens for ${opens.join(' or ')} and for nothing less`, async () => {
    let router;
    try { router = require(file); if (router.router) router = router.router; } catch (error) { assert.fail(`${file}: ${error.message}`); }
    const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods[method]);
    if (!layer) return assert.fail(`${method} ${routePath} is no longer a route of ${file}`);
    for (const permission of opens) {
      assert.equal((await guard(router, method, routePath, { staff: staffWith(permission) })).allowed, true, `${permission} opens it`);
    }
    const others = ['view_dashboard', 'view_leads', 'manage_inbox', 'view_reports'].filter(permission => !opens.includes(permission));
    const refused = await guard(router, method, routePath, { staff: staffWith(...others) });
    assert.equal(refused.allowed, false, 'a caller with only other permissions is refused');
    assert.equal(refused.status, 403);
    assert.equal((await guard(router, method, routePath, { staff: null })).status, 403, 'no staff record, no entry');
  });
}
