import { useMemo } from 'react';
import type { PaymentHistoryEntry, SubscriberItem } from '../../../../types';
import { paymentTypeLabels } from './financialTabUtils';

export const ONLINE_CHANNEL = '__online_paymob__';

export interface FinancialOrderRow {
  key: string;
  title: string;
  name: string;
  paymentType: string;
  channel: string;
  channelLabel: string;
  amount: number;
  currency: string;
  amountEGP: number;
  date: string;
  sortKey: string;
  note: string;
  isOnline: boolean;
  printRow: FinancialPaidOrder | null;
  staffName: string | null;
}

interface FinancialPaidOrder {
  id: string;
  status?: string;
  paymentMethod?: string;
  type?: string;
  itemTitle?: string;
  customerName?: string;
  amount: number;
  currency: string;
  paidAt?: string;
  createdAt?: string;
  transactionId?: string;
  [key: string]: unknown;
}

interface DbPayment {
  id: string;
  subscriberName: string;
  amount: number;
  currency: string;
  paymentType: string;
  paymentMethod: string | null;
  transactionId: string | null;
  note: string | null;
  at: string;
}

interface UseFinancialOrdersDataArgs {
  paidOrders: FinancialPaidOrder[];
  subscribers: SubscriberItem[];
  dbPayments: DbPayment[] | null;
  orderMethodFilter: string;
  orderSearch: string;
  orderDateFrom: string;
  orderDateTo: string;
  orderTypeFilter: string;
  ordersPage: number;
  pageSize: number;
  toEGP: (amount: number, currency: string) => number;
  getMethod: (payment: Pick<PaymentHistoryEntry, 'paymentMethod' | 'note'>) => string;
}

export function useFinancialOrdersData({
  paidOrders,
  subscribers,
  dbPayments,
  orderMethodFilter,
  orderSearch,
  orderDateFrom,
  orderDateTo,
  orderTypeFilter,
  ordersPage,
  pageSize,
  toEGP,
  getMethod,
}: UseFinancialOrdersDataArgs) {
  return useMemo(() => {
    const onlineRows: FinancialOrderRow[] = paidOrders.map((row) => ({
      key: `o-${row.id}`,
      title: row.itemTitle || '—',
      name: row.customerName || '—',
      paymentType: row.type === 'bundle' ? 'bundle' : row.type === 'consultation' ? 'consultation' : 'course',
      channel: ONLINE_CHANNEL,
      channelLabel: row.paymentMethod === 'card' ? 'بطاقة بنكية (أونلاين)' : row.paymentMethod === 'wallet' ? 'محفظة إلكترونية (أونلاين)' : 'أونلاين',
      amount: row.amount,
      currency: row.currency,
      amountEGP: toEGP(row.amount, row.currency),
      date: (row.paidAt || row.createdAt || '').slice(0, 10),
      sortKey: row.paidAt || row.createdAt || '',
      note: row.transactionId ? `#${row.transactionId}` : '—',
      isOnline: true,
      printRow: row,
      staffName: (row.staffName as string) || null,
    }));

    const contextManualRows: FinancialOrderRow[] = subscribers.flatMap((subscriber) =>
      (subscriber.paymentHistory ?? [])
        .filter((payment) =>
          (payment.paymentMethod || '') !== 'online_paymob' &&
          (!payment.status || payment.status === 'paid')
        )
        .map((payment, index) => ({
          key: `m-${payment.id}`,
          title: payment.itemTitle || (payment.paymentType ? (paymentTypeLabels[payment.paymentType] ?? 'دفعة') : 'دفعة'),
          name: subscriber.name,
          paymentType: payment.paymentType || 'other',
          channel: getMethod(payment) || 'غير محدد',
          channelLabel: getMethod(payment) || 'غير محدد',
          amount: payment.amount,
          currency: payment.currency,
          amountEGP: toEGP(payment.amount, payment.currency),
          date: (payment.at || '').slice(0, 10),
          sortKey: payment.at || `${(payment.at || '').slice(0, 10)}T${String(index).padStart(6, '0')}`,
          note: payment.note || '—',
          isOnline: false,
          staffName: payment.staffName || null,
          printRow: null,
        }))
    );

    const contextIds = new Set(contextManualRows.map((row) => row.key.replace('m-', '')));
    const dbExtraRows: FinancialOrderRow[] = dbPayments
      ? dbPayments.filter((payment) => (payment.paymentMethod || '') !== 'online_paymob' && !contextIds.has(payment.id)).map((payment) => ({
          key: `db-${payment.id}`,
          title: (payment.paymentType ? paymentTypeLabels[payment.paymentType as keyof typeof paymentTypeLabels] : undefined) ?? 'دفعة',
          name: payment.subscriberName || '—',
          paymentType: payment.paymentType || 'other',
          channel: payment.paymentMethod || 'غير محدد',
          channelLabel: payment.paymentMethod || 'غير محدد',
          amount: payment.amount,
          currency: payment.currency,
          amountEGP: toEGP(payment.amount, payment.currency),
          date: (payment.at || '').slice(0, 10),
          sortKey: payment.at || '',
          note: payment.note || (payment.transactionId ? `#${payment.transactionId}` : '—'),
          isOnline: false,
          printRow: null,
          staffName: null,
        }))
      : [];

    const manualRows = [...contextManualRows, ...dbExtraRows];
    const allRows = [...onlineRows, ...manualRows].sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    const methodFiltered = !orderMethodFilter ? allRows
      : orderMethodFilter === ONLINE_CHANNEL ? allRows.filter((row) => row.isOnline)
      : allRows.filter((row) => !row.isOnline && row.channel === orderMethodFilter);
    const search = orderSearch.toLowerCase();
    const searchFiltered = !search ? methodFiltered
      : methodFiltered.filter((row) => row.name.toLowerCase().includes(search) || row.title.toLowerCase().includes(search));
    const fromFiltered = !orderDateFrom ? searchFiltered : searchFiltered.filter((row) => row.date >= orderDateFrom);
    const toFiltered = !orderDateTo ? fromFiltered : fromFiltered.filter((row) => row.date <= orderDateTo);
    const filteredRows = !orderTypeFilter ? toFiltered : toFiltered.filter((row) => row.paymentType === orderTypeFilter);
    const totalFiltered = filteredRows.reduce((sum, row) => sum + row.amountEGP, 0);
    const pageCount = Math.ceil(filteredRows.length / pageSize);
    const pageRows = filteredRows.slice((ordersPage - 1) * pageSize, ordersPage * pageSize);
    const byType: Record<string, number> = {};
    for (const row of filteredRows) byType[row.paymentType] = (byType[row.paymentType] || 0) + row.amountEGP;
    const hasFilters = Boolean(orderSearch || orderDateFrom || orderDateTo || orderTypeFilter || orderMethodFilter);

    return {
      allRows,
      onlineRows,
      manualRows,
      filteredRows,
      pageRows,
      byType,
      totalFiltered,
      pageCount,
      hasFilters,
    };
  }, [dbPayments, getMethod, orderDateFrom, orderDateTo, orderMethodFilter, orderSearch, orderTypeFilter, ordersPage, pageSize, paidOrders, subscribers, toEGP]);
}
