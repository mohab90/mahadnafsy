import React from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { LeadReminderCard } from './LeadReminderCard';
import type { ReminderLead } from './useLeadRemindersData';

type LeadReminderKanbanProps = {
  overdueFiltered: ReminderLead[];
  todayFiltered: ReminderLead[];
  upcomingFiltered: ReminderLead[];
  showSalesName: boolean;
  onSnooze: (lead: ReminderLead) => void;
  onDone: (lead: ReminderLead) => void;
  onOpenLead: (leadId: string) => void;
};

export function LeadReminderKanban({
  overdueFiltered,
  todayFiltered,
  upcomingFiltered,
  showSalesName,
  onSnooze,
  onDone,
  onOpenLead,
}: LeadReminderKanbanProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <ReminderColumn
        title="متأخرة"
        icon="🔴"
        count={overdueFiltered.length}
        headerClass="bg-red-50 border-red-200"
        titleClass="text-red-700"
        countClass="bg-red-500"
        empty={<><CheckCheck size={20} className="text-emerald-500 mx-auto mb-1" /><p className="text-xs font-bold text-emerald-700">لا توجد متأخرة 🎉</p></>}
      >
        {overdueFiltered.slice(0, 20).map((lead) => (
          <LeadReminderCard key={lead.id} lead={lead} urgency="overdue" showSalesName={showSalesName} onSnooze={onSnooze} onDone={onDone} onOpenLead={onOpenLead} />
        ))}
        {overdueFiltered.length > 20 && <p className="text-center text-xs text-gray-400">+{overdueFiltered.length - 20} أخرى</p>}
      </ReminderColumn>

      <ReminderColumn
        title="اليوم"
        icon="🟡"
        count={todayFiltered.length}
        headerClass="bg-amber-50 border-amber-200"
        titleClass="text-amber-700"
        countClass="bg-amber-500"
        empty={<><Bell size={20} className="text-gray-300 mx-auto mb-1" /><p className="text-xs text-gray-400">لا متابعات لليوم</p></>}
      >
        {todayFiltered.slice(0, 20).map((lead) => (
          <LeadReminderCard key={lead.id} lead={lead} urgency="today" showSalesName={showSalesName} onSnooze={onSnooze} onDone={onDone} onOpenLead={onOpenLead} />
        ))}
      </ReminderColumn>

      <ReminderColumn
        title="هذا الأسبوع"
        icon="📅"
        count={upcomingFiltered.length}
        headerClass="bg-blue-50 border-blue-200"
        titleClass="text-blue-700"
        countClass="bg-blue-500"
        empty={<p className="text-xs text-gray-400">لا متابعات هذا الأسبوع</p>}
      >
        {upcomingFiltered.slice(0, 20).map((lead) => (
          <LeadReminderCard key={lead.id} lead={lead} urgency="upcoming" showSalesName={showSalesName} onSnooze={onSnooze} onDone={onDone} onOpenLead={onOpenLead} />
        ))}
      </ReminderColumn>
    </div>
  );
}

function ReminderColumn({
  title,
  icon,
  count,
  headerClass,
  titleClass,
  countClass,
  empty,
  children,
}: {
  title: string;
  icon: string;
  count: number;
  headerClass: string;
  titleClass: string;
  countClass: string;
  empty: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className={`flex items-center gap-2 px-3 py-2 border rounded-xl ${headerClass}`}>
        <span className="text-base">{icon}</span>
        <span className={`font-bold text-sm ${titleClass}`}>{title}</span>
        <span className={`mr-auto text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full ${countClass}`}>{count}</span>
      </div>
      {count === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">{empty}</div>
      ) : children}
    </div>
  );
}
