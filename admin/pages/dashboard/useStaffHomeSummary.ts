import { useCallback, useEffect, useRef, useState } from 'react';
import { mysqlAdmin } from '../../lib/mysqlapi';
import { CRM_CHANGED_EVENT } from '../../lib/crmChanged';
import { useVisibleInterval } from '../../../shared/useVisibleInterval';
import { hasPermission, type PermissionKey, type RoleKey } from '../../constants/permissions';
import type { LeadItem, StaffMember } from '../../types';

/**
 * What a staff member's landing page and performance page need, counted by the database
 * (GET /api/staff/home-summary), not out of every lead and client in their scope.
 *
 * Those screens read the whole lists, which the dashboard downloaded at sign-in and again after every write, every
 * two minutes and at every return to the tab: 37,000 leads for one rep on the production-scale lab. Here it is a
 * small answer, refreshed after a write (lib/crmChanged.ts) and on a slow timer while the page is in view.
 */
export type StaffHomeSummary = {
  totalLeads: number;
  converted: number;
  convertedThisMonth: number;
  newThisMonth: number;
  callsThisMonth: number;
  last7: { day: string; calls: number; converted: number }[];
  overdue: LeadItem[];
  today: LeadItem[];
  recent: LeadItem[];
  urgent: LeadItem[];
  clients: number;
  signups: { month: number; weeks: number[] };
};

// Every part of a page that draws these figures asks through one request at a time: the landing page and the
// performance page each hold the hook, and a refresh that lands while one is in flight joins it.
let inFlight: Promise<StaffHomeSummary> | null = null;
const loadSummary = (): Promise<StaffHomeSummary> => {
  if (!inFlight) {
    inFlight = mysqlAdmin.adminGet<StaffHomeSummary>('/staff/home-summary').finally(() => { inFlight = null; });
  }
  return inFlight;
};

/** Only a role that may see leads or clients has figures to show: HR and the instructors are refused (403). */
const mayHaveSummary = (staff: StaffMember | null | undefined) => {
  const subject = staff as unknown as { role: RoleKey; permissions?: PermissionKey[] } | null | undefined;
  return !!subject && (hasPermission(subject, 'view_leads') || hasPermission(subject, 'view_subscribers'));
};

export function useStaffHomeSummary(staff: StaffMember | null | undefined) {
  const enabled = mayHaveSummary(staff);
  const [summary, setSummary] = useState<StaffHomeSummary | null>(null);
  const [error, setError] = useState('');
  // A slow answer must not overwrite a newer one.
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const answer = await loadSummary();
      if (ticket === latest.current) { setSummary(answer); setError(''); }
    } catch (failure) {
      if (ticket === latest.current) setError(failure instanceof Error ? failure.message : 'تعذر تحميل الأرقام');
    }
  }, []);

  useVisibleInterval(() => { void refresh(); }, 2 * 60 * 1000, enabled);

  useEffect(() => {
    if (!enabled) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 300); };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => { clearTimeout(timer); window.removeEventListener(CRM_CHANGED_EVENT, onChanged); };
  }, [enabled, refresh]);

  return { summary, error, refresh };
}
