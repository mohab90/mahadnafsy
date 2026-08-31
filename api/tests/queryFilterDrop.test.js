'use strict';
// A filter the route never reads is not a narrow list — it is the whole table.
//
// Two of these were live at once, and both surfaced as "why is this screen
// showing me things that do not belong here":
//
//   • the باي موب tab fetched /api/admin/payments?source=paymob against a
//     handler that destructured startDate, endDate, channel and paymentType and
//     nothing else. It listed every payment in the database — hand-entered cash
//     included — under a heading promising the opposite, and added them into its
//     own "إجمالي المحصّل".
//   • the staff home panel asked for ?my=true where the route read
//     `mine === '1'`. Wrong key and wrong value, so the flag never fired; a
//     manager saw every task in the tenant under "مهامي".
//
// Nothing was watching this. payload-drop-scan covers request bodies on write
// routes; on a read route the failure runs the other way — a dropped filter
// widens the result instead of losing a field, so the screen looks populated
// rather than broken, and only someone who knows the data spots it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const load = () => import(pathToFileURL(
  path.join(__dirname, '..', '..', 'tools', 'query-filter-drop-scan.mjs')));

test('every query filter the admin sends is read by the route it is sent to', async () => {
  const tool = await load();
  const { drops } = tool.scanQueryFilterDrops();
  assert.deepEqual(drops, [], 'these screens are filtering nothing at all');
});

test('the scan is indexing routes, so an empty result means something', async () => {
  // Same lesson as the permission matrix, which twice reported a clean run
  // while its subject count had fallen to zero. If the route pattern stops
  // matching, every caller silently has "no route" and every drop disappears.
  const tool = await load();
  const { routesIndexed } = tool.scanQueryFilterDrops();
  assert.ok(
    routesIndexed >= 300,
    `only ${routesIndexed} GET routes indexed — the scan stopped finding handlers, so a clean result proves nothing`,
  );
});
