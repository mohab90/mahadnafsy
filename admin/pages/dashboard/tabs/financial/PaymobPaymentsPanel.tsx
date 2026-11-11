import React, { useEffect, useMemo, useState } from 'react';
import { CreditCard, Loader2, RefreshCw } from 'lucide-react';

import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';
import { CAIRO_TIME_ZONE } from '../../../../../shared/cairoDate';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type PaymobRow = {
  id: string;
  amount: string | number;
  status: string;
  /** The route answers `at` (date only) and camelCase everywhere else. */
  at: string;
  transactionId: string | null;
  itemTitle: string | null;
  subscriberName?: string | null;
  subscriberClientCode?: string | null;
  courseTitleAr?: string | null;
  courseTitle?: string | null;
};

/** One status group of GET /api/admin/payments/summary: the database's figures over EVERY payment the list matches, not over the rows that came back. */
type SummaryGroup = { count: number; totalEgp: number; certificateEgp: number; byCurrency: Record<string, number>; unconverted: number };
type PaymentsSummary = { groups: { paid: SummaryGroup; refunded: SummaryGroup; uncollected: SummaryGroup } };
const LIST_LIMIT = 200;

const money = (value: string | number) =>
  Number(value || 0).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 });

/**
 * Online card and wallet sales on their own, apart from what staff enter by
 * hand. The two were indistinguishable until payments.source started recording
 * where a payment came from — the same gap that made an online sale look
 * missing rather than merely unlabelled.
 */
