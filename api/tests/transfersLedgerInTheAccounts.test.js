'use strict';

// «التحويلات» and «إضافة تحويل» in الحسابات wrote each transfer as an order
// with type='transfer' — a type the orders ENUM cannot hold — so no transfer
// was ever saved and «🔗 ربط» could not succeed. They use the transfers ledger
// (migration 224, lib/incomingTransfers.js) now.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

test('confirming a payment against a transfer takes it from the ledger, once', () => {
  const orders = read('api/routes/orders.js');
  const confirm = orders.slice(orders.indexOf("router.post('/api/admin/orders/:id/confirm-payment'"), orders.indexOf('// PATCH /api/admin/orders/:id'));
  assert.match(confirm, /FROM incoming_transfers WHERE id=\? AND tenant_id=\? LIMIT 1 FOR UPDATE/);
  assert.match(confirm, /if \(row\.payment_id\) \{ await conn\.rollback\(\); return res\.status\(409\)/, 'a transfer confirms one payment');
  assert.match(confirm, /if \(transfer\) await linkTransfer\(conn, \{ tenantId: req\.tenantId, paymentId, link: \{ transferId: transfer\.id \} \}\);\s+await conn\.commit\(\);/);
  assert.doesNotMatch(confirm, /type='transfer'/);
  // A refusal reaches the screen in words, not as «Internal server error».
  assert.match(confirm, /if \(refused >= 400 && refused < 500\) return res\.status\(refused\)\.json\(\{ error: e\.message \}\);/);
});

test('the accounts screen lists and records transfers on the ledger', () => {
  const tab = read('admin/pages/dashboard/tabs/OrdersTab.tsx');
  assert.doesNotMatch(tab, /type: 'transfer'|r\.type === 'transfer'\)\.length/);
  assert.match(tab, /const ledger = useIncomingTransfers\(canManageFinancial\);/);
  assert.match(tab, /const availableTransfers = ledger\.transfers\.filter\(transfer => !transfer\.paymentId\);/);
  const ledger = read('admin/pages/dashboard/tabs/orders/IncomingTransfers.tsx');
  assert.match(ledger, /adminGet<IncomingTransfer\[\]>\('\/admin\/incoming-transfers'\)/);
  assert.match(ledger, /const ready = Number\(form\.amount\) > 0 && !!form\.method && !!form\.reference\.trim\(\);/,
    'the operation number is asked for: the server refuses a transfer without one');
  // Nothing else wrote an order from the admin, so the call is gone.
  assert.doesNotMatch(read('admin/lib/mysqlapi.ts'), /saveOrder:/);
});
