'use strict';

// A payment taken at the desk belongs to the box that took it, not to Paymob.
//
// /api/admin/orders returns the orders table and, after it, every manual
// payment that no order already covers, marked source:'crm'. The vault told
// the two apart by that mark — and both of the panel's order mappers dropped
// it, so every desk payment arrived looking like an online order. On
// production that was all 175 payments with a named box: «أونلاين (Paymob)»
// carried them, and because their ids then counted as online, each one was
// also taken out of its own box. Clicking «فودافون كاش» opened nothing.
//
// So: one mapper, which keeps the mark, and one rule for "came through
// Paymob", used by the vault and by the export alike.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const MODULE = path.join(ROOT, 'admin', 'context', 'site-data-hooks', 'normalizeOrders.ts');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The real module with its types stripped, not a copy of its rules.
function load() {
  const js = require('node:module')
    .stripTypeScriptTypes(fs.readFileSync(MODULE, 'utf8'))
    .replace(/^export /gm, '');
  const box = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', js + '\nmodule.exports = { normalizeOrders, isOnlinePaidOrder };')(box, box.exports);
  return box.exports;
}

// Shaped as the route sends them.
const deskPayment = {
  id: '98fd1ae7-8ca1', amount: 1382, currency: 'EGP', status: 'paid', type: 'course',
  payment_method: 'فودافون كاش 2020', staff_name: 'منى', created_at: '2026-09-04T10:00:00.000Z', source: 'crm',
};
const paymobOrder = {
  id: 'ord-1', amount: 2500, currency: 'EGP', status: 'PAID', type: 'COURSE',
  payment_method: 'card', transaction_id: 'txn-9', created_at: '2026-09-05T10:00:00.000Z',
};

test('the mapper keeps the mark that says a row is a desk payment', () => {
  const { normalizeOrders } = load();
  const [desk, online] = normalizeOrders([deskPayment, paymobOrder]);
  assert.equal(desk.source, 'crm');
  assert.equal(online.source, undefined);
  assert.equal(desk.paymentMethod, 'فودافون كاش 2020');
  assert.equal(desk.staffName, 'منى');
  assert.equal(online.status, 'paid');
});

test('a desk payment is not online, whatever box it went into', () => {
  const { normalizeOrders, isOnlinePaidOrder } = load();
  for (const method of ['فودافون كاش 2020', 'كاش', 'انستا باي', 'MANUAL', 'wallet', 'card']) {
    const [row] = normalizeOrders([{ ...deskPayment, payment_method: method }]);
    assert.equal(isOnlinePaidOrder(row), false, `a desk payment into «${method}» was counted as Paymob`);
  }
});

test('Paymob stays online, whether it arrived as an order or as a payment row', () => {
  const { normalizeOrders, isOnlinePaidOrder } = load();
  const [order, mirrored] = normalizeOrders([paymobOrder, { ...deskPayment, payment_method: 'online_paymob' }]);
  assert.equal(isOnlinePaidOrder(order), true);
  assert.equal(isOnlinePaidOrder(mirrored), true);
  const [unpaid] = normalizeOrders([{ ...paymobOrder, status: 'PENDING' }]);
  assert.equal(isOnlinePaidOrder(unpaid), false);
});

test('both loads of the orders go through the one mapper', () => {
  for (const file of ['admin/context/site-data-hooks/useAdminDataRuntime.ts', 'admin/context/site-data-hooks/useCrmCoreState.ts']) {
    const src = read(file);
    assert.ok(src.includes("from './normalizeOrders'"), `${file} does not use the shared mapper`);
    assert.ok(!src.includes('row.payment_method') && !src.includes('r.payment_method'), `${file} maps orders by hand again`);
  }
});

test('the vault and the export ask the same question', () => {
  for (const file of ['admin/pages/dashboard/tabs/FinancialTab.tsx', 'admin/pages/dashboard/tabs/financial/financialExports.ts']) {
    const src = read(file);
    assert.ok(src.includes('isOnlinePaidOrder'), `${file} decides "online" for itself`);
    assert.ok(!src.includes("!== 'crm'"), `${file} still tests the mark inline`);
  }
});
