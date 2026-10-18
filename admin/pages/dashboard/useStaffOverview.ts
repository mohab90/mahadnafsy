import { useCallback, useEffect, useState } from 'react';
import { mysqlAdmin } from '../../lib/mysqlapi';
import { CRM_CHANGED_EVENT } from '../../lib/crmChanged';
import { useVisibleInterval } from '../../../shared/useVisibleInterval';

export interface DueClient { id: string; name: string; clientCode: string; amount: number; currency: string; date: string }

export interface StaffOverview {
  clients: number;
  money: { today: number; week: number; month: number; total: number; remaining: number };
  last30: Array<{ day: string; rev: number }>;
  installments: {
    overdue: { count: number; rows: DueClient[] };
    dueToday: { count: number; rows: DueClient[] };
    dueWeek: number;
  };
  team: Array<{
    id: string; name: string; role: string; subs: number; monthRev: number; weekRev: number; todayRev: number;
    remaining: number; overdue: number; callsToday: number; callsWeek: number; callsMonth: number;
  }>;
  courseCounts: Record<string, number>;
}

/**
 * «إحصائياتي» of the collection officer, the online manager and the Dokki reception, from the server
 * (GET /api/staff/overview-summary): the money collected, what is owed, the instalments due, the last thirty days
 * and, for the online manager, each collection officer's figures. They were added up out of every client the
 * panel had downloaded.
 */
export function useStaffOverview(kind: 'own' | 'online_manager', enabled: boolean): StaffOverview | null {
  const [overview, setOverview] = useState<StaffOverview | null>(null);
  const load = useCallback(() => {
    mysqlAdmin.adminGet<StaffOverview>(`/staff/overview-summary${kind === 'online_manager' ? '?kind=online_manager' : ''}`)
      .then(setOverview)
      .catch(() => { /* the figures keep their last values */ });
  }, [kind]);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  useVisibleInterval(load, 2 * 60 * 1000, enabled);
  useEffect(() => {
    if (!enabled) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = () => { clearTimeout(timer); timer = setTimeout(load, 1000); };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => { clearTimeout(timer); window.removeEventListener(CRM_CHANGED_EVENT, onChanged); };
  }, [enabled, load]);

  return overview;
}
