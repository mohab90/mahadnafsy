'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const leadsRoute = fs.readFileSync(path.join(root, 'api/routes/admin/leads.js'), 'utf8');
const ordersRoute = fs.readFileSync(path.join(root, 'api/routes/orders.js'), 'utf8');
const stafflists = fs.readFileSync(path.join(root, 'api/routes/admin/stafflists.js'), 'utf8');

// The routes that replaced whole-table downloads. Read as text because each
// module opens the pool at import.

const AGGREGATE_ROUTES = [
  ['/api/admin/leads/scored', leadsRoute],
  ['/api/admin/leads/staff-performance', leadsRoute],
  ['/api/admin/leads/crm-insights', leadsRoute],
  ['/api/admin/subscribers/stats', stafflists],
];

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

test('a role scoped to nothing gets an empty payload, never the whole table', () => {
  for (const [route, src] of AGGREGATE_ROUTES) {
    const start = src.indexOf(`router.get('${route}'`);
    const nextRoute = src.indexOf("\nrouter.", start + 10);
    const body = src.slice(start, nextRoute === -1 ? src.length : nextRoute);
    assert.ok(/accessScope\.none|scope === 'none'/.test(body),
      `${route} must short-circuit when the caller may see no rows`);
  }
});

test('the staff-performance range bound is validated, not interpolated', () => {
  const start = leadsRoute.indexOf("router.get('/api/admin/leads/staff-performance'");
  const body = leadsRoute.slice(start, leadsRoute.indexOf("\nrouter.", start + 10));
  // `from` arrives from the query string and goes into a comparison. It is
  // matched against a bare date and passed as a bound parameter; anything else
  // becomes "no bound", which is the range the screen also offers.
  assert.ok(body.includes('/^\\d{4}-\\d{2}-\\d{2}$/'),
    'from must be checked against a plain calendar date');
  assert.ok(!/\$\{\s*from\s*\}/.test(body),
    'from must never be interpolated into SQL');
});

test('the scored route bounds every number it takes from the query string', () => {
  const start = leadsRoute.indexOf("router.get('/api/admin/leads/scored'");
  const body = leadsRoute.slice(start, leadsRoute.indexOf("\nrouter.", start + 10));
  assert.ok(/Math\.min\(Math\.max\(parseInt\(req\.query\.limit/.test(body),
    'limit must be clamped');
  assert.ok(/Math\.min\(Math\.max\(parseInt\(req\.query\.minScore/.test(body),
    'minScore must be clamped');
  // sortBy picks a column name, so it must be a choice between two literals
  // rather than anything the caller sends.
  assert.ok(body.includes("req.query.sortBy === 'date' ? 'date' : 'score'"),
    'sortBy must resolve to one of two known values');
});

test('the orders list resolves the lead source instead of the browser doing it', () => {
  // The browser did leads.find(l => l.id === order.leadId), which could never
  // match: orders has no lead_id column and the mapper never set leadId. Every
  // order landed in the 'مباشر' bucket, so the chart showed one bar. The join
  // through the subscriber is the link that does exist.
  assert.ok(ordersRoute.includes('LEFT JOIN leads ol ON ol.id=s.lead_id'),
    'orders must resolve the lead through the subscriber');
  assert.ok(ordersRoute.includes("COALESCE(NULLIF(ol.source, ''), '') AS lead_source"),
    'the order row must carry lead_source');
});

test('no aggregate route reads leads.score', () => {
  // The column is zero for every bulk-imported lead and stale for the rest;
  // LEAD_SCORE_SQL recomputes the formula instead. Guarded here as well as in
  // leadAggregates.test.js because a new route is exactly where it would creep
  // back in.
  assert.ok(!/SUM\(l\.score\)|AVG\(l\.score\)/.test(leadsRoute),
    'the stored score column must not be aggregated');
});
