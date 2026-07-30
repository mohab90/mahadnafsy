import { useCallback, useMemo } from 'react';
import type React from 'react';
import type { CommunicationRecord, LeadItem } from '../../../../types';
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
}

export function useLeadRemindersData({
  leads,
  reminderStaffFilter,
  snoozeIds,
  updateLead,
  setSnoozeIds,
}: UseLeadRemindersDataArgs) {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const next7 = useMemo(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), []);

  const data = useMemo(() => {
    const remindersAll: ReminderLead[] = leads.filter(lead =>
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

    const filterByStaff = (items: ReminderLead[]) =>
      reminderStaffFilter ? items.filter(lead => lead.assignedSalesId === reminderStaffFilter) : items;

    const totalDue = leads.filter(lead => lead.nextFollowUpDate && lead.nextFollowUpDate <= todayStr && !lead.hidden).length;
    const completed = leads.filter(lead => {
      if (!lead.nextFollowUpDate || lead.nextFollowUpDate > todayStr || lead.hidden) return false;
      return (lead.communications || []).some(comm => comm.date.slice(0, 10) >= lead.nextFollowUpDate!);
    }).length;

    return {
      overdue,
      today,
      upcoming,
      overdueFiltered: filterByStaff(overdue).filter(lead => !snoozeIds.has(lead.id)),
      todayFiltered: filterByStaff(today).filter(lead => !snoozeIds.has(lead.id)),
      upcomingFiltered: filterByStaff(upcoming).filter(lead => !snoozeIds.has(lead.id)),
      completionRate: totalDue > 0 ? Math.round((completed / totalDue) * 100) : 0,
    };
  }, [leads, next7, reminderStaffFilter, snoozeIds, todayStr]);

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
