import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Loader2, Minus, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { isContactedStatus, isInterestedStatus } from '../leadUtils';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type Range = 'today' | '7d' | 'month' | '30d' | 'all';
type LeadRow = { status: string; source: string; n: number };
type Period = { leads: LeadRow[]; revenue: number; payments: number };
type Overview = {
  range: Range; from: string | null; to: string;
  current: Period; previous: (Period & { from: string; to: string }) | null;
  daily: { day: string; leads: number; converted: number; revenue: number }[];
  untouchedLeads: number;
};

const RANGES: { key: Range; label: string }[] = [
  { key: 'today', label: 'اليوم' }, { key: '7d', label: '7 أيام' }, { key: 'month', label: 'الشهر' }, { key: '30d', label: '30 يوم' }, { key: 'all', label: 'الكل' },
];

// «converted» and «won» are one thing to the server (api/lib/leadStatuses.js).
const isConverted = (status: string) => status === 'converted' || status === 'won';
const sum = (rows: LeadRow[], test: (status: string) => boolean = () => true) => rows.filter(r => test(r.status)).reduce((s, r) => s + r.n, 0);
const percent = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);
const money = (n: number) => `${Math.round(n).toLocaleString('ar-EG-u-nu-latn')} ج`;

function Delta({ now, before }: { now: number; before: number | null }) {
  if (before === null) return null;
  if (before === 0) return <span className="text-[11px] text-gray-400">{now > 0 ? 'جديد' : '—'}</span>;
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return <span className="flex items-center gap-0.5 text-[11px] text-gray-400"><Minus size={11} />زي الفترة اللي قبلها</span>;
  return (
    <span className={`flex items-center gap-0.5 text-[11px] font-bold ${change > 0 ? 'text-green-600' : 'text-red-500'}`}>
      {change > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(change)}% عن الفترة اللي قبلها
    </span>
  );
}

