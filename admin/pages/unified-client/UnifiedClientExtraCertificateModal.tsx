import React from 'react';
import { Modal } from '../../../shared/ui/Modal';

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
  if (!subscriber) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="طلب شهادة إضافية"
      subtitle={clientName}
      icon={<div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-lg shadow">🏆</div>}
      size="sm"
      footer={(
        <>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
          <button
            onClick={onSubmit}
            disabled={!draft.courseId || !draft.type}
            className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-40"
          >
            إضافة الطلب
          </button>
        </>
      )}
    >
        <div className="space-y-3">
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
        </div>
    </Modal>
  );
};
