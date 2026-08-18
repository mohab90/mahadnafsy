import React, { useEffect, useMemo, useState } from 'react';
import { CreditCard, Loader2, RefreshCw } from 'lucide-react';

import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';

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
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/payments?source=paymob&limit=200', {
        credentials: 'include', headers: adminAuthHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : (data.rows || data.payments || []));
    } catch (error) {
      notify('error', error instanceof Error ? `تعذر تحميل مدفوعات باي موب: ${error.message}` : 'تعذر التحميل');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = useMemo(
    () => rows.filter(row => row.status === 'paid').reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [rows]);

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
          <div className="text-white/70 text-xs">إجمالي المحصّل · {rows.length} عملية</div>
        </div>
      </div>

      <div className="flex justify-end">
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
      ) : rows.length === 0 ? (
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
              {rows.map(row => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="p-3 whitespace-nowrap text-gray-600 text-xs">
                    {new Date(row.at).toLocaleString('ar-EG')}
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
    </div>
  );
};

export default PaymobPaymentsPanel;
