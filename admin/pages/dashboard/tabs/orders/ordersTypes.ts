// The orders screen's props and constants, shared by its views.
import type { Bundle, Course, OrderItem, StaffMember, SubscriberItem } from '../../../../types';
import { PAYMENT_METHOD_CODES } from '../../../../../shared/paymentMethods';
import { type IncomingTransfer } from './IncomingTransfers';

// What an order's payment_method can hold. The four rails a customer may pick,
// plus the three the gateways and the desk write: a card charge, a Paymob
// charge, and a payment the desk entered by hand. The list used to sit inline
// in the filter and had no 'bank_transfer' at all.
export const ORDER_METHOD_FILTERS: string[] = [
  ...PAYMENT_METHOD_CODES,
  'card', 'wallet', 'online_paymob', 'manual',
];

export type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

export type OrdersStats = {
  total: number;
  paid: number;
  failed: number;
  refunded: number;
  revenueEGP: number;
  revenueSAR: number;
  revenueUSD: number;
};

export interface OrdersTabProps {
  isOnlineManager: boolean;
  isDaqqiManager: boolean;
  isAdmin: boolean;
  canManageFinancial: boolean;
  notify: NotifyFn;
  courses: Course[];
  bundles: Bundle[];

  // OM + Daqqi views
  salesOwnSubscribers: SubscriberItem[];
  daqqiSubSearch: string;
  setDaqqiSubSearch: (v: string) => void;
  daqqiAccDateFrom: string;
  setDaqqiAccDateFrom: (v: string) => void;
  daqqiAccDateTo: string;
  setDaqqiAccDateTo: (v: string) => void;

  // OM only
  omOrdReviewTab: 'review' | 'accepted' | 'failed';
  setOmOrdReviewTab: (v: 'review' | 'accepted' | 'failed') => void;

  // Admin view
  effectiveOrders: OrderItem[];
  filteredOrders: OrderItem[];
  ordersStats: OrdersStats;
  orderSearch: string;
  setOrderSearch: (v: string) => void;
  orderStatusFilter: 'all' | 'paid' | 'failed' | 'refunded';
  setOrderStatusFilter: (v: 'all' | 'paid' | 'failed' | 'refunded') => void;
  orderTypeFilter: 'all' | 'course' | 'bundle' | 'consultation';
  setOrderTypeFilter: (v: 'all' | 'course' | 'bundle' | 'consultation') => void;
  orderMethodFilter: string;
  setOrderMethodFilter: (v: string) => void;
  orderDateFrom: string;
  setOrderDateFrom: (v: string) => void;
  orderDateTo: string;
  setOrderDateTo: (v: string) => void;
  orderStaffFilter: string;
  setOrderStaffFilter: (v: string) => void;
  orderReviewTab: 'review' | 'accepted' | 'failed' | 'transfers';
  setOrderReviewTab: (v: 'review' | 'accepted' | 'failed' | 'transfers') => void;
  showAddTransfer: boolean;
  setShowAddTransfer: (v: boolean) => void;
  linkTransferModal: { row: IncomingTransfer } | null;
  setLinkTransferModal: (v: { row: IncomingTransfer } | null) => void;
  linkOrderModal: { row: OrderItem } | null;
  setLinkOrderModal: (v: { row: OrderItem } | null) => void;
  currentStaff: StaffMember | null;
  authUser: { displayName?: string | null; email?: string | null; uid?: string } | null;
  content: Record<string, string>;
  updateOrderStatus: (id: string, status: 'paid' | 'failed' | 'refunded') => Promise<boolean>;
  deleteOrder: (id: string) => Promise<boolean>;
  reloadOrders: () => Promise<void>;
  reloadSubscribers: () => Promise<void>;
  exportFilteredOrdersCsv: (rows: OrderItem[]) => void;
}

