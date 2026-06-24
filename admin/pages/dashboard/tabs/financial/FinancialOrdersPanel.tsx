import React, { useState } from 'react';
import { Download, Receipt, Search, X } from 'lucide-react';
import { useSiteData } from '../../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { OrderItem, SubscriberItem, PaymentItemType } from '../../../../types';

const ORDERS_PAGE_SIZE = 50;

const paymentTypeLabels: Record<PaymentItemType, string> = {
  course: 'كورس', certificate: 'شهادة', consultation: 'استشارة',
  book: 'كتاب', carneh: 'كارنيه', other: 'أخرى',
};

const typeColors: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  course: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', badge: 'bg-violet-100 text-violet-700' },
  bundle: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', badge: 'bg-teal-100 text-teal-700' },
  consultation: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', badge: 'bg-sky-100 text-sky-700' },
  certificate: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700' },
  book: { bg: 'bg-lime-50', text: 'text-lime-700', border: 'border-lime-200', badge: 'bg-lime-100 text-lime-700' },
  carneh: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200', badge: 'bg-pink-100 text-pink-700' },
  other: { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', badge: 'bg-gray-100 text-gray-600' },
};

const typeLabels: Record<string, string> = {
  course: 'كورس', bundle: 'مسار', consultation: 'استشارة',
  certificate: 'شهادة', book: 'كتاب', carneh: 'كارنيه', other: 'أخرى',
};

type DbPayment = { id: string; subscriberId: string; subscriberName: string; amount: number; currency: string; paymentType: string; paymentMethod: string | null; transactionId: string | null; note: string | null; at: string; isInstallment: boolean };

interface Props {
  paidOrders: OrderItem[];
  subscribers: SubscriberItem[];
  onlineRevenueEGP: number;
  manualRevenueEGP: number;
  totalRevenueEGP: number;
  initialMethodFilter?: string;
}

