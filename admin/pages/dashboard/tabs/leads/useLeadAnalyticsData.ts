import { useMemo } from 'react';

import type { LeadItem, LeadStats } from '../../../../types';
import { cairoDay, cairoMonthStart } from '../../../../../shared/cairoDate';

/**
 * Trend, funnel and source charts.
 *
 * All three are counts over the whole leads table, which is why they used to
 * need the whole leads table in the browser. `leadStats` carries the same three
 * as GROUP BYs; the array path below stays as the pre-response fallback.
 *
 * `totals` is not part of that: it counts `effectiveLeads`, the filtered set the
 * user is currently looking at, so it stays client-side by definition.
 */
export function useLeadAnalyticsData(leads: LeadItem[], effectiveLeads: LeadItem[], leadStats?: LeadStats | null) {
  const monthlyTrend = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => cairoMonthStart(5 - i).slice(0, 7));

    return months.map(month => {
      // The server omits months with no leads; the axis still needs them.
      const agg = leadStats?.byMonth?.[month];
      return {
        month: `${month.slice(5)}/${month.slice(2, 4)}`,
        'ليدز': leadStats
          ? (agg?.total ?? 0)
          : leads.filter(lead => cairoDay(lead.createdAt).slice(0, 7) === month).length,
        'محوّل': leadStats
          ? (agg?.converted ?? 0)
          : leads.filter(lead => cairoDay(lead.createdAt).slice(0, 7) === month && lead.status === 'converted').length,
      };
    });
  }, [leads, leadStats]);

  const funnelData = useMemo(() => {
    // byStatus is already scoped to hidden = 0, which is what every stage here
    // filters for by hand.
    const count = (...statuses: string[]) => leadStats
      ? statuses.reduce((sum, status) => sum + (leadStats.byStatus?.[status] || 0), 0)
      : leads.filter(lead => statuses.includes(lead.status) && !lead.hidden).length;
    return [
      { name: 'وارد جديد', value: count('new'), color: '#6366f1' },
      { name: 'تم التواصل', value: count('contacted'), color: '#8b5cf6' },
      { name: 'مهتم', value: count('interested'), color: '#a78bfa' },
      { name: 'مغلق/لا يرد', value: count('closed', 'no_answer'), color: '#f59e0b' },
      { name: 'محوّل', value: count('converted'), color: '#10b981' },
    ];
  }, [leads, leadStats]);

  const sourcesData = useMemo(() => {
    const counts: Record<string, number> = {};
    if (leadStats) {
      // The server keys the no-source bucket as '', which is the same lead the
      // array path labelled 'غير محدد'.
      for (const [source, value] of Object.entries(leadStats.bySource || {})) {
        counts[source || 'غير محدد'] = value;
      }
    } else {
      leads.filter(lead => !lead.hidden).forEach(lead => {
        const source = lead.source || 'غير محدد';
        counts[source] = (counts[source] || 0) + 1;
      });
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [leads, leadStats]);

  const totals = useMemo(() => ({
    converted: effectiveLeads.filter(lead => lead.status === 'converted').length,
    lost: effectiveLeads.filter(lead => lead.status === 'lost').length,
  }), [effectiveLeads]);

  return { monthlyTrend, funnelData, sourcesData, totalConverted: totals.converted, totalLost: totals.lost };
}
