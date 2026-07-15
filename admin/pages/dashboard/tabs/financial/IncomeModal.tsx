import React from 'react';
import type { Course, PaymentItemType, SubscriberItem } from '../../../../types';
import { paymentTypeLabels, type IncomeDraft } from './financialTabUtils';

interface IncomeModalProps {
  incomeDraft: IncomeDraft;
  setIncomeDraft: React.Dispatch<React.SetStateAction<IncomeDraft>>;
  subscribers: SubscriberItem[];
  courses: Course[];
  paymentMethods: string[];
  onSave: () => void;
  onClose: () => void;
}

export function IncomeModal({
  incomeDraft,
  setIncomeDraft,
  subscribers,
  courses,
  paymentMethods,
  onSave,
  onClose,
}: IncomeModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" dir="rtl" onClick={(event) => event.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 mb-1">إضافة دخل يدوي</h3>
        <p className="text-sm text-gray-500 mb-4">يُضاف للمشترك المحدد في سجل المدفوعات</p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-600 mb-1 block">العميل <span className="text-red-500">*</span></label>
            <select value={incomeDraft.subscriberId} onChange={(event) => setIncomeDraft({ ...incomeDraft, subscriberId: event.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">— اختر العميل —</option>
              {[...subscribers].sort((a, b) => a.name.localeCompare(b.name, 'ar')).map((subscriber) => (
                <option key={subscriber.id} value={subscriber.id}>{subscriber.name} {subscriber.phone ? `(${subscriber.phone})` : ''}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-600 mb-1 block">نوع الدفع</label>
            <select value={incomeDraft.paymentType} onChange={(event) => setIncomeDraft({ ...incomeDraft, paymentType: event.target.value as PaymentItemType })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {(Object.entries(paymentTypeLabels) as [PaymentItemType, string][]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>

          {incomeDraft.paymentType === 'course' && (
            <>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">الكورس (اختياري)</label>
                <select value={incomeDraft.courseId} onChange={(event) => setIncomeDraft({ ...incomeDraft, courseId: event.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">— اختر كورس —</option>
                  {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={incomeDraft.isInstallment}
                  onChange={(event) => setIncomeDraft({ ...incomeDraft, isInstallment: event.target.checked })}
                  className="w-4 h-4 rounded accent-primary-600" />
                <span className="text-sm text-gray-700">دفعة قسط (يُفتح 15 فيديو عند أول قسط)</span>
              </label>
            </>
          )}

          <div>
            <label className="text-xs text-gray-600 mb-1 block">وسيلة الدفع</label>
            <select value={incomeDraft.paymentMethod} onChange={(event) => setIncomeDraft({ ...incomeDraft, paymentMethod: event.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">— اختر وسيلة الدفع —</option>
              {paymentMethods.map((method) => <option key={method} value={method}>{method}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-600 mb-1 block">رقم العملية</label>
            <input value={incomeDraft.transactionId} onChange={(event) => setIncomeDraft({ ...incomeDraft, transactionId: event.target.value })}
              placeholder="رقم العملية / المرجع..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>

          <div>
            <label className="text-xs text-gray-600 mb-1 block">رقم الحساب / المحفظة المحوَّل منه</label>
            <input value={incomeDraft.fromAccountNumber} onChange={(event) => setIncomeDraft({ ...incomeDraft, fromAccountNumber: event.target.value })}
              placeholder="اختياري — مثال: 01012345678" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 mb-1 block">المبلغ <span className="text-red-500">*</span></label>
              <input type="number" min={0} value={incomeDraft.amount || ''}
                onChange={(event) => setIncomeDraft({ ...incomeDraft, amount: Number(event.target.value) })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-600 mb-1 block">العملة</label>
              <select value={incomeDraft.currency} onChange={(event) => setIncomeDraft({ ...incomeDraft, currency: event.target.value as IncomeDraft['currency'] })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="EGP">ج.م</option><option value="SAR">ر.س</option><option value="USD">$</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-600 mb-1 block">التاريخ</label>
            <input type="date" value={incomeDraft.date} onChange={(event) => setIncomeDraft({ ...incomeDraft, date: event.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>

          <div>
            <label className="text-xs text-gray-600 mb-1 block">ملاحظة</label>
            <input value={incomeDraft.note} onChange={(event) => setIncomeDraft({ ...incomeDraft, note: event.target.value })}
              placeholder="مثال: دفعة أولى..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={onSave} disabled={!incomeDraft.subscriberId || !incomeDraft.amount}
              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-50">
              حفظ الدخل
            </button>
            <button onClick={onClose} className="flex-1 py-2.5 bg-gray-200 text-gray-700 rounded-xl text-sm hover:bg-gray-300">إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}
