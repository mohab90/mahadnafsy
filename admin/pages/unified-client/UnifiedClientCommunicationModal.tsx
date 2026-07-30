import React from 'react';
import { X } from 'lucide-react';
import type { CommunicationRecord } from '../../types';
import { commTypeMeta } from './constants';

export type UnifiedClientCommunicationDraft = {
  type: CommunicationRecord['type'];
  date: string;
  notes: string;
  outcome: string;
  nextFollowUp: string;
  newStatus?: string;
};

type Props = {
  open: boolean;
  clientName: string;
  draft: UnifiedClientCommunicationDraft;
  setDraft: React.Dispatch<React.SetStateAction<UnifiedClientCommunicationDraft>>;
  saving: boolean;
  allowLeadStatus?: boolean;
  onSubmit: () => void;
  onClose: () => void;
};

const NOTE_SUGGESTIONS = [
  'تم التواصل ولا يرد',
  'مهتم وطلب التفكير',
  'طلب تأجيل الدفع',
  'تذكير بالقسط القادم',
  'تم الانتهاء من الكورس',
];

export const UnifiedClientCommunicationModal: React.FC<Props> = ({
  open,
  clientName,
  draft,
  setDraft,
  saving,
  allowLeadStatus = false,
  onSubmit,
  onClose,
}) => {
  if (!open) return null;
  const update = (patch: Partial<UnifiedClientCommunicationDraft>) => {
    setDraft(current => ({ ...current, ...patch }));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-black text-base shadow">
              {(clientName || 'ع').charAt(0)}
            </div>
            <div>
              <p className="font-extrabold text-gray-900 text-sm">تسجيل تواصل جديد</p>
              <p className="text-[11px] text-gray-400">{clientName}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 mb-1 block">نوع التواصل</label>
              <select value={draft.type} onChange={event => update({ type: event.target.value as CommunicationRecord['type'] })} className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm">
                {Object.entries(commTypeMeta).map(([key, meta]) => (
                  <option key={key} value={key}>{meta.icon} {meta.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600 mb-1 block">التاريخ والوقت</label>
              <input type="datetime-local" value={draft.date} onChange={event => update({ date: event.target.value })} className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">ملاحظات *</label>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {NOTE_SUGGESTIONS.map(text => (
                <button key={text} type="button" onClick={() => update({ notes: text })} className="text-[10px] bg-gray-100 hover:bg-indigo-50 hover:text-indigo-700 text-gray-600 px-2 py-1 rounded-full border border-gray-200 transition">
                  {text}
                </button>
              ))}
            </div>
            <textarea value={draft.notes} onChange={event => update({ notes: event.target.value })} placeholder="ماذا تم في هذه المكالمة / المحادثة؟" className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm h-24 resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 mb-1 block">النتيجة</label>
              <input value={draft.outcome} onChange={event => update({ outcome: event.target.value })} placeholder="مثال: سيدفع الأسبوع القادم" className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-600 mb-1 block">موعد المتابعة</label>
              <input type="date" value={draft.nextFollowUp} onChange={event => update({ nextFollowUp: event.target.value })} className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          {allowLeadStatus && (
            <div>
              <label className="text-xs text-gray-600 mb-1 block">تغيير الحالة (اختياري)</label>
              <select value={draft.newStatus || ''} onChange={event => update({ newStatus: event.target.value })} className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm">
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
            <button type="button" onClick={onSubmit} disabled={saving || !draft.notes.trim()} className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'جاري الحفظ...' : '💾 حفظ التواصل'}
            </button>
            <button type="button" onClick={onClose} className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
