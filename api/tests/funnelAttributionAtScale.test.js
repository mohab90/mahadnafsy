'use strict';
/**
 * «Where does the money come from» (GET /api/admin/funnel/attribution) at 600,000 leads (31 Oct 2026 audit).
 *
 * The lab read it at 5-8 s cold (15 s timeout for a second account whose cache had lapsed): every lead, bought or
 * not, went through leads LEFT JOIN subscribers LEFT JOIN payments before the GROUP BY. Only 20,000 of the 600,000
 * leads have a client. Split in two reads — the leads counted alone, the leads that have a client with their
 * payments — and merged by label, it is 0.5-2.5 s with byte-identical output (4 query shapes compared: by source,
 * by salesperson, with and without a date range).
 *
 * The guard that keeps a soft-deleted payment out stays in the ON of the LEFT JOIN, where softDeletedMoney.test.js
 * looks for it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const funnel = fs.readFileSync(path.join(__dirname, '..', 'routes', 'funnel.js'), 'utf8').replace(/\r\n/g, '\n');
const route = funnel.slice(funnel.indexOf("router.get('/api/admin/funnel/attribution'"), funnel.indexOf("router.get('/api/admin/action-center'"));

test('attribution counts leads on their own and reads payments only through the leads that have a client', () => {
  assert.ok(route.includes('FROM leads l\n             ${salesJoin}\n            WHERE ${where}'), 'the lead count must not join subscribers');
  assert.ok(route.includes('FROM subscribers s\n             JOIN leads l ON l.id = s.lead_id AND l.tenant_id = s.tenant_id'), 'the revenue read starts from the clients');
  assert.ok(!/FROM leads l\s+\$\{salesJoin\}\s+LEFT JOIN subscribers/.test(route), 'leads LEFT JOIN subscribers over the whole table is the 5-8 s shape');
  assert.equal((route.match(/pool\.query\(/g) || []).length, 2, 'two reads, merged in memory');
});

test('attribution keeps the soft-delete guard in the join and the top-40 cut after the merge', () => {
  assert.match(route, /LEFT JOIN payments p ON p\.subscriber_id = s\.id AND p\.tenant_id=l\.tenant_id AND p\.deleted_at IS NULL/);
  assert.ok(route.indexOf('.sort(') < route.indexOf('.slice(0, 40)'), 'sort by revenue, then leads, then keep 40');
  assert.ok(route.indexOf('.slice(0, 40)') < route.indexOf('const totalRev'), 'the share is of the 40 kept, as before');
});
