import { useCallback, useEffect, useRef, useState } from 'react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { CRM_CHANGED_EVENT } from '../../../../lib/crmChanged';
import type { PaymentHistoryEntry } from '../../../../types';

/** One payment of the person's own clients, with the client it belongs to (GET /api/staff/payments). */
export type DeskPayment = PaymentHistoryEntry & {
  clientId: string; clientName: string; clientCode: string; clientEmail?: string;
};

export type DeskTab = 'review' | 'accepted' | 'failed';
const STATUS_OF_TAB: Record<DeskTab, string> = { review: 'pending', accepted: 'paid', failed: 'declined' };
const PAGE = 200;

export interface DeskTotals {
  pending: number; accepted: number; declined: number;
  groupSumEgp: number; acceptedTodayEgp: number; acceptedMonthEgp: number;
}

/**
 * The online manager's accounts desk: the payments of his clients in the group (waiting / accepted / declined) he
 * is looking at, a page at a time, with the counts of the three groups and the money the server added up. It used
 * to be every payment of every client the panel had downloaded, grouped and summed in the browser.
 */
export function usePaymentsDesk({ tab, search, from, to }: { tab: DeskTab; search: string; from: string; to: string }) {
  const [rows, setRows] = useState<DeskPayment[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<DeskTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [typed, setTyped] = useState(search.trim());
  useEffect(() => {
    const timer = setTimeout(() => setTyped(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const asked = useRef(0);
  const queryOf = useCallback((offset: number) => {
    const params = new URLSearchParams({ status: STATUS_OF_TAB[tab], tabs: '1', limit: String(PAGE), offset: String(offset) });
    if (typed) params.set('q', typed);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params.toString();
  }, [tab, typed, from, to]);

  const load = useCallback(async () => {
    const ticket = ++asked.current;
    setLoading(true);
    try {
      const answer = await mysqlAdmin.adminGet<{ rows: DeskPayment[]; total: number; tabs?: DeskTotals }>(`/staff/payments?${queryOf(0)}`);
      if (ticket !== asked.current) return;
      setRows(answer.rows);
      setTotal(answer.total);
      if (answer.tabs) setTotals(answer.tabs);
    } catch { /* the page keeps what it shows */ } finally {
      if (ticket === asked.current) setLoading(false);
    }
  }, [queryOf]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = () => { clearTimeout(timer); timer = setTimeout(() => { void load(); }, 300); };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => { clearTimeout(timer); window.removeEventListener(CRM_CHANGED_EVENT, onChanged); };
  }, [load]);

  const loadMore = useCallback(async () => {
    try {
      const answer = await mysqlAdmin.adminGet<{ rows: DeskPayment[]; total: number }>(`/staff/payments?${queryOf(rows.length)}`);
      setRows(current => [...current, ...answer.rows]);
      setTotal(answer.total);
    } catch { /* the button stays */ }
  }, [queryOf, rows.length]);

  return { rows, total, totals, loading, reload: load, loadMore };
}
