'use strict';
/**
 * Buttons rendered without the permission their route enforces.
 *
 * Found by tools/permission-mismatch-scan.mjs, which walks every menu tab,
 * resolves the API calls its screen makes, and reports where a role can open
 * the screen and be refused inside it — the same shape as
 * «خطأ في تحميل لوحة KPI: HTTP 403», which is what prompted writing it.
 * Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('deleting a ticket is offered only to whoever can delete one', () => {
  // DELETE /api/admin/tickets/:id is requireAdmin, and الدعم والجودة opens on
  // manage_inbox — support, sales, collection and three managers all reached
  // this screen and saw a delete that could only ever answer 403.
  const support = read('api/routes/support.js');
  assert.match(support, /router\.delete\('\/api\/admin\/tickets\/:id', requireAuth, requireAdmin/);

  const tickets = codeOnly(read('admin/pages/dashboard/tabs/TicketsTab.tsx'));
  assert.match(tickets, /\{isAdmin && \(\s*<button onClick=\{\(\) => deleteTicketApi/,
    'the delete must be behind the same check the route makes');
  // Through the narrow slice: this screen is already off the wide context, and
  // reaching for useSiteData here would put it back on.
  assert.match(tickets, /const \{ isAdmin \} = useStaticData\(\)/);

  // The sibling inbox already had it right, which is what made this an omission.
  const inbox = codeOnly(read('admin/pages/dashboard/tabs/CustomerInboxTab.tsx'));
  // [^>] would stop at the > inside `onClick={() =>`.
  assert.match(inbox, /\{isAdmin && <button[\s\S]{0,200}?deleteTicketApi/);
});

test('refreshing the exchange rates is offered only to whoever can', () => {
  // POST /api/admin/fx-rates/refresh needs manage_financial; محاسبة الدقي opens
  // on manage_daqqi, so reception_daqqi saw a button that always failed.
  const config = read('api/routes/config.js');
  assert.match(config, /router\.post\('\/api\/admin\/fx-rates\/refresh', requireAuth, requireAdminOrStaff, requirePermission\('manage_financial'\)/);

  const financial = codeOnly(read('admin/pages/dashboard/tabs/FinancialTab.tsx'));
  assert.match(financial, /\{canManageFinancial && <button onClick=\{refreshFxRates\}/);
  // Gated on the permission rather than on isAdmin, because the accountant and
  // the collection desk hold manage_financial and may legitimately refresh.
  assert.match(financial, /'manage_financial',\s*\);/);
});

test('the scan that found them still knows what every route requires', () => {
  const scan = read('tools/permission-mismatch-scan.mjs');
  // Verb and path together: /api/admin/tickets/:id is manage_inbox on GET and
  // admin-only on DELETE, and matching on the path alone reported six roles as
  // broken when their reads were fine.
  assert.match(scan, /const guardFor = \(verb, called\) =>/);
  assert.match(scan, /if \(routeVerb !== verb\) continue;/);
  // And it says what it cannot prove, rather than overclaiming.
  assert.match(scan, /Check the call site before acting/);
});
