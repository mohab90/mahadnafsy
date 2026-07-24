import { CheckCheck, Clock, MessageCircle } from 'lucide-react';
import type { LeadStatus } from '../../../../types';
import { DataTable, type Column } from '../../../../components/shared/DataTable';
import { LEAD_STATUS_CFG, crmStatusLabels, formatWaPhone } from './LeadSubcomponents';
import type { ReminderLead } from './useLeadRemindersData';

type LeadReminderListProps = {
  overdueFiltered: ReminderLead[];
  todayFiltered: ReminderLead[];
  upcomingFiltered: ReminderLead[];
  todayStr: string;
  showSalesName: boolean;
  onSnooze: (lead: ReminderLead) => void;
  onDone: (lead: ReminderLead) => void;
};

function getUrgency(lead: ReminderLead, todayStr: string) {
  if (lead.nextFollowUpDate! < todayStr) {
    return {
      label: `متأخر ${lead.daysOverdue || 0} يوم`,
      className: 'bg-red-100 text-red-700',
    };
  }
  if (lead.nextFollowUpDate === todayStr) {
    return {
      label: 'اليوم',
      className: 'bg-amber-100 text-amber-700',
    };
  }
  return {
    label: lead.nextFollowUpDate || '-',
    className: 'bg-blue-50 text-blue-700',
  };
}

export function LeadReminderList({
  overdueFiltered,
  todayFiltered,
  upcomingFiltered,
  todayStr,
  showSalesName,
  onSnooze,
  onDone,
}: LeadReminderListProps) {
  const rows = [...overdueFiltered, ...todayFiltered, ...upcomingFiltered];

  const columns: Column<ReminderLead>[] = [
    {
      key: 'name',
      header: 'العميل',
      render: (lead) => (
        <div>
          <p className="text-xs font-bold text-gray-900">{lead.name}</p>
          <span className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-bold ${LEAD_STATUS_CFG[lead.status as LeadStatus]?.color || 'bg-gray-100 text-gray-500'}`}>
            {crmStatusLabels[lead.status] || lead.status}
          </span>
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'الهاتف',
      render: (lead) => (
        <a href={`tel:${lead.phone}`} className="text-xs font-mono text-blue-600 hover:underline" dir="ltr">
          {lead.phone}
        </a>
      ),
    },
    ...(showSalesName ? [{
      key: 'assignedSalesName',
      header: 'المندوب',
      render: (lead: ReminderLead) => <span className="text-xs text-gray-600">{lead.assignedSalesName || '-'}</span>,
    } satisfies Column<ReminderLead>] : []),
    {
      key: 'nextFollowUpDate',
      header: 'موعد المتابعة',
      render: (lead) => {
        const urgency = getUrgency(lead, todayStr);
        return <span className={`rounded-full px-2 py-1 text-xs font-bold ${urgency.className}`}>{urgency.label}</span>;
      },
    },
    {
      key: 'actions',
      header: 'إجراءات',
      render: (lead) => (
        <div className="flex gap-1">
          <a
            href={`https://wa.me/${formatWaPhone(lead.phone)}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-7 items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100"
          >
            <MessageCircle size={12} /> WA
          </a>
          <button
            type="button"
            onClick={() => onSnooze(lead)}
            title="تأجيل يوم"
            className="grid h-7 w-7 place-items-center rounded-lg border border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100"
          >
            <Clock size={12} />
          </button>
          <button
            type="button"
            onClick={() => onDone(lead)}
            title="تمت المتابعة"
            className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <CheckCheck size={12} />
          </button>
        </div>
      ),
    },
  ];

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-100 bg-white py-12 text-center">
        <CheckCheck size={32} className="mx-auto mb-3 text-emerald-400" />
        <p className="font-bold text-emerald-700">لا توجد تذكيرات في الفئات المحددة</p>
      </div>
    );
  }

  return (
    <DataTable<ReminderLead>
      data={rows}
      columns={columns}
      total={rows.length}
      limit={rows.length}
    />
  );
}
