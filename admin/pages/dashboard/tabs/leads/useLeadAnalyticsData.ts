import { useMemo } from 'react';

import type { LeadStats } from '../../../../types';
import { cairoMonthStart } from '../../../../../shared/cairoDate';

/**
 * Trend, funnel and source charts, and the converted / lost totals.
 *
 * All of them are counts over the whole leads table, which is why they used to
 * need the whole leads table in the browser. `leadStats` (GET /admin/leads/stats)
 * carries the same counts as GROUP BYs. The fallback that counted the leads the
 * browser held saw only the page of them a screen had loaded; the screen holds
 * none now, so until the stats answer the charts read zero.
 */
export function useLeadAnalyticsData(leadStats?: LeadStats | null) {
  const monthlyTrend = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => cairoMonthStart(5 - i).slice(0, 7));
    return months.map(month => {
      // The server omits months with no leads; the axis still needs them.
      const agg = leadStats?.byMonth?.[month];
      return {
        month: `${month.slice(5)}/${month.slice(2, 4)}`,
        'ليدز': agg?.total ?? 0,
        'محوّل': agg?.converted ?? 0,
      };
    });
  }, [leadStats]);

  const funnelData = useMemo(() => {
    // byStatus is already scoped to hidden = 0, which is what every stage here
    // filtered for by hand.
    const count = (...statuses: string[]) =>
      statuses.reduce((sum, status) => sum + (leadStats?.byStatus?.[status] || 0), 0);
    return [
      { name: 'وارد جديد', value: count('new'), color: '#6366f1' },
      { name: 'تم التواصل', value: count('contacted'), color: '#8b5cf6' },
      { name: 'مهتم', value: count('interested'), color: '#a78bfa' },
      { name: 'مغلق/لا يرد', value: count('closed', 'no_answer'), color: '#f59e0b' },
      { name: 'محوّل', value: count('converted'), color: '#10b981' },
    ];
  }, [leadStats]);

  const sourcesData = useMemo(() => {
    const counts: Record<string, number> = {};
    // The server keys the no-source bucket as '' — labelled 'غير محدد'.
    for (const [source, value] of Object.entries(leadStats?.bySource || {})) {
      counts[source || 'غير محدد'] = value;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [leadStats]);

  return {
    monthlyTrend, funnelData, sourcesData,
    totalConverted: leadStats?.byStatus?.converted || 0,
    totalLost: leadStats?.byStatus?.lost || 0,
  };
}
