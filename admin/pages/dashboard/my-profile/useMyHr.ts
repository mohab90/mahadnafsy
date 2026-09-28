import { useCallback, useEffect, useState } from 'react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';

/** /api/staff/me/hr — the employee's own record, as the server keeps it. */
export type MyHrSnapshot = {
  staff: { hire_date: string | null; department_name: string | null; employment_type: string | null; joined_at: string | null };
  salary: { base_salary: number; housing_allowance: number; transport_allowance: number } | null;
  commission: { thisMonth: { total: number; count: number } | null };
  attendance: { present_days: number; absent_days: number; late_days: number; total_late_minutes: number };
  leaveBalance: { annualEntitlement: number; usedDays: number; remaining: number };
  kpi: { leads_assigned: number; leads_converted: number; revenue_generated: number };
};

export type MyLeave = {
  id: string; type: string; status: string;
  start_date: string; end_date: string; start_time: string | null; end_time: string | null;
  total_days: number; reason: string | null; admin_note: string | null;
  approved_by_name: string | null; created_at: string;
};

export type MyAdvance = {
  id: string; amount: number; currency: string; reason: string | null; status: string;
  deduct_month: number | null; deduct_year: number | null; approved_by_name?: string | null; created_at: string;
};

export type MyDisciplinary = {
  id: string; type: string; severity: string; title: string; description: string | null;
  incident_date: string | null; action_taken: string | null; appeal_note: string | null;
  acknowledged_at: string | null; status: string; created_at: string;
};

const getJson = async <T,>(url: string, fallback: T): Promise<T> => {
  const response = await fetch(url, { credentials: 'include', headers: adminAuthHeaders() });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || 'تعذر التحميل');
  return (payload ?? fallback) as T;
};

/**
 * Everything the profile page reads about the person signed in, loaded once
 * for the page and shared by its tabs.
 *
 * It used to live in Dashboard.tsx and load only when the URL said
 * staff_settings — while every bar opened the page as staff_home — so «ملفي
 * الوظيفي» inside the profile drew nothing at all for anyone who arrived the
 * normal way. The page owns it now, and the hero, the requests and the job
 * file read one copy.
 */
export function useMyHr(notify: (kind: 'error', message: string) => void) {
  const [hr, setHr] = useState<MyHrSnapshot | null>(null);
  const [leaves, setLeaves] = useState<MyLeave[]>([]);
  const [advances, setAdvances] = useState<MyAdvance[]>([]);
  const [disciplinary, setDisciplinary] = useState<MyDisciplinary[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [hrRes, leavesRes, advancesRes, disciplinaryRes] = await Promise.allSettled([
      getJson<MyHrSnapshot | null>('/api/staff/me/hr', null),
      getJson<MyLeave[]>('/api/staff/me/leaves', []),
      getJson<MyAdvance[]>('/api/staff/me/advances', []),
      getJson<MyDisciplinary[]>('/api/staff/me/disciplinary', []),
    ]);
    if (hrRes.status === 'fulfilled') setHr(hrRes.value);
    if (leavesRes.status === 'fulfilled' && Array.isArray(leavesRes.value)) setLeaves(leavesRes.value);
    if (advancesRes.status === 'fulfilled' && Array.isArray(advancesRes.value)) setAdvances(advancesRes.value);
    if (disciplinaryRes.status === 'fulfilled' && Array.isArray(disciplinaryRes.value)) setDisciplinary(disciplinaryRes.value);
    const failed = [hrRes, leavesRes, advancesRes].find(result => result.status === 'rejected');
    if (failed && failed.status === 'rejected') notify('error', failed.reason instanceof Error ? failed.reason.message : 'تعذر تحميل ملفك الوظيفي');
    setLoading(false);
  }, [notify]);

  useEffect(() => { void reload(); }, [reload]);

  const pendingCount = leaves.filter(leave => leave.status === 'PENDING').length
    + advances.filter(advance => advance.status === 'PENDING').length;

  return { hr, leaves, advances, disciplinary, setDisciplinary, loading, reload, pendingCount };
}
