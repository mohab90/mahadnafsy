import { useCallback, useMemo } from 'react';
import type React from 'react';
import type { CommunicationRecord, CrmInsights, LeadItem } from '../../../../types';
import { calcLeadScore } from '../leadUtils';

export type ReminderLead = LeadItem & {
  daysOverdue: number;
  isToday: boolean;
  isUpcoming: boolean;
};

interface UseLeadRemindersDataArgs {
  leads: LeadItem[];
  reminderStaffFilter: string;
  snoozeIds: Set<string>;
  updateLead: (lead: LeadItem) => void | Promise<boolean>;
  setSnoozeIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  insights?: CrmInsights | null;
}

/**
 * The follow-up reminder panel.
 *
 * `insights.reminders` is the same set this hook used to carve out of the full
 * leads array — open leads with a follow-up date due within seven days — except
 * the database does the carving. On production that is 14 rows out of 26,887,
 * and the panel renders 2 of them: this screen was pulling the whole table down
 * the wire to show two names.
 *
 * The array path stays as the fallback for before the request resolves and for
 * if it fails. Both paths apply the same three conditions, so whichever one runs
 * the panel shows the same leads.
 */

/**
 * How many untouched leads a rep is shown at once. A day's work, not a backlog:
 * the full list is 11,257 and showing it is what made the old screen unusable.
 */
const UNTOUCHED_LIMIT = 50;

export function useLeadRemindersData({
  leads,
  reminderStaffFilter,
  snoozeIds,
  updateLead,
  setSnoozeIds,
  insights,
}: UseLeadRemindersDataArgs) {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const next7 = useMemo(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), []);

  const data = useMemo(() => {
    // The server already applied hidden/status/window; re-applying them to its
    // rows costs nothing and keeps one definition of a reminder in this file.
    const source = insights?.reminders ?? leads;
    const remindersAll: ReminderLead[] = source.filter(lead =>
      !lead.hidden && lead.nextFollowUpDate && !['converted', 'lost', 'not_interested_hidden'].includes(lead.status)
    ).map(lead => ({
      ...lead,
      daysOverdue: lead.nextFollowUpDate! < todayStr
        ? Math.floor((Date.now() - new Date(lead.nextFollowUpDate!).getTime()) / 86400000)
        : 0,
      isToday: lead.nextFollowUpDate === todayStr,
      isUpcoming: lead.nextFollowUpDate! > todayStr && lead.nextFollowUpDate! <= next7,
    }));

    const overdue = remindersAll
      .filter(lead => lead.nextFollowUpDate! < todayStr)
      .sort((a, b) => b.daysOverdue - a.daysOverdue);
    const today = remindersAll
      .filter(lead => lead.nextFollowUpDate === todayStr)
      .sort((a, b) => calcLeadScore(b) - calcLeadScore(a));
    const upcoming = remindersAll
      .filter(lead => lead.nextFollowUpDate! > todayStr && lead.nextFollowUpDate! <= next7)
      .sort((a, b) => (a.nextFollowUpDate || '').localeCompare(b.nextFollowUpDate || ''));

    // The other half of a day's work: leads nobody has touched at all.
    //
    // The panel only ever showed leads that already had a follow-up date, and
    // 22 leads out of 15,936 had one — so it rendered an almost empty screen
    // while 11,257 leads sat untouched past thirty days. A queue that shows
    // nothing is not a queue.
    //
    // Oldest first, because the lead that has waited longest is the one going
    // cold. Capped, because a list of eleven thousand is the thing the rep is
    // already ignoring; a day's work is what belongs on a day's screen.
    const untouched: ReminderLead[] = leads
      .filter(lead =>
        !lead.hidden
        && lead.status === 'new'
        && !lead.nextFollowUpDate
        && !(lead.communications || []).length)
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
      .slice(0, UNTOUCHED_LIMIT)
      .map(lead => ({ ...lead, daysOverdue: 0, isToday: false, isUpcoming: false }));

    const filterByStaff = (items: ReminderLead[]) =>
      reminderStaffFilter ? items.filter(lead => lead.assignedSalesId === reminderStaffFilter) : items;

    // completionRate counts leads whose date has passed whether or not they are
    // still open, so it cannot come from remindersAll above — the server returns
    // it directly, and the array fallback recomputes it the old way.
    let completionRate: number;
    if (insights) {
      completionRate = insights.remindersCompletionRate;
    } else {
      const totalDue = leads.filter(lead => lead.nextFollowUpDate && lead.nextFollowUpDate <= todayStr && !lead.hidden).length;
      const completed = leads.filter(lead => {
        if (!lead.nextFollowUpDate || lead.nextFollowUpDate > todayStr || lead.hidden) return false;
        return (lead.communications || []).some(comm => comm.date.slice(0, 10) >= lead.nextFollowUpDate!);
      }).length;
      completionRate = totalDue > 0 ? Math.round((completed / totalDue) * 100) : 0;
    }

    return {
      overdue,
      today,
      upcoming,
      untouched,
      untouchedFiltered: filterByStaff(untouched).filter(lead => !snoozeIds.has(lead.id)),
      overdueFiltered: filterByStaff(overdue).filter(lead => !snoozeIds.has(lead.id)),
      todayFiltered: filterByStaff(today).filter(lead => !snoozeIds.has(lead.id)),
      upcomingFiltered: filterByStaff(upcoming).filter(lead => !snoozeIds.has(lead.id)),
      completionRate,
    };
  }, [insights, leads, next7, reminderStaffFilter, snoozeIds, todayStr]);

  const snooze1Day = useCallback(async (lead: LeadItem) => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (await updateLead({ ...lead, nextFollowUpDate: tomorrow }) === false) return;
    setSnoozeIds(current => new Set([...current, lead.id]));
  }, [setSnoozeIds, updateLead]);

  const markDone = useCallback(async (lead: LeadItem) => {
    const rec: CommunicationRecord = {
      id: `rem-${Date.now()}`,
      type: 'note',
      date: new Date().toISOString().slice(0, 16).replace('T', ' '),
      notes: '✅ تم إنجاز المتابعة',
    };
    if (await updateLead({
      ...lead,
      communications: [...(lead.communications || []), rec],
      nextFollowUpDate: undefined,
    }) === false) return;
    setSnoozeIds(current => new Set([...current, lead.id]));
  }, [setSnoozeIds, updateLead]);

  return {
    ...data,
    snooze1Day,
    markDone,
  };
}
