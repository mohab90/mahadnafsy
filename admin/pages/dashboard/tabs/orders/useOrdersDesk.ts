import { useCallback, useEffect, useMemo, useState } from 'react';
import { mysqlAdmin, type OrdersPage } from '../../../../lib/mysqlapi';
import { CRM_CHANGED_EVENT } from '../../../../lib/crmChanged';
import { toEgp } from '../../../../lib/money';
import { cairoDateOnly } from '../../../../../shared/cairoDate';
import { normalizeOrders } from '../../../../context/site-data-hooks/normalizeOrders';
import type { OrderItem } from '../../../../types';
import { filterOrders, ordersKpi, sameMethod, tabOf, type OrdersFilters, type OrdersKpi, type ReviewTab } from './ordersDeskMath';

export const ORDERS_PAGE_SIZE = 100;
/** The most rows an export asks for, so a click cannot download the book without end. */
const EXPORT_CAP = 20_000;
/** Separates the stored spellings of a method in the `methods` parameter (a character no spelling holds). */
const SPELLING_SEPARATOR = String.fromCharCode(31);

export interface OrdersDesk {
  /** The current tab's rows on this page (at most ORDERS_PAGE_SIZE). */
  rows: OrderItem[];
  /** How many rows the tab holds under the filters, and what they add up to in EGP at the screen's rates. */
  total: number;
  totalEgp: number;
  counts: Record<ReviewTab, number>;
  kpi: OrdersKpi;
  staffNames: string[];
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
  loading: boolean;
  /** Asked again (after a payment is confirmed, rejected, linked or removed). */
  reload: () => void;
  /** Every row of the tab under the filters — the export's, fetched when it is clicked. */
  fetchAll: () => Promise<OrderItem[]>;
  /** The pending rows a transfer may be linked to: those of its amount, and a search across the rest. */
  linkCandidates: (options: { amount?: number; query?: string }) => Promise<OrderItem[]>;
}

const EMPTY_KPI: OrdersKpi = { total: 0, paid: 0, pending: 0, failedOrRefunded: 0, revenueEGP: 0, revenueSAR: 0, last7: [], todayEgp: 0, monthEgp: 0 };

const egp = (totals: Partial<Record<'EGP' | 'SAR' | 'USD', number>>) => toEgp(totals.EGP || 0, 'EGP') + toEgp(totals.SAR || 0, 'SAR') + toEgp(totals.USD || 0, 'USD');

/**
 * «الطلبات والمدفوعات» (6 Nov 2026): the administration's desk is a page of the server's list (GET /api/admin/orders/page) with the counts, the totals and the head of
 * the screen computed by the database; it used to be the newest 500 orders and 500 payments merged by the server and then searched, counted and added up here.
 * An employee who keeps the accounts has only their own clients' newest payments (`localRows`, GET /staff/payments) and the same screen is drawn from those.
 */
