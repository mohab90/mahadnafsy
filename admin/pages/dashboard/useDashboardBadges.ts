import React from 'react';
import type { LeadItem, SubscriberItem, StaffMember } from '../../types';

interface DashboardBadgesArgs {
  currentStaff: StaffMember | null | undefined;
  isNonAdminStaff: boolean;
  isOnlineManager: boolean;
  leads: LeadItem[];
  salesOwnLeads: LeadItem[];
  subscribers: SubscriberItem[];
  salesOwnSubscribers: SubscriberItem[];
}

/**
 * Derived nav notification-badge counts. Pure reads of existing data — no state
 * is owned here — extracted verbatim from Dashboard.tsx to slim the god-component
 * without any behaviour change. The internal useMemo calls run at exactly the same
 * point in the render as before (the hook is called where the inline code was).
 */
export function useDashboardBadges({
  currentStaff, isNonAdminStaff, isOnlineManager, leads, salesOwnLeads, subscribers, salesOwnSubscribers,
}: DashboardBadgesArgs) {
  // Badge count for staff notification bell (overdue + today followup leads)
  const _staffNotifTodayStr = new Date().toISOString().slice(0, 10);
  const staffNotifBadge = currentStaff ? (isNonAdminStaff ? salesOwnLeads : leads).filter(l =>
    !['converted', 'lost'].includes(l.status) && l.nextFollowUpDate && l.nextFollowUpDate <= _staffNotifTodayStr
  ).length : 0;

  // Online manager: collection/installment follow-up badge
  const onlineMgrFollowupBadge = React.useMemo(() => {
    if (!isOnlineManager) return 0;
    const today = new Date().toISOString().slice(0, 10);
    const subs = isNonAdminStaff ? salesOwnSubscribers : subscribers;
    let count = 0;
    for (const sub of subs) {
      for (const plan of (sub.installmentPlans || [])) {
        for (const entry of (plan.entries || [])) {
          if (!entry.paidAt && entry.dueDate && entry.dueDate <= today) count++;
        }
      }
    }
    return count;
  }, [isOnlineManager, isNonAdminStaff, salesOwnSubscribers, subscribers]);

  // Online manager: new subscribers + payments in last 7 days badge
  const onlineMgrNewEventsBadge = React.useMemo(() => {
    if (!isOnlineManager) return 0;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const subs = isNonAdminStaff ? salesOwnSubscribers : subscribers;
    const newSubs = subs.filter(s => s.createdAt && s.createdAt.slice(0, 10) >= since).length;
    const newPayments = subs.reduce((acc, s) =>
      acc + (s.paymentHistory || []).filter(p => p.at && p.at.slice(0, 10) >= since).length
    , 0);
    return newSubs + newPayments;
  }, [isOnlineManager, isNonAdminStaff, salesOwnSubscribers, subscribers]);

  return { staffNotifBadge, onlineMgrFollowupBadge, onlineMgrNewEventsBadge };
}
