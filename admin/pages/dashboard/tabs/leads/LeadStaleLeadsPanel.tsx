import React from 'react';
import { CheckCheck, Clock, MessageCircle, RefreshCw } from 'lucide-react';
import { formatWaPhone } from './LeadSubcomponents';

export type StaleLeadRow = {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: string;
  interest_level: string;
  days_silent: number;
  last_comm_date: string;
  next_follow_up_date: string | null;
  assigned_sales_name: string | null;
};

type LeadStaleLeadsPanelProps = {
  staleLeads: StaleLeadRow[];
  staleLoading: boolean;
  staleBulkMsg: string;
  staleSending: boolean;
  staleSelected: Set<string>;
  setStaleBulkMsg: (value: string) => void;
  setStaleSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  onRefresh: () => void;
  onSendBulk: () => void;
};

export function LeadStaleLeadsPanel({
  staleLeads,
  staleLoading,
  staleBulkMsg,
  staleSending,
  staleSelected,
  setStaleBulkMsg,
  setStaleSelected,
  onRefresh,
  onSendBulk,
}: LeadStaleLeadsPanelProps) {
  const allSelected = staleSelected.size === staleLeads.length && staleLeads.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
          <MessageCircle size={15} className="text-amber-500" />
          عملاء متوقفون (لم يُتواصل معهم 7 أيام+)
          {staleLeads.length > 0 && (
            <span className="text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
              {staleLeads.length}
            </span>
          )}
        </h3>
        <button onClick={onRefresh} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 transition">
          <RefreshCw size={12} className={staleLoading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      {staleLoading ? (
        <div className="text-center py-8 text-sm text-gray-400">جارٍ التحميل...</div>
      ) : staleLeads.length === 0 ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
          <CheckCheck size={24} className="text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-bold text-emerald-800">جميع العملاء تم التواصل معهم مؤخراً ✅</p>
        </div>
      ) : (
        <>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => setStaleSelected(event.target.checked ? new Set(staleLeads.map((lead) => lead.id)) : new Set())}
                className="w-4 h-4 accent-amber-600"
              />
              <span className="text-sm font-bold text-amber-800">تحديد الكل ({staleLeads.length})</span>
              {staleSelected.size > 0 && <span className="text-xs text-amber-600 font-bold mr-auto">محدد: {staleSelected.size}</span>}
            </div>
            <textarea
              value={staleBulkMsg}
              onChange={(event) => setStaleBulkMsg(event.target.value)}
              rows={2}
              className="w-full text-sm border border-amber-200 rounded-lg p-2 resize-none bg-white"
              placeholder="نص الرسالة — استخدم {name} لاسم العميل"
            />
            <button
              disabled={staleSending || staleSelected.size === 0}
              onClick={onSendBulk}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-60"
            >
              {staleSending ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <MessageCircle size={15} />}
              إرسال واتساب ({staleSelected.size})
            </button>
          </div>

          {staleLeads.map((lead) => (
            <div key={lead.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3">
              <input
                type="checkbox"
                checked={staleSelected.has(lead.id)}
                onChange={(event) => setStaleSelected((prev) => {
                  const next = new Set(prev);
                  if (event.target.checked) next.add(lead.id);
                  else next.delete(lead.id);
                  return next;
                })}
                className="w-4 h-4 accent-amber-600 flex-shrink-0"
              />
              <div className={`w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center ${lead.days_silent >= 14 ? 'bg-red-100' : 'bg-amber-100'}`}>
                <Clock size={15} className={lead.days_silent >= 14 ? 'text-red-500' : 'text-amber-500'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900 text-sm">{lead.name}</p>
                <p className="text-xs text-gray-500">{lead.phone} · آخر تواصل منذ <span className="font-bold text-amber-700">{lead.days_silent} يوم</span></p>
                {lead.assigned_sales_name && <p className="text-xs text-gray-400">مندوب: {lead.assigned_sales_name}</p>}
              </div>
              <a
                href={`https://wa.me/${formatWaPhone(lead.phone)}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1.5 rounded-lg hover:bg-emerald-100 font-bold flex-shrink-0"
              >
                واتساب
              </a>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
