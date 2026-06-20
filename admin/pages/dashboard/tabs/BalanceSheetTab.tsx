import React, { useState, useEffect } from 'react';
import { Scale, BarChart3, ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

type AccountRow = {
  account_code: string;
  account_name: string;
  total_debit: number;
  total_credit: number;
  balance: number;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'other';
};

type TrialBalanceData = {
  period: { from: string; to: string };
  accounts: AccountRow[];
  totals: { debit: number; credit: number; balanced: boolean };
};

const BalanceSheetTab: React.FC<Props> = ({ notify }) => {
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year' | 'all'>('year');
  const [data, setData] = useState<TrialBalanceData | null>(null);
  const [loading, setLoading] = useState(false);

  const getDateRange = (p: typeof period) => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (p === 'month') return { from: new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10), to: today };
    if (p === 'quarter') return { from: new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10), to: today };
    if (p === 'year') return { from: `${now.getFullYear()}-01-01`, to: today };
    return { from: '2020-01-01', to: today };
  };

  useEffect(() => {
    const { from, to } = getDateRange(period);
    setLoading(true);
    mysqlAdmin.adminGet<TrialBalanceData>(`/api/admin/reports/trial-balance?from=${from}&to=${to}`)
      .then(setData)
      .catch(() => notify('error', 'فشل تحميل بيانات الميزانية'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const fmt = (n: number) => Math.abs(n).toLocaleString('ar-EG', { maximumFractionDigits: 0 });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={36} className="animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-16 text-sm text-gray-400">
        <p>لم يتم تحميل البيانات بعد</p>
        <button onClick={() => setPeriod(p => p)} className="mt-3 px-4 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm hover:bg-gray-200">
          إعادة المحاولة
        </button>
      </div>
    );
  }

  const assets = data.accounts.filter(a => a.type === 'asset');
  const liabilities = data.accounts.filter(a => a.type === 'liability');
  const equityAccounts = data.accounts.filter(a => a.type === 'equity');
  const revenues = data.accounts.filter(a => a.type === 'revenue');
  const expenses = data.accounts.filter(a => a.type === 'expense');

  const totalAssets = assets.reduce((s, a) => s + Math.max(a.balance, 0), 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + Math.max(-a.balance, 0), 0);
  const totalEquityBase = equityAccounts.reduce((s, a) => s + Math.max(-a.balance, 0), 0);
  const totalRevenue = revenues.reduce((s, a) => s + Math.max(-a.balance, 0), 0);
  const totalExpenses = expenses.reduce((s, a) => s + Math.max(a.balance, 0), 0);
  const netIncome = totalRevenue - totalExpenses;
  const totalEquity = totalEquityBase + Math.max(netIncome, 0);

  const hasEntries = data.accounts.length > 0;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-emerald-700 to-teal-600 rounded-2xl p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><Scale size={22} /> الميزانية العمومية</h2>
            <p className="text-emerald-200 text-sm mt-0.5">
              بيانات فعلية من دفتر اليومية — {data.period.from} إلى {data.period.to}
            </p>
          </div>
          <select value={period} onChange={e => setPeriod(e.target.value as typeof period)}
            className="bg-white/15 border border-white/30 rounded-xl px-3 py-2 text-sm text-white focus:outline-none hover:bg-white/25">
            <option value="month">هذا الشهر</option>
            <option value="quarter">ربع السنة</option>
            <option value="year">هذه السنة</option>
            <option value="all">إجمالي</option>
          </select>
        </div>

        {hasEntries ? (
          <>
            <div className="grid grid-cols-3 gap-3 mt-4">
              {[
                { label: 'إجمالي الأصول', value: totalAssets, icon: '📈' },
                { label: 'إجمالي الخصوم', value: totalLiabilities, icon: '📉' },
                { label: 'حقوق الملكية', value: totalEquity, icon: '💎' },
              ].map(s => (
                <div key={s.label} className="bg-white/15 rounded-xl p-3 text-center">
                  <div className="text-lg font-black">{fmt(s.value)} ج.م</div>
                  <div className="text-xs text-emerald-200 mt-0.5">{s.icon} {s.label}</div>
                </div>
              ))}
            </div>
            {data.totals.balanced && (
              <p className="text-xs text-emerald-300 text-center mt-3">
                ✅ دفتر اليومية متوازن — {fmt(data.totals.debit)} ج.م مدين = دائن
              </p>
            )}
          </>
        ) : (
          <div className="mt-4 bg-white/10 rounded-xl p-4 text-center text-emerald-100 text-sm">
            لا توجد قيود يومية في هذه الفترة — سيتم تحديث البيانات تلقائياً مع تسجيل المدفوعات
          </div>
        )}
      </div>

      {hasEntries && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Assets */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
                <h3 className="font-bold text-blue-800 flex items-center gap-2"><ArrowUpRight size={16} /> الأصول</h3>
                <p className="text-xl font-black text-blue-700">{fmt(totalAssets)} ج.م</p>
              </div>
              <div className="p-4 space-y-1">
                {assets.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">لا توجد حسابات أصول</p>
                ) : assets.map(a => (
                  <div key={a.account_code} className="flex justify-between items-center py-1.5 border-b border-gray-50">
                    <div>
                      <span className="text-sm text-gray-700">{a.account_name}</span>
                      <span className="text-xs text-gray-400 mr-1">({a.account_code})</span>
                    </div>
                    <span className="text-sm font-bold text-gray-800">{fmt(a.balance)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-3 border-t-2 border-blue-200 mt-2">
                  <span className="font-bold text-blue-800">إجمالي الأصول</span>
                  <span className="font-black text-blue-800 text-lg">{fmt(totalAssets)}</span>
                </div>
              </div>
            </div>

            {/* Liabilities + Equity */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-red-50 border-b border-red-100">
                <h3 className="font-bold text-red-800 flex items-center gap-2"><ArrowDownRight size={16} /> الخصوم</h3>
                <p className="text-xl font-black text-red-700">{fmt(totalLiabilities)} ج.م</p>
              </div>
              <div className="p-4 space-y-1">
                {liabilities.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">لا توجد حسابات خصوم</p>
                ) : liabilities.map(l => (
                  <div key={l.account_code} className="flex justify-between items-center py-1.5 border-b border-gray-50">
                    <div>
                      <span className="text-sm text-gray-700">{l.account_name}</span>
                      <span className="text-xs text-gray-400 mr-1">({l.account_code})</span>
                    </div>
                    <span className="text-sm font-bold text-gray-800">{fmt(-l.balance)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-3 border-t-2 border-red-200 mt-2">
                  <span className="font-bold text-red-800">إجمالي الخصوم</span>
                  <span className="font-black text-red-800 text-lg">{fmt(totalLiabilities)}</span>
                </div>
              </div>

              <div className="px-4 py-3 bg-emerald-50 border-t border-emerald-100 space-y-1">
                <h3 className="font-bold text-emerald-800 text-sm">💎 حقوق الملكية</h3>
                {equityAccounts.map(e => (
                  <div key={e.account_code} className="flex justify-between items-center py-1.5 border-b border-emerald-100">
                    <span className="text-sm text-gray-700">{e.account_name}</span>
                    <span className="font-bold text-emerald-700">{fmt(-e.balance)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center py-1.5 border-b border-emerald-100">
                  <span className="text-sm text-gray-700">الأرباح المحتجزة</span>
                  <span className={`font-bold ${netIncome >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {netIncome >= 0 ? '+' : '-'}{fmt(Math.abs(netIncome))}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t-2 border-emerald-200">
                  <span className="font-bold text-emerald-800 text-sm">الخصوم + حقوق الملكية</span>
                  <span className="font-black text-emerald-800">{fmt(totalLiabilities + totalEquity)}</span>
                </div>
              </div>
            </div>

            {/* Income Statement */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-purple-50 border-b border-purple-100">
                <h3 className="font-bold text-purple-800 flex items-center gap-2"><BarChart3 size={16} /> قائمة الدخل</h3>
                <p className={`text-xl font-black ${netIncome >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {fmt(Math.abs(netIncome))} ج.م
                </p>
                <p className="text-xs text-purple-600">{netIncome >= 0 ? '▲ صافي ربح' : '▼ صافي خسارة'}</p>
              </div>
              <div className="p-4 space-y-1.5">
                <div className="flex justify-between items-center py-1.5 border-b border-gray-50">
                  <span className="text-sm text-gray-700">إجمالي الإيرادات</span>
                  <span className="text-sm font-bold text-green-600">+{fmt(totalRevenue)}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-gray-50">
                  <span className="text-sm text-gray-700">إجمالي المصروفات</span>
                  <span className="text-sm font-bold text-red-600">-{fmt(totalExpenses)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-t-2 border-purple-200 mt-2">
                  <span className="font-bold text-purple-800">صافي الدخل</span>
                  <span className={`font-black text-lg ${netIncome >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {netIncome >= 0 ? '+' : '-'}{fmt(Math.abs(netIncome))}
                  </span>
                </div>
              </div>

              {revenues.length > 0 && (
                <div className="px-4 pb-3">
                  <p className="text-xs text-gray-400 font-bold mb-2">الإيرادات حسب الحساب</p>
                  {revenues.map(r => {
                    const pct = totalRevenue > 0 ? Math.round(-r.balance / totalRevenue * 100) : 0;
                    return (
                      <div key={r.account_code} className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs text-gray-600 w-28 shrink-0 truncate">{r.account_name}</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-green-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-bold text-gray-700 w-16 text-right">{fmt(-r.balance)}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {expenses.length > 0 && (
                <div className="px-4 pb-4">
                  <p className="text-xs text-gray-400 font-bold mb-2">المصروفات حسب الحساب</p>
                  {expenses.slice(0, 6).map(e => {
                    const pct = totalExpenses > 0 ? Math.round(e.balance / totalExpenses * 100) : 0;
                    return (
                      <div key={e.account_code} className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs text-gray-600 w-28 shrink-0 truncate">{e.account_name}</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-red-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-bold text-gray-700 w-16 text-right">{fmt(e.balance)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Accounting Equation */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4">
            <p className="text-sm text-indigo-700 font-bold text-center">
              ⚖️ معادلة المحاسبة: الأصول ({fmt(totalAssets)}) = الخصوم ({fmt(totalLiabilities)}) + حقوق الملكية ({fmt(totalEquity)})
            </p>
            <p className="text-xs text-indigo-500 text-center mt-1">
              {Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 1
                ? '✅ المعادلة متوازنة'
                : `⚠️ فارق ${fmt(Math.abs(totalAssets - (totalLiabilities + totalEquity)))} ج.م — يومية التسوية غير مكتملة`}
            </p>
            {!data.totals.balanced && (
              <p className="text-xs text-orange-500 text-center mt-1">
                ⚠️ دفتر اليومية غير متوازن — مجموع المدين والدائن يختلفان
              </p>
            )}
            <p className="text-xs text-indigo-400 text-center mt-2">
              📊 البيانات من قيود اليومية المزدوجة الفعلية — {data.period.from} إلى {data.period.to}
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default BalanceSheetTab;
