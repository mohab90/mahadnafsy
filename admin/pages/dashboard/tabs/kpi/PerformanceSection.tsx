import { useCallback, useEffect, useState } from 'react';
import { Award, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { cairoDateOnly } from '../../../../../shared/cairoDate';
import { ROLE_LABELS, type RoleKey } from '../../../../constants/permissions';

/**
 * «الأداء لكل موظف وكل فرع» on «لوحة KPI — المدير»: the period picker and the server's figures (GET /api/admin/kpi/performance, api/lib/performanceBoard.js).
 * Course money and certificate money are shown apart; revenue is new bookings, collections are instalments.
 */
type Person = {
  id: string; name: string; role: string; branch: string | null; rank: number;
  leads: { received: number; converted: number; rate: number };
  money: { revenue: number; collections: number; certificates: number; total: number };
  responseMinutes: number | null;
  followUps: { waiting: number; contacts: number };
  attendance: { present: number; late: number; absent: number; lateMinutes: number } | null;
  target: { month: string; revenue: number; leads: number; achieved: number; pct: number | null } | null;
  trend: { months: string[]; money: number[]; changeVsAverage: number | null; monthToDate: number };
};
type BranchRow = { branch: string; received: number; converted: number; rate: number; revenue: number; collections: number; certificates: number; total: number };
type Performance = { from: string; to: string; employees: Person[]; branches: BranchRow[] };

const RANGES = [['today', 'النهارده'], ['week', 'آخر 7 أيام'], ['month', 'الشهر'], ['custom', 'فترة محددة']] as const;
type RangeKey = typeof RANGES[number][0];
const BRANCHES: Record<string, string> = {
  DAQQI: 'فرع الدقي', TAGAMOA: 'فرع التجمع', ONLINE_EGYPT: 'أونلاين مصر', ONLINE_SAUDI: 'أونلاين السعودية', ONLINE_ABROAD: 'أونلاين دولي', OTHER: 'أخرى',
};
const n = (value: number) => Math.round(value).toLocaleString('ar-EG-u-nu-latn');
const minutes = (value: number | null) => (value === null ? '—' : value < 60 ? `${n(value)} د` : `${n(Math.round(value / 60))} س`);
const roleLabel = (role: string) => ROLE_LABELS[role.toLowerCase() as RoleKey] || role || '—';

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-gray-300">—</span>;
  const Icon = value >= 0 ? TrendingUp : TrendingDown;
  return <span className={`inline-flex items-center gap-0.5 font-bold ${value >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}><Icon size={11} />{value > 0 ? '+' : ''}{n(value)}٪</span>;
}

export default function PerformanceSection() {
  const [range, setRange] = useState<RangeKey>('month');
  const [from, setFrom] = useState(() => cairoDateOnly());
  const [to, setTo] = useState(() => cairoDateOnly());
  const [data, setData] = useState<Performance | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const query = range === 'custom' ? `range=custom&from=${from}&to=${to}` : `range=${range}`;
    mysqlAdmin.adminGet<Performance>(`/admin/kpi/performance?${query}`)
      .then(answer => { setData(answer); setFailed(false); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [range, from, to]);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="space-y-3" dir="rtl" data-testid="kpi-performance">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-gray-600">الأداء لكل موظف وكل فرع{data ? ` — ${data.from === data.to ? data.from : `${data.from} → ${data.to}`}` : ''}</h3>
        <div className="mr-auto flex flex-wrap items-center gap-1">
          {RANGES.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setRange(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${range === key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-indigo-50'}`}>{label}</button>
          ))}
          {range === 'custom' && (
            <>
              <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} aria-label="من" className="rounded-lg border border-gray-200 px-2 py-1 text-xs" />
              <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} aria-label="إلى" className="rounded-lg border border-gray-200 px-2 py-1 text-xs" />
            </>
          )}
          <button type="button" onClick={load} className="rounded-lg bg-gray-100 p-1.5 hover:bg-gray-200" title="تحديث"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>
      {failed && <p className="text-xs text-rose-600">تعذّر تحميل الأداء — جرّب تاني</p>}
      {data && (
        <>
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="w-full min-w-[1000px] text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-right">#</th><th className="px-2 text-right">الموظف</th>
                  <th className="px-2">ليدات (استلم / اتحول)</th><th className="px-2">التحويل</th><th className="px-2">مبيعات (ج)</th><th className="px-2">تحصيل (ج)</th><th className="px-2">شهادات (ج)</th>
                  <th className="px-2">أول رد</th><th className="px-2">متابعات (مستنية / تواصل)</th><th className="px-2">حضور (حاضر / متأخر / غايب)</th>
                  <th className="px-2">الهدف</th><th className="px-2">آخر 3 شهور</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.employees.length === 0 && <tr><td colSpan={12} className="py-8 text-center text-gray-400">مفيش أرقام في الفترة دي</td></tr>}
                {data.employees.map(person => (
                  <tr key={person.id} className="text-center" data-testid="kpi-employee-row">
                    <td className="px-3 py-2 text-right font-black text-gray-400">{person.rank === 1 ? <Award size={14} className="text-amber-500" /> : person.rank}</td>
                    <td className="px-2 text-right"><div className="font-bold text-gray-800">{person.name}</div><div className="text-[11px] text-gray-400">{roleLabel(person.role)}{person.branch ? ` · ${person.branch}` : ''}</div></td>
                    <td className="px-2">{n(person.leads.received)} / {n(person.leads.converted)}</td>
                    <td className="px-2 font-bold">{person.leads.received ? `${n(person.leads.rate)}٪` : '—'}</td>
                    <td className="px-2 font-bold text-emerald-700">{n(person.money.revenue)}</td>
                    <td className="px-2 font-bold text-sky-700">{n(person.money.collections)}</td>
                    <td className="px-2 text-gray-500">{n(person.money.certificates)}</td>
                    <td className="px-2">{minutes(person.responseMinutes)}</td>
                    <td className="px-2">{n(person.followUps.waiting)} / {n(person.followUps.contacts)}</td>
                    <td className="px-2">{person.attendance ? `${n(person.attendance.present)} / ${n(person.attendance.late)} / ${n(person.attendance.absent)}` : '—'}</td>
                    <td className="px-2">
                      {person.target && person.target.pct !== null ? (
                        <div className="mx-auto w-24"><div className="h-1.5 rounded-full bg-gray-100"><div className={`h-1.5 rounded-full ${person.target.pct >= 100 ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${Math.min(100, person.target.pct)}%` }} /></div>
                          <div className="mt-0.5 text-[11px] text-gray-500">{n(person.target.pct)}٪ من {n(person.target.revenue)}</div></div>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-2"><div className="text-[11px] text-gray-500">{person.trend.money.map(n).join(' · ')}</div><Change value={person.trend.changeVsAverage} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="bg-gray-50 text-gray-500"><tr><th className="px-3 py-2 text-right">الفرع</th><th className="px-2">ليدات</th><th className="px-2">اتحول</th><th className="px-2">التحويل</th><th className="px-2">مبيعات (ج)</th><th className="px-2">تحصيل (ج)</th><th className="px-2">شهادات (ج)</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {data.branches.map(row => (
                  <tr key={row.branch} className="text-center" data-testid="kpi-branch-row">
                    <td className="px-3 py-2 text-right font-bold text-gray-800">{BRANCHES[row.branch] || row.branch}</td>
                    <td className="px-2">{n(row.received)}</td><td className="px-2">{n(row.converted)}</td><td className="px-2 font-bold">{row.received ? `${n(row.rate)}٪` : '—'}</td>
                    <td className="px-2 font-bold text-emerald-700">{n(row.revenue)}</td><td className="px-2 font-bold text-sky-700">{n(row.collections)}</td><td className="px-2 text-gray-500">{n(row.certificates)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
