import { useCallback, useEffect, useState } from 'react';
import { Award, BarChart3, BookOpen, Megaphone, RefreshCw, TrendingUp, Users } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { cairoDateOnly, cairoDaysAgo } from '../../../../shared/cairoDate';
import { REPORT_RANGES, TEAM_LABELS, type RangeKey, type TeamKey } from './reports/teamReportColumns';
import { AllTeamsReport } from './reports/AllTeamsReport';
import { TeamReportTable } from './reports/TeamReportTable';
import { OwnerWhatsappReportCard } from './reports/OwnerWhatsappReportCard';

/**
 * «تقارير الإدارة»: the institute's money, per branch, department and type,
 * the best-selling courses, where clients come from, who led, and each team's
 * own report — one page, one period (api/lib/managementReport.js).
 */
type Money = { label: string; payments: number; moneyEgp: number };
type Leader = { id: string; name: string; value: number };
type Row = Record<string, string | number | null>;
type Team = { rows?: Row[]; reps?: Row[]; totals?: Record<string, number | null>; team?: Record<string, number> };
type Report = {
  from: string; to: string;
  income: { totalEgp: number; payments: number; byBranch: Money[]; byDepartment: Money[]; byType: Money[]; byDay: { day: string; payments: number; moneyEgp: number }[] };
  topCourses: { item: string; title: string; kind: string; bookings: number; clients: number; moneyEgp: number }[];
  topSources: { source: string; leads: number; converted: number; rate: number }[];
  leaders: Record<'salesByMoney' | 'salesByCalls' | 'collectionByMoney' | 'supportByResolved' | 'daqqiByMoney', Leader[]>;
  counts: { newLeads: number; newClients: number; pendingPayments: number };
  teams: { sales: Team; online: Team; support: Team; daqqi: Team; tagamoa?: Team };
};

const n = (value: number | string | null | undefined) => Number(value || 0).toLocaleString('ar-EG-u-nu-latn');
const egp = (value: number) => `${n(value)} ج.م`;

