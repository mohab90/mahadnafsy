import { useMemo } from 'react';

import type { LeadItem } from '../../../../types';

export function useLeadAnalyticsData(leads: LeadItem[], effectiveLeads: LeadItem[]) {
  const monthlyTrend = useMemo(() => {
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      months.push(date.toISOString().slice(0, 7));
    }

    return months.map(month => ({
      month: `${month.slice(5)}/${month.slice(2, 4)}`,
      'ليدز': leads.filter(lead => (lead.createdAt || '').slice(0, 7) === month).length,
      'محوّل': leads.filter(lead => (lead.createdAt || '').slice(0, 7) === month && lead.status === 'converted').length,
    }));
  }, [leads]);

  const funnelData = useMemo(() => [
    { name: 'وارد جديد', value: leads.filter(lead => lead.status === 'new' && !lead.hidden).length, color: '#6366f1' },
    { name: 'تم التواصل', value: leads.filter(lead => lead.status === 'contacted' && !lead.hidden).length, color: '#8b5cf6' },
    { name: 'مهتم', value: leads.filter(lead => lead.status === 'interested' && !lead.hidden).length, color: '#a78bfa' },
    { name: 'مغلق/لا يرد', value: leads.filter(lead => ['closed', 'no_answer'].includes(lead.status) && !lead.hidden).length, color: '#f59e0b' },
    { name: 'محوّل', value: leads.filter(lead => lead.status === 'converted').length, color: '#10b981' },
  ], [leads]);

  const sourcesData = useMemo(() => {
    const counts: Record<string, number> = {};
    leads.filter(lead => !lead.hidden).forEach(lead => {
      const source = lead.source || 'غير محدد';
      counts[source] = (counts[source] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [leads]);

  const totals = useMemo(() => ({
    converted: effectiveLeads.filter(lead => lead.status === 'converted').length,
    lost: effectiveLeads.filter(lead => lead.status === 'lost').length,
  }), [effectiveLeads]);

  return { monthlyTrend, funnelData, sourcesData, totalConverted: totals.converted, totalLost: totals.lost };
}
