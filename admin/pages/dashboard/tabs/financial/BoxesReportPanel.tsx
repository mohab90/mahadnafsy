import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Vault } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type Window = 1 | 7 | 15 | 30;
type Box = { method: string; currency: string; totals: Record<Window, number>; counts: Record<Window, number> };
type BoxesReport = { branch: string | null; today: string; windows: Record<Window, string>; boxes: Box[] };

const WINDOWS: Array<[Window, string]> = [[1, 'اليوم'], [7, 'آخر 7 أيام'], [15, 'آخر 15 يوم'], [30, 'آخر 30 يوم']];
const num = (value: number) => value.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 });

/**
 * «كل وسائل الدفع اللى تمت للدقي وكل وسيله دفع خزنتها كام … بتقرير يومي
 * واسبوعي وكل 15 وكل 30 يوم». One row per box, the four periods side by side,
 * refunds out of a box netted (GET /api/admin/finance/boxes). A branch sees its
 * own clients' money only; the main books see every branch.
 */
export function BoxesReportPanel({ branch }: { branch?: string }) {
  const [report, setReport] = useState<BoxesReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError('');
    mysqlAdmin.adminGet<BoxesReport>(`/admin/finance/boxes${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`)
      .then(setReport)
      .catch(err => setError(err instanceof Error ? err.message : 'تعذر تحميل الخزائن'))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [branch]);

  const currencies = [...new Set((report?.boxes || []).map(box => box.currency))];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-extrabold text-gray-800">
          <Vault size={16} className="text-emerald-600" />
          الخزائن — كل وسيلة دفع وفيها كام
          {report?.today && <span className="text-[11px] font-semibold text-gray-400">لحد {report.today}</span>}
        </h3>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} تحديث
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : loading && !report ? (
        <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 size={18} className="ml-2 animate-spin" /> جاري التحميل...</div>
      ) : !report?.boxes.length ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">مفيش فلوس دخلت أي خزنة في آخر 30 يوم.</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2.5 text-right font-semibold">وسيلة الدفع</th>
                {WINDOWS.map(([days, label]) => (
                  <th key={days} className="px-3 py-2.5 text-right font-semibold">
                    {label}
                    <div className="text-[10px] font-normal text-gray-400">من {report.windows[days]}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.boxes.map((box, index) => (
                <tr key={`${box.method}:${box.currency}`} className={`${index % 2 ? 'bg-gray-50' : 'bg-white'} border-t border-gray-100`}>
                  <td className="px-3 py-2 font-bold text-gray-800">{box.method}</td>
                  {WINDOWS.map(([days]) => (
                    <td key={days} className="px-3 py-2 whitespace-nowrap">
                      <span className={`font-bold ${box.totals[days] < 0 ? 'text-red-600' : box.totals[days] ? 'text-emerald-700' : 'text-gray-300'}`}>
                        {num(box.totals[days])} {box.currency === 'EGP' ? 'ج.م' : box.currency}
                      </span>
                      {box.counts[days] > 0 && <span className="mr-1 text-[10px] text-gray-400">({box.counts[days]} دفعة)</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-emerald-50/60 font-extrabold">
              {currencies.map(currency => (
                <tr key={currency}>
                  <td className="px-3 py-2 text-emerald-900">الإجمالي{currencies.length > 1 ? ` (${currency})` : ''}</td>
                  {WINDOWS.map(([days]) => (
                    <td key={days} className="px-3 py-2 whitespace-nowrap text-emerald-800">
                      {num(report.boxes.filter(box => box.currency === currency).reduce((sum, box) => sum + box.totals[days], 0))} {currency === 'EGP' ? 'ج.م' : currency}
                    </td>
                  ))}
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-[11px] text-gray-400">الاسترداد بيتخصم من الخزنة اللي خرج منها. الأرقام من الدفعات المعتمدة بس — الدفعات اللي مستنية مراجعة مش محسوبة.</p>
    </div>
  );
}
