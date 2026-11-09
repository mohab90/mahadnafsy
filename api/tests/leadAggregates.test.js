'use strict';
const { leadsRouteSource } = require('./_authRouteSource');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const route = leadsRouteSource();

// The CRM screens read these aggregates instead of downloading every lead. The
// route module opens the pool at import, so this reads it as text — the same
// approach the sibling Dokki tests take.

const scoreSql = fs.readFileSync(path.join(root, 'api/lib/leadScoreSql.js'), 'utf8');
const scoreRefresh = fs.readFileSync(path.join(root, 'api/lib/leadScoreRefresh.js'), 'utf8');



test('the score formula covers every status the JavaScript original scores', () => {
  const helpers = fs.readFileSync(path.join(root, 'api/lib/helpers.js'), 'utf8');
  const block = helpers.slice(helpers.indexOf('const statusScore = {'));
  const jsStatuses = [...block.slice(0, block.indexOf('};')).matchAll(/(\w+):\s*\d+/g)]
    .map(m => m[1]);
  assert.ok(jsStatuses.length > 10, 'sanity: the JS status table was found');

  const sql = scoreSql.slice(scoreSql.indexOf('const LEAD_SCORE_SQL'));
  const caseBlock = sql.slice(0, sql.indexOf('END'));
  for (const status of jsStatuses) {
    assert.ok(caseBlock.includes(`'${status}'`),
      `LEAD_SCORE_SQL is missing the '${status}' arm — that lead would score 0`);
  }
});

test('no predicate wraps the status column in LOWER()', () => {
  // leads.status collates utf8mb4_unicode_ci, so 'converted' already matches the
  // stored 'CONVERTED'. Wrapping it only puts idx_leads_tenant_status_created
  // out of reach — 26,888 rows scanned to answer a question the index holds.
  const predicates = route.match(/(WHERE|AND|HAVING)[^\n]*LOWER\(l?\.?status\)/g) || [];
  assert.deepEqual(predicates, [],
    'LOWER() on status inside a predicate forces a full scan');
});



test('the insights route scopes by role like its siblings', () => {
  const start = route.indexOf("router.get('/api/admin/leads/crm-insights'");
  assert.ok(start > -1, 'the crm-insights route must exist');
  const body = route.slice(start, route.indexOf("router.get('/api/admin/leads/stats'"));
  assert.ok(body.includes('requireAuth'), 'must require authentication');
  assert.ok(body.includes("requirePermission('view_leads')"), 'must check view_leads');
  assert.ok(body.includes("leadScope(req, 'l')"),
    'must apply the same DATA_SCOPE filter as the list and stats routes');
  assert.ok(body.includes('accessScope.none'),
    'a role that may see no leads must get an empty payload, not every lead');
});

test('the redistribution list is bounded and deterministic', () => {
  const start = route.indexOf('const idleWhere =');
  const body = route.slice(start, route.indexOf('const [loadRows]', start));
  assert.ok(start > -1, 'the idle-lead search must exist');
  assert.ok(body.includes('LIMIT 50'), 'only the 50 shown should be fetched');
  assert.ok(body.includes('ORDER BY l.created_at ASC, l.id ASC') && body.includes('ORDER BY last_activity ASC, lead_id ASC'),
    'without a tie-break the same query returns a different 50 each call');
  assert.ok(body.includes('.slice(0, 50)'), 'the merged list is cut to the 50 shown');
  assert.ok(body.includes('HAVING DATE(MAX(date))') && body.includes('INTERVAL ? DAY + INTERVAL 1 DAY'),
    'the idle boundary floors to the calendar day, as the browser did');
});
