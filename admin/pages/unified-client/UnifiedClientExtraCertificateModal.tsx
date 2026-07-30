import React from 'react';
import { X } from 'lucide-react';

import type { Course, ExtraCertificateType, SubscriberItem } from '../../types';
import type { ExtraCertificateDraft } from './useUnifiedClientCertificateState';
import { EXTRA_TYPE_LABELS } from './constants';

interface UnifiedClientExtraCertificateModalProps {
  open: boolean;
  subscriber: SubscriberItem | null | undefined;
  clientName: string;
  courses: Course[];
  draft: ExtraCertificateDraft;
  settlementLabel: string;
  setDraft: React.Dispatch<React.SetStateAction<ExtraCertificateDraft>>;
  onSubmit: () => void;
  onClose: () => void;
}

export const UnifiedClientExtraCertificateModal: React.FC<UnifiedClientExtraCertificateModalProps> = ({
  open,
  subscriber,
  clientName,
  courses,
  draft,
  settlementLabel,
  setDraft,
  onSubmit,
  onClose,
}) => {
  if (!open || !subscriber) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-lg shadow">🏆</div>
            <div>
              <p className="font-extrabold text-gray-900 text-sm">طلب شهادة إضافية</p>
              <p className="text-[11px] text-gray-400">{clientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-xs text-gray-600 mb-1.5 block font-medium">الكورس</label>
            <select
              value={draft.courseId}
              onChange={e => setDraft({ ...draft, courseId: e.target.value })}
              className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm"
            >
              <option value="">- اختر الكورس -</option>
              {subscriber.enrolledCourseIds.map(cId => {
                const ec = courses.find(x => x.id === cId);
                return <option key={cId} value={cId}>{ec?.title || cId}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1.5 block font-medium">نوع الشهادة</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.entries(EXTRA_TYPE_LABELS) as [ExtraCertificateType, string][]).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setDraft({ ...draft, type: value })}
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium border transition text-right ${draft.type === value ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-bold shadow-sm' : 'border-gray-200 bg-white text-gray-600 hover:border-emerald-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div>
              <label className="text-xs text-gray-600 mb-1 block">سعر الشهادة (اختياري)</label>
              <input
                type="number"
                min="0"
                placeholder={`0 ${settlementLabel}`}
                value={draft.certExpected}
                onChange={e => setDraft({ ...draft, certExpected: e.target.value })}
                className="w-full border border-gray-200 bg-white rounded-lg px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <p className="text-[11px] text-gray-400">
            تسجيل المدفوع يتم من شاشة الدفع حتى يظهر في الحسابات ويرتبط بطلب الشهادة.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              onClick={onSubmit}
              disabled={!draft.courseId || !draft.type}
              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-40"
            >
              إضافة الطلب
            </button>
            <button onClick={onClose} className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
};
