import { useMemo } from 'react';

import type { LeadItem, StaffMember, SubscriberItem } from '../../../../types';

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

  const effectiveLeads = useMemo(() => {
    if (!isSalesOnly) return leads;
    const snapMap = new Map((salesOwnLeads || []).map(lead => [lead.id, lead]));
    leads
      .filter(lead => snapMap.has(lead.id) || lead.assignedSalesId === staffId)
      .forEach(lead => snapMap.set(lead.id, lead));
    return [...snapMap.values()];
  }, [isSalesOnly, leads, salesOwnLeads, staffId]);

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