/** A line of bars, one per day: the height is the day's share of the busiest day. */
function Bars({ values, color, labels }: { values: number[]; color: string; labels: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-24 items-end gap-0.5" role="img" aria-label={`أعلى قيمة ${max}`}>
      {values.map((value, i) => (
        <div key={labels[i]} className="flex h-full flex-1 flex-col justify-end" title={`${labels[i]}: ${value.toLocaleString('ar-EG-u-nu-latn')}`}>
          <div className={`${color} min-h-[2px] rounded-t`} style={{ height: `${Math.max(value ? 4 : 0, (value / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

/** «نظرة عامة»: the numbers come from the server (GET /admin/marketing/overview) with the period before them to compare against, not from the whole lead and order tables. */
export function MarketingOverview({ notify }: { notify: NotifyFn }) {
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>('month');
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await mysqlAdmin.adminGet<Overview>(`/admin/marketing/overview?range=${range}`));
    } catch {
      notify('error', 'تعذّر تحميل أرقام التسويق');
    } finally { setLoading(false); }
  }, [range, notify]);
  useEffect(() => { void load(); }, [load]);

  const view = useMemo(() => {
    if (!data) return null;
    const { current, previous } = data;
    const total = sum(current.leads);
    const converted = sum(current.leads, isConverted);
    const contacted = sum(current.leads, isContactedStatus);
    const interested = sum(current.leads, isInterestedStatus);
    const prevTotal = previous ? sum(previous.leads) : null;
    const prevConverted = previous ? sum(previous.leads, isConverted) : null;
    const sources = new Map<string, { total: number; converted: number }>();
    for (const row of current.leads) {
      const entry = sources.get(row.source) || { total: 0, converted: 0 };
      entry.total += row.n;
      if (isConverted(row.status)) entry.converted += row.n;
      sources.set(row.source, entry);
    }
    return {
      total, converted, contacted, interested, prevTotal, prevConverted,
      rate: percent(converted, total), prevRate: previous && prevTotal ? percent(prevConverted || 0, prevTotal) : null,
      rows: [...sources.entries()].map(([source, v]) => ({ source, ...v, rate: percent(v.converted, v.total) })).sort((a, b) => b.total - a.total),
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex overflow-hidden rounded-xl border border-gray-200 bg-white">
          {RANGES.map(option => (
            <button key={option.key} type="button" onClick={() => setRange(option.key)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${range === option.key ? 'bg-rose-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />تحديث
        </button>
      </div>

      {loading && !data && <div className="flex justify-center py-16 text-gray-400"><Loader2 className="animate-spin" /></div>}

      {data && view && (
        <>
          {data.untouchedLeads > 0 && (
            <button type="button" onClick={() => navigate('/dashboard/leads')}
              className="flex w-full items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-right text-sm text-amber-900 hover:bg-amber-100">
              <AlertTriangle size={18} className="shrink-0" />
              <span><b>{data.untouchedLeads.toLocaleString('ar-EG-u-nu-latn')}</b> ليد جديد من أكتر من يومين محدش كلمه — افتح العملاء المحتملين وابدأ بيهم</span>
            </button>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: 'ليدات جديدة', value: view.total.toLocaleString('ar-EG-u-nu-latn'), now: view.total, before: view.prevTotal },
              { label: 'تحويلات', value: view.converted.toLocaleString('ar-EG-u-nu-latn'), now: view.converted, before: view.prevConverted },
              { label: 'معدل التحويل', value: `${view.rate}%`, now: view.rate, before: view.prevRate },
              { label: 'إيراد محصّل', value: money(data.current.revenue), now: data.current.revenue, before: data.previous ? data.previous.revenue : null, sub: `${data.current.payments.toLocaleString('ar-EG-u-nu-latn')} دفعة` },
            ].map(card => (
              <div key={card.label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-medium text-gray-500">{card.label}</div>
                <div className="mt-1 text-2xl font-black text-gray-900">{card.value}</div>
                {card.sub && <div className="text-xs text-gray-400">{card.sub}</div>}
                <div className="mt-1"><Delta now={card.now} before={card.before} /></div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-bold text-gray-800">الليدات يوم بيوم</h3>
              <Bars values={data.daily.map(d => d.leads)} labels={data.daily.map(d => d.day)} color="bg-rose-400" />
              <div className="mt-1 flex justify-between text-[10px] text-gray-400"><span>{data.daily[0]?.day}</span><span>{data.daily.at(-1)?.day}</span></div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-bold text-gray-800">الإيراد يوم بيوم (جنيه)</h3>
              <Bars values={data.daily.map(d => d.revenue)} labels={data.daily.map(d => d.day)} color="bg-emerald-400" />
              <div className="mt-1 flex justify-between text-[10px] text-gray-400"><span>{data.daily[0]?.day}</span><span>{data.daily.at(-1)?.day}</span></div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-bold text-gray-800">مسار الليد</h3>
            <div className="space-y-2">
              {[
                { label: 'الليدات الواردة', value: view.total, color: 'bg-rose-500' },
                { label: 'تم التواصل', value: view.contacted, color: 'bg-orange-500' },
                { label: 'مهتم', value: view.interested, color: 'bg-amber-500' },
                { label: 'تحويل ناجح', value: view.converted, color: 'bg-green-500' },
              ].map(step => (
                <div key={step.label} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 text-gray-600">{step.label}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div className={`${step.color} h-full rounded-full`} style={{ width: `${percent(step.value, view.total)}%` }} />
                  </div>
                  <span className="w-20 text-left font-bold text-gray-700">{step.value.toLocaleString('ar-EG-u-nu-latn')} <span className="text-xs font-normal text-gray-400">({percent(step.value, view.total)}%)</span></span>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3 text-sm font-bold text-gray-800">المصادر — أنهي مصدر بيجيب عملاء فعلًا؟</div>
            {view.rows.length === 0 ? (
              <p className="p-8 text-center text-sm text-gray-400">مفيش ليدات في الفترة دي</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr><th className="p-3 text-right font-medium">المصدر</th><th className="p-3 text-center font-medium">ليدات</th><th className="p-3 text-center font-medium">تحويلات</th><th className="p-3 text-center font-medium">معدل التحويل</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {view.rows.map(row => (
                      <tr key={row.source}>
                        <td className="p-3 font-medium text-gray-800">{row.source}</td>
                        <td className="p-3 text-center">{row.total.toLocaleString('ar-EG-u-nu-latn')}</td>
                        <td className="p-3 text-center">{row.converted.toLocaleString('ar-EG-u-nu-latn')}</td>
                        <td className="p-3 text-center"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${row.rate >= 15 ? 'bg-green-100 text-green-700' : row.rate >= 5 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{row.rate}%</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
