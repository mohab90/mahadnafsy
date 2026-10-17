import { useCallback, useEffect, useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type Endpoint = {
  route: string; count: number; errors: number; p50: number; p95: number; max: number;
  avgKb: number; avgQueries: number; maxQueries: number; avgDbMs: number;
};
type Snapshot = {
  since: string;
  thresholds: { slowRequestMs: number; slowQueryMs: number; manyQueries: number };
  requests: number;
  slowest: Endpoint[]; heaviest: Endpoint[]; chattiest: Endpoint[];
  slowQueries: Array<{ shape: string; count: number; avgMs: number; maxMs: number; lastAt: string }>;
};

const ms = (value: number) => `${value.toLocaleString('ar-EG-u-nu-latn')}ms`;

/**
 * «السيستم بطيء» answered with numbers: which endpoints are slow, which send the most, which make
 * the most queries, and which query shapes ran slowly — since the server last started.
 * The 95th percentile is what a person waits on one time in twenty.
 */
export default function PerformancePanel() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await mysqlAdmin.adminGet<Snapshot>('/admin/monitoring/performance')); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل أداء الطلبات'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const slowCut = data?.thresholds.slowRequestMs ?? 1500;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
          <Gauge size={15} className="text-gray-500" />
          أداء الطلبات
          {data && <span className="text-xs text-gray-400 font-normal">— {data.requests.toLocaleString('ar-EG-u-nu-latn')} طلب من تشغيل السيرفر</span>}
        </h3>
        <button onClick={() => void load()} disabled={loading} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-50" aria-label="تحديث">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {error ? <p className="p-4 text-sm text-red-600">{error}</p> : !data ? <p className="p-6 text-center text-sm text-gray-400">جاري التحميل...</p> : (
        <div className="space-y-5 p-4 text-xs">
          <section>
            <h4 className="mb-2 font-bold text-gray-700">الأبطأ (٩٥٪ من الطلبات أسرع من الرقم ده)</h4>
            {data.slowest.length === 0 ? <p className="text-gray-400">مفيش طلبات اتسجلت لسه.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-right">
                  <thead><tr className="border-b text-gray-500">
                    <th className="p-1.5">الطلب</th><th className="p-1.5">مرات</th><th className="p-1.5">وسيط</th><th className="p-1.5">٩٥٪</th>
                    <th className="p-1.5">أقصى</th><th className="p-1.5">قاعدة البيانات</th><th className="p-1.5">استعلامات</th><th className="p-1.5">حجم</th>
                  </tr></thead>
                  <tbody>
                    {data.slowest.map(row => (
                      <tr key={row.route} className="border-b border-gray-50">
                        <td className="p-1.5 font-mono text-[11px]" dir="ltr">{row.route}</td>
                        <td className="p-1.5">{row.count}</td>
                        <td className="p-1.5">{ms(row.p50)}</td>
                        <td className={`p-1.5 font-bold ${row.p95 >= slowCut ? 'text-red-600' : row.p95 >= slowCut / 3 ? 'text-amber-600' : 'text-gray-700'}`}>{ms(row.p95)}</td>
                        <td className="p-1.5">{ms(row.max)}</td>
                        <td className="p-1.5">{ms(row.avgDbMs)}</td>
                        <td className="p-1.5">{row.avgQueries}</td>
                        <td className="p-1.5">{row.avgKb} KB</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <div className="grid gap-5 lg:grid-cols-2">
            <section>
              <h4 className="mb-2 font-bold text-gray-700">الأثقل في الحجم (متوسط الرد)</h4>
              <ul className="space-y-1">
                {data.heaviest.slice(0, 6).map(row => (
                  <li key={row.route} className="flex items-center justify-between gap-2"><span className="font-mono text-[11px]" dir="ltr">{row.route}</span><span className="font-bold">{row.avgKb} KB</span></li>
                ))}
              </ul>
            </section>
            <section>
              <h4 className="mb-2 font-bold text-gray-700">الأكتر استعلامات في الطلب الواحد</h4>
              <ul className="space-y-1">
                {data.chattiest.slice(0, 6).map(row => (
                  <li key={row.route} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px]" dir="ltr">{row.route}</span>
                    <span className={`font-bold ${row.avgQueries >= data.thresholds.manyQueries ? 'text-red-600' : ''}`}>{row.avgQueries}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <section>
            <h4 className="mb-2 font-bold text-gray-700">استعلامات بطيئة (أبطأ من {ms(data.thresholds.slowQueryMs)})</h4>
            {data.slowQueries.length === 0 ? <p className="text-emerald-700">مفيش استعلام بطيء من تشغيل السيرفر.</p> : (
              <ul className="space-y-2">
                {data.slowQueries.slice(0, 10).map(query => (
                  <li key={query.shape} className="rounded-lg bg-gray-50 p-2">
                    <p className="font-mono text-[11px] text-gray-700" dir="ltr">{query.shape}</p>
                    <p className="mt-1 text-gray-500">{query.count} مرة — متوسط {ms(query.avgMs)} — أقصى {ms(query.maxMs)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
