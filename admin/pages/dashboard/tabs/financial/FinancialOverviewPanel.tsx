import React from 'react';
import {
  ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays, CreditCard, Download,
  FileText, Percent, Receipt, TrendingDown, TrendingUp, Wallet,
} from 'lucide-react';
import type { FinancialSubTab } from './financialTabUtils';

type RevenueByType = {
  course: number;
  bundle: number;
  consultation: number;
  certificate: number;
  book: number;
  carneh: number;
  other: number;
};

type RevenueByCourse = {
  id: string;
  title: string;
  online: number;
  manual: number;
  total: number;
};

interface Props {
  globalDateFrom: string;
  setGlobalDateFrom: React.Dispatch<React.SetStateAction<string>>;
  globalDateTo: string;
  setGlobalDateTo: React.Dispatch<React.SetStateAction<string>>;
  isGlobalFiltered: boolean;
  exportFullReport: () => void;
  exportPaymentsExcel: () => void;
  exportExpensesPDF: () => void;
  gRevenue: number;
  gExpenses: number;
  gProfit: number;
  gMargin: number;
  totalRevenueEGP: number;
  totalExpensesEGP: number;
  netProfitEGP: number;
  profitMargin: number;
  revenueByType: RevenueByType;
  expenseByCategory: Record<string, number>;
  vaultMonth: string;
  setVaultMonth: React.Dispatch<React.SetStateAction<string>>;
  currentMonth: string;
  onlineRevenueFiltered: number;
  revenueByMethodFiltered: Record<string, number>;
  setFinancialSubTab: React.Dispatch<React.SetStateAction<FinancialSubTab>>;
  setOrderMethodFilter: React.Dispatch<React.SetStateAction<string>>;
  isMethodsEditing: boolean;
  setIsMethodsEditing: React.Dispatch<React.SetStateAction<boolean>>;
  paymentMethods: string[];
  savePaymentMethods: (methods: string[]) => void;
  newMethodDraft: string;
  setNewMethodDraft: React.Dispatch<React.SetStateAction<string>>;
  revenueByCourse: RevenueByCourse[];
  exportCSV: (filename: string, rows: string[][], headers: string[]) => void;
}

