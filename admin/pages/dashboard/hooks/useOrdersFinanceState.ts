import { useState } from 'react';
import type { OrderItem } from '../../../types';
import type { IncomingTransfer } from '../tabs/orders/IncomingTransfers';

/**
 * Orders/finance tab state: the order-list search/status/type/method/staff/
 * date filters, the review-queue sub-tabs (admin + online-manager variants),
 * and the transfer-linking modals
 * (add transfer, link transfer-to-order, link order-to-transfer); the add
 * form keeps its own draft (tabs/orders/IncomingTransfers.tsx). Lifted out of the Dashboard god-hub — pure UI
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
  // -- Add Transfer Modal --
  const [showAddTransfer, setShowAddTransfer] = useState(false);
  // -- Link Transfer -> Pending Order modal --
  const [linkTransferModal, setLinkTransferModal] = useState<{ row: IncomingTransfer } | null>(null);
  // -- Link Pending Order -> Transfer modal --
  const [linkOrderModal, setLinkOrderModal] = useState<{ row: OrderItem } | null>(null);

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
    showAddTransfer, setShowAddTransfer,
    linkTransferModal, setLinkTransferModal,
    linkOrderModal, setLinkOrderModal,
  };
}
