import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import type { SubscriberItem } from '../../../../types';

interface PayingEntryDraft {
  subId: string;
  planId: string;
  entryId: string;
  paidAmount: number;
  paymentMethod: string;
}

interface InstallmentPlansListProps {
  subscribersWithPlans: SubscriberItem[];
  today: string;
  onPayEntry: (draft: PayingEntryDraft) => void;
}

export function InstallmentPlansList({ subscribersWithPlans, today, onPayEntry }: InstallmentPlansListProps) {
  return (
    <div className="space-y-4">
      {subscribersWithPlans.map((subscriber) => (
        <article key={subscriber.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="bg-gray-50 border-b border-gray-100 px-5 py-3 flex items-center gap-3">
            <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-xs font-bold text-primary-700">{subscriber.name.charAt(0)}</div>
            <div>
              <p className="font-bold text-gray-900">{subscriber.name}</p>
              <p className="text-xs text-gray-500">{subscriber.phone}</p>
            </div>
          </div>
          <div className="p-4 space-y-4">
            {(subscriber.installmentPlans || []).map((plan) => {
              const totalPaid = plan.entries.reduce((sum, entry) => sum + (entry.paidAmount ?? (entry.paidAt ? entry.amount : 0)), 0);
              const percent = plan.totalAmount > 0 ? Math.round((totalPaid / plan.totalAmount) * 100) : 0;
              return (
                <div key={plan.id} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-bold text-gray-800">{plan.courseTitle || 'خطة سداد'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        إجمالي: {plan.totalAmount.toLocaleString()} {plan.currency} · مدفوع: {totalPaid.toLocaleString()} {plan.currency}
                      </p>
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${percent >= 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{percent}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
                    <div className={`h-full rounded-full transition-all ${percent >= 100 ? 'bg-emerald-500' : 'bg-primary-500'}`} style={{ width: `${Math.min(percent, 100)}%` }} />
                  </div>
                  <div className="space-y-1.5">
                    {plan.entries.map((entry) => {
                      const isOverdueEntry = !entry.paidAt && entry.dueDate < today;
                      return (
                        <div key={entry.id} className={`flex items-center gap-3 text-sm rounded-lg px-3 py-2 ${isOverdueEntry ? 'bg-red-50 border border-red-200' : entry.paidAt ? 'bg-emerald-50 border border-emerald-100' : 'bg-gray-50 border border-gray-100'}`}>
                          {entry.paidAt ? <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                            : isOverdueEntry ? <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                            : <Clock size={14} className="text-amber-500 flex-shrink-0" />}
                          <div className="flex-1">
                            <span className={`font-medium ${isOverdueEntry ? 'text-red-800' : entry.paidAt ? 'text-emerald-800' : 'text-gray-700'}`}>
                              {entry.amount.toLocaleString()} {entry.currency}
                            </span>
                            <span className="text-xs text-gray-400 mr-2">استحقاق: {entry.dueDate}</span>
                            {entry.paidAt && <span className="text-xs text-emerald-600"> · سُدِّد: {entry.paidAt}</span>}
                            {isOverdueEntry && (
                              <span className="text-xs text-red-600 font-bold">
                                {' '}· متأخر {Math.floor((Date.now() - new Date(entry.dueDate).getTime()) / 86400000)} يوم
                              </span>
                            )}
                            {entry.note && <span className="text-xs text-gray-400"> · {entry.note}</span>}
                          </div>
                          {!entry.paidAt && (
                            <button onClick={() => onPayEntry({ subId: subscriber.id, planId: plan.id, entryId: entry.id, paidAmount: entry.amount, paymentMethod: '' })}
                              className="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded-lg hover:bg-emerald-700 transition flex-shrink-0">
                              تم الدفع
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      ))}
    </div>
  );
}
