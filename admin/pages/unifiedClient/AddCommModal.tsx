import React from 'react';
import { X } from 'lucide-react';
import type { CommunicationRecord } from '../../types';
import { commTypeMeta } from '../unifiedClient.constants';

export type NewCommDraft = {
  type: CommunicationRecord['type'];
  date: string;
  notes: string;
  outcome: string;
  nextFollowUp: string;
};

interface Props {
  clientName: string;
  newComm: NewCommDraft; setNewComm: (v: NewCommDraft) => void;
  isSaving: boolean;
  onSave: () => void;
  onClose: () => void;
}

/** "تسجيل تواصل جديد" (avatar variant) modal — extracted from UnifiedClientPage. */
export default function AddCommModal({ clientName, newComm, setNewComm, isSaving, onSave, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl" onClick={e => e.stopPropagation()}>
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
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 mb-1 block">نوع التواصل</label>
              <select value={newComm.type} onChange={e => setNewComm({ ...newComm, type: e.target.value as CommunicationRecord['type'] })}
                className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm">
                {Object.entries(commTypeMeta).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600 mb-1 block">التاريخ والوقت</label>
              <input type="datetime-local" value={newComm.date} onChange={e => setNewComm({ ...newComm, date: e.target.value })}
                className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">ملاحظات *</label>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {['تم التواصل ولا يرد', 'مهتم وطلب التفكير', 'طلب تأجيل الدفع', 'تذكير بالقسط القادم', 'تم الانتهاء من الكورس'].map(t => (
                <button key={t} type="button" onClick={() => setNewComm({ ...newComm, notes: t })}
                  className="text-[10px] bg-gray-100 hover:bg-indigo-50 hover:text-indigo-700 text-gray-600 px-2 py-1 rounded-full border border-gray-200 transition">{t}</button>
              ))}
            </div>
            <textarea value={newComm.notes} onChange={e => setNewComm({ ...newComm, notes: e.target.value })}
              placeholder="ماذا تم في هذه المكالمة / المحادثة؟"
              className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm h-24 resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 mb-1 block">النتيجة</label>
              <input value={newComm.outcome} onChange={e => setNewComm({ ...newComm, outcome: e.target.value })}
                placeholder="مثال: سيدفع الأسبوع القادم"
                className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-600 mb-1 block">موعد المتابعة</label>
              <input type="date" value={newComm.nextFollowUp} onChange={e => setNewComm({ ...newComm, nextFollowUp: e.target.value })}
                className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onSave} disabled={isSaving} className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50">💾 حفظ التواصل</button>
            <button onClick={onClose} className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}
