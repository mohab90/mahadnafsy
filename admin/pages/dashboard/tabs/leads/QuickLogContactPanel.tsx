import type React from 'react';
import { Plus } from 'lucide-react';
import type { CommunicationRecord, LeadItem } from '../../../../types';

/**
 * Log a call, a WhatsApp message or a note against a lead.
 *
 * This used to live inside the الاتصالات timeline, which is where it went wrong:
 * the button that opens it is on the pipeline card, so a rep pressed "سجل تواصل"
 * on one tab and the form appeared on another — and when that timeline was
 * removed as duplicated data, the button stopped doing anything at all.
 *
 * It is an action, not a view, so it belongs beside the leads screen itself and
 * opens wherever it is asked for.
 */
interface QuickCommunicationDraft {
  leadSearch: string;
  selectedLeadId: string;
  type: CommunicationRecord['type'];
  notes: string;
  outcome: string;
  nextFollowUp: string;
  alsoSend: boolean;
}

export interface QuickLogContactPanelProps {
  canManageLeads: boolean;
  showAddComm: boolean;
  setShowAddComm: React.Dispatch<React.SetStateAction<boolean>>;
  addCommDraft: QuickCommunicationDraft;
  setAddCommDraft: React.Dispatch<React.SetStateAction<QuickCommunicationDraft>>;
  addCommSearchResults: LeadItem[];
  handleLeadSearchChange: (value: string) => void;
  selectLeadForCommunication: (lead: LeadItem) => void;
  saveQuickCommunication: () => void | Promise<void>;
}

export function QuickLogContactPanel({
  canManageLeads,
  showAddComm,
  setShowAddComm,
  addCommDraft,
  setAddCommDraft,
  addCommSearchResults,
  handleLeadSearchChange,
  selectLeadForCommunication,
  saveQuickCommunication,
}: QuickLogContactPanelProps) {
  return (
    <>
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
      {addCommDraft.type === 'whatsapp' && (
        <label className="flex items-start gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2 cursor-pointer">
          <input
            type="checkbox"
            checked={addCommDraft.alsoSend}
            onChange={e => setAddCommDraft(d => ({ ...d, alsoSend: e.target.checked }))}
            className="w-4 h-4 accent-emerald-600 mt-0.5"
          />
          <span className="text-xs text-emerald-800 leading-relaxed">
            <b>ابعت الرسالة فعلاً للعميل</b>
            <br />
            <span className="text-emerald-700">
              هتخرج من واتسابك لو رابطه، وإلا من رقم الشركة — وهتتسجّل في محادثة العميل.
            </span>
          </span>
        </label>
      )}
      <div className="flex gap-2 pt-1">
        <button
          disabled={!addCommDraft.selectedLeadId || !addCommDraft.notes.trim()}
          onClick={saveQuickCommunication}
          className="flex-1 py-2 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 disabled:opacity-50 transition">
          {addCommDraft.alsoSend && addCommDraft.type === 'whatsapp' ? 'إرسال وتسجيل' : 'حفظ التواصل'}
        </button>
        <button onClick={() => setShowAddComm(false)} className="px-4 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition text-sm">إلغاء</button>
      </div>
    </div>
  )}
    </>
  );
}