export function FinancialOrdersPanel({ paidOrders, subscribers, onlineRevenueEGP, manualRevenueEGP, totalRevenueEGP, initialMethodFilter = '' }: Props) {
  const { content } = useSiteData();

  const [orderSearch, setOrderSearch] = useState('');
  const [orderDateFrom, setOrderDateFrom] = useState('');
  const [orderDateTo, setOrderDateTo] = useState('');
  const [orderTypeFilter, setOrderTypeFilter] = useState('');
  const [ordersPage, setOrdersPage] = useState(1);
  const [orderMethodFilter, setOrderMethodFilter] = useState(initialMethodFilter);
  const [dbPayments, setDbPayments] = useState<DbPayment[] | null>(null);
  const [loadingDbPayments, setLoadingDbPayments] = useState(false);

  const sarRate = parseFloat(content['exchange.sar_to_egp'] || '13') || 13;
  const usdRate = parseFloat(content['exchange.usd_to_egp'] || '48') || 48;
  const toEGP = (amt: number, cur: string) => cur === 'EGP' ? amt : cur === 'SAR' ? amt * sarRate : amt * usdRate;

  const DEFAULT_METHODS = ['خزنة الدقي', 'خزنة الفرع', 'فودافون كاش', 'انستا باي', 'تحويل بنكي', 'احمد السعودية'];
  const PAYMENT_METHODS: string[] = content['finance.payment_methods']
    ? content['finance.payment_methods'].split('||').map((s: string) => s.trim()).filter(Boolean)
    : DEFAULT_METHODS;

  const getMethod = (p: { paymentMethod?: string; note?: string }) =>
    p.paymentMethod || PAYMENT_METHODS.find(m => (p.note || '').includes(m)) || '';

  const loadDbPayments = async () => {
    setLoadingDbPayments(true);
    try {
      const rows = await mysqlAdmin.getPayments() as unknown as DbPayment[];
      setDbPayments(rows ?? null);
    } catch { /* ignore */ }
    finally { setLoadingDbPayments(false); }
  };

  const exportCSV = (filename: string, rows: string[][], headers: string[]) => {
    const BOM = '﻿';
    const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const csvLines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))];
    const blob = new Blob([BOM + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const ONLINE_CHANNEL = '__online_paymob__';
  const onlineRows = paidOrders.map(row => ({
    key: `o-${row.id}`,
    title: row.itemTitle || '—',
    name: row.customerName || '—',
    paymentType: row.type === 'bundle' ? 'bundle' : row.type === 'consultation' ? 'consultation' : 'course',
    channel: ONLINE_CHANNEL,
    channelLabel: row.paymentMethod === 'card' ? 'بطاقة بنكية (أونلاين)' : row.paymentMethod === 'wallet' ? 'محفظة إلكترونية (أونلاين)' : 'أونلاين',
    amount: row.amount,
    currency: row.currency,
    amountEGP: toEGP(row.amount, row.currency),
    date: (row.paidAt || row.createdAt || '').slice(0, 10),
    sortKey: row.paidAt || row.createdAt || '',
    note: row.transactionId ? `#${row.transactionId}` : '—',
    isOnline: true,
    printRow: row,
    staffName: (row as unknown as Record<string, unknown>)['staffName'] as string || null,
  }));
  const contextManualRows = subscribers.flatMap(s =>
    (s.paymentHistory ?? [])
      .filter(p =>
        (p.paymentMethod || '') !== 'online_paymob' &&
        (!p.status || p.status === 'paid')
      )
      .map((p, idx) => ({
        key: `m-${p.id}`,
        title: p.itemTitle || (p.paymentType ? (paymentTypeLabels[p.paymentType] ?? 'دفعة') : 'دفعة'),
        name: s.name,
        paymentType: p.paymentType || 'other',
        channel: getMethod(p) || 'غير محدد',
        channelLabel: getMethod(p) || 'غير محدد',
        amount: p.amount,
        currency: p.currency,
        amountEGP: toEGP(p.amount, p.currency),
        date: (p.at || '').slice(0, 10),
        sortKey: p.at || `${(p.at || '').slice(0, 10)}T${String(idx).padStart(6, '0')}`,
        note: p.note || '—',
        isOnline: false,
        staffName: p.staffName || null,
        printRow: null,
      }))
  );
  const contextIds = new Set(contextManualRows.map(r => r.key.replace('m-', '')));
  const dbExtraRows = dbPayments
    ? dbPayments.filter(p => (p.paymentMethod || '') !== 'online_paymob' && !contextIds.has(p.id)).map(p => ({
        key: `db-${p.id}`,
        title: (p.paymentType ? paymentTypeLabels[p.paymentType as PaymentItemType] : undefined) ?? 'دفعة',
        name: p.subscriberName || '—',
        paymentType: p.paymentType || 'other',
        channel: p.paymentMethod || 'غير محدد',
        channelLabel: p.paymentMethod || 'غير محدد',
        amount: p.amount,
        currency: p.currency,
        amountEGP: toEGP(p.amount, p.currency),
        date: (p.at || '').slice(0, 10),
        sortKey: p.at || '',
        note: p.note || (p.transactionId ? `#${p.transactionId}` : '—'),
        isOnline: false,
        printRow: null,
        staffName: null,
      }))
    : [];
  const manualRows = [...contextManualRows, ...dbExtraRows];
  const allRows = [...onlineRows, ...manualRows].sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  const filtered1 = !orderMethodFilter ? allRows
    : orderMethodFilter === ONLINE_CHANNEL ? allRows.filter(r => r.isOnline)
    : allRows.filter(r => !r.isOnline && r.channel === orderMethodFilter);
  const filtered2 = !orderSearch ? filtered1
    : filtered1.filter(r => r.name.toLowerCase().includes(orderSearch.toLowerCase()) || r.title.toLowerCase().includes(orderSearch.toLowerCase()));
  const filtered3 = !orderDateFrom ? filtered2 : filtered2.filter(r => r.date >= orderDateFrom);
  const filtered4 = !orderDateTo ? filtered3 : filtered3.filter(r => r.date <= orderDateTo);
  const filteredRows = !orderTypeFilter ? filtered4 : filtered4.filter(r => r.paymentType === orderTypeFilter);

  const totalFiltered = filteredRows.reduce((s, r) => s + r.amountEGP, 0);
  const pageCount = Math.ceil(filteredRows.length / ORDERS_PAGE_SIZE);
  const pageRows = filteredRows.slice((ordersPage - 1) * ORDERS_PAGE_SIZE, ordersPage * ORDERS_PAGE_SIZE);

  const byType: Record<string, number> = {};
  for (const r of filteredRows) { byType[r.paymentType] = (byType[r.paymentType] || 0) + r.amountEGP; }

  const printManual = (row: typeof pageRows[0]) => {
    const w = window.open('', '_blank', 'width=700,height=900');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>إيصال دفع</title><style>body{font-family:Arial,sans-serif;padding:40px;direction:rtl;color:#111}.header{text-align:center;border-bottom:3px solid #d97706;padding-bottom:20px;margin-bottom:30px}h1{color:#d97706;margin:0;font-size:24px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:12px 16px;border:1px solid #e5e7eb;text-align:right}th{background:#fffbeb;font-weight:700}tfoot td{font-weight:700;background:#f0fdf4}.footer{margin-top:40px;text-align:center;color:#888;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px}</style></head><body><div class="header"><h1>معهد الدراسات النفسية</h1><p style="color:#888;font-size:12px">التاريخ: ${row.date}</p></div><h3>العميل: ${row.name}${row.staffName ? ` | بواسطة: ${row.staffName}` : ''}</h3><table><thead><tr><th>الخدمة</th><th>النوع</th><th>وسيلة الدفع</th><th>المبلغ</th></tr></thead><tbody><tr><td>${row.title}</td><td>${typeLabels[row.paymentType] || row.paymentType}</td><td>${row.channelLabel}</td><td>${row.amount} ${row.currency}</td></tr></tbody><tfoot><tr><td colspan="3">الإجمالي</td><td>${row.amount} ${row.currency}</td></tr></tfoot></table><div class="footer">معهد الدراسات النفسية — mahadnafsy.com</div></body></html>`);
    w.document.close(); setTimeout(() => w.print(), 500);
  };

  const hasFilters = orderSearch || orderDateFrom || orderDateTo || orderTypeFilter || orderMethodFilter;

  return (
    <div className="space-y-4">
      {/* ── KPI strip ── */}
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

      {/* ── Analytics by type (mini bars) ── */}
      {Object.keys(byType).length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <p className="text-xs font-bold text-gray-500 mb-3">توزيع المدفوعات حسب النوع</p>
          <div className="flex flex-wrap gap-3">
            {(Object.entries(byType) as [string, number][]).sort((a, b) => b[1] - a[1]).map(([type, val]) => {
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

      {/* ── Filters bar ── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute top-1/2 -translate-y-1/2 right-3 text-gray-400 pointer-events-none" />
            <input value={orderSearch} onChange={e => { setOrderSearch(e.target.value); setOrdersPage(1); }}
              placeholder="بحث باسم العميل أو الخدمة..."
              className="w-full border border-gray-200 rounded-xl pr-8 pl-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-400" />
          </div>
          {/* Date range */}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-gray-500">من</label>
            <input type="date" value={orderDateFrom} onChange={e => { setOrderDateFrom(e.target.value); setOrdersPage(1); }}
              className="border border-gray-200 rounded-xl px-2 py-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-400" />
            <label className="text-xs text-gray-500">إلى</label>
            <input type="date" value={orderDateTo} onChange={e => { setOrderDateTo(e.target.value); setOrdersPage(1); }}
              className="border border-gray-200 rounded-xl px-2 py-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-400" />
          </div>
          {/* Action buttons */}
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
        {/* Channel pills */}
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
          {PAYMENT_METHODS.map(m => {
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

      {/* ── Payments table ── */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h4 className="font-bold text-gray-800 text-sm">
            سجل المدفوعات
            {hasFilters && <span className="mr-2 text-xs bg-primary-100 text-primary-700 rounded-full px-2 py-0.5 font-bold">{filteredRows.length} نتيجة</span>}
          </h4>
          <span className="text-xs text-gray-400">{filteredRows.length} دفعة · {Math.round(totalFiltered).toLocaleString('ar-EG-u-nu-latn')} ج.م</span>
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
              {pageRows.map(row => {
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
                      <span className="font-extrabold text-emerald-700 text-sm">{row.amount.toLocaleString('ar-EG-u-nu-latn')}</span>
                      <span className="text-[10px] text-gray-400 mr-1">{row.currency}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 max-w-[160px] truncate">{row.note !== '—' ? row.note : ''}</td>
                    <td className="px-4 py-3">
                      {row.isOnline && row.printRow ? (
                        <button onClick={() => {
                          const r = row.printRow!;
                          const w = window.open('', '_blank', 'width=700,height=900');
                          if (!w) return;
                          w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>فاتورة #${r.id}</title><style>body{font-family:Arial,sans-serif;padding:40px;direction:rtl;color:#111}.header{text-align:center;border-bottom:3px solid #7c3aed;padding-bottom:20px;margin-bottom:30px}h1{color:#7c3aed;margin:0;font-size:24px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:12px 16px;border:1px solid #e5e7eb;text-align:right}th{background:#f9fafb;font-weight:700}tfoot td{font-weight:700;background:#f0fdf4}.footer{margin-top:40px;text-align:center;color:#888;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px}</style></head><body><div class="header"><h1>معهد الدراسات النفسية</h1><p style="color:#888;font-size:12px">فاتورة رقم: ${r.id} — ${(r.paidAt || r.createdAt || '').slice(0, 10)}</p></div><h3>${r.customerName}</h3><table><thead><tr><th>الخدمة</th><th>طريقة الدفع</th><th>المبلغ</th></tr></thead><tbody><tr><td>${r.itemTitle}</td><td>${r.paymentMethod === 'card' ? 'بطاقة بنكية' : 'محفظة إلكترونية'}</td><td>${r.amount} ${r.currency}</td></tr></tbody><tfoot><tr><td colspan="2">الإجمالي</td><td>${r.amount} ${r.currency}</td></tr></tfoot></table><div class="footer">معهد الدراسات النفسية — mahadnafsy.com</div></body></html>`);
                          w.document.close(); setTimeout(() => w.print(), 500);
                        }} className="opacity-0 group-hover:opacity-100 transition text-[11px] bg-gray-100 hover:bg-primary-50 hover:text-primary-700 text-gray-600 px-2 py-1 rounded-lg flex items-center gap-1">
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
                  <td className="px-4 py-3 text-left text-emerald-700 font-extrabold">{Math.round(totalFiltered).toLocaleString('ar-EG-u-nu-latn')} <span className="text-xs font-normal text-gray-400">ج.م</span></td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {/* Pagination */}
        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-2 px-5 py-3 border-t border-gray-100">
            <button disabled={ordersPage <= 1} onClick={() => setOrdersPage(p => p - 1)} className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 grid place-items-center text-gray-600 text-xs font-bold">‹</button>
            <span className="text-xs text-gray-500">{ordersPage} / {pageCount}</span>
            <button disabled={ordersPage >= pageCount} onClick={() => setOrdersPage(p => p + 1)} className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 grid place-items-center text-gray-600 text-xs font-bold">›</button>
          </div>
        )}
      </div>
    </div>
  );
}
