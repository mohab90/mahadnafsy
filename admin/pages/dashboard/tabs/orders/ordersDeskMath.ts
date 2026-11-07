// The arithmetic of «الطلبات والمدفوعات», on rows the screen holds: the filters, the three tabs, the head of the screen's figures.
//
// The admin's desk gets all of this from the server (GET /api/admin/orders/page counts it in the database); this is what an employee who keeps the accounts through
// GET /staff/payments still gets it from (their newest 500 payments, held in the browser), and what api/tests/integration/ordersPage.integration.test.js holds the server's
// answer against — the old full merge, filtered and added up here, must give the numbers the server gives.

import { cairoDay, cairoDaysAgo, cairoMonthOnly, cairoDateOnly, CAIRO_TIME_ZONE } from '../../../../../shared/cairoDate';
import { normalizePaymentMethod } from '../../../../../shared/paymentMethods';
import { toEgp } from '../../../../lib/money';
import type { OrderItem } from '../../../../types';

export type ReviewTab = 'review' | 'accepted' | 'failed';

export interface OrdersFilters {
  search: string;
  status: string;
  type: string;
  method: string;
  staff: string;
  from: string;
  to: string;
}

/** Two stored spellings of one rail are the same rail. */
export const sameMethod = (a: string | undefined, b: string): boolean => {
  const left = normalizePaymentMethod(a) || String(a || '').trim().toLowerCase();
  const right = normalizePaymentMethod(b) || b.trim().toLowerCase();
  return left === right;
};

/** The rows the search, status, type, method, staff and date filters keep. */
export function filterOrders(rows: OrderItem[], filters: OrdersFilters): OrderItem[] {
  const { search, status, type, method, staff, from, to } = filters;
  const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : null;
  const toTime = to ? new Date(`${to}T23:59:59`).getTime() : null;
  return rows.filter((row) => {
    const text = `${row.id} ${row.itemTitle} ${row.customerName} ${row.staffName || ''}`.toLowerCase();
    const rowTime = new Date(row.createdAt.replace(' ', 'T')).getTime();
    const hasValidTime = !Number.isNaN(rowTime);
    return text.includes(search.toLowerCase())
      && (status === 'all' || row.status === status)
      && (type === 'all' || row.type === type)
      // Both sides through the same vocabulary: production writes 'TRANSFER' in upper case while the filter offers 'transfer'.
      && (method === 'all' || sameMethod(row.paymentMethod, method))
      && (staff === 'all' || (row.staffName || '') === staff)
      // A row with an unparseable createdAt is not silently dropped when no date filter is active.
      && ((fromTime === null && toTime === null)
        || (hasValidTime && (fromTime === null || rowTime >= fromTime) && (toTime === null || rowTime <= toTime)));
  });
}

/** The rows a tab lists: waiting for review (the desk's own payments first), confirmed, failed or refunded. */
export function tabOf(rows: OrderItem[], tab: ReviewTab): OrderItem[] {
  if (tab === 'review') return rows.filter(r => r.status === 'pending' && r.type !== 'transfer').sort((a, b) => Number(b.source === 'crm') - Number(a.source === 'crm'));
  if (tab === 'accepted') return rows.filter(r => (r.status === 'paid' || !r.status) && r.type !== 'transfer');
  return rows.filter(r => (r.status === 'failed' || r.status === 'refunded') && r.type !== 'transfer');
}

export interface OrdersKpi {
  total: number;
  paid: number;
  pending: number;
  failedOrRefunded: number;
  revenueEGP: number;
  revenueSAR: number;
  /** Paid revenue of each of the last seven Cairo days, oldest first, in EGP at the screen's rates. */
  last7: Array<{ ds: string; rev: number }>;
  todayEgp: number;
  monthEgp: number;
}

/** The head of the screen: the whole book, whatever the filters say. */
export function ordersKpi(rows: OrderItem[]): OrdersKpi {
  const paid = rows.filter(r => r.status === 'paid');
  const sum = (list: OrderItem[]) => list.reduce((s, r) => s + toEgp(r.amount, r.currency), 0);
  const today = cairoDateOnly();
  const month = cairoMonthOnly();
  return {
    total: rows.length,
    paid: paid.length,
    pending: rows.filter(r => r.status === 'pending').length,
    failedOrRefunded: rows.filter(r => r.status === 'failed' || r.status === 'refunded').length,
    revenueEGP: paid.filter(r => r.currency === 'EGP').reduce((a, r) => a + r.amount, 0),
    revenueSAR: paid.filter(r => r.currency === 'SAR').reduce((a, r) => a + r.amount, 0),
    last7: Array.from({ length: 7 }, (_, i) => {
      const ds = cairoDaysAgo(6 - i);
      return { ds, rev: sum(paid.filter(r => cairoDay(r.createdAt) === ds)) };
    }),
    todayEgp: sum(paid.filter(r => cairoDay(r.createdAt) === today)),
    monthEgp: sum(paid.filter(r => cairoDay(r.createdAt).startsWith(month))),
  };
}

export const weekdayLabel = (ds: string) => new Date(ds).toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'short', timeZone: CAIRO_TIME_ZONE });
