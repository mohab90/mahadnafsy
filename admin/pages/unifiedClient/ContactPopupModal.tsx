import React from 'react';
import type { CommunicationRecord } from '../../types';
import { commTypeMeta } from '../unifiedClient.constants';

export type ContactPopupDraft = {
  type: CommunicationRecord['type'];
  date: string;
  notes: string;
  outcome: string;
  nextFollowUp: string;
  newStatus: string;
};

interface Props {
  draft: ContactPopupDraft;
  setDraft: React.Dispatch<React.SetStateAction<ContactPopupDraft>>;
  isLead: boolean;
  isSaving: boolean;
  onSave: () => void;
  onClose: () => void;
}

/** "تسجيل تواصل جديد" modal (extracted from UnifiedClientPage). */
export default function ContactPopupModal({ draft, setDraft, isLead, isSaving, onSave, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full space-y-4" onClick={e => e.stopPropagation()} dir="rtl">
        <div className="flex items-center justify-between">
          <h2 className="font-extrabold text-lg text-gray-900 flex items-center gap-2">
            <span className="text-xl">📞</span> تسجيل تواصل جديد
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none">×</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block font-semibold">نوع التواصل</label>
            <select value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value as CommunicationRecord['type'] }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
              {Object.entries(commTypeMeta).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block font-semibold">التاريخ والوقت</label>
            <input type="datetime-local" value={draft.date}
              onChange={e => setDraft(d => ({ ...d, date: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block font-semibold">الملاحظات *</label>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {['تم التواصل ولا يرد', 'مهتم وطلب التفكير', 'طلب تأجيل الدفع', 'تذكير بالقسط', 'تم الانتهاء من الكورس'].map(t => (
              <button key={t} type="button" onClick={() => setDraft(d => ({ ...d, notes: t }))}
                className="text-[10px] bg-gray-100 hover:bg-indigo-50 hover:text-indigo-700 text-gray-600 px-2 py-1 rounded-full border border-gray-200 transition">
                {t}
              </button>
            ))}
          </div>
          <textarea value={draft.notes}
            onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
            placeholder="ماذا تم في هذا التواصل؟"
            rows={3}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block font-semibold">النتيجة</label>
            <input value={draft.outcome}
              onChange={e => setDraft(d => ({ ...d, outcome: e.target.value }))}
              placeholder="مثال: سيدفع الأسبوع القادم"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block font-semibold">موعد المتابعة</label>
            <input type="date" value={draft.nextFollowUp}
              onChange={e => setDraft(d => ({ ...d, nextFollowUp: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
        </div>

        {isLead && (
          <div>
            <label className="text-xs text-gray-500 mb-1 block font-semibold">تغيير الحالة (اختياري)</label>
            <select value={draft.newStatus}
              onChange={e => setDraft(d => ({ ...d, newStatus: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
              <option value="">— بدون تغيير —</option>
              <option value="contacted">تم التواصل</option>
              <option value="interested">مهتم</option>
              <option value="interested_followup">مهتم ومتابعة</option>
              <option value="not_interested">غير مهتم</option>
              <option value="lost">خسرنا</option>
            </select>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onSave} disabled={isSaving || !draft.notes.trim()}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold disabled:opacity-50 transition">
            {isSaving ? 'جاري الحفظ...' : '💾 حفظ التواصل'}
          </button>
          <button onClick={onClose}
            className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-medium transition">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
