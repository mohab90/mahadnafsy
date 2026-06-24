import React, { useState, useEffect } from 'react';
import {
  CalendarDays, CheckCircle, CheckCircle2, Clock, Receipt, Search, Wallet, XCircle,
} from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { PaymentHistoryEntry, PaymentItemType, Currency, SubscriberItem } from '../../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type ReviewPayment = PaymentHistoryEntry & {
  subscriberName: string;
  subscriberCode: string;
  subscriberId: string;
  subscriberPhone?: string;
  subscriberEmail?: string;
};

const paymentTypeLabels: Record<PaymentItemType, string> = {
  course: 'كورس', certificate: 'شهادة', consultation: 'استشارة',
  book: 'كتاب', carneh: 'كارنيه', other: 'أخرى',
};

interface Props {
  notify: NotifyFn;
  branchFilter?: string;
  subscribers: SubscriberItem[];
  updateSubscriber: (s: SubscriberItem) => void;
  actorEmail?: string | null;
  sarRate: number;
  usdRate: number;
}

export function PaymentReviewPanel({ notify, branchFilter, subscribers, updateSubscriber, actorEmail, sarRate, usdRate }: Props) {
  const toEGP = (amt: number, cur: string) => cur === 'EGP' ? amt : cur === 'SAR' ? amt * sarRate : amt * usdRate;

  const [reviewStatusFilter, setReviewStatusFilter] = useState<'all' | 'pending' | 'paid' | 'failed'>('all');
  const [reviewTypeFilter, setReviewTypeFilter] = useState('');
  const [reviewSearch, setReviewSearch] = useState('');
  const [reviewDateFrom, setReviewDateFrom] = useState('');
  const [reviewDateTo, setReviewDateTo] = useState('');
  const [reviewActionLoading, setReviewActionLoading] = useState('');
  const [serverReviewRows, setServerReviewRows] = useState<ReviewPayment[]>([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadReview = async () => {
      setReviewLoading(true);
      try {
        const params = new URLSearchParams({ page: '1', limit: '200' });
        params.set('status', reviewStatusFilter);
        if (reviewTypeFilter) params.set('paymentType', reviewTypeFilter);
        if (reviewDateFrom) params.set('dateFrom', reviewDateFrom);
        if (reviewDateTo) params.set('dateTo', reviewDateTo);
        if (reviewSearch.trim()) params.set('search', reviewSearch.trim());
        if (branchFilter) params.set('branch', branchFilter);
        const data = await mysqlAdmin.adminGet<{ total: number; rows: Array<Record<string, unknown>> }>(
          `/admin/payments/review?${params.toString()}`
        );
        if (cancelled) return;
        const rows = (data.rows || []).map((p) => ({
          id: String(p.id || ''),
          subscriberId: String(p.subscriberId || ''),
          subscriberName: String(p.subscriberName || ''),
          subscriberCode: String(p.subscriberClientCode || ''),
          subscriberPhone: String(p.subscriberPhone || ''),
          subscriberEmail: String(p.subscriberEmail || ''),
          amount: Number(p.amount) || 0,
          currency: String(p.currency || 'EGP') as Currency,
          paymentType: String(p.paymentType || 'other') as PaymentItemType,
          paymentMethod: p.paymentMethod ? String(p.paymentMethod) : undefined,
          transactionId: p.transactionId ? String(p.transactionId) : undefined,
          isInstallment: Boolean(p.isInstallment),
          note: p.note ? String(p.note) : undefined,
          at: String(p.at || ''),
          status: String(p.status || 'paid') as 'pending' | 'paid' | 'failed',
          staffId: p.staffId ? String(p.staffId) : undefined,
          staffName: p.staffName ? String(p.staffName) : undefined,
          fromAccountNumber: p.fromAccountNumber ? String(p.fromAccountNumber) : undefined,
          source: p.source ? String(p.source) : undefined,
          itemTitle: String(p.itemTitle || p.courseTitleAr || p.courseTitle || ''),
        } as ReviewPayment));
        setServerReviewRows(rows);
        setReviewTotal(Number(data.total) || rows.length);
      } catch {
        if (!cancelled) { setServerReviewRows([]); setReviewTotal(0); }
      } finally {
        if (!cancelled) setReviewLoading(false);
      }
    };
    const t = window.setTimeout(loadReview, reviewSearch.trim() ? 350 : 0);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [reviewStatusFilter, reviewTypeFilter, reviewDateFrom, reviewDateTo, reviewSearch, branchFilter]);

  const localReview: ReviewPayment[] = subscribers.flatMap(s =>
    (s.paymentHistory ?? []).map(p => ({
      ...p,
      subscriberName: s.name,
      subscriberCode: s.clientCode || '',
      subscriberId: s.id,
    }))
  ).sort((a, b) => (b.at || '').localeCompare(a.at || ''));

  const allReview: ReviewPayment[] = serverReviewRows.length > 0 ? serverReviewRows : localReview;

  const filtered = serverReviewRows.length > 0 ? allReview : allReview.filter(p => {
    if (reviewStatusFilter !== 'all' && (p.status || 'paid') !== reviewStatusFilter) return false;
    if (reviewTypeFilter && p.paymentType !== reviewTypeFilter) return false;
    if (reviewDateFrom && (p.at || '').slice(0, 10) < reviewDateFrom) return false;
    if (reviewDateTo && (p.at || '').slice(0, 10) > reviewDateTo) return false;
    if (reviewSearch) {
      const q = reviewSearch.toLowerCase();
      if (
        !p.subscriberName.toLowerCase().includes(q) &&
        !p.subscriberCode.toLowerCase().includes(q) &&
        !(p.itemTitle || '').toLowerCase().includes(q) &&
        !(p.transactionId || '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const pendingItems = allReview.filter(p => p.status === 'pending');
  const pendingAmt = pendingItems.reduce((s, p) => s + toEGP(p.amount, p.currency), 0);
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayCount = allReview.filter(p => (p.at || '').slice(0, 10) === todayStr).length;

  const handleAction = async (p: ReviewPayment, newStatus: 'paid' | 'failed') => {
    setReviewActionLoading(p.id);
    try {
      await mysqlAdmin.adminPatch(`/admin/payments/${encodeURIComponent(p.id)}/status`, { status: newStatus, actor: actorEmail || 'admin' });
      const sub = subscribers.find(s => s.id === p.subscriberId);
      if (sub) {
        updateSubscriber({
          ...sub,
          paymentHistory: (sub.paymentHistory ?? []).map(ph =>
            ph.id === p.id ? { ...ph, status: newStatus } : ph
          ),
        });
      }
      setServerReviewRows(rows => rows.map(row => row.id === p.id ? { ...row, status: newStatus } : row));
      notify('success', newStatus === 'paid' ? 'تم تأكيد الدفعة ✅' : 'تم وضع علامة فشل على الدفعة');
    } catch (e: unknown) { notify('error', (e as Error).message || 'خطأ'); }
    finally { setReviewActionLoading(''); }
  };

  const sourceBadgeEl = (src?: string) => {
    if (!src) return null;
    const m: Record<string, [string, string]> = {
      web: ['موقع', 'bg-blue-100 text-blue-700'],
      staff: ['موظف', 'bg-violet-100 text-violet-700'],
      daqqi: ['دقيقي', 'bg-amber-100 text-amber-700'],
      paymob: ['باي موب', 'bg-emerald-100 text-emerald-700'],
      reception: ['استقبال', 'bg-cyan-100 text-cyan-700'],
      system: ['نظام', 'bg-gray-100 text-gray-500'],
    };
    const b = m[src];
    return b ? <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[11px] font-bold ${b[1]}`}>{b[0]}</span> : null;
  };

  const statusBadgeEl = (st?: string) => {
    if (!st || st === 'paid') return <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700"><CheckCircle2 size={10} />مدفوع</span>;
    if (st === 'pending') return <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700"><Clock size={10} />معلق</span>;
    return <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700"><XCircle size={10} />فشل</span>;
  };

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {([
          ['معلق الموافقة', pendingItems.length, 'text-amber-700', 'bg-amber-50', 'border-amber-200', Clock],
          ['مبلغ معلق (ج.م)', Math.round(pendingAmt).toLocaleString('ar-EG-u-nu-latn'), 'text-amber-700', 'bg-amber-50', 'border-amber-200', Wallet],
          ['دفعات اليوم', todayCount, 'text-primary-700', 'bg-primary-50', 'border-primary-200', CalendarDays],
          ['إجمالي الدفعات', reviewTotal || allReview.length, 'text-gray-700', 'bg-gray-50', 'border-gray-200', Receipt],
        ] as [string, string | number, string, string, string, React.ElementType][]).map(([lbl, val, txt, bg, br, Ic]) => (
          <article key={lbl} className={`${bg} border ${br} rounded-2xl p-4 flex items-center gap-3 shadow-sm`}>
            <div className={`w-9 h-9 rounded-xl ${bg} border ${br} flex items-center justify-center flex-shrink-0`}><Ic size={18} className={txt} /></div>
            <div><p className="text-xs text-gray-500">{lbl}</p><p className={`text-xl font-extrabold ${txt}`}>{val}</p></div>
          </article>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <div className="flex flex-wrap gap-3 items-end" dir="rtl">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">الحالة</label>
            <select value={reviewStatusFilter} onChange={e => setReviewStatusFilter(e.target.value as typeof reviewStatusFilter)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50">
              <option value="all">الكل</option>
              <option value="pending">معلق</option>
              <option value="paid">مدفوع</option>
              <option value="failed">فشل</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">النوع</label>
            <select value={reviewTypeFilter} onChange={e => setReviewTypeFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50">
              <option value="">كل الأنواع</option>
              {(Object.entries(paymentTypeLabels) as [string, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">من تاريخ</label>
            <input type="date" value={reviewDateFrom} onChange={e => setReviewDateFrom(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">إلى تاريخ</label>
            <input type="date" value={reviewDateTo} onChange={e => setReviewDateTo(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50" />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <label className="text-xs text-gray-500 font-medium">بحث</label>
            <div className="relative">
              <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={reviewSearch} onChange={e => setReviewSearch(e.target.value)}
                placeholder="اسم العميل / الكود / الخدمة..."
                className="w-full border border-gray-200 rounded-lg pr-8 pl-3 py-1.5 text-sm bg-gray-50" />
            </div>
          </div>
          {(reviewStatusFilter !== 'all' || reviewTypeFilter || reviewDateFrom || reviewDateTo || reviewSearch) && (
            <button onClick={() => { setReviewStatusFilter('all'); setReviewTypeFilter(''); setReviewDateFrom(''); setReviewDateTo(''); setReviewSearch(''); }}
              className="px-3 py-1.5 rounded-xl text-sm font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 transition self-end">مسح</button>
          )}
          <span className="text-xs text-gray-400 self-end pb-1.5">{reviewLoading ? 'تحميل...' : `${filtered.length} دفعة`}</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-x-auto shadow-sm">
        {reviewLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <span className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">لا توجد دفعات تطابق الفلتر</p>
        ) : (
          <table className="w-full text-sm min-w-[900px]" dir="rtl">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-100">
                <th className="px-4 py-3 text-right font-semibold">العميل</th>
                <th className="px-4 py-3 text-right font-semibold">الخدمة</th>
                <th className="px-4 py-3 text-right font-semibold">المبلغ</th>
                <th className="px-4 py-3 text-right font-semibold">الوسيلة / الحساب</th>
                <th className="px-4 py-3 text-right font-semibold">الموظف</th>
                <th className="px-4 py-3 text-right font-semibold">المصدر</th>
                <th className="px-4 py-3 text-right font-semibold">التاريخ</th>
                <th className="px-4 py-3 text-right font-semibold">الحالة</th>
                <th className="px-4 py-3 text-right font-semibold">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.slice(0, 200).map(p => (
                <tr key={p.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800 text-xs">{p.subscriberName}</div>
                    {p.subscriberCode && <div className="text-[11px] text-gray-400">{p.subscriberCode}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-gray-700">{p.itemTitle || (p.paymentType ? (paymentTypeLabels[p.paymentType as PaymentItemType] ?? 'دفعة') : 'دفعة')}</div>
                    {p.transactionId && <div className="text-[11px] text-gray-400 font-mono">#{p.transactionId}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono font-bold text-gray-800 whitespace-nowrap">
                    {p.amount.toLocaleString('ar-EG-u-nu-latn')} <span className="text-xs font-normal text-gray-500">{p.currency}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-gray-700">{p.paymentMethod || '—'}</div>
                    {p.fromAccountNumber && <div className="text-[11px] text-gray-400 font-mono">{p.fromAccountNumber}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{p.staffName || '—'}</td>
                  <td className="px-4 py-3">{sourceBadgeEl(p.source)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{(p.at || '').slice(0, 10)}</td>
                  <td className="px-4 py-3">{statusBadgeEl(p.status)}</td>
                  <td className="px-4 py-3">
                    {(!p.status || p.status === 'pending') && (
                      <div className="flex gap-1.5">
                        <button onClick={() => handleAction(p, 'paid')} disabled={reviewActionLoading === p.id}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition disabled:opacity-50">
                          {reviewActionLoading === p.id ? <span className="w-3 h-3 border-2 border-emerald-400/40 border-t-emerald-600 rounded-full animate-spin" /> : <CheckCircle size={12} />}
                          قبول
                        </button>
                        <button onClick={() => handleAction(p, 'failed')} disabled={reviewActionLoading === p.id}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-red-100 text-red-700 hover:bg-red-200 transition disabled:opacity-50">
                          <XCircle size={12} />رفض
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
