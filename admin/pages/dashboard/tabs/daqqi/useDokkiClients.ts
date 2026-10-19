import { useCallback, useEffect, useRef, useState } from 'react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { CRM_CHANGED_EVENT } from '../../../../lib/crmChanged';
import type { SubscriberItem } from '../../../../types';

/**
 * The schedule's clients, chosen by the server (api/lib/dokkiClients.js). «جدول الدقي» streamed the branch's whole client
 * list with payments into the browser (7,400 clients on the production-scale lab) to show two figures and to fill two
 * pickers; now it asks for the figures and for one page of a picker at a time.
 */

/** A value that follows `value` after the person stops typing. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export interface DokkiOverviewFigures { clients: number; waiting: number }

/**
 * How many clients the branch has and how many wait for a seat. Asked again when the rounds' seats change (`signature`)
 * and after any write (lib/crmChanged.ts).
 */
export function useDokkiOverview(branch: string, signature: string): DokkiOverviewFigures | null {
  const [figures, setFigures] = useState<DokkiOverviewFigures | null>(null);
  const asked = useRef(0);
  const load = useCallback(() => {
    const ticket = ++asked.current;
    mysqlAdmin.adminGet<DokkiOverviewFigures>(`/admin/dokki/overview?branch=${encodeURIComponent(branch)}`)
      .then(answer => { if (ticket === asked.current) setFigures(answer); })
      .catch(() => { /* the figures keep their last values */ });
  }, [branch]);

  useEffect(() => { setFigures(null); }, [branch]);
  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load, signature]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = () => { clearTimeout(timer); timer = setTimeout(load, 400); };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => { clearTimeout(timer); window.removeEventListener(CRM_CHANGED_EVENT, onChanged); };
  }, [load]);
  return figures;
}

export interface DokkiCandidateFilters {
  /** A course the client must hold ('' for any). */
  enrolled: string;
  housing: 'any' | 'unhoused' | 'housed';
  /** The course "housed" is judged for; '' judges every course the client holds. */
  housedFor: string;
  /** Leave out whoever already sits in this round. */
  roundId: string;
  q: string;
}

const PAGE = 100;

/**
 * The clients a round's picker offers: the first page as soon as the filters are set, more on request, and the id of
 * every match (for «تحديد الكل»). `enabled` false (the dialog is closed) asks nothing.
 */
export function useDokkiCandidates(branch: string, filters: DokkiCandidateFilters, enabled: boolean) {
  const [rows, setRows] = useState<SubscriberItem[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const asked = useRef(0);
  const settledQ = useSettled(filters.q, 300);

  const queryFor = useCallback((offset: number) => {
    const params = new URLSearchParams({ branch, housing: filters.housing, limit: String(PAGE), offset: String(offset) });
    if (filters.enrolled) params.set('enrolled', filters.enrolled);
    if (filters.housedFor) params.set('housedFor', filters.housedFor);
    if (filters.roundId) params.set('roundId', filters.roundId);
    if (settledQ.trim()) params.set('q', settledQ.trim());
    return params.toString();
  }, [branch, filters.housing, filters.enrolled, filters.housedFor, filters.roundId, settledQ]);

  const load = useCallback((offset: number) => {
    const ticket = ++asked.current;
    setLoading(true);
    mysqlAdmin.adminGet<{ rows: SubscriberItem[]; total: number; ids: string[] }>(`/admin/dokki/candidates?${queryFor(offset)}`)
      .then(answer => {
        // An older answer arriving after a newer question is dropped.
        if (ticket !== asked.current) return;
        const page = answer.rows.map(row => ({ ...row, enrolledCourseIds: Array.isArray(row.enrolledCourseIds) ? row.enrolledCourseIds : [] }));
        setRows(current => (offset === 0 ? page : [...current, ...page]));
        setTotal(answer.total);
        setIds(answer.ids);
      })
      .catch(() => { /* the list keeps what it had */ })
      .finally(() => { if (ticket === asked.current) setLoading(false); });
  }, [queryFor]);

  useEffect(() => { if (enabled) load(0); }, [enabled, load]);
  // Seating someone (or any other write) changes who is left to offer.
  useEffect(() => {
    if (!enabled) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = () => { clearTimeout(timer); timer = setTimeout(() => load(0), 400); };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => { clearTimeout(timer); window.removeEventListener(CRM_CHANGED_EVENT, onChanged); };
  }, [enabled, load]);

  const loadMore = useCallback(() => { if (rows.length < total) load(rows.length); }, [load, rows.length, total]);
  return { rows, ids, total, loading, loadMore, hasMore: rows.length < total };
}
