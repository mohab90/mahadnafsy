import { CreditCard, Plus, Trash2 } from 'lucide-react';
import type { LeadItem, PaymentRecord } from '../../types';

interface UnifiedClientLeadPaymentsPanelProps {
  lead?: LeadItem;
  payments: PaymentRecord[];
  showForm: boolean;
  onShowForm: () => void;
  onUpdateLead: (lead: LeadItem) => void;
}

export function UnifiedClientLeadPaymentsPanel({
  lead,
  payments,
  showForm,
  onShowForm,
  onUpdateLead,
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

      {payments.map((payment) => (
        <div key={payment.id} className="group flex items-start justify-between rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
          <div>
            <p className="font-bold text-emerald-700">
              {Number(payment.amount || 0).toLocaleString()} {payment.currency}
            </p>
            <p className="text-xs text-gray-400">{payment.date}</p>
            {payment.courseId && <p className="text-xs text-gray-500">كورس: {payment.courseId}</p>}
            {payment.note && <p className="text-xs italic text-gray-500">{payment.note}</p>}
          </div>
          <button
            type="button"
            onClick={() => lead && onUpdateLead({ ...lead, paymentRecords: payments.filter((item) => item.id !== payment.id) })}
            className="mt-1 text-red-400 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
            aria-label="حذف الدفعة"
          >
            <Trash2 size={14} />
          </button>
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
