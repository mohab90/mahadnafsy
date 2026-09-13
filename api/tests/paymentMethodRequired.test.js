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
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', 'routes', ...rel.split('/')), 'utf8');

// Comments quote the rule they explain, and one of them quotes the Arabic
// message verbatim. Matching against the source with comments left in lets a
// deleted check keep passing on the strength of the paragraph describing it.
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const create = codeOnly(read('subscriber-payments.js'));
const approve = codeOnly(read('core/financepay.js'));

test('recording a settled payment requires a method', () => {
  assert.match(create, /const resolvedMethod = sanitize\(payment\.paymentMethod \|\| payment\.payment_method/);
  assert.match(create, /if \(isPaid && !resolvedMethod\)/);
  assert.match(create, /status\(400\)/);
});

test('the value that was validated is the value that is stored', () => {
  // It used to be sanitized a second time at the INSERT, so a guard on one copy
  // said nothing about the other.
  const insert = create.slice(create.indexOf('INSERT INTO payments'));
  assert.match(insert.slice(0, 2000), /\n\s*resolvedMethod,/);
  assert.doesNotMatch(insert.slice(0, 2000), /sanitize\(payment\.paymentMethod/);
});

test('a pending payment may still be recorded without one', () => {
  // The guard is on isPaid, not on every write: someone taking a booking before
  // the transfer clears has nothing to name yet.
  const guard = create.slice(create.indexOf('if (isPaid && !resolvedMethod)'));
  assert.match(guard.slice(0, 200), /isPaid/);
  assert.doesNotMatch(create, /if \(!resolvedMethod\) \{[\s\S]{0,80}status\(400\)/);
});

test('approving a payment to paid requires a method too', () => {
  assert.match(approve, /const settledMethod = String\(payment\.payment_method \|\| ''\)\.trim\(\) \|\| suppliedMethod/);
  assert.match(approve, /if \(becomingPaid && !settledMethod\)/);
  assert.match(approve, /rollback\(\);[\s\S]{0,60}status\(400\)/);
});

test('an approver can supply the method, and it is persisted', () => {
  // Nothing else can edit a stored method. Without this, a pending row that
  // lacks one could never be approved at all.
  assert.match(approve, /req\.body\.paymentMethod \|\| req\.body\.payment_method/);
  const update = approve.slice(approve.indexOf('UPDATE payments'));
  assert.match(update.slice(0, 400), /SET status=\?, payment_method=\?/);
  assert.match(update.slice(0, 700), /settledMethod \|\| payment\.payment_method \|\| null/);
});

test('rejecting or reverting a payment is not held to the rule', () => {
  // Only becomingPaid. A failed or pending outcome must stay reachable.
  const guard = approve.slice(approve.indexOf('if (becomingPaid && !settledMethod)'), approve.indexOf('const rawAmount'));
  assert.match(guard, /becomingPaid/);
  assert.doesNotMatch(guard, /status === 'failed'/);
});

// ── The admin side of the same rule ────────────────────────────────────────
// The API refusing is only half a fix: the review queue's «قبول» button sent no
// method at all, so a row stored without one would have been refused with no
// way in the screen to supply it.
const ADMIN = path.join(__dirname, '..', '..', 'admin');
const readAdmin = rel => fs.readFileSync(path.join(ADMIN, ...rel.split('/')), 'utf8');
const ordersTab = codeOnly(readAdmin('pages/dashboard/tabs/OrdersTab.tsx'));

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
  // Refusing a payment is not a claim that money arrived.
  assert.match(ordersTab, /updatePaymentStatus\(payId, 'failed'\)/);
});

test('the API client forwards the method', () => {
  const client = codeOnly(readAdmin('lib/mysqlapi.ts'));
  assert.match(client, /updatePaymentStatus: \(id: string, status: 'paid' \| 'failed' \| 'pending', reviewNote\?: string, paymentMethod\?: string\)/);
  assert.match(client, /JSON\.stringify\(\{ status, reviewNote, paymentMethod \}\)/);
});