export function useOrdersDesk(options: {
  tab: ReviewTab | 'transfers';
  filters: OrdersFilters;
  branch?: string;
  /** Rows held in the browser: the desk is then computed here and the server is not asked. */
  localRows?: OrderItem[];
  enabled?: boolean;
}): OrdersDesk {
  const { tab, filters, branch, localRows, enabled = true } = options;
  const activeTab: ReviewTab = tab === 'transfers' ? 'review' : tab;
  const [page, setPageState] = useState(0);
  const [data, setData] = useState<OrdersPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState(filters.search.trim());
  const methodsInUse = data?.facets.methods;

  useEffect(() => { const timer = setTimeout(() => setSearch(filters.search.trim()), 350); return () => clearTimeout(timer); }, [filters.search]);

  // The stored spellings of the chosen method, worked out here where the vocabulary lives (shared/paymentMethods.ts) from the ones in use.
  const methodsParam = useMemo(
    () => (filters.method === 'all' ? null : (methodsInUse || []).filter(raw => sameMethod(raw, filters.method)).join(SPELLING_SEPARATOR)),
    [filters.method, methodsInUse],
  );
  const query = useCallback((extra: Record<string, string>): URLSearchParams => {
    const params = new URLSearchParams({ tab: activeTab, ...extra });
    if (filters.type !== 'all') params.set('type', filters.type);
    if (filters.staff !== 'all') params.set('staff', filters.staff);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (methodsParam !== null) params.set('methods', methodsParam);
    if (branch) params.set('branch', branch.toUpperCase());
    return params;
  }, [activeTab, filters.type, filters.staff, filters.from, filters.to, methodsParam, branch]);

  // A new tab or a new filter starts at the first page.
  const filterKey = `${activeTab}|${search}|${filters.type}|${filters.staff}|${filters.from}|${filters.to}|${filters.method}|${branch || ''}`;
  useEffect(() => { setPageState(0); }, [filterKey]);

  const remote = !localRows && enabled;
  useEffect(() => {
    if (!remote) return undefined;
    let alive = true;
    setLoading(true);
    mysqlAdmin.getOrdersPage(query({ page: String(page), pageSize: String(ORDERS_PAGE_SIZE), ...(search ? { q: search } : {}) }))
      .then(answer => { if (alive) setData(answer); })
      .catch(() => { /* the screen keeps what it shows */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [remote, query, page, search, version]);

  useEffect(() => {
    if (!remote) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = () => { clearTimeout(timer); timer = setTimeout(() => setVersion(v => v + 1), 600); };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => { clearTimeout(timer); window.removeEventListener(CRM_CHANGED_EVENT, onChanged); };
  }, [remote]);

  const reload = useCallback(() => setVersion(v => v + 1), []);

  // ── The same figures from rows held here ──
  const local = useMemo(() => {
    if (!localRows) return null;
    const filtered = filterOrders(localRows, { search, status: 'all', type: filters.type, method: filters.method, staff: filters.staff, from: filters.from, to: filters.to });
    return {
      inTab: tabOf(filtered, activeTab),
      counts: { review: tabOf(filtered, 'review').length, accepted: tabOf(filtered, 'accepted').length, failed: tabOf(filtered, 'failed').length },
      kpi: ordersKpi(localRows),
      staffNames: Array.from(new Set(localRows.map(r => r.staffName).filter(Boolean))) as string[],
    };
  }, [localRows, search, filters.type, filters.method, filters.staff, filters.from, filters.to, activeTab]);

  const fetchAll = useCallback(async (): Promise<OrderItem[]> => {
    if (local) return local.inTab;
    const rows: OrderItem[] = [];
    for (let at = 0; at * 100 < EXPORT_CAP; at++) {
      const answer = await mysqlAdmin.getOrdersPage(query({ page: String(at), pageSize: '100', ...(search ? { q: search } : {}) }));
      rows.push(...normalizeOrders(answer.rows));
      if (rows.length >= answer.total || answer.rows.length === 0) break;
    }
    return rows;
  }, [local, query, search]);

  const linkCandidates = useCallback(async ({ amount, query: text }: { amount?: number; query?: string }): Promise<OrderItem[]> => {
    if (localRows) return tabOf(filterOrders(localRows, { search: text || '', status: 'all', type: 'all', method: 'all', staff: 'all', from: '', to: '' }), 'review');
    const asked = new URLSearchParams({ tab: 'review', page: '0', pageSize: '100' });
    if (amount !== undefined) asked.set('amount', String(amount));
    if (text) asked.set('q', text);
    if (branch) asked.set('branch', branch.toUpperCase());
    return normalizeOrders((await mysqlAdmin.getOrdersPage(asked)).rows);
  }, [localRows, branch]);

  const setPage = useCallback((next: number) => setPageState(Math.max(0, next)), []);

  if (local) {
    return {
      rows: local.inTab.slice(page * ORDERS_PAGE_SIZE, (page + 1) * ORDERS_PAGE_SIZE),
      total: local.inTab.length,
      totalEgp: local.inTab.reduce((sum, row) => sum + toEgp(row.amount, row.currency), 0),
      counts: local.counts, kpi: local.kpi, staffNames: local.staffNames,
      page, pageCount: Math.max(1, Math.ceil(local.inTab.length / ORDERS_PAGE_SIZE)), setPage, loading: false, reload, fetchAll, linkCandidates,
    };
  }
  const stats = data?.stats;
  const kpi: OrdersKpi = stats ? {
    total: stats.total, paid: stats.paid, pending: stats.pending, failedOrRefunded: stats.failed + stats.refunded,
    revenueEGP: stats.revenue.EGP, revenueSAR: stats.revenue.SAR,
    last7: stats.daily.map(day => ({ ds: day.day, rev: egp(day) })),
    todayEgp: egp(stats.daily.find(day => day.day === cairoDateOnly()) || {}),
    monthEgp: egp(stats.month),
  } : EMPTY_KPI;
  return {
    rows: data ? normalizeOrders(data.rows) : [],
    total: data?.total ?? 0,
    totalEgp: data ? egp(data.totals) : 0,
    counts: data?.counts ?? { review: 0, accepted: 0, failed: 0 },
    kpi, staffNames: data?.facets.staff ?? [],
    page, pageCount: Math.max(1, Math.ceil((data?.total ?? 0) / ORDERS_PAGE_SIZE)), setPage, loading, reload, fetchAll, linkCandidates,
  };
}
