import React from 'react';
import { ArrowDownRight, ArrowUpRight, FileText, PieChart } from 'lucide-react';
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

interface Props {
  isGlobalFiltered: boolean;
  setFinancialSubTab: React.Dispatch<React.SetStateAction<FinancialSubTab>>;
  gRevenue: number;
  gExpenses: number;
  gProfit: number;
  gMargin: number;
  totalRevenueEGP: number;
  totalExpensesEGP: number;
  netProfitEGP: number;
  profitMargin: number;
  globalDateFrom: string;
  globalDateTo: string;
  today: string;
  revenueByType: RevenueByType;
  expenseByCategory: Record<string, number>;
}

export function FinancialProfitLossPanel({
  isGlobalFiltered,
  setFinancialSubTab,
  gRevenue,
  gExpenses,
  gProfit,
  gMargin,
  totalRevenueEGP,
  totalExpensesEGP,
  netProfitEGP,
  profitMargin,
  globalDateFrom,
  globalDateTo,
  today,
  revenueByType,
  expenseByCategory,
}: Props) {
  return (
  <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h4 className="font-bold text-gray-800 flex items-center gap-2"><PieChart size={16} className="text-primary-600" />تقرير الأرباح والخسائر {isGlobalFiltered && <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full border border-primary-200">مفلتر</span>}</h4>
              <div className="flex gap-2">
                <button onClick={() => setFinancialSubTab('overview')}
                  className="flex items-center gap-1.5 text-xs font-bold text-gray-600 hover:text-primary-700 border border-gray-200 hover:bg-gray-50 rounded-lg px-2 py-1 transition">
                  <FileText size={13} /> تغيير الفترة
                </button>
                <button
                  onClick={() => {
                    const w = window.open('', '_blank', 'width=720,height=960');
                    if (!w) return;
                    const rev = isGlobalFiltered ? gRevenue : totalRevenueEGP;
                    const exp = isGlobalFiltered ? gExpenses : totalExpensesEGP;
                    const profit = isGlobalFiltered ? gProfit : netProfitEGP;
                    const margin = isGlobalFiltered ? gMargin : profitMargin;
                    const period = (globalDateFrom || globalDateTo)
                      ? `${globalDateFrom || '—'} إلى ${globalDateTo || '—'}`
                      : 'الكل';
                    w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>تقرير الأرباح والخسائر</title><style>body{font-family:Arial,sans-serif;padding:48px;direction:rtl;color:#111}.title{font-size:22px;font-weight:900;color:#7c3aed;border-bottom:3px solid #7c3aed;padding-bottom:12px;margin-bottom:24px}.section{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px}.section h3{font-size:15px;font-weight:700;margin-bottom:12px}.row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid #f3f4f6}.row:last-child{border:none;font-weight:700;font-size:15px}.profit{background:#eff6ff;border-color:#bfdbfe;border-radius:12px;padding:16px;display:flex;justify-content:space-between;align-items:center}.profit-label{font-size:18px;font-weight:900;color:#1d4ed8}.profit-value{font-size:24px;font-weight:900;color:#2563eb}.meta{color:#888;font-size:12px;text-align:center;margin-top:32px}@media print{body{padding:24px}}</style></head><body><div class="title">تقرير الأرباح والخسائر</div><p style="color:#888;font-size:13px;margin-bottom:24px">الفترة: ${period} &nbsp;|&nbsp; تاريخ الطباعة: ${today}</p><div class="section" style="background:#f0fdf4;border-color:#bbf7d0"><h3 style="color:#166534">الإيرادات</h3>${Object.entries(revenueByType).map(([k,v])=>v>0?`<div class="row"><span>${{course:'كورسات',bundle:'مسارات',consultation:'استشارات',certificate:'شهادات',book:'كتب',carneh:'كارنيهات',other:'أخرى'}[k]||k}</span><span>${Number(v).toLocaleString('ar-EG-u-nu-latn')} ج.م</span></div>`:'').join('')}<div class="row" style="margin-top:8px"><span>إجمالي الإيرادات</span><span>${rev.toLocaleString('ar-EG-u-nu-latn')} ج.م</span></div></div><div class="section" style="background:#fff1f2;border-color:#fecdd3"><h3 style="color:#9f1239">المصروفات</h3>${Object.entries(expenseByCategory).map(([k,v])=>`<div class="row"><span>${k}</span><span>(${Number(v).toLocaleString('ar-EG-u-nu-latn')} ج.م)</span></div>`).join('')}<div class="row" style="margin-top:8px"><span>إجمالي المصروفات</span><span>(${exp.toLocaleString('ar-EG-u-nu-latn')} ج.م)</span></div></div><div class="profit"><span class="profit-label">صافي ${profit>=0?'الربح':'الخسارة'}</span><span class="profit-value">${Math.abs(profit).toLocaleString('ar-EG-u-nu-latn')} ج.م</span></div><p style="text-align:center;color:#7c3aed;font-size:12px;margin-top:8px">هامش الربح: ${margin}%</p><div class="meta">معهد الدراسات النفسية — mahadnafsy.com</div></body></html>`);
                    w.document.close();
                    setTimeout(() => w.print(), 500);
                  }}
                  className="flex items-center gap-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl px-3 py-1.5 text-xs font-bold transition">
                  <FileText size={13} /> طباعة PDF
                </button>
              </div>
            </div>
            <div className="max-w-lg mx-auto space-y-0">
              {/* Revenue section */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-t-2xl p-4">
                <p className="text-emerald-700 font-bold text-lg mb-3 flex items-center gap-2"><ArrowUpRight size={18}/>الإيرادات</p>
                <div className="space-y-2 text-sm">
                  {([['كورسات', revenueByType.course],['مسارات', revenueByType.bundle],['استشارات', revenueByType.consultation],['شهادات', revenueByType.certificate],['كتب', revenueByType.book],['كارنيهات', revenueByType.carneh],['أخرى', revenueByType.other]] as [string,number][]).filter(([,v])=>v>0).map(([lbl,val])=>(
                    <div key={lbl} className="flex justify-between"><span className="text-emerald-700">{lbl}</span><span className="font-semibold">{val.toLocaleString('ar-EG-u-nu-latn')} ج.م</span></div>
                  ))}
                </div>
                <div className="border-t border-emerald-300 mt-3 pt-3 flex justify-between font-extrabold text-emerald-800 text-base">
                  <span>إجمالي الإيرادات</span><span>{(isGlobalFiltered ? gRevenue : totalRevenueEGP).toLocaleString('ar-EG-u-nu-latn')} ج.م</span>
                </div>
              </div>
              {/* Expense section */}
              <div className="bg-red-50 border border-red-200 border-t-0 p-4">
                <p className="text-red-700 font-bold text-lg mb-3 flex items-center gap-2"><ArrowDownRight size={18}/>المصروفات</p>
                <div className="space-y-2 text-sm">
                  {(Object.entries(expenseByCategory) as [string, number][]).sort((a,b)=>b[1]-a[1]).map(([cat,val])=>(
                    <div key={cat} className="flex justify-between"><span className="text-red-700">{cat}</span><span className="font-semibold">({val.toLocaleString()} ج.م)</span></div>
                  ))}
                  {Object.keys(expenseByCategory).length === 0 && <p className="text-red-400 text-xs">لا توجد مصروفات مسجّلة</p>}
                </div>
                <div className="border-t border-red-300 mt-3 pt-3 flex justify-between font-extrabold text-red-800 text-base">
                  <span>إجمالي المصروفات</span><span>({(isGlobalFiltered ? gExpenses : totalExpensesEGP).toLocaleString('ar-EG-u-nu-latn')} ج.م)</span>
                </div>
              </div>
              {/* Net profit */}
              {(() => { const p = isGlobalFiltered ? gProfit : netProfitEGP; const m = isGlobalFiltered ? gMargin : profitMargin; return (
              <div className={`border rounded-b-2xl border-t-0 p-5 ${p >= 0 ? 'bg-blue-50 border-blue-200' : 'bg-orange-50 border-orange-200'}`}>
                <div className="flex justify-between items-center">
                  <span className={`font-extrabold text-xl ${p >= 0 ? 'text-blue-800' : 'text-orange-800'}`}>صافي {p >= 0 ? 'الربح' : 'الخسارة'}</span>
                  <span className={`font-extrabold text-2xl ${p >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>{Math.abs(p).toLocaleString('ar-EG-u-nu-latn')} ج.م</span>
                </div>
                <p className={`text-sm mt-1 ${p >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>هامش الربح: {m}%</p>
              </div>
              );})()}
            </div>
          </article>
  );
}
