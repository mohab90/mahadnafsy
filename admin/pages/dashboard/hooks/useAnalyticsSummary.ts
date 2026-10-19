import { useEffect, useState } from 'react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { CRM_CHANGED_EVENT } from '../../../lib/crmChanged';

/**
 * What «تقارير وإحصاءات تفصيلية» draws, counted by the server (GET /api/admin/analytics-summary,
 * api/lib/analyticsSummary.js). The screen held the orders, leads and clients and added them up in the browser — every
 * lead and client of the system for «إحصائيات الدقي», the 500 newest of each under «الرئيسية». Money comes per
 * currency: the screen converts it with the rates the institute configured.
 */
export type Money = { currency: string; amount: number };
export interface AnalyticsSummary {
  range: string;
  months: string[];
  orders: null | {
    pending: number;
    inRange: Array<Money & { type: string; count: number }>;
    monthly: Array<{ month: string; orders: number; amounts: Money[] }>;
    items: Array<Money & { type: string; itemId: string }>;
    coupons: Record<string, number>;
  };
  leads: null | { rows: Array<{ status: string; source: string; n: number }> };
  subscribers: null | {
    total: number; inRange: number; byBranch: Record<string, number>;
    monthly: Array<{ month: string; n: number }>; perCourse: Record<string, number>; perBundle: Record<string, number>;
  };
}
/** The applications to join the institute by stage (GET /api/admin/join-us/counts). */
export interface JoinCounts { total: number; byStatus: Record<string, number> }

export function useAnalyticsSummary(range: string): { summary: AnalyticsSummary | null; joins: JoinCounts | null } {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [joins, setJoins] = useState<JoinCounts | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      mysqlAdmin.adminGet<AnalyticsSummary>(`/admin/analytics-summary?range=${encodeURIComponent(range)}`)
        .then(answer => { if (!cancelled) setSummary(answer); })
        .catch(() => { /* the figures keep their last values */ });
    };
    load();
    // After a write (a payment, a lead, a client) the figures are asked for again, once for a burst.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = () => { clearTimeout(timer); timer = setTimeout(load, 600); };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => { cancelled = true; clearTimeout(timer); window.removeEventListener(CRM_CHANGED_EVENT, onChanged); };
  }, [range]);
  useEffect(() => {
    mysqlAdmin.adminGet<JoinCounts>('/admin/join-us/counts').then(setJoins).catch(() => setJoins(null));
  }, []);
  return { summary, joins };
}
