'use strict';
/**
 * 1 Nov 2026, the owner's list: customer service (Hana) confirms the transfers that arrive and got «Permission denied: manage_financial» on
 * every one; the online manager's payments screen had no transfers ledger and no «تحويل جديد»; a new certificate could not be booked for a
 * non-Egyptian living in Egypt.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-transfers-1-nov-0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hasPermission, PERMISSIONS } = require('../constants/permissions');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('confirming transfers is its own permission: customer service has it, sales and collection do not, and it opens no finance screen', () => {
  assert.equal(PERMISSIONS.CONFIRM_TRANSFERS, 'confirm_transfers');
  assert.equal(hasPermission({ role: 'SUPPORT', permissions_json: null }, 'confirm_transfers'), true);
  for (const role of ['SALES', 'COLLECTION', 'RECEPTION_DAQQI', 'HR']) {
    assert.equal(hasPermission({ role, permissions_json: null }, 'confirm_transfers'), false, role);
  }
  // it is not the financial permission in disguise
  assert.equal(hasPermission({ role: 'SUPPORT', permissions_json: null }, 'view_financial'), false);
  assert.equal(hasPermission({ role: 'SUPPORT', permissions_json: null }, 'manage_financial'), false);
  // and an account the owner ticks it for has it
  assert.equal(hasPermission({ role: 'SALES', permissions_json: JSON.stringify(['confirm_transfers']) }, 'confirm_transfers'), true);
});

test('the routes a transfer is confirmed through accept it, and the managers\' corrections still do not', () => {
  const transfers = read('api/routes/core/financepay.js');
  for (const route of ["router.get('/api/admin/incoming-transfers',", "router.post('/api/admin/incoming-transfers',", "router.get('/api/admin/incoming-transfers/accounts',", "router.patch('/api/admin/payments/:id/status',"]) {
    const line = transfers.split('\n').find(row => row.startsWith(route));
    assert.ok(line && line.includes("requireAnyPermission('manage_financial', 'confirm_transfers')"), route);
  }
  for (const route of ["router.post('/api/admin/incoming-transfers/import',", "router.post('/api/admin/incoming-transfers/merge-accounts',", "router.delete('/api/admin/incoming-transfers/:id',"]) {
    const line = transfers.split('\n').find(row => row.startsWith(route));
    assert.ok(line && !line.includes('confirm_transfers'), `${route} stays with the finance permission`);
  }
  assert.ok(read('api/routes/payments.js').includes("router.get('/api/admin/payments/review', requireAuth, requireAdminOrStaff, requireAnyPermission('view_financial', 'confirm_transfers')"));
  assert.ok(read('api/routes/payment-proofs.js').includes("requireAnyPermission('view_financial', 'confirm_transfers')"));
  assert.ok(read('api/routes/orders.js').includes("router.post('/api/admin/orders/:id/confirm-payment', requireAuth, requireAdminOrStaff, requireAnyPermission('manage_financial', 'confirm_transfers')"));
});

test('the permission is in the screens\' lists, so the owner can tick it per employee', () => {
  assert.match(read('admin/constants/permissions.ts'), /CONFIRM_TRANSFERS:\s+'confirm_transfers'/);
  assert.match(read('admin/types.ts'), /\| 'confirm_transfers'/);
  assert.ok(read('admin/pages/staff-profile/staffProfileConstants.ts').includes("confirm_transfers: 'تأكيد التحويلات"));
  assert.ok(read('admin/pages/Dashboard.tsx').includes("canManageFinancial: hasPermission('manage_financial') || hasPermission('confirm_transfers')"));
});

test('the online manager sees the transfers that arrived and can add one', () => {
  const view = read('admin/pages/dashboard/tabs/orders/OrdersOnlineManagerView.tsx');
  assert.match(view, /<IncomingTransfersTable transfers=\{ledger\.transfers\}/);
  assert.match(view, /<AddTransferModal boxes=\{paymentBoxes\}/);
  assert.match(view, /سجل التحويلات/);
});

test('a refused permission reads in Arabic with what it is called, not «Permission denied: manage_financial»', () => {
  const api = read('admin/lib/mysqlapi.ts');
  assert.match(api, /function arabicRefusal\(message: unknown\): string/);
  assert.match(api, /throw new Error\(res\.status === 403 \? arabicRefusal\(b\.error\)/);
});

test('a new certificate carries the client\'s nationality and the client keeps it', () => {
  const route = read('api/routes/subscriber-payments.js');
  assert.match(route, /const certNationality = String\(payment\.certNationality \|\| ''\)\.trim\(\)\.toUpperCase\(\);/);
  assert.match(route, /\['EGYPTIAN', 'NON_EGYPTIAN_EGYPT'\]\.includes\(certNationality\)/);
  assert.match(route, /UPDATE subscribers SET nationality=\? WHERE id=\? AND tenant_id=\?/);
  const section = read('admin/components/payment-modal/PaymentItemSection.tsx');
  assert.ok(section.includes('<option value="NON_EGYPTIAN_EGYPT">👤 غير مصري مقيم في مصر</option>'));
  assert.ok(read('admin/components/payment-modal/paymentDraft.ts').includes("certNationality: '' | 'EGYPTIAN' | 'NON_EGYPTIAN_EGYPT';"));
});

test('customer service confirms transfers even when its saved grid never had the box (Hana\'s account)', () => {
  const grid = JSON.stringify(['view_orders', 'manage_payments', 'manage_inbox', 'set_client_price']);
  assert.equal(hasPermission({ role: 'SUPPORT', permissions_json: grid }, 'confirm_transfers'), true);
  assert.equal(hasPermission({ role: 'SUPPORT', permissions_json: grid }, 'manage_financial'), false, 'and nothing else opens');
  assert.equal(hasPermission({ role: 'SALES', permissions_json: grid }, 'confirm_transfers'), false);
  assert.match(read('admin/constants/permissions.ts'), /permission === 'confirm_transfers' && String\(staff\.role \|\| ''\)\.toLowerCase\(\) === 'support'/);
});

test('whoever confirms transfers reads the real payments list with its statuses, not their own 500 paid rows', () => {
  const model = read('admin/pages/dashboard/shell/useDashboardModel.tsx');
  assert.match(model, /const confirmsTransfers = access\.can\('confirm_transfers'\) \|\| access\.can\('manage_financial'\);/);
  assert.match(model, /const effectiveOrders = readsOwnPayments \? staffOrders : orders;/);
  // the hook that fed the screen marks every row paid, which is why «قيد المراجعة» read 0 and «مؤكدة» read 500
  assert.match(read('admin/pages/dashboard/useStaffOrders.ts'), /status: 'paid' as const/);
});

test('customer service has the manager\'s hands on the pages it sees, and still cannot delete (2 Nov 2026)', () => {
  const permissions = read('admin/pages/unified-client/useUnifiedClientPermissions.ts');
  assert.match(permissions, /const isOnlineManager = currentStaff\?\.role === 'online_manager' \|\| isCustomerService;/);
  assert.match(read('admin/pages/UnifiedClientPage.tsx'), /isAdmin=\{isAdmin \|\| isCustomerService\}/);
  // the hero header's delete button is still the owner's list: isAdmin && canDelete, and canDelete is false for anyone off it
  assert.match(read('admin/pages/unified-client/UnifiedClientHeroHeader.tsx'), /\{isAdmin && canDelete && \(/);
  assert.match(read('api/routes/admin/subscribers.js'), /staffRole === 'online_manager'\s*\n\s*\|\| staffRole === 'support'/);
  assert.match(read('api/lib/paymentApprovalPolicy.js'), /new Set\(\['admin', 'manager', 'support'\]\)/);
  const transfers = read('api/routes/core/financepay.js');
  assert.match(transfers, /const correctsTransfers = req => managesTransfers\(req\)/);
  const deleteLine = transfers.split('\n').find(row => row.startsWith("router.delete('/api/admin/incoming-transfers/:id'"));
  assert.ok(deleteLine && !deleteLine.includes('confirm_transfers'), 'deleting a transfer is not customer service\'s');
  assert.match(transfers, /router\.delete\('\/api\/admin\/incoming-transfers\/:id'[\s\S]{0,400}managesTransfers\(req\)/);
});
