'use strict';

// «في صفحه التحويلات اللي بيتم رفعتها للسيتسم محتاج يكون عند المديرين صلاحيه
// تعديل او حذف لتحويل معين موظف رفعه غلط» (8 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { updateTransfer, deleteTransfer } = require('../lib/incomingTransfers');

function fakeConn(row) {
  const writes = [];
  return {
    writes,
    query: async (sql, params = []) => {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      if (/^SELECT \* FROM incoming_transfers/.test(flat)) return [[row].filter(Boolean)];
      writes.push({ sql: flat, params });
      return [{ affectedRows: 1 }];
    },
  };
}
const free = { id: 'tr-1', amount: 1500, currency: 'EGP', method: 'فودافون كاش 2020', reference: '111', received_on: new Date('2026-10-07'), payment_id: null };

test('a free transfer is corrected whole', async () => {
  const conn = fakeConn(free);
  const before = await updateTransfer(conn, { tenantId: 't', transferId: 'tr-1', transfer: { amount: 1050, currency: 'EGP', method: 'فودافون كاش 2020', reference: '112', senderName: 'منى', receivedOn: '2026-10-06' } });
  assert.equal(before.amount, 1500, 'the old values come back for the audit trail');
  assert.deepEqual(conn.writes[0].params.slice(0, 4), [1050, 'EGP', 'فودافون كاش 2020', '112']);
});

test('one that confirmed a payment keeps its amount, box, number and date', async () => {
  const linked = { ...free, payment_id: 'pay-1' };
  const conn = fakeConn(linked);
  await updateTransfer(conn, { tenantId: 't', transferId: 'tr-1', transfer: { amount: 9, method: 'غيره', reference: '999', senderName: 'منى أحمد', note: 'اتصلح الاسم', receivedOn: '2026-01-01' } });
  const params = conn.writes[0].params;
  assert.deepEqual(params.slice(0, 4), [1500, 'EGP', 'فودافون كاش 2020', '111']);
  assert.equal(params[4], 'منى أحمد');
  assert.equal(params[6], linked.received_on);
});

test('only a free transfer is deleted', async () => {
  await assert.rejects(deleteTransfer(fakeConn({ ...free, payment_id: 'pay-1' }), { tenantId: 't', transferId: 'tr-1' }), err => err.code === 'TRANSFER_LINKED');
  const conn = fakeConn(free);
  await deleteTransfer(conn, { tenantId: 't', transferId: 'tr-1' });
  assert.match(conn.writes[0].sql, /^DELETE FROM incoming_transfers WHERE tenant_id=\? AND id=\? AND payment_id IS NULL/);
});

test('the managers\' only, recorded in the audit trail; the buttons are theirs', () => {
  const route = fs.readFileSync(path.join(__dirname, '../routes/core/financepay.js'), 'utf8');
  assert.match(route, /const managesTransfers = req => req\.isSuperAdmin \|\| \['admin', 'manager'\]\.includes/);
  assert.equal((route.match(/if \(!managesTransfers\(req\)\) return res\.status\(403\)/g) || []).length, 2);
  assert.match(route, /action: 'incoming_transfer\.updated'/);
  assert.match(route, /action: 'incoming_transfer\.deleted'/);
  const view = fs.readFileSync(path.join(__dirname, '../../admin/pages/dashboard/tabs/orders/OrdersAdminView.tsx'), 'utf8');
  assert.match(view, /canManage=\{canManageFinancial && canAcceptDirectly\}/);
});
