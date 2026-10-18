import React from 'react';
import { cairoDateOnly, cairoDay, cairoDaysAgo } from '../../../shared/cairoDate';
import type { SubscriberItem, StaffMember } from '../../types';

interface DashboardBadgesArgs {
  currentStaff: StaffMember | null | undefined;
  isNonAdminStaff: boolean;
  isOnlineManager: boolean;
  /** The server's count of the session's due follow-ups (GET /admin/leads/followups-due), or null until it answers. */
  dueFollowups: number | null;
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
  currentStaff, isNonAdminStaff, isOnlineManager, dueFollowups, subscribers, salesOwnSubscribers,
}: DashboardBadgesArgs) {
  // Badge count for staff notification bell (overdue + today followup leads): the
  // server's count, in the session's own scope. Counting the leads in the browser
  // meant loading them on every screen for this one number — the 500 newest for an
  // admin, every lead in the scope for an employee — and missed every follow-up on
  // an older lead.
  const staffNotifBadge = !currentStaff ? 0 : (dueFollowups ?? 0);

  // Online manager: collection/installment follow-up badge
  const onlineMgrFollowupBadge = React.useMemo(() => {
    if (!isOnlineManager) return 0;
    const today = cairoDateOnly();
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
    const since = cairoDaysAgo(7);
    const subs = isNonAdminStaff ? salesOwnSubscribers : subscribers;
    const newSubs = subs.filter(s => s.createdAt && cairoDay(s.createdAt) >= since).length;
    const newPayments = subs.reduce((acc, s) =>
      acc + (s.paymentHistory || []).filter(p => p.at && cairoDay(p.at) >= since).length
    , 0);
    return newSubs + newPayments;
  }, [isOnlineManager, isNonAdminStaff, salesOwnSubscribers, subscribers]);

  return { staffNotifBadge, onlineMgrFollowupBadge, onlineMgrNewEventsBadge };
}
