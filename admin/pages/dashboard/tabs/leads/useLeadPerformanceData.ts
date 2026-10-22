import { useEffect, useMemo, useState } from 'react';
import type { LeadStats, SalesTarget, StaffMember } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

/**
 * Each rep's clients' collected payments in `month`, in EGP, from the server (GET /admin/leads/rep-revenue).
 *
 * The figure was summed here out of the clients the browser held with their payments — the 500 newest, 700 KB on
 * the lab — so a rep's older clients paid nothing on this page. null until the server answers.
 */
export function useRepRevenue(month: string, enabled: boolean): Record<string, number> | null {
  const [byStaff, setByStaff] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    setByStaff(null);
    mysqlAdmin.getRepRevenue(month)
      .then(answer => { if (alive) setByStaff(answer.byStaff || {}); })
      .catch(() => { if (alive) setByStaff({}); });
    return () => { alive = false; };
  }, [month, enabled]);
  return byStaff;
}

/**
 * Per-rep performance figures, from the server's aggregates: the leads, conversions, scores and contacts from
 * `leadStats.byOwner` (GET /admin/leads/stats), the month's revenue from GET /admin/leads/rep-revenue.
 *
 * Both used to fall back to counting the arrays the browser held — the leads and the clients with their payments —
 * which were the newest 500 of each, so before the aggregates answered a rep was shown a share of their own numbers.
 * The screen holds neither array now; until the aggregates answer the figures read zero.
 */
export function useLeadPerformanceData(
  salesReps: StaffMember[],
  repRevenue: Record<string, number> | null,
  salesTargets: SalesTarget[],
  targetMonth: string,
  leadStats?: LeadStats | null,
) {
  const salesPerformance = useMemo(() => salesReps.map((rep) => {
    const agg = leadStats?.byOwner?.[rep.id];
    const leadCount = agg?.total ?? 0;
    const converted = agg?.converted ?? 0;
    const avgScore = agg?.avgScore ?? 0;
    const convPct = leadCount > 0 ? Math.round((converted / leadCount) * 100) : 0;
    const revenue = repRevenue?.[rep.id] ?? 0;
    const target = salesTargets.find((item) => item.staffId === rep.id && item.month === targetMonth);
    return { rep, leads: leadCount, converted, convPct, revenue, avgScore, targetEGP: target?.targetEGP || 0 };
  }), [salesReps, repRevenue, salesTargets, targetMonth, leadStats]);

  const commsByRep = useMemo(() => salesReps.map((rep) => {
    // The server groups by the channel as stored (upper case on this database)
    // and lowercases it on the way out.
    const counts = leadStats?.byOwner?.[rep.id]?.comms ?? {};
    return {
      name: rep.name.split(' ')[0],
      'مكالمة': counts.call || 0,
      'واتساب': counts.whatsapp || 0,
      'اجتماع': counts.meeting || 0,
    };
  }), [salesReps, leadStats]);

  return { salesPerformance, commsByRep };
}
