import { useMemo } from 'react';

import type { LeadItem, StaffMember } from '../../../../types';
import { isArchiveSource } from './leadSourceGroups';

type StaffSelf = Pick<StaffMember, 'id' | 'role'> | null | undefined;

type Args = {
  leads: LeadItem[];
  isSalesOnly: boolean;
  selfStaff?: StaffSelf;
  staffSelfProp?: StaffSelf;
};

/**
 * The leads the CRM has in memory, as the screen's own panels read them.
 *
 * Only what the context holds — the page the dashboard bootstraps with. A rep's whole list of leads is not here and
 * is not downloaded for this screen any more: the table and the board page from the server, and the strip above
 * them, the follow-ups drawer, the contact search, the export and the client lookup each ask the server for their
 * own figure (GET /staff/leads-kpis, /admin/leads/followups-panel, /admin/leads/table, /admin/leads/clients).
 * Nothing drawn from this array is a total.
 */
export function useLeadEffectiveRecords({
  leads,
  isSalesOnly,
  selfStaff,
  staffSelfProp,
}: Args) {
  const staffId = selfStaff?.id || staffSelfProp?.id;

  // An imported archive stays in its own tab. It is bulk historical data —
  // thousands of rows — and letting it into the pipeline and the main table
  // buries the leads people are actually working. Once a batch is distributed
  // the distributor chooses where it should surface ("وجهة الداتا بعد التوزيع"),
  // which rewrites the source, and from then on it flows normally.
  const liveLeads = useMemo(
    () => leads.filter(lead => !isArchiveSource(lead.source)),
    [leads],
  );

  const effectiveLeads = useMemo(() => {
    if (!isSalesOnly) return liveLeads;
    // Theirs as the rep, or as the collection officer the desk handed it to.
    return liveLeads.filter(lead => lead.assignedSalesId === staffId || lead.assignedCsId === staffId);
  }, [isSalesOnly, liveLeads, staffId]);

  return { effectiveLeads };
}
