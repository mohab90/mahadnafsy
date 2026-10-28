'use strict';
// A customer was shown «تم تأكيد الدفع 2800 جنيه» for a transfer nobody could
// find. The row was real: status paid, 2800 EGP, recorded by a staff member —
// and payment_method NULL, so it appeared in no provider report and there was
// nothing to reconcile it against. 192 paid rows on production are in that
// state. The modal draws the field as required, but an empty string reaching
// the API became NULL and was stored as paid anyway.
//
// Two routes can settle a payment and both are held to the same rule. Only
// settling is held to it — a pending row is still being sorted out, which is
// exactly when the method may not be known yet.
const { ordersScreenSource } = require('./_authRouteSource');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');


// Comments quote the rule they explain, and one of them quotes the Arabic
// message verbatim. Matching against the source with comments left in lets a
// deleted check keep passing on the strength of the paragraph describing it.
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');


// The server's half — a settled payment needs a method, a pending one does not, an
// approver supplies it and it is kept, a rejection is not held to it — runs over
// HTTP in tests/integration/deskPaymentsAndOrders.integration.test.js. What is
// left is the review screen and the API client.

const ADMIN = path.join(__dirname, '..', '..', 'admin');
const readAdmin = rel => fs.readFileSync(path.join(ADMIN, ...rel.split('/')), 'utf8');
const ordersTab = codeOnly(ordersScreenSource());

test('the review queue asks for a method when the payment has none', () => {
  assert.match(ordersTab, /const storedMethod = \(\(p as \{paymentMethod\?:string\}\)\.paymentMethod\|\|''\)\.trim\(\)/);
  assert.match(ordersTab, /\{!storedMethod && \(/);
  // Read once at the top of the component — this dropdown sits inside a
  // conditional block, so the hook cannot be called here.
  assert.match(ordersTab, /const paymentBoxes = usePaymentBoxes\(content\['finance\.payment_methods'\]\)/);
  assert.match(ordersTab, /\{paymentBoxes\.map\(/);
});

test('it cannot be approved until one is chosen, and the choice is sent', () => {
  assert.match(ordersTab, /disabled=\{!storedMethod && !approveMethod\[payId\]\}/);
  assert.match(ordersTab, /updatePaymentStatus\(payId, 'paid', undefined, approveMethod\[payId\] \|\| undefined\)/);
});

test('rejecting still needs nothing', () => {
  // Refusing a payment is not a claim that money arrived: no method is asked, only the reason.
  assert.match(ordersTab, /updatePaymentStatus\(payId, 'failed', reason\)/);
});

test('the API client forwards the method', () => {
  const client = codeOnly(readAdmin('lib/mysqlapi.ts'));
  assert.match(client, /updatePaymentStatus: \(id: string, status: 'paid' \| 'failed' \| 'pending', reviewNote\?: string, paymentMethod\?: string, transfer\?: \{ transferId: string \}\)/);
  // The transfer rides along only when there is one, so a plain approval's body is unchanged.
  assert.match(client, /JSON\.stringify\(\{ status, reviewNote, paymentMethod, \.\.\.\(transfer \? \{ transfer \} : \{\}\) \}\)/);
});
