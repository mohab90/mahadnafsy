import type { ReactNode } from 'react';

import type { LeadItem, LeadStatus, StaffMember } from '../../../../types';
import { LEAD_STATUS_CFG } from './LeadSubcomponents';
import { toDialable } from '../../../../lib/whatsappLink';

type Props = {
  open: boolean;
  leads: LeadItem[];
  isSalesOnly: boolean;
  currentStaff: StaffMember | null;
  onClose: () => void;
  onShowOverdue: () => void;
  onShowToday: () => void;
};

// Delegates to the shared rule — this used to build country code "2".
const formatWaPhone = (phone: string) => toDialable(phone);

function LeadNotificationRow({
  lead,
  badge,
  isSalesOnly,
}: {
  lead: LeadItem;
  badge: ReactNode;
  isSalesOnly: boolean;
}) {
  const daysSince = lead.nextFollowUpDate
    ? Math.floor((Date.now() - new Date(lead.nextFollowUpDate).getTime()) / 86_400_000)
    : null;

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition">
      <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
        {lead.name.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="font-bold text-gray-800 text-sm">{lead.name}</span>
          {badge}
          {lead.assignedSalesName && !isSalesOnly && (
            <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">👤 {lead.assignedSalesName}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
          {lead.phone && <a href={`tel:${lead.phone}`} className="text-blue-600 hover:underline">{lead.phone}</a>}
          {lead.nextFollowUpDate && daysSince !== null && daysSince > 0 && (
            <span className="text-red-500 font-bold">متأخر {daysSince} يوم</span>
          )}
          {lead.lastContactNote && <span className="truncate max-w-[160px] text-gray-400 italic">{lead.lastContactNote}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {lead.phone && (
          <a href={`https://wa.me/${formatWaPhone(lead.phone)}`} target="_blank" rel="noopener noreferrer"
            className="w-7 h-7 rounded-full bg-green-500 hover:bg-green-600 text-white text-xs font-bold flex items-center justify-center">W</a>
        )}
      </div>
    </div>
  );
}

export function LeadSalesNotificationsPanel({
  open,
  leads,
  isSalesOnly,
  currentStaff,
  onClose,
  onShowOverdue,
  onShowToday,
}: Props) {
  if (!open) return null;

  const todayStr = new Date().toISOString().slice(0, 10);
  const scopedLeads = isSalesOnly && currentStaff
    ? leads.filter(l => l.assignedSalesId === currentStaff.id && !['converted', 'lost'].includes(l.status))
    : leads.filter(l => !['converted', 'lost'].includes(l.status));
  const overdue = scopedLeads
    .filter(l => l.nextFollowUpDate && l.nextFollowUpDate < todayStr)
    .sort((a, b) => (a.nextFollowUpDate || '').localeCompare(b.nextFollowUpDate || ''));
  const todayLeads = scopedLeads
    .filter(l => l.nextFollowUpDate === todayStr)
    .sort((a, b) => a.name.localeCompare(b.name));
  const noFollowup = scopedLeads
    .filter(l => !l.nextFollowUpDate && ['new', 'contacted', 'interested'].includes(l.status))
    .sort((a, b) => b.createdAt?.localeCompare(a.createdAt || '') || 0);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-end" onClick={onClose}>
      <div className="bg-white h-full w-full max-w-md shadow-2xl flex flex-col" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gradient-to-l from-primary-50 to-white">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">🔔 متابعات السيلز</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {isSalesOnly ? `قائمتك — ${scopedLeads.length} عميل` : `جميع السيلز — ${scopedLeads.length} عميل`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        <div className="grid grid-cols-3 gap-0 border-b border-gray-100">
          {[
            { label: 'متأخرة', val: overdue.length, color: overdue.length > 0 ? 'text-red-600 bg-red-50' : 'text-gray-400 bg-gray-50' },
            { label: 'اليوم', val: todayLeads.length, color: todayLeads.length > 0 ? 'text-amber-600 bg-amber-50' : 'text-gray-400 bg-gray-50' },
            { label: 'بدون موعد', val: noFollowup.length, color: noFollowup.length > 0 ? 'text-violet-600 bg-violet-50' : 'text-gray-400 bg-gray-50' },
          ].map(c => (
            <div key={c.label} className={`${c.color} py-3 text-center`}>
              <div className="text-2xl font-extrabold">{c.val}</div>
              <div className="text-[11px] font-medium opacity-80">{c.label}</div>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {overdue.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">⚠️ متأخرة ({overdue.length})</span>
              </div>
              <div className="space-y-2">
                {overdue.map(lead => (
                  <LeadNotificationRow key={lead.id} lead={lead} isSalesOnly={isSalesOnly} badge={
                    <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                      📅 {lead.nextFollowUpDate}
                    </span>
                  } />
                ))}
              </div>
            </div>
          )}

          {todayLeads.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">📅 متابعات اليوم ({todayLeads.length})</span>
              </div>
              <div className="space-y-2">
                {todayLeads.map(lead => (
                  <LeadNotificationRow key={lead.id} lead={lead} isSalesOnly={isSalesOnly} badge={
                    <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">اليوم</span>
                  } />
                ))}
              </div>
            </div>
          )}

          {noFollowup.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">🕐 بدون موعد متابعة ({noFollowup.length})</span>
              </div>
              <div className="space-y-2">
                {noFollowup.slice(0, 20).map(lead => (
                  <LeadNotificationRow key={lead.id} lead={lead} isSalesOnly={isSalesOnly} badge={
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      lead.status === 'interested' ? 'bg-emerald-100 text-emerald-700'
                        : lead.status === 'contacted' ? 'bg-amber-100 text-amber-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}>
                      {LEAD_STATUS_CFG[lead.status as LeadStatus]?.label || lead.status}
                    </span>
                  } />
                ))}
                {noFollowup.length > 20 && (
                  <p className="text-xs text-gray-400 text-center pt-1">+{noFollowup.length - 20} عميل آخر</p>
                )}
              </div>
            </div>
          )}

          {overdue.length === 0 && todayLeads.length === 0 && noFollowup.length === 0 && (
            <div className="text-center py-20">
              <div className="text-5xl mb-3">✅</div>
              <p className="text-gray-500 font-bold">كل شيء على ما يرام!</p>
              <p className="text-gray-400 text-sm mt-1">لا توجد متابعات معلّقة</p>
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 px-5 py-4 bg-gray-50 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={onShowOverdue}
              disabled={overdue.length === 0}
              className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-xl disabled:opacity-40 transition"
            >عرض المتأخرة في الجدول</button>
            <button
              onClick={onShowToday}
              disabled={todayLeads.length === 0}
              className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl disabled:opacity-40 transition"
            >عرض اليوم</button>
          </div>
        </div>
      </div>
    </div>
  );
}
