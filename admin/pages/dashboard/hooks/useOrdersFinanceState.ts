import { useState } from 'react';
import type { OrderItem } from '../../../types';

/**
 * Orders/finance tab state: the order-list search/status/type/method/staff/
 * date filters, the review-queue sub-tabs (admin + online-manager variants),
 * the reviewed-orders localStorage set, and the transfer-linking modals
 * (add transfer, link transfer-to-order, link order-to-transfer) plus the
 * transfer entry form draft. Lifted out of the Dashboard god-hub — pure UI
 * state (no effects) — returns identical names so the component body is
 * unchanged apart from the single destructure that replaces these 14
 * useState lines.
 */
export function useOrdersFinanceState() {
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | 'paid' | 'failed' | 'refunded'>('all');
  const [orderTypeFilter, setOrderTypeFilter] = useState<'all' | 'course' | 'bundle' | 'consultation'>('all');
  const [orderMethodFilter, setOrderMethodFilter] = useState<string>('all');
  const [orderDateFrom, setOrderDateFrom] = useState('');
  const [orderDateTo, setOrderDateTo] = useState('');
  const [orderReviewTab, setOrderReviewTab] = useState<'review' | 'accepted' | 'failed' | 'transfers'>('review');
  const [orderStaffFilter, setOrderStaffFilter] = useState<string>('all');
  const [omOrdReviewTab, setOmOrdReviewTab] = useState<'review' | 'accepted' | 'failed'>('review');
  const [reviewedOrders, setReviewedOrders] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('reviewedOrders') || '[]')); } catch { return new Set(); }
  });

  // -- Add Transfer Modal --
  const [showAddTransfer, setShowAddTransfer] = useState(false);
  // -- Link Transfer -> Pending Order modal --
  const [linkTransferModal, setLinkTransferModal] = useState<{ row: OrderItem } | null>(null);
  // -- Link Pending Order -> Transfer modal --
  const [linkOrderModal, setLinkOrderModal] = useState<{ row: OrderItem } | null>(null);
  const [transferForm, setTransferForm] = useState({
    amount: '',
    currency: 'EGP' as 'EGP' | 'SAR' | 'USD',
    method: '' as string,
    senderName: '',
    senderPhone: '',
    reference: '',
    note: '',
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toTimeString().slice(0, 5),
    status: 'paid' as 'paid' | 'pending',
  });

  return {
    orderSearch, setOrderSearch,
    orderStatusFilter, setOrderStatusFilter,
    orderTypeFilter, setOrderTypeFilter,
    orderMethodFilter, setOrderMethodFilter,
    orderDateFrom, setOrderDateFrom,
    orderDateTo, setOrderDateTo,
    orderReviewTab, setOrderReviewTab,
    orderStaffFilter, setOrderStaffFilter,
    omOrdReviewTab, setOmOrdReviewTab,
    reviewedOrders, setReviewedOrders,
    showAddTransfer, setShowAddTransfer,
    linkTransferModal, setLinkTransferModal,
    linkOrderModal, setLinkOrderModal,
    transferForm, setTransferForm,
  };
}
