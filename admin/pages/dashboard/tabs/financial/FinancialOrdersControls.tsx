import type React from 'react';
import { Download, Receipt, Search, X } from 'lucide-react';
import { ONLINE_CHANNEL, type FinancialOrderRow } from './useFinancialOrdersData';

const typeColors: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  course: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', badge: 'bg-violet-100 text-violet-700' },
  bundle: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', badge: 'bg-teal-100 text-teal-700' },
  consultation: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', badge: 'bg-sky-100 text-sky-700' },
  certificate: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700' },
  book: { bg: 'bg-lime-50', text: 'text-lime-700', border: 'border-lime-200', badge: 'bg-lime-100 text-lime-700' },
  carneh: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200', badge: 'bg-pink-100 text-pink-700' },
  other: { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', badge: 'bg-gray-100 text-gray-600' },
};

const typeLabels: Record<string, string> = { course: 'كورس', bundle: 'مسار', consultation: 'استشارة', certificate: 'شهادة', book: 'كتاب', carneh: 'كارنيه', other: 'أخرى' };

interface FinancialOrdersControlsProps {
  onlineRevenueEGP: number;
  manualRevenueEGP: number;
  totalRevenueEGP: number;
  onlineRows: FinancialOrderRow[];
  manualRows: FinancialOrderRow[];
  filteredRows: FinancialOrderRow[];
  allRows: FinancialOrderRow[];
  byType: Record<string, number>;
  totalFiltered: number;
  hasFilters: boolean;
  orderSearch: string;
  setOrderSearch: React.Dispatch<React.SetStateAction<string>>;
  orderDateFrom: string;
  setOrderDateFrom: React.Dispatch<React.SetStateAction<string>>;
  orderDateTo: string;
  setOrderDateTo: React.Dispatch<React.SetStateAction<string>>;
  orderTypeFilter: string;
  setOrderTypeFilter: React.Dispatch<React.SetStateAction<string>>;
  orderMethodFilter: string;
  setOrderMethodFilter: React.Dispatch<React.SetStateAction<string>>;
  setOrdersPage: React.Dispatch<React.SetStateAction<number>>;
  paymentMethods: string[];
  exportCSV: (filename: string, rows: string[][], headers: string[]) => void;
  loadDbPayments: () => void;
  loadingDbPayments: boolean;
}

