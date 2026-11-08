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
const { codeOnlyKeepingUrls: codeOnly } = require('./support/repo');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

test('deleting a ticket is offered only to whoever can delete one', () => {
  // DELETE /api/admin/tickets/:id is requireAdmin, and الدعم والجودة opens on
  // manage_inbox — support, sales, collection and three managers all reached
  // this screen and saw a delete that could only ever answer 403.
  const support = read('api/routes/support.js');
  

  // The tickets screen and the inbox are one page since 8 Oct 2026; both of
  // its deletes — the row's and the drawer's — sit behind the route's check.
  assert.ok(!fs.existsSync(path.join(__dirname, '..', '..', 'admin/pages/dashboard/tabs/TicketsTab.tsx')), 'the duplicate screen is gone');
  const inbox = codeOnly(read('admin/pages/dashboard/tabs/CustomerInboxTab.tsx'));
  // [^>] would stop at the > inside `onClick={() =>`.
  assert.equal((inbox.match(/\{isAdmin && <button[\s\S]{0,200}?deleteTicketApi/g) || []).length, 2);
});



