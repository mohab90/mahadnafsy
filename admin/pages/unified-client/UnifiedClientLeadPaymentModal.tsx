import React from 'react';
import { CreditCard, X } from 'lucide-react';
import type { Bundle, Course, PaymentRecord } from '../../types';
import { UnifiedClientCourseOptions } from './UnifiedClientCourseOptions';

export type UnifiedClientLeadPaymentDraft = Omit<PaymentRecord, 'id'>;

type Props = {
  open: boolean;
  clientName: string;
  bundles: Bundle[];
  courses: Course[];
  draft: UnifiedClientLeadPaymentDraft;
  setDraft: React.Dispatch<React.SetStateAction<UnifiedClientLeadPaymentDraft>>;
  saving: boolean;
  onSubmit: () => void;
  onClose: () => void;
};

export const UnifiedClientLeadPaymentModal: React.FC<Props> = ({
  open,
  clientName,
  bundles,
  courses,
  draft,
  setDraft,
  saving,
  onSubmit,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" dir="rtl" onClick={event => event.stopPropagation()}>
        <div className="bg-gradient-to-l from-red-700 to-red-500 px-5 py-4 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 rounded-xl p-2"><CreditCard size={20} className="text-white" /></div>
              <div>
                <p className="font-extrabold text-white text-base leading-tight">تسجيل دفعة جديدة</p>
                <p className="text-red-100 text-xs mt-0.5">{clientName}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 mb-1 block">المبلغ</label>
              <input type="number" min="0" value={draft.amount || ''} onChange={event => setDraft(current => ({ ...current, amount: Number(event.target.value) }))} className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-600 mb-1 block">العملة</label>
              <select value={draft.currency} onChange={event => setDraft(current => ({ ...current, currency: event.target.value as UnifiedClientLeadPaymentDraft['currency'] }))} className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm">
                <option value="EGP">ج.م</option>
                <option value="SAR">ر.س</option>
                <option value="USD">$</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600 mb-1 block">الكورس</label>
              <select value={draft.courseId} onChange={event => setDraft(current => ({ ...current, courseId: event.target.value }))} className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm">
                <option value="">اختر</option>
                <UnifiedClientCourseOptions bundles={bundles} courses={courses} />
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600 mb-1 block">التاريخ</label>
              <input type="date" value={draft.date} onChange={event => setDraft(current => ({ ...current, date: event.target.value }))} className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">ملاحظة</label>
            <input value={draft.note || ''} onChange={event => setDraft(current => ({ ...current, note: event.target.value }))} className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onSubmit} disabled={saving} className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2">
              <CreditCard size={15} /> {saving ? 'جاري التسجيل...' : 'تسجيل الدفعة'}
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
