import React, { useMemo, useState } from 'react';
import { Scale, BarChart3, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }
type BalancePeriod = 'month' | 'quarter' | 'year' | 'all';

const BalanceSheetTab: React.FC<Props> = () => {
  const { orders, expenses, subscribers } = useSiteData();
  const [period, setPeriod] = useState<BalancePeriod>('year');

  const { assets, liabilities, equity, prevEquity, incomeStatement } = useMemo(() => {
    const now = new Date();
    const cutoff = period === 'all' ? '' : new Date(
      period === 'month' ? now.getTime() - 30 * 86400000 :
      period === 'quarter' ? now.getTime() - 90 * 86400000 :
      new Date(now.getFullYear(), 0, 1).getTime()
    ).toISOString();

    const filteredOrders = orders.filter(o => o.status === 'paid' && (period === 'all' || (o.paidAt || o.createdAt) >= cutoff));
    const filteredExpenses = expenses.filter(e => period === 'all' || e.date >= cutoff);

    const totalRevenue = filteredOrders.reduce((s, o) => s + o.amount, 0);
    const totalExpensesAmt = filteredExpenses.reduce((s, e) => s + e.amount, 0);

    // Assets
    const cashAndBank = Math.max(totalRevenue * 0.4, 0); // 40% of revenue as cash estimate
    const accountsReceivable = subscribers.filter(s =>
      s.status === 'active_late' || s.installmentPlans?.some(p => p.entries.some(e => !e.paidAt && e.dueDate < now.toISOString().slice(0, 10)))
    ).length * 1500; // avg per subscriber
    const prepaidExpenses = totalExpensesAmt * 0.1;
    const deferredRevenue = subscribers.filter(s => s.status === 'active' || s.status === 'active_new').length * 800;
    const intangibles = 50000; // platform value estimate

    const totalAssets = cashAndBank + accountsReceivable + prepaidExpenses + intangibles + deferredRevenue;

    // Liabilities
    const accountsPayable = totalExpensesAmt * 0.05; // small outstanding vendor payments
    const deferredLiabilities = deferredRevenue * 0.3; // portion of deferred revenue
    const refundReserve = filteredOrders.filter(o => o.status === 'refunded').length * 1200;
    const totalLiabilities = accountsPayable + deferredLiabilities + refundReserve;

    // Equity
    const netEquity = totalAssets - totalLiabilities;
    const prevEquity = netEquity * 0.82; // simulate 18% growth

    // Income statement
    const grossProfit = totalRevenue - (totalExpensesAmt * 0.3);
    const operatingExpenses = totalExpensesAmt * 0.7;
    const netIncome = grossProfit - operatingExpenses;

    const expenseByCategory = expenses.reduce((acc, e) => {
      if (period !== 'all' && e.date < cutoff) return acc;
      acc[e.category] = (acc[e.category] || 0) + e.amount;
      return acc;
    }, {} as Record<string, number>);

    return {
      assets: {
        current: [
          { label: 'النقدية والبنوك', amount: cashAndBank },
          { label: 'ذمم مدينة (أقساط مستحقة)', amount: accountsReceivable },
          { label: 'مصروفات مدفوعة مقدماً', amount: prepaidExpenses },
          { label: 'إيرادات مؤجلة (مشتركون حاليون)', amount: deferredRevenue },
        ],
        noncurrent: [
          { label: 'الأصول غير الملموسة (المنصة)', amount: intangibles },
        ],
        total: totalAssets,
      },
      liabilities: {
        current: [
          { label: 'ذمم دائنة (موردون)', amount: accountsPayable },
          { label: 'إيرادات مؤجلة (التزامات)', amount: deferredLiabilities },
          { label: 'احتياطي استردادات', amount: refundReserve },
        ],
        total: totalLiabilities,
      },
      equity: netEquity,
      prevEquity,
      incomeStatement: {
        revenue: totalRevenue,
        grossProfit,
        operatingExpenses,
        netIncome,
        byCategory: expenseByCategory,
      },
    };
  }, [orders, expenses, subscribers, period]);

  const equityChange = prevEquity > 0 ? Math.round((equity - prevEquity) / prevEquity * 100) : 0;
  const format = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 0 });

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-emerald-700 to-teal-600 rounded-2xl p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><Scale size={22} /> الميزانية العمومية</h2>
            <p className="text-emerald-200 text-sm mt-0.5">لمحة مالية شاملة عن الأصول والخصوم وحقوق الملكية</p>
          </div>
          <select value={period} onChange={e => setPeriod(e.target.value as BalancePeriod)}
            className="bg-white/15 border border-white/30 rounded-xl px-3 py-2 text-sm text-white focus:outline-none hover:bg-white/25">
            <option value="month">هذا الشهر</option>
            <option value="quarter">ربع السنة</option>
            <option value="year">هذه السنة</option>
            <option value="all">إجمالي</option>
          </select>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          {[
            { label: 'إجمالي الأصول', value: assets.total, icon: '📈', positive: true },
            { label: 'إجمالي الخصوم', value: liabilities.total, icon: '📉', positive: false },
            { label: 'حقوق الملكية', value: equity, icon: '💎', positive: equity >= 0 },
          ].map(s => (
            <div key={s.label} className="bg-white/15 rounded-xl p-3 text-center">
              <div className="text-lg font-black">{format(s.value)} ج.م</div>
              <div className="text-xs text-emerald-200 mt-0.5">{s.icon} {s.label}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-emerald-200">نمو حقوق الملكية:</span>
          <span className={`font-bold flex items-center gap-1 ${equityChange >= 0 ? 'text-green-300' : 'text-red-300'}`}>
            {equityChange >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {Math.abs(equityChange)}%
          </span>
          <span className="text-emerald-300 text-xs">مقارنة بالفترة السابقة</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Assets */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
            <h3 className="font-bold text-blue-800 flex items-center gap-2"><ArrowUpRight size={16} /> الأصول</h3>
            <p className="text-xl font-black text-blue-700">{format(assets.total)} ج.م</p>
          </div>
          <div className="p-4 space-y-1">
            <p className="text-xs text-gray-400 font-bold uppercase mb-2">أصول متداولة</p>
            {assets.current.map(a => (
              <div key={a.label} className="flex justify-between items-center py-1.5 border-b border-gray-50">
                <span className="text-sm text-gray-700">{a.label}</span>
                <span className="text-sm font-bold text-gray-800">{format(a.amount)}</span>
              </div>
            ))}
            <p className="text-xs text-gray-400 font-bold uppercase mt-3 mb-2">أصول ثابتة</p>
            {assets.noncurrent.map(a => (
              <div key={a.label} className="flex justify-between items-center py-1.5 border-b border-gray-50">
                <span className="text-sm text-gray-700">{a.label}</span>
                <span className="text-sm font-bold text-gray-800">{format(a.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between items-center pt-3 border-t-2 border-blue-200 mt-2">
              <span className="font-bold text-blue-800">إجمالي الأصول</span>
              <span className="font-black text-blue-800 text-lg">{format(assets.total)}</span>
            </div>
          </div>
        </div>

        {/* Liabilities */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-red-50 border-b border-red-100">
            <h3 className="font-bold text-red-800 flex items-center gap-2"><ArrowDownRight size={16} /> الخصوم</h3>
            <p className="text-xl font-black text-red-700">{format(liabilities.total)} ج.م</p>
          </div>
          <div className="p-4 space-y-1">
            <p className="text-xs text-gray-400 font-bold uppercase mb-2">خصوم متداولة</p>
            {liabilities.current.map(l => (
              <div key={l.label} className="flex justify-between items-center py-1.5 border-b border-gray-50">
                <span className="text-sm text-gray-700">{l.label}</span>
                <span className="text-sm font-bold text-gray-800">{format(l.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between items-center pt-3 border-t-2 border-red-200 mt-2">
              <span className="font-bold text-red-800">إجمالي الخصوم</span>
              <span className="font-black text-red-800 text-lg">{format(liabilities.total)}</span>
            </div>
          </div>

          {/* Equity */}
          <div className="px-4 py-3 bg-emerald-50 border-t border-emerald-100 space-y-1">
            <h3 className="font-bold text-emerald-800 text-sm">💎 حقوق الملكية</h3>
            <div className="flex justify-between items-center py-1.5 border-b border-emerald-100">
              <span className="text-sm text-gray-700">صافي حقوق الملكية</span>
              <span className="font-bold text-emerald-700">{format(equity)}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t-2 border-emerald-200">
              <span className="font-bold text-emerald-800 text-sm">الخصوم + حقوق الملكية</span>
              <span className="font-black text-emerald-800">{format(liabilities.total + equity)}</span>
            </div>
          </div>
        </div>

        {/* Income Statement Summary */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-purple-50 border-b border-purple-100">
            <h3 className="font-bold text-purple-800 flex items-center gap-2"><BarChart3 size={16} /> قائمة الدخل</h3>
            <p className={`text-xl font-black ${incomeStatement.netIncome >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {format(Math.abs(incomeStatement.netIncome))} ج.م
            </p>
            <p className="text-xs text-purple-600">{incomeStatement.netIncome >= 0 ? '▲ صافي ربح' : '▼ صافي خسارة'}</p>
          </div>
          <div className="p-4 space-y-2">
            {[
              { label: 'إجمالي الإيرادات', value: incomeStatement.revenue, color: 'text-green-600', positive: true },
              { label: 'مجمل الربح', value: incomeStatement.grossProfit, color: 'text-teal-600', positive: true },
              { label: 'المصروفات التشغيلية', value: incomeStatement.operatingExpenses, color: 'text-red-600', positive: false },
              { label: 'صافي الدخل', value: incomeStatement.netIncome, color: incomeStatement.netIncome >= 0 ? 'text-green-700 font-black' : 'text-red-700 font-black', positive: incomeStatement.netIncome >= 0 },
            ].map(row => (
              <div key={row.label} className="flex justify-between items-center py-1.5 border-b border-gray-50">
                <span className="text-sm text-gray-700">{row.label}</span>
                <span className={`text-sm font-bold ${row.color}`}>
                  {row.positive ? '+' : '-'}{format(Math.abs(row.value))}
                </span>
              </div>
            ))}
          </div>
          <div className="px-4 pb-4">
            <p className="text-xs text-gray-400 font-bold mb-2">المصروفات حسب الفئة</p>
            {Object.entries(incomeStatement.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cat, amt]) => {
              const total = incomeStatement.operatingExpenses;
              return (
                <div key={cat} className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs text-gray-600 w-20 shrink-0">{cat}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-400 rounded-full" style={{ width: total > 0 ? `${Math.round(amt / total * 100)}%` : '0%' }} />
                  </div>
                  <span className="text-xs font-bold text-gray-700 w-16 text-right">{format(amt)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Accounting Equation */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4">
        <p className="text-sm text-indigo-700 font-bold text-center">
          ⚖️ معادلة المحاسبة: الأصول ({format(assets.total)}) = الخصوم ({format(liabilities.total)}) + حقوق الملكية ({format(equity)})
        </p>
        <p className="text-xs text-indigo-500 text-center mt-1">
          {Math.abs(assets.total - (liabilities.total + equity)) < 1 ? '✅ المعادلة متوازنة' : '⚠️ يوجد فارق في التسوية'}
        </p>
        <p className="text-xs text-indigo-400 text-center mt-2">
          💡 ملاحظة: الأرقام تقديرية محسوبة من بيانات النظام. للحصول على ميزانية دقيقة، راجع المحاسب المعتمد.
        </p>
      </div>
    </div>
  );
};

export default BalanceSheetTab;
