'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const route = fs.readFileSync(path.join(root, 'api/routes/admin/leads.js'), 'utf8');

// The CRM screens read these aggregates instead of downloading every lead. The
// route module opens the pool at import, so this reads it as text — the same
// approach the sibling Dokki tests take.

test('the score is computed, never read from the leads.score column', () => {
  // 15,974 of 29,272 production rows have score = 0 because no import ever
  // scored them, and even a backfilled column would drift: the formula decays
  // with time and the column only changes when the lead is written.
  assert.ok(route.includes('LEAD_SCORE_SQL'), 'the SQL formula must exist');
  assert.ok(!/SUM\(l\.score\)/.test(route),
    'SUM(l.score) would report 0 for every rep whose leads were bulk-imported');
  assert.ok(!/AVG\(l\.score\)/.test(route), 'same for AVG(l.score)');
});

test('the score formula covers every status the JavaScript original scores', () => {
  const helpers = fs.readFileSync(path.join(root, 'api/lib/helpers.js'), 'utf8');
  const block = helpers.slice(helpers.indexOf('const statusScore = {'));
  const jsStatuses = [...block.slice(0, block.indexOf('};')).matchAll(/(\w+):\s*\d+/g)]
    .map(m => m[1]);
  assert.ok(jsStatuses.length > 10, 'sanity: the JS status table was found');

  const sql = route.slice(route.indexOf('const LEAD_SCORE_SQL'));
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

test('dates leaving the lead mapper are calendar dates, not Date.toString()', () => {
  // next_follow_up_date is a DATETIME, so mysql2 returns a Date and JSON renders
  // it '2026-08-23T00:00:00.000Z'. The reminders panel compares that with ===
  // against a bare '2026-08-23', which can never be true — the "due today"
  // column was permanently empty and today's follow-ups showed as upcoming.
  assert.ok(route.includes('nextFollowUpDate: ymd(r.next_follow_up_date)'),
    'the mapper must normalise next_follow_up_date through ymd()');
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
  const start = route.indexOf('const [idleRows] = await pool.query');
  const body = route.slice(start, start + 1600);
  assert.ok(body.includes('LIMIT 50'), 'only the 50 shown should be fetched');
  assert.ok(body.includes('ORDER BY last_activity ASC, l.id ASC'),
    'without a tie-break the same query returns a different 50 each call');
  assert.ok(body.includes('HAVING DATE(last_activity)'),
    'the idle boundary floors to the calendar day, as the browser did');
});
