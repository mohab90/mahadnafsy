import { AlertCircle, CalendarDays, Plus, Trash2 } from 'lucide-react';
import type { Course, InstallmentEntry, InstallmentPlan, SubscriberItem } from '../../types';

interface UnifiedClientInstallmentsPanelProps {
  subscriber: SubscriberItem;
  plans: InstallmentPlan[];
  courses: Course[];
  todayStr: string;
  soon3Str: string;
  overdueCount: number;
  soonCount: number;
  payingEntryKey: string | null;
  payEntryAmount: string;
  payEntryDate: string;
  onAddPlan: () => void;
  onSetPayingEntryKey: (key: string | null) => void;
  onSetPayEntryAmount: (value: string) => void;
  onSetPayEntryDate: (value: string) => void;
  onPayEntry: (planId: string, entryId: string) => void;
  onDeletePlan: (planId: string) => void;
  onDeleteEntry: (planId: string, entryId: string) => void;
  onUpdateSubscriber: (subscriber: SubscriberItem) => void;
}

const currencyLabel = (currency: InstallmentPlan['currency']) =>
  currency === 'SAR' ? 'ر.س' : currency === 'USD' ? '$' : 'ج.م';

export function UnifiedClientInstallmentsPanel({
  subscriber,
  plans,
  courses,
  todayStr,
  soon3Str,
  overdueCount,
  soonCount,
  payingEntryKey,
  payEntryAmount,
  payEntryDate,
  onAddPlan,
  onSetPayingEntryKey,
  onSetPayEntryAmount,
  onSetPayEntryDate,
  onPayEntry,
  onDeletePlan,
  onDeleteEntry,
  onUpdateSubscriber,
}: UnifiedClientInstallmentsPanelProps) {
  return (
    <div id="section-installments" className="border-t-2 border-gray-100 pt-6 space-y-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-1 h-5 rounded-full bg-purple-500 flex-shrink-0" />
        <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-2 flex-1">
          <CalendarDays size={14} className="text-purple-500" /> خطط الأقساط
        </h3>
        {overdueCount > 0 && <span className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">{overdueCount} متأخر 🔴</span>}
        {overdueCount === 0 && soonCount > 0 && <span className="text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">{soonCount} قريباً ⚠️</span>}
      </div>

      {(overdueCount > 0 || soonCount > 0) && (
        <div className={`rounded-xl px-4 py-3 flex items-center gap-3 ${overdueCount > 0 ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
          <AlertCircle size={20} className={overdueCount > 0 ? 'text-red-500' : 'text-amber-500'} />
          <div>
            {overdueCount > 0 && <p className="font-bold text-red-700 text-sm">⚠️ {overdueCount} قسط متأخر — يستدعي متابعة فورية</p>}
            {soonCount > 0 && <p className="font-bold text-amber-700 text-sm">⏰ {soonCount} قسط مستحق خلال 3 أيام</p>}
          </div>
        </div>
      )}

      {plans.length > 0 && (() => {
        const allEntries = plans.flatMap(plan => plan.entries);
        const paidEntries = allEntries.filter(entry => entry.paidAt);
        const unpaidEntries = allEntries.filter(entry => !entry.paidAt);
        const totalExpected = plans.reduce((sum, plan) => sum + plan.totalAmount, 0);
        return (
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-purple-50 border border-purple-100 rounded-xl p-2.5 text-center">
              <p className="font-extrabold text-purple-700 text-lg">{plans.length}</p>
              <p className="text-[10px] text-gray-400">خطة</p>
            </div>
            <div className="bg-green-50 border border-green-100 rounded-xl p-2.5 text-center">
              <p className="font-extrabold text-green-700 text-lg">{paidEntries.length}</p>
              <p className="text-[10px] text-gray-400">مدفوع</p>
            </div>
            <div className={`border rounded-xl p-2.5 text-center ${unpaidEntries.filter(entry => entry.dueDate < todayStr).length > 0 ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
              <p className={`font-extrabold text-lg ${unpaidEntries.filter(entry => entry.dueDate < todayStr).length > 0 ? 'text-red-600' : 'text-gray-500'}`}>{unpaidEntries.length}</p>
              <p className="text-[10px] text-gray-400">متبقي</p>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-2.5 text-center">
              <p className="font-extrabold text-blue-700 text-sm">{totalExpected.toLocaleString()}</p>
              <p className="text-[10px] text-gray-400">إجمالي ج.م</p>
            </div>
          </div>
        );
      })()}

      <button
        onClick={onAddPlan}
        className="w-full py-3 border-2 border-dashed border-purple-200 rounded-xl text-purple-600 hover:bg-purple-50 text-sm flex items-center justify-center gap-2"
      >
        <Plus size={18} /> إضافة خطة أقساط جديدة
      </button>

      {plans.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <CalendarDays size={40} className="mx-auto mb-2 text-gray-200" />
          <p>لا توجد خطط أقساط</p>
          <p className="text-xs mt-1">أضف خطة أقساط لتتبع مواعيد الدفع</p>
        </div>
      ) : plans.map(plan => {
        const planCourse = courses.find(course => course.id === plan.courseId);
        const paidEntries = plan.entries.filter(entry => entry.paidAt);
        const unpaidEntries = plan.entries.filter(entry => !entry.paidAt).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        const totalPaid = paidEntries.reduce((sum, entry) => sum + (entry.paidAmount || entry.amount), 0);
        const totalRemaining = plan.totalAmount - totalPaid;
        const pct = plan.totalAmount > 0 ? Math.min(100, Math.round((totalPaid / plan.totalAmount) * 100)) : 0;
        const currLabel = currencyLabel(plan.currency);
        const hasOverdue = unpaidEntries.some(entry => entry.dueDate < todayStr);

        return (
          <div key={plan.id} className={`border rounded-2xl overflow-hidden shadow-sm ${hasOverdue ? 'border-red-200' : 'border-purple-100'}`}>
            <div className={`px-4 py-3 flex items-start justify-between gap-3 ${hasOverdue ? 'bg-red-50' : 'bg-purple-50'}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-extrabold text-gray-900 text-sm truncate">{plan.courseTitle || planCourse?.title || plan.courseId}</span>
                  {hasOverdue && <span className="text-[10px] font-black bg-red-100 text-red-700 px-2 py-0.5 rounded-full">🔴 متأخر</span>}
                  {!hasOverdue && pct < 100 && <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">جاري</span>}
                  {pct >= 100 && <span className="text-[10px] font-black bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✅ مكتمل</span>}
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">أُضيف في {plan.createdAt}</p>
              </div>
              <button onClick={() => onDeletePlan(plan.id)} className="text-red-400 hover:text-red-600 shrink-0">
                <Trash2 size={14} />
              </button>
            </div>

            <div className="px-4 pt-3 pb-1">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-500 font-medium">التقدم</span>
                <span className="font-bold text-gray-700">{pct}% — {totalPaid.toLocaleString()} {currLabel} من {plan.totalAmount.toLocaleString()}</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : pct >= 30 ? 'bg-amber-500' : 'bg-red-400'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-[10px] text-gray-400">
                <span>مدفوع: <span className="font-bold text-green-700">{totalPaid.toLocaleString()} {currLabel}</span></span>
                {totalRemaining > 0 && <span>متبقي: <span className="font-bold text-red-600">{totalRemaining.toLocaleString()} {currLabel}</span></span>}
                {plan.downPayment && <span>مقدم: <span className="font-bold">{plan.downPayment.toLocaleString()} {currLabel}</span></span>}
              </div>
            </div>

            <div className="px-4 pb-4 space-y-2 mt-2">
              {plan.entries.map((entry, index) => {
                const isPaid = !!entry.paidAt;
                const isOverdue = !isPaid && entry.dueDate < todayStr;
                const isSoon = !isPaid && entry.dueDate >= todayStr && entry.dueDate <= soon3Str;
                const payKey = `${plan.id}::${entry.id}`;
                const isPayingThis = payingEntryKey === payKey;
                return (
                  <div
                    key={entry.id}
                    className={`group rounded-xl border px-3 py-2.5 ${isPaid ? 'border-green-100 bg-green-50' : isOverdue ? 'border-red-200 bg-red-50' : isSoon ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-white'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-sm font-black w-6 h-6 rounded-full flex items-center justify-center text-[11px] flex-shrink-0 ${isPaid ? 'bg-green-200 text-green-800' : isOverdue ? 'bg-red-200 text-red-800' : 'bg-gray-100 text-gray-600'}`}>
                          {isPaid ? '✓' : index + 1}
                        </span>
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-gray-800 text-sm">{entry.amount.toLocaleString()} {currLabel}</span>
                            {isPaid && entry.paidAmount && entry.paidAmount !== entry.amount && (
                              <span className="text-[10px] text-green-700 font-bold">(دُفع {entry.paidAmount.toLocaleString()})</span>
                            )}
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isPaid ? 'bg-green-100 text-green-700' : isOverdue ? 'bg-red-100 text-red-700' : isSoon ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                              {isPaid ? '✅ مدفوع' : isOverdue ? '🔴 متأخر' : isSoon ? '🟡 قريب' : '📅'}
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-400">
                            {isOverdue ? `استحق في ${entry.dueDate}` : isPaid ? `دُفع في ${entry.paidAt}` : `يستحق في ${entry.dueDate}`}
                          </p>
                          {entry.note && <p className="text-[10px] text-gray-500 italic">{entry.note}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!isPaid && !isPayingThis && (
                          <button
                            onClick={() => {
                              onSetPayingEntryKey(payKey);
                              onSetPayEntryAmount(String(entry.amount));
                              onSetPayEntryDate(new Date().toISOString().slice(0, 10));
                            }}
                            className="px-2.5 py-1 bg-emerald-600 text-white text-[11px] font-bold rounded-lg hover:bg-emerald-700 transition"
                          >
                            تسجيل دفع
                          </button>
                        )}
                        {isPaid && (
                          <button
                            onClick={() => {
                              if (!window.confirm('إلغاء تأشير هذا القسط كمدفوع؟')) return;
                              const updatedPlans = (subscriber.installmentPlans || []).map(item =>
                                item.id !== plan.id ? item : { ...item, entries: item.entries.map(value => value.id !== entry.id ? value : { ...value, paidAt: undefined, paidAmount: undefined }) }
                              );
                              onUpdateSubscriber({ ...subscriber, installmentPlans: updatedPlans });
                            }}
                            className="opacity-0 group-hover:opacity-100 text-xs text-amber-500 hover:text-amber-700 transition-opacity"
                          >
                            تراجع
                          </button>
                        )}
                        <button onClick={() => onDeleteEntry(plan.id, entry.id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {isPayingThis && (
                      <div className="mt-2.5 pt-2.5 border-t border-gray-200 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-gray-500 block mb-0.5">المبلغ المدفوع</label>
                            <input
                              type="number"
                              min="1"
                              value={payEntryAmount}
                              onChange={event => onSetPayEntryAmount(event.target.value)}
                              className="w-full border border-gray-200 bg-white rounded-lg px-2 py-1.5 text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 block mb-0.5">تاريخ الدفع</label>
                            <input
                              type="date"
                              value={payEntryDate}
                              onChange={event => onSetPayEntryDate(event.target.value)}
                              className="w-full border border-gray-200 bg-white rounded-lg px-2 py-1.5 text-sm"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => onPayEntry(plan.id, entry.id)}
                            disabled={!payEntryAmount || Number(payEntryAmount) <= 0}
                            className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 disabled:opacity-40"
                          >
                            ✅ تأكيد الدفع
                          </button>
                          <button onClick={() => onSetPayingEntryKey(null)} className="flex-1 py-2 bg-gray-200 text-gray-600 rounded-lg text-xs">إلغاء</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                onClick={() => {
                  const lastEntry = plan.entries[plan.entries.length - 1];
                  const lastDate = lastEntry ? new Date(lastEntry.dueDate) : new Date();
                  const nextDate = new Date(lastDate);
                  nextDate.setDate(nextDate.getDate() + 30);
                  const newEntry: InstallmentEntry = {
                    id: `ie-${Date.now()}`,
                    amount: 0,
                    currency: plan.currency,
                    dueDate: nextDate.toISOString().slice(0, 10),
                  };
                  const updatedPlans = (subscriber.installmentPlans || []).map(item =>
                    item.id !== plan.id ? item : { ...item, entries: [...item.entries, newEntry] }
                  );
                  onUpdateSubscriber({ ...subscriber, installmentPlans: updatedPlans });
                }}
                className="w-full py-2 border border-dashed border-purple-200 rounded-xl text-purple-600 hover:bg-purple-50 text-xs flex items-center justify-center gap-1"
              >
                <Plus size={12} /> إضافة قسط إضافي
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
