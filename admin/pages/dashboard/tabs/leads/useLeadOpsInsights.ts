import { useMemo } from 'react';

import type { CrmInsights, LeadItem, StaffMember } from '../../../../types';

type LeadStatusLike = LeadItem['status'];

const CLOSED_STATUSES: LeadStatusLike[] = ['converted', 'lost', 'not_interested_hidden'];
const REDISTRIBUTION_EXCLUDED_STATUSES: LeadStatusLike[] = [
  'converted',
  'lost',
  'not_interested_hidden',
  'wrong_number',
];

/**
 * The weekly scorecard and the redistribution suggestions.
 *
 * Both were full-table scans in the browser: the scorecard flattened every
 * lead's communications to count a week's calls, and the redistribution panel
 * sorted all 26,887 leads by silence to show the quietest 50. `insights` is the
 * same two answers computed by the database, so neither needs the array.
 *
 * The array path remains for before the request resolves and for if it fails.
 */
export function useLeadOpsInsights(
  leads: LeadItem[],
  salesReps: StaffMember[],
  smartIdleDays: number,
  insights?: CrmInsights | null,
) {
  const weeklyScorecard = useMemo(() => {
    if (insights) {
      const byStaff = new Map(insights.scorecard.map(row => [row.staffId, row]));
      return salesReps.map(rep => {
        // A rep with no activity this week is absent from the aggregate rather
        // than present with zeroes, so the row is still built for them.
        const row = byStaff.get(rep.id);
        return {
          rep,
          calls: row?.calls ?? 0,
          wa: row?.wa ?? 0,
          meetings: row?.meetings ?? 0,
          totalComms: row?.totalComms ?? 0,
          followupsDone: row?.followupsDone ?? 0,
          newLeadsThisWeek: row?.newLeadsThisWeek ?? 0,
          overdueOwn: row?.overdueOwn ?? 0,
        };
      });
    }

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
  }, [insights, leads, salesReps]);

  const smartRedistCandidates = useMemo(() => {
    if (insights) {
      const repLoadMap = new Map(
        salesReps.map(rep => [rep.id, insights.openLoadByRep[rep.id] || 0]),
      );
      // Already filtered to >= idleDays, already sorted by silence, already cut
      // to 50 — the server applied the same three rules this hook used to.
      return insights.redistCandidates.map(item => {
        const currentRepId = item.lead.assignedSalesId || '';
        const currentRep = salesReps.find(rep => rep.id === currentRepId);
        const suggestedRep = salesReps
          .filter(rep => rep.id !== currentRepId)
          .sort((a, b) => (repLoadMap.get(a.id) || 0) - (repLoadMap.get(b.id) || 0))[0];
        return {
          lead: item.lead,
          daysSilent: item.daysSilent,
          lastDate: item.lastDate,
          currentRep,
          suggestedRep,
        };
      });
    }

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
  }, [insights, leads, salesReps, smartIdleDays]);

  return { weeklyScorecard, smartRedistCandidates };
}
