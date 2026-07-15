import type React from 'react';
import type { InstallmentEntry, InstallmentPlan, SubscriberItem } from '../../../../types';

export interface PayingInstallmentEntry {
  subId: string;
  planId: string;
  entryId: string;
  paidAmount: number;
  paymentMethod: string;
}

interface InstallmentPaymentModalProps {
  payingEntry: PayingInstallmentEntry | null;
  setPayingEntry: React.Dispatch<React.SetStateAction<PayingInstallmentEntry | null>>;
  subscribers: SubscriberItem[];
  paymentMethods: string[];
  onConfirm: (sub: SubscriberItem, plan: InstallmentPlan, entry: InstallmentEntry) => void;
}

export function InstallmentPaymentModal({
  payingEntry,
  setPayingEntry,
  subscribers,
  paymentMethods,
  onConfirm,
}: InstallmentPaymentModalProps) {
  if (!payingEntry) return null;

  const sub = subscribers.find(s => s.id === payingEntry.subId);
  const plan = sub?.installmentPlans?.find(p => p.id === payingEntry.planId);
  const entry = plan?.entries.find(e => e.id === payingEntry.entryId);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPayingEntry(null)}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" dir="rtl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 mb-1">تأكيد سداد الدفعة</h3>
        <p className="text-sm text-gray-500 mb-4">{sub?.name} — {plan?.courseTitle || 'خطة سداد'}</p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-600 mb-1 block">المبلغ المدفوع فعلياً</label>
            <input type="number" min={0}
              value={payingEntry.paidAmount}
              onChange={e => setPayingEntry(pe => pe ? { ...pe, paidAmount: +e.target.value } : null)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            <p className="text-xs text-gray-400 mt-0.5">المبلغ المستحق: {entry?.amount.toLocaleString()} {entry?.currency}</p>
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">وسيلة الدفع <span className="text-gray-400">(اختياري)</span></label>
            <select value={payingEntry.paymentMethod}
              onChange={e => setPayingEntry(pe => pe ? { ...pe, paymentMethod: e.target.value } : null)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
              <option value="">— اختر وسيلة الدفع —</option>
              {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => {
                if (!sub || !plan || !entry) return;
                onConfirm(sub, plan, entry);
              }}
              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700">
              تأكيد السداد
            </button>
            <button onClick={() => setPayingEntry(null)} className="px-5 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300">إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}
