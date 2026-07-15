import React from 'react';
import { CreditCard, X } from 'lucide-react';
import type { BundleItem, CourseItem, PaymentRecord } from '../../types';

interface UnifiedClientLeadPaymentModalProps {
  open: boolean;
  clientName: string;
  courses: CourseItem[];
  bundles: BundleItem[];
  leadPayDraft: Omit<PaymentRecord, 'id'>;
  setLeadPayDraft: React.Dispatch<React.SetStateAction<Omit<PaymentRecord, 'id'>>>;
  onSubmit: () => void;
  onClose: () => void;
}

export const UnifiedClientLeadPaymentModal: React.FC<UnifiedClientLeadPaymentModalProps> = ({
  open,
  clientName,
  courses,
  bundles,
  leadPayDraft,
  setLeadPayDraft,
  onSubmit,
  onClose,
}) => {
  if (!open) return null;

  const bundledIds = new Set(bundles.flatMap((bundle) => bundle.courses.map((course) => course.id)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white shadow-2xl"
        dir="rtl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="bg-red-700 px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-white/20 p-2">
                <CreditCard size={20} className="text-white" />
              </div>
              <div>
                <p className="text-base font-extrabold leading-tight text-white">تسجيل دفعة جديدة</p>
                <p className="mt-0.5 text-xs text-red-100">{clientName}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-white/10 p-1.5 text-white transition hover:bg-white/20"
              aria-label="اغلاق"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="space-y-3 p-5">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-gray-600">المبلغ</span>
              <input
                type="number"
                min="0"
                value={leadPayDraft.amount || ''}
                onChange={(event) => setLeadPayDraft({ ...leadPayDraft, amount: Number(event.target.value) })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-gray-600">العملة</span>
              <select
                value={leadPayDraft.currency}
                onChange={(event) => setLeadPayDraft({ ...leadPayDraft, currency: event.target.value as 'EGP' | 'SAR' | 'USD' })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <option value="EGP">ج.م</option>
                <option value="SAR">ر.س</option>
                <option value="USD">$</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-gray-600">الكورس</span>
              <select
                value={leadPayDraft.courseId}
                onChange={(event) => setLeadPayDraft({ ...leadPayDraft, courseId: event.target.value })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">اختر</option>
                {bundles.map((bundle) => (
                  <optgroup key={bundle.id} label={bundle.title}>
                    {bundle.courses.map((course) => (
                      <option key={course.id} value={course.id}>{course.title}</option>
                    ))}
                  </optgroup>
                ))}
                <optgroup label="الكورسات الفردية">
                  {courses.filter((course) => !bundledIds.has(course.id)).map((course) => (
                    <option key={course.id} value={course.id}>{course.title}</option>
                  ))}
                </optgroup>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-gray-600">التاريخ</span>
              <input
                type="date"
                value={leadPayDraft.date}
                onChange={(event) => setLeadPayDraft({ ...leadPayDraft, date: event.target.value })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs text-gray-600">ملاحظة</span>
            <input
              value={leadPayDraft.note || ''}
              onChange={(event) => setLeadPayDraft({ ...leadPayDraft, note: event.target.value })}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
            />
          </label>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onSubmit}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700"
            >
              <CreditCard size={15} /> تسجيل الدفعة
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg bg-gray-100 py-2.5 text-sm text-gray-700 hover:bg-gray-200"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
