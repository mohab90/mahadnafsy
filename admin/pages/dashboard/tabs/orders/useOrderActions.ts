// What the orders views do: confirm, reject, link to a transfer — and who may.
import React from 'react';
import { usePaymentBoxes } from '../../../../lib/paymentMethods';
import { useNavigate } from 'react-router-dom';
import type { OrderItem } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { useIncomingTransfers, type IncomingTransfer } from './IncomingTransfers';
import { foldText } from '../../../../../shared/sheetImport';
import type { OrdersTabProps } from './ordersTypes';

export function useOrderActions(props: OrdersTabProps) {
  const { isAdmin, canManageFinancial, notify, currentStaff, content, updateOrderStatus, reloadOrders, reloadSubscribers } = props;
  // One list for every box dropdown: what الإعدادات lists, plus every box the
  // institute has collected into. A hook, so it is read once at the top —
  // the dropdowns below sit inside conditional blocks and callbacks.
  const paymentBoxes = usePaymentBoxes(content['finance.payment_methods']);
  const navigate = useNavigate();
  const ledger = useIncomingTransfers(canManageFinancial);
  // The «ربط» lists: the likeliest match first, and a search across the rest.
  const [linkQuery, setLinkQuery] = React.useState('');
  const matchesQuery = (text: string) => foldText(linkQuery).split(' ').filter(Boolean).every(word => foldText(text).includes(word));
  // Approving is when the accounts team says the money arrived, so it is when
  // the method has to be known — and older rows reached the review queue
  // without one. Nothing else can edit a stored method, so it is asked for
  // here rather than leaving a payment that can never be approved.
  const [approveMethod, setApproveMethod] = React.useState<Record<string, string>>({});

  // Who may accept a payment outright: the manager. Everybody else with the
  // financial permission confirms against the transfer that brought the money
  // («🔗 ربط») — the server holds the same line (lib/paymentApprovalPolicy.js).
  const approverRole = String(currentStaff?.role || '').toLowerCase();
  const canAcceptDirectly = isAdmin || approverRole === 'manager';

  // One list, two tables behind it. /api/admin/orders returns the orders table and,
  // after it, every payment a person recorded at a desk (source «crm»): an
  // instalment, a booking. A desk payment's id is a payments row, not an order, so
  // confirming it through the orders route answered «Order not found» — which this
  // screen then printed as «تحقق من أن الطلب لسه قيد المراجعة» for every instalment
  // a desk had recorded.
  const isDeskPayment = (row: OrderItem) => row.source === 'crm';
  // The list fills in «MANUAL» when the payment row has no method; that is not one.
  const storedMethodOf = (row: OrderItem) => {
    const method = String(row.paymentMethod || '').trim();
    return !method || method.toLowerCase() === 'manual' ? '' : method;
  };
  const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

  const handleConfirmOrder = async (row: OrderItem) => {
    if (!canManageFinancial) {
      notify('error', 'تأكيد المدفوعات يتطلب صلاحية الإدارة المالية.');
      return;
    }
    if (!canAcceptDirectly) {
      notify('info', 'القبول المباشر للمدير. اضغط «🔗 ربط» واربط الدفعة بالتحويل اللي وصل.');
      return;
    }
    if (!isAdmin && row.staffId && row.staffId === currentStaff?.id) {
      notify('error', 'لا يمكنك تأكيد دفعة قمت بتسجيلها أنت.');
      return;
    }
    try {
      if (isDeskPayment(row)) {
        const method = storedMethodOf(row) || approveMethod[row.id] || '';
        if (!method) { notify('error', 'اختار طريقة الدفع الأول من القايمة جنب الدفعة.'); return; }
        await mysqlAdmin.updatePaymentStatus(row.id, 'paid', undefined, method);
      } else {
        await mysqlAdmin.adminPost(`/admin/orders/${row.id}/confirm-payment`, {});
      }
      await Promise.all([reloadOrders(), reloadSubscribers()]);
      notify('success', `✅ تم تأكيد دفعة ${row.customerName} بنجاح`);
    } catch (error) {
      // The server's own reason, not a guess at it.
      notify('error', messageOf(error, 'تعذر تأكيد الدفعة.'));
    }
  };

  const handleRejectOrder = async (row: OrderItem) => {
    try {
      if (isDeskPayment(row)) {
        await mysqlAdmin.updatePaymentStatus(row.id, 'failed');
        await Promise.all([reloadOrders(), reloadSubscribers()]);
      } else {
        await updateOrderStatus(row.id, 'failed');
      }
    } catch (error) {
      notify('error', messageOf(error, 'تعذر رفض الدفعة.'));
    }
  };

  // Confirm a pending row against a transfer on the ledger.
  const confirmWithTransfer = async (row: OrderItem, transfer: IncomingTransfer) => {
    if (isDeskPayment(row)) {
      await mysqlAdmin.updatePaymentStatus(row.id, 'paid', undefined, storedMethodOf(row) || transfer.method, { transferId: transfer.id });
    } else {
      await mysqlAdmin.adminPost(`/admin/orders/${row.id}/confirm-payment`, { linkedTransferId: transfer.id });
    }
  };
  return { paymentBoxes, navigate, ledger, linkQuery, setLinkQuery, matchesQuery, approveMethod, setApproveMethod, approverRole, canAcceptDirectly, isDeskPayment, storedMethodOf, messageOf, handleConfirmOrder, handleRejectOrder, confirmWithTransfer };
}

export type OrderActions = ReturnType<typeof useOrderActions>;
