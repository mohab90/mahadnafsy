import type React from 'react';
import { Activity, Download, Plus, X } from 'lucide-react';
import type { CommunicationRecord, LeadItem, StaffMember } from '../../../../types';
import type { LeadCommunicationFilter } from './useLeadCommunicationsData';

interface QuickCommunicationDraft {
  leadSearch: string;
  selectedLeadId: string;
  type: CommunicationRecord['type'];
  notes: string;
  outcome: string;
  nextFollowUp: string;
}

interface LeadCommunicationsControlsProps {
  filteredCount: number;
  totalCount: number;
  commFilter: LeadCommunicationFilter;
  setCommFilter: React.Dispatch<React.SetStateAction<LeadCommunicationFilter>>;
  salesReps: StaffMember[];
  isSalesOnly: boolean;
  canManageLeads: boolean;
  canExportLeads: boolean;
  showAddComm: boolean;
  setShowAddComm: React.Dispatch<React.SetStateAction<boolean>>;
  addCommDraft: QuickCommunicationDraft;
  setAddCommDraft: React.Dispatch<React.SetStateAction<QuickCommunicationDraft>>;
  addCommSearchResults: LeadItem[];
  handleLeadSearchChange: (value: string) => void;
  selectLeadForCommunication: (lead: LeadItem) => void;
  saveQuickCommunication: () => void;
  exportCommsCsv: () => void;
}

export function LeadCommunicationsControls({
  filteredCount,
  totalCount,
  commFilter,
  setCommFilter,
  salesReps,
  isSalesOnly,
  canManageLeads,
  canExportLeads,
  showAddComm,
  setShowAddComm,
  addCommDraft,
  setAddCommDraft,
  addCommSearchResults,
  handleLeadSearchChange,
  selectLeadForCommunication,
  saveQuickCommunication,
  exportCommsCsv,
}: LeadCommunicationsControlsProps) {
  return (
    <>
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
            <Activity size={15} className="text-primary-500" /> سجل التواصلات
            <span className="text-xs font-normal text-gray-400">({filteredCount} من {totalCount})</span>
          </h3>
          <div className="flex gap-2">
            {canManageLeads && <button onClick={() => setShowAddComm(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition">
              <Plus size={13} /> تسجيل تواصل
            </button>}
            {canExportLeads && <button onClick={exportCommsCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">
              <Download size={13} /> تصدير
            </button>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            value={commFilter.search}
            onChange={e => setCommFilter(f => ({ ...f, search: e.target.value }))}
            placeholder="بحث بالاسم أو الهاتف أو الملاحظة..."
            className="flex-1 min-w-[160px] border border-gray-200 rounded-xl px-3 py-2 text-xs"
          />
          <select value={commFilter.type} onChange={e => setCommFilter(f => ({ ...f, type: e.target.value }))}
            className="border border-gray-200 rounded-xl px-3 py-2 text-xs bg-white">
            <option value="">كل الأنواع</option>
            <option value="call">📞 مكالمة</option>
            <option value="whatsapp">💬 واتساب</option>
            <option value="email">✉️ إيميل</option>
            <option value="meeting">🤝 اجتماع</option>
            <option value="note">📝 ملاحظة</option>
          </select>
          {!isSalesOnly && (
            <select value={commFilter.staffId} onChange={e => setCommFilter(f => ({ ...f, staffId: e.target.value }))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-xs bg-white">
              <option value="">كل المندوبين</option>
              {salesReps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <input type="date" value={commFilter.dateFrom} onChange={e => setCommFilter(f => ({ ...f, dateFrom: e.target.value }))}
            className="border border-gray-200 rounded-xl px-3 py-2 text-xs" />
          <input type="date" value={commFilter.dateTo} onChange={e => setCommFilter(f => ({ ...f, dateTo: e.target.value }))}
            className="border border-gray-200 rounded-xl px-3 py-2 text-xs" />
          {(commFilter.staffId || commFilter.type || commFilter.dateFrom || commFilter.dateTo || commFilter.search) && (
            <button onClick={() => setCommFilter({ staffId: '', type: '', dateFrom: '', dateTo: '', search: '' })}
              className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 px-2 py-1.5 rounded-xl border border-red-200 bg-red-50">
              <X size={11} /> مسح الفلاتر
            </button>
          )}
        </div>
      </div>

      {canManageLeads && showAddComm && (
        <div className="bg-white border border-primary-200 rounded-2xl p-4 shadow-sm space-y-3">
          <h4 className="font-bold text-primary-700 text-sm flex items-center gap-2">
            <Plus size={14} /> تسجيل تواصل جديد
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <label className="text-xs font-bold text-gray-600 mb-1 block">البحث عن عميل</label>
              <input
                value={addCommDraft.leadSearch}
                onChange={e => handleLeadSearchChange(e.target.value)}
                placeholder="ابحث عن العميل..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
              />
              {addCommSearchResults.length > 0 && !addCommDraft.selectedLeadId && (
                <div className="absolute top-full mt-1 right-0 left-0 z-50 bg-white border border-gray-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                  {addCommSearchResults.map(l => (
                    <button key={l.id} onClick={() => selectLeadForCommunication(l)} className="w-full text-right px-3 py-2 text-xs hover:bg-gray-50 flex justify-between items-center">
                      <span className="font-bold text-gray-800">{l.name}</span>
                      <span className="text-gray-400 font-mono">{l.phone}</span>
                    </button>
                  ))}
                </div>
              )}
              {addCommDraft.selectedLeadId && (
                <span className="absolute left-2 top-8 text-emerald-600 text-xs font-bold">✓ محدد</span>
              )}
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">نوع التواصل</label>
              <select value={addCommDraft.type} onChange={e => setAddCommDraft(d => ({ ...d, type: e.target.value as CommunicationRecord['type'] }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
                <option value="call">📞 مكالمة</option>
                <option value="whatsapp">💬 واتساب</option>
                <option value="email">✉️ إيميل</option>
                <option value="meeting">🤝 اجتماع</option>
                <option value="note">📝 ملاحظة</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">ملاحظة التواصل *</label>
            <textarea value={addCommDraft.notes} onChange={e => setAddCommDraft(d => ({ ...d, notes: e.target.value }))}
              rows={2} placeholder="ما الذي حصل في هذا التواصل؟"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-bold text-gray-600 mb-1 block">النتيجة (اختياري)</label>
              <input value={addCommDraft.outcome} onChange={e => setAddCommDraft(d => ({ ...d, outcome: e.target.value }))}
                placeholder="نتيجة التواصل..." className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="flex-1">
              <label className="text-xs font-bold text-gray-600 mb-1 block">موعد المتابعة التالية</label>
              <input type="date" value={addCommDraft.nextFollowUp} onChange={e => setAddCommDraft(d => ({ ...d, nextFollowUp: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              disabled={!addCommDraft.selectedLeadId || !addCommDraft.notes.trim()}
              onClick={saveQuickCommunication}
              className="flex-1 py-2 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 disabled:opacity-50 transition">
              حفظ التواصل
            </button>
            <button onClick={() => setShowAddComm(false)} className="px-4 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition text-sm">إلغاء</button>
          </div>
        </div>
      )}
    </>
  );
}