export const PaymobPaymentsPanel: React.FC<{ notify: NotifyFn }> = ({ notify }) => {
  const [rows, setRows] = useState<PaymobRow[]>([]);
  const [summary, setSummary] = useState<PaymentsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      // The totals are the database's over every Paymob payment (the summary takes the list's own filters); the list is only its latest rows.
      const [res, summaryRes] = await Promise.all([
        fetch(`/api/admin/payments?source=paymob&limit=${LIST_LIMIT}`, { credentials: 'include', headers: adminAuthHeaders() }),
        fetch('/api/admin/payments/summary?source=paymob', { credentials: 'include', headers: adminAuthHeaders() }),
      ]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!summaryRes.ok) throw new Error(`HTTP ${summaryRes.status}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : (data.rows || data.payments || []));
      setSummary(await summaryRes.json() as PaymentsSummary);
    } catch (error) {
      notify('error', error instanceof Error ? `تعذر تحميل مدفوعات باي موب: ${error.message}` : 'تعذر التحميل');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    void load();
    // Once on opening; the refresh button calls load again. notify is rebuilt by the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Collected and not-collected are different things and must never be added
  // together. The route merges in orders with no matching payment — abandoned
  // checkouts and refused attempts — so the split happens here.
  const collected = useMemo(() => rows.filter(row => row.status === 'paid'), [rows]);
  const uncollected = useMemo(
    () => rows.filter(row => row.status !== 'paid' && row.status !== 'refunded'), [rows]);
  const paidGroup = summary?.groups.paid;
  const uncollectedGroup = summary?.groups.uncollected;
  const total = paidGroup?.totalEgp ?? 0;
  const uncollectedTotal = uncollectedGroup?.totalEgp ?? 0;
  const shown = rows.length;
  const matching = (paidGroup?.count ?? 0) + (uncollectedGroup?.count ?? 0) + (summary?.groups.refunded.count ?? 0);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="bg-gradient-to-l from-emerald-600 to-teal-600 rounded-2xl p-5 text-white flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-extrabold text-lg flex items-center gap-2">
            <CreditCard size={20} /> مدفوعات باي موب
          </h3>
          <p className="text-white/80 text-sm mt-1">
            الدفع الإلكتروني بالكارت والمحفظة — منفصل عن الدفعات اللي بيسجّلها الموظفين
          </p>
        </div>
        <div className="text-left">
          <div className="text-2xl font-extrabold font-mono">{money(total)}</div>
          <div className="text-white/70 text-xs">إجمالي المحصّل فعلاً · {paidGroup?.count ?? 0} عملية</div>
          {(paidGroup?.certificateEgp ?? 0) > 0 && <div className="text-white/70 text-[11px]">منه شهادات {money(paidGroup?.certificateEgp ?? 0)}</div>}
          {(paidGroup?.unconverted ?? 0) > 0 && <div className="text-amber-200 text-[11px]">{paidGroup?.unconverted} عملية بعملة أجنبية من غير قيمة بالجنيه مش محسوبة</div>}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-400">{matching > shown ? `الجدول بيعرض آخر ${shown} عملية من ${matching} — الإجماليات فوق على كل العمليات.` : ''}</span>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-bold transition disabled:opacity-40"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} تحديث
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 size={26} className="animate-spin ml-2" /> جاري التحميل...
        </div>
      ) : collected.length === 0 && uncollected.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm border border-dashed border-gray-200 rounded-2xl">
          مفيش مدفوعات إلكترونية لسه
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-2xl">
          <table className="w-full min-w-[52rem] bg-white text-sm">
            <thead>
              <tr className="bg-emerald-50 text-emerald-800 text-xs">
                <th className="p-3 text-right font-bold">التاريخ</th>
                <th className="p-3 text-right font-bold">العميل</th>
                <th className="p-3 text-right font-bold">الكود</th>
                <th className="p-3 text-right font-bold">البند</th>
                <th className="p-3 text-right font-bold">المبلغ</th>
                <th className="p-3 text-right font-bold">الحالة</th>
                <th className="p-3 text-right font-bold">رقم المعاملة</th>
              </tr>
            </thead>
            <tbody>
              {collected.map(row => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="p-3 whitespace-nowrap text-gray-600 text-xs">
                    {new Date(row.at).toLocaleString('ar-EG-u-nu-latn', { timeZone: CAIRO_TIME_ZONE })}
                  </td>
                  <td className="p-3 font-semibold text-gray-800">{row.subscriberName || '—'}</td>
                  <td className="p-3 font-mono text-xs text-gray-500">{row.subscriberClientCode || '—'}</td>
                  <td className="p-3 text-gray-600 text-xs">
                    {row.courseTitleAr || row.courseTitle || row.itemTitle || '—'}
                  </td>
                  <td className="p-3 font-mono font-bold text-emerald-700 whitespace-nowrap">
                    {money(row.amount)} <span className="text-[10px] font-normal text-gray-400">ج.م</span>
                  </td>
                  <td className="p-3">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                      row.status === 'paid' ? 'bg-emerald-100 text-emerald-700'
                        : row.status === 'refunded' ? 'bg-rose-100 text-rose-700'
                          : 'bg-amber-100 text-amber-700'}`}
                    >
                      {row.status === 'paid' ? 'مدفوع' : row.status === 'refunded' ? 'مسترجع' : row.status}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-[11px] text-gray-500 whitespace-nowrap">
                    {row.transactionId || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {uncollected.length > 0 && (
        <div className="border border-amber-200 rounded-2xl overflow-hidden">
          <div className="bg-amber-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-bold text-amber-900 text-sm">محاولات دفع لم تكتمل</div>
              <div className="text-[11px] text-amber-700 mt-0.5">
                العميل فتح صفحة الدفع وما كمّلش — دي مش فلوس محصّلة ومش داخلة في أي إجمالي.
              </div>
            </div>
            <div className="text-left">
              <div className="text-lg font-extrabold font-mono text-amber-800">{money(uncollectedTotal)}</div>
              <div className="text-[11px] text-amber-600">{uncollectedGroup?.count ?? 0} محاولة</div>
            </div>
          </div>
          <table className="w-full bg-white text-sm">
            <tbody>
              {uncollected.map(row => (
                <tr key={row.id} className="border-t border-amber-100">
                  <td className="p-3 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(row.at).toLocaleString('ar-EG-u-nu-latn', { timeZone: CAIRO_TIME_ZONE })}
                  </td>
                  <td className="p-3 text-xs text-gray-700">{row.subscriberName || row.itemTitle || '—'}</td>
                  <td className="p-3 font-mono text-xs text-amber-700">{money(row.amount)} ج.م</td>
                  <td className="p-3">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                      لم تكتمل
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PaymobPaymentsPanel;
