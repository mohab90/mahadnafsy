import { AlertCircle, CalendarDays, CheckCircle2, Clock } from 'lucide-react';
import type { Course, InstallmentPlan } from '../../types';

interface Props {
  plans: InstallmentPlan[];
  courses: Course[];
  todayStr: string;
  soon3Str: string;
  overdueCount: number;
  soonCount: number;
}

const currencyLabel = (currency: InstallmentPlan['currency']) =>
  currency === 'SAR' ? 'ر.س' : currency === 'USD' ? '$' : 'ج.م';

export function UnifiedClientInstallmentsPanel({
  plans,
  courses,
  todayStr,
  soon3Str,
  overdueCount,
  soonCount,
}: Props) {
  return (
    <div id="section-installments" className="border-t-2 border-gray-100 pt-6 space-y-4">
      <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        تعديل خطط الأقساط وتسجيل دفعاتها موقوفان مؤقتًا لحين اعتماد نموذج الدفع. العرض الحالي للقراءة فقط.
      </div>

      <div className="flex items-center gap-3">
        <div className="w-1 h-5 rounded-full bg-purple-500" />
        <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-2 flex-1">
          <CalendarDays size={14} className="text-purple-500" /> خطط الأقساط
        </h3>
        {overdueCount > 0 && <span className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">{overdueCount} متأخر</span>}
        {overdueCount === 0 && soonCount > 0 && <span className="text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">{soonCount} قريبًا</span>}
      </div>

      {(overdueCount > 0 || soonCount > 0) && (
        <div className={`rounded-xl px-4 py-3 flex items-center gap-3 ${overdueCount > 0 ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
          <AlertCircle size={20} className={overdueCount > 0 ? 'text-red-500' : 'text-amber-500'} />
          <div>
            {overdueCount > 0 && <p className="font-bold text-red-700 text-sm">{overdueCount} قسط متأخر يستدعي المتابعة</p>}
            {soonCount > 0 && <p className="font-bold text-amber-700 text-sm">{soonCount} قسط مستحق خلال 3 أيام</p>}
          </div>
        </div>
      )}

      {plans.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <CalendarDays size={40} className="mx-auto mb-2 text-gray-200" />
          <p>لا توجد خطط أقساط مسجلة</p>
        </div>
      ) : plans.map(plan => {
        const title = plan.courseTitle || courses.find(course => course.id === plan.courseId)?.title || plan.courseId;
        const paid = plan.entries.filter(entry => entry.paidAt)
          .reduce((sum, entry) => sum + (entry.paidAmount || entry.amount), 0);
        const percent = plan.totalAmount > 0 ? Math.min(100, Math.round((paid / plan.totalAmount) * 100)) : 0;
        const label = currencyLabel(plan.currency);
        return (
          <article key={plan.id} className="border border-purple-100 rounded-2xl overflow-hidden shadow-sm">
            <div className="bg-purple-50 px-4 py-3">
              <div className="flex justify-between gap-3">
                <strong className="text-sm text-gray-900">{title}</strong>
                <span className="text-xs font-bold text-purple-700">{percent}%</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {paid.toLocaleString()} {label} من {plan.totalAmount.toLocaleString()} {label}
              </p>
            </div>
            <div className="p-4 space-y-2">
              {plan.entries.map((entry, index) => {
                const overdue = !entry.paidAt && entry.dueDate < todayStr;
                const soon = !entry.paidAt && entry.dueDate >= todayStr && entry.dueDate <= soon3Str;
                return (
                  <div key={entry.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${entry.paidAt ? 'border-green-100 bg-green-50' : overdue ? 'border-red-200 bg-red-50' : soon ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-white'}`}>
                    {entry.paidAt
                      ? <CheckCircle2 size={15} className="text-green-600" />
                      : <Clock size={15} className={overdue ? 'text-red-600' : 'text-amber-600'} />}
                    <div className="flex-1">
                      <p className="text-sm font-bold text-gray-800">القسط {index + 1}: {entry.amount.toLocaleString()} {label}</p>
                      <p className="text-[11px] text-gray-500">{entry.paidAt ? `دُفع في ${entry.paidAt}` : `يستحق في ${entry.dueDate}`}</p>
                    </div>
                    <span className={`text-[10px] font-bold ${entry.paidAt ? 'text-green-700' : overdue ? 'text-red-700' : 'text-gray-500'}`}>
                      {entry.paidAt ? 'مدفوع' : overdue ? 'متأخر' : 'مجدول'}
                    </span>
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}