export function FinancialOrdersControls({
  onlineRevenueEGP,
  manualRevenueEGP,
  totalRevenueEGP,
  onlineRows,
  manualRows,
  filteredRows,
  allRows,
  byType,
  totalFiltered,
  hasFilters,
  orderSearch,
  setOrderSearch,
  orderDateFrom,
  setOrderDateFrom,
  orderDateTo,
  setOrderDateTo,
  orderTypeFilter,
  setOrderTypeFilter,
  orderMethodFilter,
  setOrderMethodFilter,
  setOrdersPage,
  paymentMethods,
  exportCSV,
  loadDbPayments,
  loadingDbPayments,
}: FinancialOrdersControlsProps) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'أونلاين (Paymob)', val: onlineRevenueEGP, bg: 'bg-blue-600', sub: `${onlineRows.length} معاملة` },
          { label: 'يدوي (نقدي / بنكي)', val: manualRevenueEGP, bg: 'bg-amber-500', sub: `${manualRows.length} معاملة` },
          { label: hasFilters ? 'إجمالي المفلتر' : 'الإجمالي الكلي', val: hasFilters ? totalFiltered : totalRevenueEGP, bg: 'bg-emerald-600', sub: `${filteredRows.length} دفعة` },
          { label: 'متوسط الدفعة', val: Math.round(filteredRows.length > 0 ? totalFiltered / filteredRows.length : 0), bg: 'bg-violet-600', sub: 'ج.م لكل معاملة' },
        ].map(c => (
          <div key={c.label} className={`${c.bg} rounded-2xl p-4 text-white shadow-sm`}>
            <p className="text-xs opacity-80 mb-1">{c.label}</p>
            <p className="text-xl font-extrabold">{c.val.toLocaleString('ar-EG-u-nu-latn')} <span className="text-sm font-normal">ج.م</span></p>
            <p className="text-[11px] opacity-70 mt-1">{c.sub}</p>
          </div>
        ))}
      </div>

      {Object.keys(byType).length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-bold text-gray-500 mb-3">توزيع المدفوعات حسب النوع</p>
          <div className="flex flex-wrap gap-3">
            {(Object.entries(byType) as [string, number][]).sort((a,b) => b[1]-a[1]).map(([type, val]) => {
              const c = typeColors[type] || typeColors.other;
              const pct = totalFiltered > 0 ? Math.round((val / totalFiltered) * 100) : 0;
              return (
                <button key={type} onClick={() => { setOrderTypeFilter(orderTypeFilter === type ? '' : type); setOrdersPage(1); }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition ${orderTypeFilter === type ? `${c.bg} ${c.border} ${c.text} font-extrabold ring-2 ring-offset-1 ring-current` : `bg-white ${c.border} hover:${c.bg}`}`}>
                  <span className={`text-xs font-bold ${c.text}`}>{typeLabels[type] || type}</span>
                  <span className={`text-xs ${c.badge} rounded-lg px-1.5 py-0.5 font-bold`}>{val.toLocaleString('ar-EG-u-nu-latn')} ج.م</span>
                  <span className="text-[10px] text-gray-400">{pct}%</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute top-1/2 -translate-y-1/2 right-3 text-gray-400 pointer-events-none" />
            <input value={orderSearch} onChange={e => { setOrderSearch(e.target.value); setOrdersPage(1); }}
              placeholder="بحث باسم العميل أو الخدمة..."
              className="w-full border border-gray-200 rounded-xl pr-8 pl-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-400" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-gray-500">من</label>
            <input type="date" value={orderDateFrom} onChange={e => { setOrderDateFrom(e.target.value); setOrdersPage(1); }}
              className="border border-gray-200 rounded-xl px-2 py-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-400" />
            <label className="text-xs text-gray-500">إلى</label>
            <input type="date" value={orderDateTo} onChange={e => { setOrderDateTo(e.target.value); setOrdersPage(1); }}
              className="border border-gray-200 rounded-xl px-2 py-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-400" />
          </div>
          <div className="flex gap-2 mr-auto">
            {hasFilters && (
              <button onClick={() => { setOrderSearch(''); setOrderDateFrom(''); setOrderDateTo(''); setOrderTypeFilter(''); setOrderMethodFilter(''); setOrdersPage(1); }}
                className="flex items-center gap-1 text-xs bg-red-50 text-red-600 border border-red-200 rounded-xl px-3 py-2 font-bold hover:bg-red-100 transition">
                <X size={11} /> مسح الفلاتر
              </button>
            )}
            <button onClick={() => exportCSV('payments.csv', filteredRows.map(r => [r.date, r.name, r.title, typeLabels[r.paymentType] || r.paymentType, r.channelLabel, String(r.amount), r.currency, r.note]), ['التاريخ', 'العميل', 'الخدمة', 'النوع', 'القناة', 'المبلغ', 'العملة', 'ملاحظة'])}
              className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl px-3 py-2 font-bold hover:bg-emerald-100 transition">
              <Download size={11} /> تصدير CSV
            </button>
            <button onClick={loadDbPayments} disabled={loadingDbPayments}
              className="flex items-center gap-1 text-xs bg-primary-50 text-primary-700 border border-primary-200 rounded-xl px-3 py-2 font-bold hover:bg-primary-100 transition disabled:opacity-50">
              <Receipt size={11} /> {loadingDbPayments ? 'جارٍ...' : 'تحديث من DB'}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-gray-400 font-bold self-center">القناة:</span>
          <button onClick={() => { setOrderMethodFilter(''); setOrdersPage(1); }}
            className={`text-xs px-3 py-1.5 rounded-full font-bold border transition ${!orderMethodFilter ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            الكل ({allRows.length})
          </button>
          <button onClick={() => { setOrderMethodFilter(ONLINE_CHANNEL); setOrdersPage(1); }}
            className={`text-xs px-3 py-1.5 rounded-full font-bold border transition ${orderMethodFilter === ONLINE_CHANNEL ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-600 border-blue-200 hover:bg-blue-50'}`}>
            🌐 أونلاين ({onlineRows.length})
          </button>
          {paymentMethods.map(m => {
            const count = manualRows.filter(r => r.channel === m).length;
            if (count === 0 && orderMethodFilter !== m) return null;
            return (
              <button key={m} onClick={() => { setOrderMethodFilter(m); setOrdersPage(1); }}
                className={`text-xs px-3 py-1.5 rounded-full font-bold border transition ${orderMethodFilter === m ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50'}`}>
                {m} ({count})
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
