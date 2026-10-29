import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { CRM_CHANGED_EVENT } from '../../../lib/crmChanged';
import type { SubscriberItem } from '../../../types';

/**
 * «عملائي» for a sales rep or a collection officer, and «عملاء الدقي»: one page of the clients, filtered and counted by
 * the server (GET /api/staff/subscribers?paged=1 and GET /api/admin/dokki/clients, api/lib/staffClientsView.js). The
 * screen used to hold every client in the person's scope with their payments — 5,000 on the production-scale lab,
 * 7,400 for the Dokki branch — and filter and page them itself.
 */
export interface StaffClientsFilters {
  view: string; q: string; from: string; to: string; course: string; collector: string;
  status: string; cert: string; remaining: string; follow: string;
  /** The branch workspace a link names (?branch=), or — on the Dokki screen — the physical branch itself. */
  branch: string;
  /** The Dokki screen's own: seated or not, the round, the reception whose rounds the client follows. */
  housing?: string; round?: string; reception?: string;
}

/** Which of the two server screens asks: the clients of an employee's scope, or the Dokki branch's. */
export type StaffClientsSource = 'staff' | 'dokki';

type Answer = Awaited<ReturnType<typeof mysqlAdmin.dokkiClientsPage>>;
export interface StaffClientsPage extends Omit<Answer, 'rows'> { rows: SubscriberItem[] }

/** The server's views; the tabs the other screen has (booking years, imports) read as «النشطين» on this one. */
const SERVER_VIEWS: Record<StaffClientsSource, string[]> = {
  staff: ['active', 'real-local', 'real-saudi', 'real-intl', 'finished', 'paused', 'refunded', 'old_local'],
  dokki: ['active', 'finished', 'paused', 'refunded', 'booked2024', 'booked2025', 'old_data'],
};

export const staffClientsPageOf = (source: StaffClientsSource, query: string) =>
  (source === 'dokki' ? mysqlAdmin.dokkiClientsPage(query) : mysqlAdmin.staffClientsPage(query));

export function staffClientsQuery(filters: StaffClientsFilters, page: number, pageSize: number, source: StaffClientsSource = 'staff'): string {
  const params = new URLSearchParams();
  params.set('view', SERVER_VIEWS[source].includes(filters.view) ? filters.view : 'active');
  for (const key of ['q', 'from', 'to', 'course', 'collector', 'status', 'cert', 'remaining', 'follow', 'branch', 'housing', 'round', 'reception'] as const) {
    const value = (filters[key] ?? '').trim();
    if (value && !(key === 'cert' && value === 'all') && !(key === 'remaining' && value === 'all') && !(key === 'housing' && value === 'all')) params.set(key, value);
  }
  params.set('limit', String(pageSize));
  params.set('offset', String((Math.max(1, page) - 1) * pageSize));
  return params.toString();
}

/** A value that follows `value` after the person stops typing. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export function useStaffClientsPage({ enabled, filters, page, pageSize, source = 'staff' }: {
  enabled: boolean; filters: StaffClientsFilters; page: number; pageSize: number; source?: StaffClientsSource;
}) {
  const [data, setData] = useState<StaffClientsPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Every client this screen has shown, as last seen: the rows a bulk action picked on another page.
  const seen = useRef(new Map<string, SubscriberItem>());
  const asked = useRef(0);

  const typed = filters.q;
  const settledQ = useSettled(typed, 300);
  const query = useMemo(
    () => staffClientsQuery({ ...filters, q: settledQ }, page, pageSize, source),
    // Keyed on the filter fields, not the object, which the screen rebuilds every render; q is the settled one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settledQ, filters.view, filters.from, filters.to, filters.course, filters.collector, filters.status, filters.cert, filters.remaining, filters.follow, filters.branch, filters.housing, filters.round, filters.reception, page, pageSize, source],
  );
  const queryRef = useRef(query);
  queryRef.current = query;

  const load = useCallback(async () => {
    const ticket = ++asked.current;
    setLoading(true);
    try {
      const answer = await staffClientsPageOf(source, queryRef.current);
      // An older answer arriving after a newer question is dropped.
      if (ticket !== asked.current) return;
      const rows = answer.rows as unknown as SubscriberItem[];
      rows.forEach(row => seen.current.set(row.id, row));
      setData({ ...answer, rows });
      setFailed(false);
    } catch {
      if (ticket === asked.current) setFailed(true);
    } finally {
      if (ticket === asked.current) setLoading(false);
    }
  }, [source]);

  useEffect(() => { if (enabled) void load(); }, [enabled, query, load]);

  // A write anywhere (lib/crmChanged.ts) asks the server again, once for a burst of them.
  useEffect(() => {
    if (!enabled) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = () => { clearTimeout(timer); timer = setTimeout(() => { void load(); }, 300); };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => { clearTimeout(timer); window.removeEventListener(CRM_CHANGED_EVENT, onChanged); };
  }, [enabled, load]);

  // The rows on screen, changed by the screen's own edits (a status, a collector, a deleted client) at once; the
  // server is asked again behind them so the totals and the tabs follow.
  const refreshSoon = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const patchRows = useCallback((update: SetStateAction<SubscriberItem[]>) => {
    setData(current => {
      if (!current) return current;
      const rows = typeof update === 'function' ? update(current.rows) : update;
      rows.forEach(row => seen.current.set(row.id, row));
      return { ...current, rows };
    });
    clearTimeout(refreshSoon.current);
    refreshSoon.current = setTimeout(() => { void load(); }, 500);
  }, [load]);
  useEffect(() => () => clearTimeout(refreshSoon.current), []);

  return { data, loading, failed, reload: load, patchRows, seen };
}
