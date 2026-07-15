import type React from 'react';
import { Receipt, Search } from 'lucide-react';
import type { FinancialOrderRow } from './useFinancialOrdersData';

const typeColors: Record<string, { badge: string }> = {
  course: { badge: 'bg-violet-100 text-violet-700' },
  bundle: { badge: 'bg-teal-100 text-teal-700' },
  consultation: { badge: 'bg-sky-100 text-sky-700' },
  certificate: { badge: 'bg-orange-100 text-orange-700' },
  book: { badge: 'bg-lime-100 text-lime-700' },
  carneh: { badge: 'bg-pink-100 text-pink-700' },
  other: { badge: 'bg-gray-100 text-gray-600' },
};

const typeLabels: Record<string, string> = {
  course: 'كورس',
  bundle: 'مسار',
  consultation: 'استشارة',
  certificate: 'شهادة',
  book: 'كتاب',
  carneh: 'كارنيه',
  other: 'أخرى',
};

interface FinancialOrdersTableProps {
  pageRows: FinancialOrderRow[];
  filteredRows: FinancialOrderRow[];
  totalFiltered: number;
  hasFilters: boolean;
  pageCount: number;
  ordersPage: number;
  setOrdersPage: React.Dispatch<React.SetStateAction<number>>;
}

function printManual(row: FinancialOrderRow) {
  const w = window.open('', '_blank', 'width=700,height=900');
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>إيصال دفع</title><style>body{font-family:Arial,sans-serif;padding:40px;direction:rtl;color:#111}.header{text-align:center;border-bottom:3px solid #d97706;padding-bottom:20px;margin-bottom:30px}h1{color:#d97706;margin:0;font-size:24px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:12px 16px;border:1px solid #e5e7eb;text-align:right}th{background:#fffbeb;font-weight:700}tfoot td{font-weight:700;background:#f0fdf4}.footer{margin-top:40px;text-align:center;color:#888;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px}</style></head><body><div class="header"><h1>معهد الدراسات النفسية</h1><p style="color:#888;font-size:12px">التاريخ: ${row.date}</p></div><h3>العميل: ${row.name}${row.staffName ? ` | بواسطة: ${row.staffName}` : ''}</h3><table><thead><tr><th>الخدمة</th><th>النوع</th><th>وسيلة الدفع</th><th>المبلغ</th></tr></thead><tbody><tr><td>${row.title}</td><td>${typeLabels[row.paymentType] || row.paymentType}</td><td>${row.channelLabel}</td><td>${row.amount} ${row.currency}</td></tr></tbody><tfoot><tr><td colspan="3">الإجمالي</td><td>${row.amount} ${row.currency}</td></tr></tfoot></table><div class="footer">معهد الدراسات النفسية — mahadnafsy.com</div></body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 500);
}

function printOnline(row: FinancialOrderRow) {
  const r = row.printRow;
  if (!r) return;
  const w = window.open('', '_blank', 'width=700,height=900');
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>فاتورة #${r.id}</title><style>body{font-family:Arial,sans-serif;padding:40px;direction:rtl;color:#111}.header{text-align:center;border-bottom:3px solid #7c3aed;padding-bottom:20px;margin-bottom:30px}h1{color:#7c3aed;margin:0;font-size:24px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:12px 16px;border:1px solid #e5e7eb;text-align:right}th{background:#f9fafb;font-weight:700}tfoot td{font-weight:700;background:#f0fdf4}.footer{margin-top:40px;text-align:center;color:#888;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px}</style></head><body><div class="header"><h1>معهد الدراسات النفسية</h1><p style="color:#888;font-size:12px">فاتورة رقم: ${r.id} — ${(r.paidAt||r.createdAt||'').slice(0,10)}</p></div><h3>${r.customerName}</h3><table><thead><tr><th>الخدمة</th><th>طريقة الدفع</th><th>المبلغ</th></tr></thead><tbody><tr><td>${r.itemTitle}</td><td>${r.paymentMethod==='card'?'بطاقة بنكية':'محفظة إلكترونية'}</td><td>${r.amount} ${r.currency}</td></tr></tbody><tfoot><tr><td colspan="2">الإجمالي</td><td>${r.amount} ${r.currency}</td></tr></tfoot></table><div class="footer">معهد الدراسات النفسية — mahadnafsy.com</div></body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 500);
}

export function FinancialOrdersTable({
  pageRows,
  filteredRows,
  totalFiltered,
  hasFilters,
  pageCount,
  ordersPage,
  setOrdersPage,
}: FinancialOrdersTableProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <h4 className="font-bold text-gray-800 text-sm">
          سجل المدفوعات
          {hasFilters && <span className="mr-2 text-xs bg-primary-100 text-primary-700 rounded-full px-2 py-0.5 font-bold">{filteredRows.length} نتيجة</span>}
        </h4>
        <span className="text-xs text-gray-400">{filteredRows.length} دفعة · {Math.round(totalFiltered).toLocaleString('ar-EG')} ج.م</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-right text-xs font-bold text-gray-500 bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 w-24">التاريخ</th>
              <th className="px-4 py-3">العميل</th>
              <th className="px-4 py-3">الخدمة</th>
              <th className="px-4 py-3">النوع</th>
              <th className="px-4 py-3">القناة</th>
              <th className="px-4 py-3 text-left">المبلغ</th>
              <th className="px-4 py-3">ملاحظة</th>
              <th className="px-4 py-3 w-16">فاتورة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {pageRows.map((row) => {
              const c = typeColors[row.paymentType] || typeColors.other;
              return (
                <tr key={row.key} className="hover:bg-gray-50/80 transition group">
                  <td className="px-4 py-3 text-xs text-gray-400 font-mono whitespace-nowrap">{row.date}</td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-gray-800 text-sm">{row.name}</span>
                    {row.staffName && <p className="text-[10px] text-gray-400">{row.staffName}</p>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-[200px] truncate">{row.title}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${c.badge}`}>{typeLabels[row.paymentType] || row.paymentType}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${row.isOnline ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {row.isOnline ? '🌐 ' : ''}{row.channelLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-left">
                    <span className="font-extrabold text-emerald-700 text-sm">{row.amount.toLocaleString('ar-EG')}</span>
                    <span className="text-[10px] text-gray-400 mr-1">{row.currency}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 max-w-[160px] truncate">{row.note !== '—' ? row.note : ''}</td>
                  <td className="px-4 py-3">
                    {row.isOnline && row.printRow ? (
                      <button onClick={() => printOnline(row)} className="opacity-0 group-hover:opacity-100 transition text-[11px] bg-gray-100 hover:bg-primary-50 hover:text-primary-700 text-gray-600 px-2 py-1 rounded-lg flex items-center gap-1">
                        <Receipt size={11} />
                      </button>
                    ) : !row.isOnline ? (
                      <button onClick={() => printManual(row)} className="opacity-0 group-hover:opacity-100 transition text-[11px] bg-amber-50 hover:bg-amber-100 text-amber-700 px-2 py-1 rounded-lg flex items-center gap-1">
                        <Receipt size={11} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr><td colSpan={8} className="py-12 text-center text-gray-400 text-sm">
                <Search size={28} className="mx-auto mb-2 opacity-30" />
                لا توجد مدفوعات مطابقة للفلتر
              </td></tr>
            )}
          </tbody>
          {filteredRows.length > 0 && (
            <tfoot>
              <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold">
                <td colSpan={5} className="px-4 py-3 text-sm text-gray-600">الإجمالي ({filteredRows.length} دفعة)</td>
                <td className="px-4 py-3 text-left text-emerald-700 font-extrabold">{Math.round(totalFiltered).toLocaleString('ar-EG')} <span className="text-xs font-normal text-gray-400">ج.م</span></td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 px-5 py-3 border-t border-gray-100">
          <button disabled={ordersPage <= 1} onClick={() => setOrdersPage(p => p - 1)} className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 grid place-items-center text-gray-600 text-xs font-bold">‹</button>
          <span className="text-xs text-gray-500">{ordersPage} / {pageCount}</span>
          <button disabled={ordersPage >= pageCount} onClick={() => setOrdersPage(p => p + 1)} className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 grid place-items-center text-gray-600 text-xs font-bold">›</button>
        </div>
      )}
    </div>
  );
}
