import { useMemo } from 'react';

import type { LeadItem, StaffMember, SubscriberItem } from '../../../../types';
import { isArchiveSource } from './leadSourceGroups';

type StaffSelf = Pick<StaffMember, 'id' | 'role'> | null | undefined;

type Args = {
  leads: LeadItem[];
  subscribers: SubscriberItem[];
  isSalesOnly: boolean;
  selfStaff?: StaffSelf;
  staffSelfProp?: StaffSelf;
  salesOwnLeads?: LeadItem[];
  salesOwnSubscribers?: SubscriberItem[];
};

export function useLeadEffectiveRecords({
  leads,
  subscribers,
  isSalesOnly,
  selfStaff,
  staffSelfProp,
  salesOwnLeads,
  salesOwnSubscribers,
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
    const snapMap = new Map(
      (salesOwnLeads || []).filter(lead => !isArchiveSource(lead.source)).map(lead => [lead.id, lead]));
    liveLeads
      .filter(lead => snapMap.has(lead.id) || lead.assignedSalesId === staffId)
      .forEach(lead => snapMap.set(lead.id, lead));
    return [...snapMap.values()];
  }, [isSalesOnly, liveLeads, salesOwnLeads, staffId]);

  const effectiveSubs = useMemo(() => {
    if (!isSalesOnly) return subscribers;
    const snapMap = new Map((salesOwnSubscribers || []).map(subscriber => [subscriber.id, subscriber]));
    subscribers
      .filter(subscriber => subscriber.assignedSalesId === staffId)
      .forEach(subscriber => snapMap.set(subscriber.id, subscriber));
    return [...snapMap.values()];
  }, [isSalesOnly, salesOwnSubscribers, staffId, subscribers]);

  return { effectiveLeads, effectiveSubs };
}
