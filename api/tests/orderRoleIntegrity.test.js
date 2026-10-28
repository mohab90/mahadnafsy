'use strict';
// The orders routes — reading needs view_orders, confirming needs
// manage_financial and is refused to whoever recorded the order, the generic
// status edit cannot mark money paid or refunded — are driven over HTTP in
// tests/integration/deskPaymentsAndOrders.integration.test.js. What is left is
// the screen, which must not offer what the server refuses.

const { ordersScreenSource } = require('./_authRouteSource');
const test = require('node:test');
const assert = require('node:assert/strict');

const ordersUi = ordersScreenSource();

test('the orders screen offers no shortcut to a paid or refunded order', () => {
  assert.doesNotMatch(ordersUi, /updateOrderStatus\(row\.id, 'paid'\)/);
  assert.doesNotMatch(ordersUi, /<option value="refunded">/);
});
