import { Download, Plus } from 'lucide-react';
import type { SubscriberItem } from '../../../../types';

interface InstallmentActionsProps {
  subscribersWithPlans: SubscriberItem[];
  exportCSV: (filename: string, rows: string[][], headers: string[]) => void;
  onNewPlan?: () => void;
}

export function InstallmentActions({
  subscribersWithPlans,
  exportCSV,
  onNewPlan,
}: InstallmentActionsProps) {
  return (
    <div className="flex gap-2 justify-end flex-wrap">
      <button
        onClick={() => exportCSV(
          'installment-debts.csv',
          subscribersWithPlans.flatMap((subscriber) =>
            (subscriber.installmentPlans ?? []).map((plan) => {
              const paid = plan.entries.reduce((sum: number, entry: { paidAt?: string; amount: number; paidAmount?: number }) =>
                sum + (entry.paidAmount ?? (entry.paidAt ? entry.amount : 0)), 0);
              return [subscriber.name, subscriber.phone, plan.courseTitle || '—', String(plan.totalAmount), plan.currency, String(paid), String(plan.totalAmount - paid)];
            })
          ),
          ['الاسم', 'الهاتف', 'الكورس', 'الإجمالي', 'العملة', 'المدفوع', 'المتبقي']
        )}
        className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-xl px-3 py-2 text-sm font-bold transition">
        <Download size={14} /> تصدير ديون CSV
      </button>
      {onNewPlan && (
        <button onClick={onNewPlan}
          className="flex items-center gap-1.5 bg-primary-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-primary-700 transition">
          <Plus size={14} /> إضافة خطة أقساط جديدة
        </button>
      )}
    </div>
  );
}
