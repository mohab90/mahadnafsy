import { useMemo } from 'react';
import type { OrderItem } from '../../../types';

/**
 * Pure derived values for the Orders tab: the filtered order list (search +
 * status/type/method/staff/date filters) and the aggregate stats card above it.
 * No state ownership — recomputes only when the branch-filtered order list or
 * one of the filter inputs changes.
 */
export function useOrdersDerived(
  branchFilteredEffectiveOrders: OrderItem[],
  orderSearch: string,
  orderStatusFilter: string,
  orderTypeFilter: string,
  orderMethodFilter: string,
  orderStaffFilter: string,
  orderDateFrom: string,
  orderDateTo: string,
) {
  const filteredOrders = useMemo(() => branchFilteredEffectiveOrders.filter((row) => {
    const text = `${row.id} ${row.itemTitle} ${row.customerName} ${row.staffName || ''}`.toLowerCase();
    const matchesSearch = text.includes(orderSearch.toLowerCase());
    const matchesStatus = orderStatusFilter === 'all' || row.status === orderStatusFilter;
    const matchesType = orderTypeFilter === 'all' || row.type === orderTypeFilter;
    const matchesMethod = orderMethodFilter === 'all' || row.paymentMethod === orderMethodFilter;
    const matchesStaff = orderStaffFilter === 'all' || (row.staffName || '') === orderStaffFilter;
    // A row with an unparseable createdAt must not be silently dropped when
    // no date filter is even active (PAY-11) — only enforce hasValidTime once
    // the admin has actually picked a from/to date to filter by.
    const rowTime = new Date(row.createdAt.replace(' ', 'T')).getTime();
    const fromTime = orderDateFrom ? new Date(`${orderDateFrom}T00:00:00`).getTime() : null;
    const toTime = orderDateTo ? new Date(`${orderDateTo}T23:59:59`).getTime() : null;
    const hasValidTime = !Number.isNaN(rowTime);
    const matchesDate = (fromTime === null && toTime === null)
      || (hasValidTime && (fromTime === null || rowTime >= fromTime) && (toTime === null || rowTime <= toTime));
    return matchesSearch && matchesStatus && matchesType && matchesMethod && matchesStaff && matchesDate;
  }), [branchFilteredEffectiveOrders, orderSearch, orderStatusFilter, orderTypeFilter, orderMethodFilter, orderStaffFilter, orderDateFrom, orderDateTo]);

  const ordersStats = useMemo(() => {
    const paidOrders = branchFilteredEffectiveOrders.filter((row) => row.status === 'paid');
    const revenueEGP = paidOrders.filter((r) => r.currency === 'EGP').reduce((a, r) => a + r.amount, 0);
    const revenueSAR = paidOrders.filter((r) => r.currency === 'SAR').reduce((a, r) => a + r.amount, 0);
    const revenueUSD = paidOrders.filter((r) => r.currency === 'USD').reduce((a, r) => a + r.amount, 0);
    return {
      total: branchFilteredEffectiveOrders.length,
      paid: paidOrders.length,
      failed: branchFilteredEffectiveOrders.filter((row) => row.status === 'failed').length,
      refunded: branchFilteredEffectiveOrders.filter((row) => row.status === 'refunded').length,
      revenueEGP,
      revenueSAR,
      revenueUSD,
    };
  }, [branchFilteredEffectiveOrders]);

  return { filteredOrders, ordersStats };
}
