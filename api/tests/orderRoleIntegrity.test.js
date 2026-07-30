'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ordersRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'orders.js'), 'utf8');
const ordersUi = fs.readFileSync(
  path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'OrdersTab.tsx'),
  'utf8'
);

test('order reads and operational mutations enforce permissions and financial data scope', () => {
  assert.match(ordersRoute, /router\.get\('\/api\/admin\/orders', requireAuth, requireAdminOrStaff, requirePermission\('view_orders'\)/);
  assert.match(ordersRoute, /resolveFinancialScope\(req,[\s\S]*allowAssigned: true/);
  assert.match(ordersRoute, /router\.post\('\/api\/admin\/orders\/:id\/confirm-payment', requireAuth, requireAdminOrStaff, requirePermission\('manage_payments'\)/);
  assert.match(ordersRoute, /cannot approve its payment/);
});

test('generic order status changes cannot rewrite payment truth or bypass reversal journals', () => {
  const patchBlock = ordersRoute.slice(
    ordersRoute.indexOf("router.patch('/api/admin/orders/:id'"),
    ordersRoute.indexOf('// DELETE /api/admin/orders/:id')
  );
  assert.doesNotMatch(patchBlock, /UPDATE payments SET status/);
  assert.match(patchBlock, /Financial order status must change through payment or refund workflow/);
  assert.doesNotMatch(ordersUi, /updateOrderStatus\(row\.id, 'paid'\)/);
  assert.doesNotMatch(ordersUi, /<option value="refunded">/);
});
