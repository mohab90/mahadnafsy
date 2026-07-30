import { CreditCard, Plus } from 'lucide-react';
import type { PaymentRecord } from '../../types';

interface UnifiedClientLeadPaymentsPanelProps {
  payments: PaymentRecord[];
  showForm: boolean;
  onShowForm: () => void;
}

export function UnifiedClientLeadPaymentsPanel({
  payments,
  showForm,
  onShowForm,
}: UnifiedClientLeadPaymentsPanelProps) {
  return (
    <>
      <button
        type="button"
        onClick={onShowForm}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-emerald-200 py-3 text-sm text-emerald-700 hover:bg-emerald-50"
      >
        <Plus size={18} /> تسجيل دفعة جديدة
      </button>

      {payments.length > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          السجلات التالية بيانات CRM قديمة وليست دفعات محاسبية معتمدة. الدفعات الجديدة تُسجّل في دفتر المدفوعات فقط.
        </p>
      )}

      {payments.map((payment) => (
        <div key={payment.id} className="flex items-start justify-between rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
          <div>
            <p className="font-bold text-emerald-700">
              {Number(payment.amount || 0).toLocaleString()} {payment.currency}
            </p>
            <p className="text-xs text-gray-400">{payment.date}</p>
            {payment.courseId && <p className="text-xs text-gray-500">كورس: {payment.courseId}</p>}
            {payment.note && <p className="text-xs italic text-gray-500">{payment.note}</p>}
          </div>
        </div>
      ))}

      {payments.length === 0 && !showForm && (
        <div className="py-10 text-center text-gray-400">
          <CreditCard size={40} className="mx-auto mb-2 text-gray-200" />
          <p>لا توجد مدفوعات مسجلة</p>
        </div>
      )}
    </>
  );
}
