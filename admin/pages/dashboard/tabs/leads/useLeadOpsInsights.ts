import { useMemo } from 'react';

import type { LeadItem, StaffMember } from '../../../../types';

type LeadStatusLike = LeadItem['status'];

const CLOSED_STATUSES: LeadStatusLike[] = ['converted', 'lost', 'not_interested_hidden'];
const REDISTRIBUTION_EXCLUDED_STATUSES: LeadStatusLike[] = [
  'converted',
  'lost',
  'not_interested_hidden',
  'wrong_number',
];

export function useLeadOpsInsights(
  leads: LeadItem[],
  salesReps: StaffMember[],
  smartIdleDays: number,
) {
  const weeklyScorecard = useMemo(() => {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

    return salesReps.map(rep => {
      const repLeads = leads.filter(lead => lead.assignedSalesId === rep.id);
      const weekComms = repLeads.flatMap(lead =>
        (lead.communications || []).filter(comm => (comm.date || '').slice(0, 10) >= weekAgo),
      );
      const calls = weekComms.filter(comm => comm.type === 'call').length;
      const wa = weekComms.filter(comm => comm.type === 'whatsapp').length;
      const meetings = weekComms.filter(comm => comm.type === 'meeting').length;
      const totalComms = weekComms.length;
      const followupsDone = repLeads.filter(lead => {
        const nextFollowUpDate = lead.nextFollowUpDate || '';
        if (!nextFollowUpDate || nextFollowUpDate < weekAgo || nextFollowUpDate > todayStr) {
          return false;
        }
        return (lead.communications || [])
          .some(comm => (comm.date || '').slice(0, 10) >= nextFollowUpDate);
      }).length;
      const newLeadsThisWeek = repLeads
        .filter(lead => (lead.createdAt || '').slice(0, 10) >= weekAgo).length;
      const overdueOwn = repLeads.filter(lead =>
        lead.nextFollowUpDate &&
        lead.nextFollowUpDate < todayStr &&
        !['converted', 'lost'].includes(lead.status),
      ).length;

      return { rep, calls, wa, meetings, totalComms, followupsDone, newLeadsThisWeek, overdueOwn };
    });
  }, [leads, salesReps]);

  const smartRedistCandidates = useMemo(() => {
    const repLoadMap = new Map(
      salesReps.map(rep => [
        rep.id,
        leads.filter(lead =>
          lead.assignedSalesId === rep.id &&
          !CLOSED_STATUSES.includes(lead.status),
        ).length,
      ]),
    );

    return leads
      .filter(lead =>
        !lead.hidden &&
        lead.assignedSalesId &&
        !REDISTRIBUTION_EXCLUDED_STATUSES.includes(lead.status),
      )
      .map(lead => {
        const sorted = [...(lead.communications || [])]
          .sort((a, b) => b.date.localeCompare(a.date));
        const lastDate = (sorted[0]?.date || lead.createdAt || '').slice(0, 10);
        const daysSilent = lastDate
          ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000)
          : 999;
        return { lead, daysSilent, lastDate };
      })
      .filter(item => item.daysSilent >= smartIdleDays)
      .map(item => {
        const currentRepId = item.lead.assignedSalesId!;
        const currentRep = salesReps.find(rep => rep.id === currentRepId);
        const suggestedRep = salesReps
          .filter(rep => rep.id !== currentRepId)
          .sort((a, b) => (repLoadMap.get(a.id) || 0) - (repLoadMap.get(b.id) || 0))[0];
        return { ...item, currentRep, suggestedRep };
      })
      .sort((a, b) => b.daysSilent - a.daysSilent)
      .slice(0, 50);
  }, [leads, salesReps, smartIdleDays]);

  return { weeklyScorecard, smartRedistCandidates };
}
