import { useCallback, useEffect, useRef, useState } from 'react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { LeadItem } from '../../../../types';
import type { PoolBreakdown, PoolReason } from './leadSourceGroups';

/**
 * One pool tab's leads — «محلي جديد», «داتا سعودي», «محلي قديم» — as the
 * server filters them (GET /admin/leads/pool, api/lib/leadPoolFilter.js).
 *
 * These tabs used to download every lead and filter the array here. Past the
 * fetch's 50,000-row cap they showed a slice as if it were the pool; now they
 * download the pool alone, and `total` is the real size when it is bigger than
 * what came back. «محلي جديد» holds every lead nobody is working; `reason`
 * narrows it to one kind (waiting, closed, archived, hidden) and `breakdown`
 * counts each.
 */
export type LeadPoolView = 'localNew' | 'dawli' | 'archive';

type PoolResponse = { rows: LeadItem[]; total: number; truncated: boolean; breakdown: PoolBreakdown | null };

export function poolViewOf(subTab: string): LeadPoolView | null {
  if (subTab === 'localNew') return 'localNew';
  if (subTab === 'dawliOld' || subTab === 'dawliNew') return 'dawli';
  if (subTab === 'archive') return 'archive';
  return null;
}

export function useLeadPool(view: LeadPoolView | null, reason: PoolReason | null = null) {
  const [rows, setRows] = useState<LeadItem[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [breakdown, setBreakdown] = useState<PoolBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState(0);
  const loadedKey = useRef<string | null>(null);
  const key = view ? `${view}:${reason || ''}` : null;

  useEffect(() => {
    if (!view) return undefined;
    let alive = true;
    setLoading(true);
    setError('');
    // Another tab's rows must not show under this tab's heading while it loads.
    if (loadedKey.current !== key) { setRows([]); setTotal(0); }
    mysqlAdmin.adminGet<PoolResponse>(`/admin/leads/pool?view=${view}${reason ? `&reason=${reason}` : ''}`).then(
      result => {
        if (!alive) return;
        loadedKey.current = key;
        setRows(result.rows);
        setTotal(result.total);
        setTruncated(result.truncated);
        setBreakdown(result.breakdown);
      },
      err => { if (alive) setError(err instanceof Error ? err.message : 'تعذر تحميل العملاء'); },
    ).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [view, reason, key, token]);

  const reload = useCallback(() => setToken(t => t + 1), []);
  /** A lead edited on this screen, shown at once; the tab's own filter drops it if it left the pool. */
  const patch = useCallback((lead: LeadItem) => {
    setRows(current => current.map(row => (row.id === lead.id ? { ...row, ...lead } : row)));
  }, []);
  /** A lead deleted on this screen. */
  const drop = useCallback((id: string) => setRows(current => current.filter(row => row.id !== id)), []);

  return { rows, total, truncated, breakdown, loading, error, reload, patch, drop, ready: loadedKey.current === key };
}

/**
 * The «محلي جديد» badge, shown on every CRM tab: the server's count of the
 * leads waiting for a rep — the ones a distribution would hand out — not the
 * archived and hidden ones the tab also keeps. `refreshKey` re-asks after
 * anything that changes the pool.
 */
export function useLocalNewCount(refreshKey: unknown) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    mysqlAdmin.adminGet<{ total: number }>('/admin/leads/pool?view=localNew&reason=waiting&countOnly=1')
      .then(result => { if (alive) setCount(result.total); }, () => { /* the badge falls back to what is loaded */ });
    return () => { alive = false; };
  }, [refreshKey]);
  return count;
}
