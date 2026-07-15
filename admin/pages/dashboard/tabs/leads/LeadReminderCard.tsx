import React from 'react';
import { ExternalLink } from 'lucide-react';
import { calcLeadScore } from '../leadUtils';
import { ScoreBadge, formatWaPhone } from './LeadSubcomponents';
import type { ReminderLead } from './useLeadRemindersData';

type LeadReminderCardProps = {
  lead: ReminderLead;
  urgency: 'overdue' | 'today' | 'upcoming';
  showSalesName: boolean;
  onSnooze: (lead: ReminderLead) => void;
  onDone: (lead: ReminderLead) => void;
  onOpenLead: (leadId: string) => void;
};

export function LeadReminderCard({
  lead,
  urgency,
  showSalesName,
  onSnooze,
  onDone,
  onOpenLead,
}: LeadReminderCardProps) {
  const cfg = {
    overdue: { border: 'border-red-300 border-r-4 border-r-red-500', badge: 'bg-red-100 text-red-700 border-red-200', icon: '🔴', label: `متأخر ${lead.daysOverdue} يوم` },
    today: { border: 'border-amber-300 border-r-4 border-r-amber-500', badge: 'bg-amber-100 text-amber-700 border-amber-200', icon: '🟡', label: 'اليوم' },
    upcoming: { border: 'border-blue-200', badge: 'bg-blue-50 text-blue-700 border-blue-200', icon: '📅', label: lead.nextFollowUpDate! },
  }[urgency];

  const lastCommunication = (lead.communications || []).length
    ? [...lead.communications!].sort((a, b) => b.date.localeCompare(a.date))[0]
    : null;

  return (
    <div className={`bg-white border ${cfg.border} rounded-xl p-3 hover:shadow-md transition`}>
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0 border ${cfg.badge}`}>
          {cfg.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span className="font-bold text-gray-900 text-sm">{lead.name}</span>
            <ScoreBadge score={calcLeadScore(lead)} />
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${cfg.badge}`}>{cfg.label}</span>
          </div>
          <p className="text-xs text-gray-500 font-mono" dir="ltr">{lead.phone}</p>
          {lead.assignedSalesName && showSalesName && (
            <p className="text-[10px] text-gray-400 mt-0.5">👤 {lead.assignedSalesName}</p>
          )}
          {lastCommunication && (
            <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-1 italic">آخر تواصل: {lastCommunication.notes}</p>
          )}
        </div>
      </div>
      <div className="flex gap-1.5 mt-2.5">
        <a
          href={`https://wa.me/${formatWaPhone(lead.phone)}`}
          target="_blank"
          rel="noreferrer"
          className="flex-1 py-1.5 text-center text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition"
        >
          💬 واتساب
        </a>
        <a
          href={`tel:${lead.phone}`}
          className="flex-1 py-1.5 text-center text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition"
        >
          📞 اتصال
        </a>
        <button
          onClick={() => onSnooze(lead)}
          className="px-2.5 py-1.5 text-[11px] font-bold bg-gray-50 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100 transition"
          title="تأجيل يوم"
        >
          ⏰
        </button>
        <button
          onClick={() => onDone(lead)}
          className="px-2.5 py-1.5 text-[11px] font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
          title="تم الإنجاز"
        >
          ✅
        </button>
        <button
          onClick={() => onOpenLead(lead.id)}
          className="px-2.5 py-1.5 text-[11px] bg-gray-50 text-gray-500 border border-gray-200 rounded-lg hover:bg-primary-50 hover:text-primary-600 transition"
        >
          <ExternalLink size={11} />
        </button>
      </div>
    </div>
  );
}
