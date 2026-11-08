'use strict';
const { leadsRouteSource } = require('./_authRouteSource');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const leadsRoute = leadsRouteSource();
const ordersRoute = fs.readFileSync(path.join(root, 'api/routes/orders.js'), 'utf8');
const stafflists = fs.readFileSync(path.join(root, 'api/routes/admin/stafflists.js'), 'utf8');

// The routes that replaced whole-table downloads. Read as text because each
// module opens the pool at import.

const AGGREGATE_ROUTES = [
  ['/api/admin/leads/staff-performance', leadsRoute],
  ['/api/admin/leads/crm-insights', leadsRoute],
  ['/api/admin/subscribers/stats', stafflists],
];

// A role scoped to nothing gets an empty answer, another rep's leads stay out of
// mine, a from that is not a date is dropped and the scored limit is clamped:
// over HTTP in tests/integration/crmAssignment.integration.test.js.

test('every aggregate route authenticates, permissions and scopes', () => {
  for (const [route, src] of AGGREGATE_ROUTES) {
    const start = src.indexOf(`router.get('${route}'`);
    assert.ok(start > -1, `${route} must exist`);
    // The handler, up to the next route registration.
    const nextRoute = src.indexOf("\nrouter.", start + 10);
    const body = src.slice(start, nextRoute === -1 ? src.length : nextRoute);

    assert.ok(body.includes('requireAuth'), `${route} must require authentication`);
    // One permission or a list of them, and every one named must be a view
    // permission — an aggregate gated on a write permission would be reachable
    // by people who can change rows and not by the ones who only read them.
    const gate = /require(?:Any)?Permission\(([^)]*)\)/.exec(body);
    assert.ok(gate, `${route} must check a permission`);
    const named = [...gate[1].matchAll(/'([a-z_]+)'/g)].map(match => match[1]);
    assert.ok(named.length && named.every(permission => permission.startsWith('view_')),
      `${route} must check view permissions only — it checks ${named.join(', ') || 'nothing'}`);
    // An aggregate that ignores role scoping leaks counts across branches even
    // though it returns no rows — the count itself is the disclosure.
    assert.ok(/leadScope\(req, 'l'\)|resolveDataScope\(/.test(body),
      `${route} must apply role scoping`);
  }
});




