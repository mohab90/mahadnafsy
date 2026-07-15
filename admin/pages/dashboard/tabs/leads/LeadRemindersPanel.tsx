import React from 'react';
import type { StaffMember } from '../../../../types';
import { LeadReminderKanban } from './LeadReminderKanban';
import { LeadReminderList } from './LeadReminderList';
import { LeadRemindersHeader } from './LeadRemindersHeader';
import { LeadStaleLeadsPanel, type StaleLeadRow } from './LeadStaleLeadsPanel';
import type { ReminderLead } from './useLeadRemindersData';

type ReminderView = 'list' | 'kanban';

interface LeadRemindersPanelProps {
  overdueCount: number;
  todayCount: number;
  upcomingCount: number;
  completionRate: number;
  reminderView: ReminderView;
  setReminderView: (view: ReminderView) => void;
  isSalesOnly: boolean;
  reminderStaffFilter: string;
  setReminderStaffFilter: (value: string) => void;
  salesReps: StaffMember[];
  snoozeCount: number;
  onClearSnoozes: () => void;
  dueTodayLoading: boolean;
  onRefreshDueToday: () => void;
  overdueFiltered: ReminderLead[];
  todayFiltered: ReminderLead[];
  upcomingFiltered: ReminderLead[];
  todayStr: string;
  onSnooze: (lead: ReminderLead) => void;
  onDone: (lead: ReminderLead) => void;
  onOpenLead: (leadId: string) => void;
  staleLeads: StaleLeadRow[];
  staleLoading: boolean;
  staleBulkMsg: string;
  staleSending: boolean;
  staleSelected: Set<string>;
  setStaleBulkMsg: (value: string) => void;
  setStaleSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  onRefreshStaleLeads: () => void;
  onSendStaleBulk: () => void;
}

export function LeadRemindersPanel({
  overdueCount,
  todayCount,
  upcomingCount,
  completionRate,
  reminderView,
  setReminderView,
  isSalesOnly,
  reminderStaffFilter,
  setReminderStaffFilter,
  salesReps,
  snoozeCount,
  onClearSnoozes,
  dueTodayLoading,
  onRefreshDueToday,
  overdueFiltered,
  todayFiltered,
  upcomingFiltered,
  todayStr,
  onSnooze,
  onDone,
  onOpenLead,
  staleLeads,
  staleLoading,
  staleBulkMsg,
  staleSending,
  staleSelected,
  setStaleBulkMsg,
  setStaleSelected,
  onRefreshStaleLeads,
  onSendStaleBulk,
}: LeadRemindersPanelProps) {
  return (
    <div className="space-y-5" dir="rtl">
      <LeadRemindersHeader
        overdueCount={overdueCount}
        todayCount={todayCount}
        upcomingCount={upcomingCount}
        completionRate={completionRate}
        reminderView={reminderView}
        setReminderView={setReminderView}
        isSalesOnly={isSalesOnly}
        reminderStaffFilter={reminderStaffFilter}
        setReminderStaffFilter={setReminderStaffFilter}
        salesReps={salesReps}
        snoozeCount={snoozeCount}
        onClearSnoozes={onClearSnoozes}
        dueTodayLoading={dueTodayLoading}
        onRefreshDueToday={onRefreshDueToday}
      />

      {reminderView === 'kanban' && (
        <LeadReminderKanban
          overdueFiltered={overdueFiltered}
          todayFiltered={todayFiltered}
          upcomingFiltered={upcomingFiltered}
          showSalesName={!isSalesOnly}
          onSnooze={onSnooze}
          onDone={onDone}
          onOpenLead={onOpenLead}
        />
      )}

      {reminderView === 'list' && (
        <LeadReminderList
          overdueFiltered={overdueFiltered}
          todayFiltered={todayFiltered}
          upcomingFiltered={upcomingFiltered}
          todayStr={todayStr}
          showSalesName={!isSalesOnly}
          onSnooze={onSnooze}
          onDone={onDone}
        />
      )}

      <LeadStaleLeadsPanel
        staleLeads={staleLeads}
        staleLoading={staleLoading}
        staleBulkMsg={staleBulkMsg}
        staleSending={staleSending}
        staleSelected={staleSelected}
        setStaleBulkMsg={setStaleBulkMsg}
        setStaleSelected={setStaleSelected}
        onRefresh={onRefreshStaleLeads}
        onSendBulk={onSendStaleBulk}
      />
    </div>
  );
}
