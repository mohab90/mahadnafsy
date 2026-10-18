import type { StaffMember } from '../../types';
import type { OnlineManagerSummary } from './useOnlineManagerSummary';

interface DashboardBadgesArgs {
  currentStaff: StaffMember | null | undefined;
  isOnlineManager: boolean;
  /** The server's count of the session's due follow-ups (GET /admin/leads/followups-due), or null until it answers. */
  dueFollowups: number | null;
  /** The online manager's figures from the server (useOnlineManagerSummary), or null until it answers. */
  onlineManagerSummary: OnlineManagerSummary | null;
}

/**
 * Derived nav notification-badge counts. Pure reads of figures the server counted — no state
 * is owned here, and no list of clients is read.
 */
export function useDashboardBadges({
  currentStaff, isOnlineManager, dueFollowups, onlineManagerSummary,
}: DashboardBadgesArgs) {
  // Badge count for staff notification bell (overdue + today followup leads): the
  // server's count, in the session's own scope. Counting the leads in the browser
  // meant loading them on every screen for this one number — the 500 newest for an
  // admin, every lead in the scope for an employee — and missed every follow-up on
  // an older lead.
  const staffNotifBadge = !currentStaff ? 0 : (dueFollowups ?? 0);

  // Online manager: the instalments that have fallen due, and the new clients and payments of the last seven days.
  const onlineMgrFollowupBadge = isOnlineManager ? onlineManagerSummary?.installments.overdue ?? 0 : 0;
  const onlineMgrNewEventsBadge = isOnlineManager
    ? (onlineManagerSummary?.newClients.count ?? 0) + (onlineManagerSummary?.newPayments.count ?? 0) : 0;

  return { staffNotifBadge, onlineMgrFollowupBadge, onlineMgrNewEventsBadge };
}
