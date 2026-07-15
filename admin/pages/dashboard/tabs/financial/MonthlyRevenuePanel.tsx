import { BarChart3 } from 'lucide-react';

interface MonthlyRevenuePanelProps {
  monthlyRevenue: [string, { online: number; manual: number }][];
}

export function MonthlyRevenuePanel({ monthlyRevenue }: MonthlyRevenuePanelProps) {
  const maxRevenue = Math.max(...monthlyRevenue.map(([, value]) => value.online + value.manual), 1);
  const totalLast12 = monthlyRevenue.reduce((sum, [, value]) => sum + value.online + value.manual, 0);
  const nonZeroMonths = monthlyRevenue.filter(([, value]) => value.online + value.manual > 0).length;

  return (
    <div className="space-y-4">
      <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <h4 className="font-bold text-gray-800 mb-1 flex items-center gap-2">
          <BarChart3 size={16} className="text-primary-600" />إيرادات آخر 12 شهر
        </h4>
        <p className="text-xs text-gray-400 mb-5">أونلاين (Paymob) + مدفوعات يدوية · بالجنيه المصري</p>
        <div className="space-y-2.5" dir="rtl">
          {monthlyRevenue.map(([month, { online, manual }]) => {
            const total = online + manual;
            const pctOnline = (online / maxRevenue) * 100;
            const pctManual = (manual / maxRevenue) * 100;
            return (
              <div key={month} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-20 flex-shrink-0 font-medium">{month}</span>
                <div className="flex-1 flex gap-0.5" dir="ltr">
                  <div className="h-6 bg-primary-500 rounded-r-sm transition-all" style={{ width: `${pctOnline}%`, minWidth: online > 0 ? 2 : 0 }} />
                  <div className="h-6 bg-amber-400 rounded-l-sm transition-all" style={{ width: `${pctManual}%`, minWidth: manual > 0 ? 2 : 0 }} />
                  {total === 0 && <div className="h-6 w-1 bg-gray-100 rounded" />}
                </div>
                <span className="text-xs font-bold text-gray-700 w-28 text-left flex-shrink-0">
                  {total > 0 ? `${total.toLocaleString('ar-EG')} ج.م` : '—'}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-primary-500 rounded-sm inline-block" />أونلاين</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-amber-400 rounded-sm inline-block" />يدوي</span>
        </div>
      </article>
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'إجمالي الـ12 شهر', val: totalLast12, color: 'bg-primary-50 text-primary-700 border-primary-200' },
          { label: 'متوسط شهري', val: nonZeroMonths > 0 ? Math.round(totalLast12 / nonZeroMonths) : 0, color: 'bg-amber-50 text-amber-700 border-amber-200' },
          { label: 'أعلى شهر', val: Math.max(...monthlyRevenue.map(([, value]) => value.online + value.manual)), color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
        ].map((card) => (
          <div key={card.label} className={`${card.color} rounded-xl p-4 border`}>
            <p className="text-xs opacity-70 mb-1">{card.label}</p>
            <p className="text-lg font-extrabold">{card.val.toLocaleString('ar-EG')} ج.م</p>
          </div>
        ))}
      </div>
    </div>
  );
}