function MoneyTable({ title, rows, total }: { title: string; rows: Money[]; total: number }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <h4 className="mb-2 text-sm font-bold text-gray-800">{title}</h4>
      {rows.length === 0 ? <p className="py-4 text-center text-xs text-gray-400">مفيش دخل في الفترة</p> : (
        <div className="space-y-2">
          {rows.map(row => (
            <div key={row.label} className="text-xs">
              <div className="flex justify-between gap-2"><span className="font-bold text-gray-700">{row.label}</span><span className="text-gray-900">{egp(row.moneyEgp)} <span className="text-gray-400">· {n(row.payments)} دفعة</span></span></div>
              <div className="mt-1 h-1.5 rounded-full bg-gray-100"><div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${total ? Math.max(2, (row.moneyEgp / total) * 100) : 0}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Leaders({ title, rows, money }: { title: string; rows: Leader[]; money?: boolean }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-800"><Award size={14} className="text-amber-500" />{title}</h4>
      {rows.length === 0 ? <p className="py-3 text-center text-xs text-gray-400">مفيش أرقام في الفترة</p> : (
        <ol className="space-y-1 text-xs">
          {rows.map((row, index) => (
            <li key={row.id} className="flex justify-between gap-2">
              <span className="font-bold text-gray-700">{index + 1}. {row.name}</span>
              <span className="text-gray-900">{money ? egp(row.value) : n(row.value)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function ManagementReportsTab({ notify }: { notify: (type: 'success' | 'error' | 'info', text: string) => void }) {
  const [range, setRange] = useState<RangeKey>('today');
  // «الكل وجمبه السيلز وغيرهم» (8 Oct 2026): every team first, then each.
  const [team, setTeam] = useState<TeamKey | 'all'>('all');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (key: RangeKey) => {
    const preset = REPORT_RANGES.find(item => item.key === key) || REPORT_RANGES[0];
    const to = preset.offset ? cairoDaysAgo(preset.offset) : cairoDateOnly();
    const from = cairoDaysAgo(preset.offset + preset.days - 1);
    setLoading(true);
    try {
      setReport(await mysqlAdmin.adminGet<Report>(`/admin/reports/management?from=${from}&to=${to}`));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذّر تحميل التقرير');
    } finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(range); }, [load, range]);

  const period = report ? (report.from === report.to ? report.from : `${report.from} → ${report.to}`) : '';
  const teamData = team === 'all' ? undefined : report?.teams[team];
  const teamRows = (team === 'sales' ? teamData?.reps : teamData?.rows) || [];
  const teamTotals = team === 'sales' ? teamData?.team : teamData?.totals;
  const maxDay = Math.max(1, ...(report?.income.byDay || []).map(day => day.moneyEgp));

  return (
    <div className="space-y-5" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-l from-slate-800 to-slate-700 p-5 text-white">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-extrabold"><BarChart3 size={22} /> تقارير الإدارة</h2>
          <p className="text-sm text-white/70">الدخل، الأوائل، وتقارير كل الفرق — {period || '…'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {REPORT_RANGES.map(item => (
            <button key={item.key} type="button" onClick={() => setRange(item.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${range === item.key ? 'bg-white text-slate-800' : 'bg-white/10 text-white hover:bg-white/20'}`}>
              {item.label}
            </button>
          ))}
          <button type="button" onClick={() => void load(range)} className="rounded-lg bg-white/10 p-1.5 hover:bg-white/20" title="تحديث">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <OwnerWhatsappReportCard notify={notify} />

      {!report ? (
        <div className="py-16 text-center text-gray-400">{loading ? 'جارٍ تجهيز التقرير…' : 'مفيش بيانات'}</div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ['الدخل', egp(report.income.totalEgp), `${n(report.income.payments)} دفعة`],
              ['ليدز جديدة', n(report.counts.newLeads), 'دخلت في الفترة'],
              ['عملاء جدد', n(report.counts.newClients), 'اتسجلوا في الفترة'],
              ['حجوزات المبيعات', n(report.teams.sales.team?.bookings), `${egp(Number(report.teams.sales.team?.moneyEgp || 0))}`],
              ['مستنية مراجعة', n(report.counts.pendingPayments), 'دفعة لسه متعتمدتش'],
            ].map(([label, value, hint]) => (
              <div key={label} className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="text-xs font-bold text-gray-500">{label}</div>
                <div className="mt-1 text-xl font-extrabold text-gray-900">{value}</div>
                <div className="text-[11px] text-gray-400">{hint}</div>
              </div>
            ))}
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <MoneyTable title="الدخل حسب الفرع" rows={report.income.byBranch} total={report.income.totalEgp} />
            <MoneyTable title="الدخل حسب القسم" rows={report.income.byDepartment} total={report.income.totalEgp} />
            <MoneyTable title="الدخل حسب النوع" rows={report.income.byType} total={report.income.totalEgp} />
          </section>

          {report.income.byDay.length > 1 && (
            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <h4 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-gray-800"><TrendingUp size={14} className="text-emerald-600" /> الدخل يوم بيوم</h4>
              <div className="flex h-32 items-end gap-1 overflow-x-auto">
                {report.income.byDay.map(day => (
                  <div key={day.day} className="flex min-w-[18px] flex-1 flex-col items-center gap-1" title={`${day.day}: ${egp(day.moneyEgp)} · ${n(day.payments)} دفعة`}>
                    <div className="w-full rounded-t bg-emerald-500" style={{ height: `${Math.max(3, (day.moneyEgp / maxDay) * 100)}px` }} />
                    <span className="text-[9px] text-gray-400">{day.day.slice(8)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-800"><BookOpen size={14} className="text-indigo-600" /> أكثر 10 كورسات مبيعاً</h4>
              {report.topCourses.length === 0 ? <p className="py-4 text-center text-xs text-gray-400">مفيش مبيعات في الفترة</p> : (
                <table className="w-full text-xs">
                  <thead className="text-gray-500"><tr><th className="py-1 text-right">#</th><th className="text-right">الكورس / المسار</th><th>حجوزات</th><th>عملاء</th><th className="text-left">الفلوس</th></tr></thead>
                  <tbody>
                    {report.topCourses.map((course, index) => (
                      <tr key={course.item} className="border-t border-gray-100">
                        <td className="py-1.5 font-bold text-gray-400">{index + 1}</td>
                        <td className="font-bold text-gray-800">{course.title}{course.kind === 'bundle' && <span className="mr-1 text-[10px] text-violet-600">مسار</span>}</td>
                        <td className="text-center">{n(course.bookings)}</td>
                        <td className="text-center">{n(course.clients)}</td>
                        <td className="text-left">{egp(course.moneyEgp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-800"><Megaphone size={14} className="text-rose-600" /> أكتر مصادر جابت عملاء</h4>
              {report.topSources.length === 0 ? <p className="py-4 text-center text-xs text-gray-400">مفيش ليدز في الفترة</p> : (
                <table className="w-full text-xs">
                  <thead className="text-gray-500"><tr><th className="py-1 text-right">المصدر</th><th>ليدز</th><th>اتحولوا عملاء</th><th className="text-left">النسبة</th></tr></thead>
                  <tbody>
                    {report.topSources.map(source => (
                      <tr key={source.source} className="border-t border-gray-100">
                        <td className="py-1.5 font-bold text-gray-800">{source.source}</td>
                        <td className="text-center">{n(source.leads)}</td>
                        <td className="text-center">{n(source.converted)}</td>
                        <td className="text-left">{n(source.rate)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Leaders title="أكتر سيلز حقق فلوس" rows={report.leaders.salesByMoney} money />
            <Leaders title="أكتر سيلز مكالمات" rows={report.leaders.salesByCalls} />
            <Leaders title="أكتر تحصيل" rows={report.leaders.collectionByMoney} money />
            <Leaders title="خدمة العملاء — مشاكل اتحلت" rows={report.leaders.supportByResolved} />
            <Leaders title="الدقي — فلوس اتسجلت" rows={report.leaders.daqqiByMoney} money />
          </section>

          <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center gap-1.5 text-sm font-bold text-gray-800"><Users size={14} className="text-sky-600" /> تقارير الفرق</h4>
              <div className="flex flex-wrap gap-1">
                <button type="button" onClick={() => setTeam('all')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold ${team === 'all' ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-sky-50'}`}>
                  الكل
                </button>
                {/* Tagamoa once it has a team or activity — the branch opens hidden. */}
                {(Object.keys(TEAM_LABELS) as TeamKey[]).filter(key => key !== 'tagamoa'
                  || Boolean(report.teams.tagamoa?.rows?.length || Number(report.teams.tagamoa?.totals?.payments))).map(key => (
                  <button key={key} type="button" onClick={() => setTeam(key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold ${team === key ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-sky-50'}`}>
                    {TEAM_LABELS[key]}
                  </button>
                ))}
              </div>
            </div>
            {team === 'all'
              ? <AllTeamsReport teams={report.teams} />
              : <TeamReportTable team={team} rows={teamRows} totals={teamTotals} />}
          </section>
        </>
      )}
    </div>
  );
}