export function FinancialOverviewPanel({
  globalDateFrom,
  setGlobalDateFrom,
  globalDateTo,
  setGlobalDateTo,
  isGlobalFiltered,
  exportFullReport,
  exportPaymentsExcel,
  exportExpensesPDF,
  gRevenue,
  gExpenses,
  gProfit,
  gMargin,
  totalRevenueEGP,
  totalExpensesEGP,
  netProfitEGP,
  profitMargin,
  revenueByType,
  expenseByCategory,
  vaultMonth,
  setVaultMonth,
  currentMonth,
  onlineRevenueFiltered,
  revenueByMethodFiltered,
  setFinancialSubTab,
  setOrderMethodFilter,
  isMethodsEditing,
  setIsMethodsEditing,
  paymentMethods,
  savePaymentMethods,
  newMethodDraft,
  setNewMethodDraft,
  revenueByCourse,
  exportCSV,
}: Props) {
  return (
  <div className="space-y-5">
            {/* ── Date range filter ── */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center gap-3" dir="rtl">
              <CalendarDays size={16} className="text-primary-600 flex-shrink-0" />
              <span className="text-sm font-bold text-gray-700">فلتر الفترة الزمنية:</span>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs text-gray-500">من</label>
                <input type="date" value={globalDateFrom} onChange={e => setGlobalDateFrom(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-700" />
                <label className="text-xs text-gray-500">إلى</label>
                <input type="date" value={globalDateTo} onChange={e => setGlobalDateTo(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-700" />
                {isGlobalFiltered && (
                  <button onClick={() => { setGlobalDateFrom(''); setGlobalDateTo(''); }}
                    className="text-xs text-red-500 hover:text-red-700 font-bold border border-red-200 rounded-lg px-2 py-1 hover:bg-red-50 transition">
                    مسح الفلتر
                  </button>
                )}
              </div>
              {isGlobalFiltered && (
                <span className="text-xs text-primary-600 font-bold bg-primary-50 border border-primary-200 rounded-lg px-2 py-1 mr-auto">
                  عرض نتائج مفلترة
                </span>
              )}
            </div>
  
            {/* ── Export Toolbar ── */}
            <div className="flex flex-wrap items-center gap-2" dir="rtl">
              <span className="text-xs font-bold text-gray-500 ml-1">تصدير التقارير:</span>
              <button onClick={exportFullReport}
                className="flex items-center gap-1.5 text-xs font-bold text-gray-600 hover:text-gray-800 border border-gray-300 hover:bg-gray-50 rounded-lg px-3 py-1.5 transition">
                <Download size={13} /> CSV شامل
              </button>
              <button onClick={exportPaymentsExcel}
                className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-900 border border-emerald-300 hover:bg-emerald-50 rounded-lg px-3 py-1.5 transition">
                <FileText size={13} /> Excel — المدفوعات
              </button>
              <button onClick={exportExpensesPDF}
                className="flex items-center gap-1.5 text-xs font-bold text-red-600 hover:text-red-800 border border-red-300 hover:bg-red-50 rounded-lg px-3 py-1.5 transition">
                <FileText size={13} /> PDF — المصروفات
              </button>
            </div>
  
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { lbl: 'إجمالي الإيرادات', val: (isGlobalFiltered ? gRevenue : totalRevenueEGP).toLocaleString('ar-EG-u-nu-latn') + ' ج.م', icon: ArrowUpRight, bg: 'bg-emerald-50', txt: 'text-emerald-700', br: 'border-emerald-200' },
                { lbl: 'إجمالي المصروفات', val: (isGlobalFiltered ? gExpenses : totalExpensesEGP).toLocaleString('ar-EG-u-nu-latn') + ' ج.م', icon: ArrowDownRight, bg: 'bg-red-50', txt: 'text-red-700', br: 'border-red-200' },
                { lbl: 'صافي الربح', val: (isGlobalFiltered ? gProfit : netProfitEGP).toLocaleString('ar-EG-u-nu-latn') + ' ج.م', icon: TrendingUp, bg: (isGlobalFiltered ? gProfit : netProfitEGP) >= 0 ? 'bg-blue-50' : 'bg-orange-50', txt: (isGlobalFiltered ? gProfit : netProfitEGP) >= 0 ? 'text-blue-700' : 'text-orange-700', br: (isGlobalFiltered ? gProfit : netProfitEGP) >= 0 ? 'border-blue-200' : 'border-orange-200' },
                { lbl: 'هامش الربح', val: (isGlobalFiltered ? gMargin : profitMargin) + '%', icon: Percent, bg: 'bg-violet-50', txt: 'text-violet-700', br: 'border-violet-200' },
              ].map(c => { const Ic = c.icon; return (
                <article key={c.lbl} className={`${c.bg} border ${c.br} rounded-2xl p-4 flex items-center gap-3 shadow-sm`}>
                  <div className={`w-10 h-10 rounded-xl ${c.bg} border ${c.br} flex items-center justify-center flex-shrink-0`}><Ic size={20} className={c.txt} /></div>
                  <div><p className="text-xs text-gray-500">{c.lbl}</p><p className={`text-xl font-extrabold ${c.txt}`}>{c.val}</p></div>
                </article>
              );})}
            </div>
            {/* Revenue breakdown bars */}
            <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Receipt size={16} className="text-primary-600" />توزيع الإيرادات حسب النوع</h4>
              <div className="space-y-3">
                {([['كورسات', revenueByType.course, 'bg-primary-500'],['مسارات', revenueByType.bundle, 'bg-emerald-500'],['استشارات', revenueByType.consultation, 'bg-amber-500'],['شهادات', revenueByType.certificate, 'bg-orange-500'],['كتب', revenueByType.book, 'bg-teal-500'],['كارنيهات', revenueByType.carneh, 'bg-indigo-500'],['أخرى', revenueByType.other, 'bg-gray-400']] as [string, number, string][]).filter(([,v]) => v > 0).map(([lbl, val, color]) => {
                  const pct = totalRevenueEGP > 0 ? Math.round((val / totalRevenueEGP) * 100) : 0;
                  return (
                    <div key={lbl}>
                      <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">{lbl}</span><span className="text-gray-500">{val.toLocaleString('ar-EG-u-nu-latn')} ج.م ({pct}%)</span></div>
                      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            </article>
            {/* Expense breakdown */}
            <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><TrendingDown size={16} className="text-red-500" />توزيع المصروفات حسب الفئة</h4>
              {Object.keys(expenseByCategory).length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">لا توجد مصروفات مسجّلة بعد</p>
              ) : (
                <div className="space-y-3">
                  {(Object.entries(expenseByCategory) as [string, number][]).sort((a,b)=>b[1]-a[1]).map(([cat, val]) => {
                    const pct = totalExpensesEGP > 0 ? Math.round((val / totalExpensesEGP) * 100) : 0;
                    return (
                      <div key={cat}>
                        <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">{cat}</span><span className="text-gray-500">{val.toLocaleString()} ج.م ({pct}%)</span></div>
                        <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-red-400 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
            {/* Payment method breakdown */}
            <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                <h4 className="font-bold text-gray-800 flex items-center gap-2"><Wallet size={16} className="text-primary-600" />الخزنة ووسائل الدفع</h4>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 font-bold">الشهر:</label>
                  <input type="month" value={vaultMonth} onChange={e => setVaultMonth(e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-700" />
                  {vaultMonth !== currentMonth && (
                    <button onClick={() => setVaultMonth(currentMonth)} className="text-xs text-primary-600 hover:underline">الشهر الحالي</button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {/* Online Paymob card — filtered by month */}
                {onlineRevenueFiltered > 0 && (
                  <button
                    onClick={() => { setFinancialSubTab('orders'); setOrderMethodFilter('__online_paymob__'); }}
                    className="bg-blue-50 border border-blue-200 hover:border-blue-400 hover:bg-blue-100 rounded-2xl p-4 text-right transition group">
                    <p className="text-xs text-blue-600 font-bold mb-1">🌐 أونلاين (Paymob)</p>
                    <p className="text-xl font-extrabold text-blue-800">{Math.round(onlineRevenueFiltered).toLocaleString('ar-EG-u-nu-latn')} ج.م</p>
                    <p className="text-[10px] text-blue-500 mt-1 group-hover:text-blue-700">بطاقة / محفظة ← اضغط للتفاصيل</p>
                  </button>
                )}
                {/* Manual payment channels — filtered by month */}
                {(Object.entries(revenueByMethodFiltered) as [string, number][]).sort((a,b)=>b[1]-a[1]).map(([method, total]) => (
                  <button key={method}
                    onClick={() => { setFinancialSubTab('orders'); setOrderMethodFilter(method); }}
                    className="bg-emerald-50 border border-emerald-200 hover:border-emerald-400 hover:bg-emerald-100 rounded-2xl p-4 text-right transition group">
                    <p className="text-xs text-emerald-600 font-bold mb-1">{method}</p>
                    <p className="text-xl font-extrabold text-emerald-800">{Math.round(total).toLocaleString('ar-EG-u-nu-latn')} ج.م</p>
                    <p className="text-[10px] text-emerald-500 mt-1 group-hover:text-emerald-700">اضغط لعرض التفاصيل ←</p>
                  </button>
                ))}
                {onlineRevenueFiltered === 0 && Object.keys(revenueByMethodFiltered).length === 0 && (
                  <p className="col-span-3 text-sm text-gray-400 text-center py-4">لا توجد مدفوعات في {vaultMonth}</p>
                )}
              </div>
            </article>
  
            {/* ── Manage Payment Methods ── */}
            <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-bold text-gray-800 flex items-center gap-2"><CreditCard size={16} className="text-primary-600" />إدارة وسائل الدفع والخزن</h4>
                <button onClick={() => setIsMethodsEditing(v => !v)}
                  className={`text-sm font-bold px-3 py-1.5 rounded-xl transition ${isMethodsEditing ? 'bg-gray-200 text-gray-700' : 'bg-primary-600 text-white hover:bg-primary-700'}`}>
                  {isMethodsEditing ? 'إغلاق' : '+ تعديل / إضافة'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {paymentMethods.map(m => (
                  <div key={m} className="flex items-center gap-1 bg-gray-100 rounded-xl px-3 py-1.5 text-sm font-bold text-gray-700">
                    {m}
                    {isMethodsEditing && (
                      <button onClick={() => savePaymentMethods(paymentMethods.filter(x => x !== m))}
                        className="mr-1 text-red-400 hover:text-red-600 font-bold leading-none" title="حذف">×</button>
                    )}
                  </div>
                ))}
              </div>
              {isMethodsEditing && (
                <div className="flex gap-2" dir="rtl">
                  <input
                    value={newMethodDraft}
                    onChange={e => setNewMethodDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newMethodDraft.trim() && !paymentMethods.includes(newMethodDraft.trim())) {
                        savePaymentMethods([...paymentMethods, newMethodDraft.trim()]);
                        setNewMethodDraft('');
                      }
                    }}
                    placeholder="اسم الخزنة أو وسيلة الدفع الجديدة..."
                    className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm"
                  />
                  <button
                    onClick={() => {
                      const t = newMethodDraft.trim();
                      if (!t || paymentMethods.includes(t)) return;
                      savePaymentMethods([...paymentMethods, t]);
                      setNewMethodDraft('');
                    }}
                    disabled={!newMethodDraft.trim() || paymentMethods.includes(newMethodDraft.trim())}
                    className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-40 transition">
                    إضافة
                  </button>
                </div>
              )}
            </article>
  
            {/* ── Revenue per Course ── */}
            {revenueByCourse.length > 0 && (
              <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold text-gray-800 flex items-center gap-2"><BarChart3 size={16} className="text-primary-600" />الإيرادات لكل كورس</h4>
                  <button
                    onClick={() => exportCSV(
                      'revenue-by-course.csv',
                      revenueByCourse.map(c => [c.title, String(c.online), String(c.manual), String(c.total)]),
                      ['الكورس', 'أونلاين (ج.م)', 'يدوي (ج.م)', 'الإجمالي (ج.م)']
                    )}
                    className="flex items-center gap-1.5 text-xs font-bold text-primary-600 hover:text-primary-800 border border-primary-200 hover:bg-primary-50 rounded-lg px-2 py-1 transition">
                    <Download size={13} /> تصدير CSV
                  </button>
                </div>
                <div className="space-y-3">
                  {revenueByCourse.map(c => {
                    const pct = revenueByCourse[0].total > 0 ? Math.round((c.total / revenueByCourse[0].total) * 100) : 0;
                    return (
                      <div key={c.id}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium text-gray-700 truncate max-w-[55%]">{c.title}</span>
                          <span className="text-gray-500 whitespace-nowrap">{c.total.toLocaleString('ar-EG-u-nu-latn')} ج.م</span>
                        </div>
                        <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-primary-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} /></div>
                        {(c.online > 0 || c.manual > 0) && (
                          <div className="flex gap-4 mt-1">
                            {c.online > 0 && <span className="text-[10px] text-blue-500">أونلاين: {c.online.toLocaleString('ar-EG-u-nu-latn')} ج.م</span>}
                            {c.manual > 0 && <span className="text-[10px] text-emerald-500">يدوي: {c.manual.toLocaleString('ar-EG-u-nu-latn')} ج.م</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>
            )}
          </div>
  );
}
