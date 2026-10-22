import { useMemo } from 'react';

import type { CrmInsights, StaffMember } from '../../../../types';

/**
 * The weekly scorecard and the redistribution suggestions.
 *
 * Both were full-table scans in the browser: the scorecard flattened every
 * lead's communications to count a week's calls, and the redistribution panel
 * sorted all 26,887 leads by silence to show the quietest 50. `insights` is the
 * same two answers computed by the database (GET /admin/leads/crm-insights).
 *
 * Until it answers, every rep reads zero and there are no suggestions. The
 * fallback that recounted them from the leads held in the browser only ever saw
 * the page of them the screen had loaded, and the screen holds none now.
 */
export function useLeadOpsInsights(
  salesReps: StaffMember[],
  insights?: CrmInsights | null,
) {
  const weeklyScorecard = useMemo(() => {
    const byStaff = new Map((insights?.scorecard ?? []).map(row => [row.staffId, row]));
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
  }, [insights, salesReps]);

  const smartRedistCandidates = useMemo(() => {
    if (!insights) return [];
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
  }, [insights, salesReps]);

  return { weeklyScorecard, smartRedistCandidates };
}
