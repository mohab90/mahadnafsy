import { useCallback, useEffect, useState } from 'react';
import { BarChart3, RefreshCw, Users } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { cairoDateOnly, cairoDaysAgo } from '../../../../shared/cairoDate';
import { REPORT_RANGES, TEAM_LABELS, type RangeKey, type TeamKey } from './reports/teamReportColumns';
import { AllTeamsReport } from './reports/AllTeamsReport';
import { TeamReportTable } from './reports/TeamReportTable';
import { OwnerWhatsappReportCard } from './reports/OwnerWhatsappReportCard';
import { WeeklyBranchReport } from './reports/WeeklyBranchReport';
import { ReportCard } from './reports/ReportCard';
import type { ReportCatalogEntry } from './reports/reportFormat';

/**
 * «تقارير الإدارة»: the reports in six groups — sales, finance, collections, HR, marketing, operations — each with a line saying what it is, the period, an
 * Excel/CSV export and a printout (api/lib/reportRunner.js lists and runs them); the headline figures and every team's own report (api/lib/managementReport.js).
 */
type Row = Record<string, string | number | null>;
type Team = { rows?: Row[]; reps?: Row[]; totals?: Record<string, number | null>; team?: Record<string, number> };
type Report = {
  from: string; to: string;
  income: { totalEgp: number; payments: number };
  counts: { newLeads: number; newClients: number; pendingPayments: number };
  teams: { sales: Team; online: Team; support: Team; daqqi: Team; tagamoa?: Team };
};

// The six groups in the order the owner reads them; the catalogue says which report belongs to which.
const GROUPS = [['sales', 'المبيعات'], ['finance', 'المالية'], ['collections', 'التحصيل'], ['hr', 'الموارد البشرية'], ['marketing', 'التسويق'], ['operations', 'العمليات']] as const;
type GroupKey = typeof GROUPS[number][0];

const n = (value: number | string | null | undefined) => Number(value || 0).toLocaleString('ar-EG-u-nu-latn');
const egp = (value: number) => `${n(value)} ج.م`;

export default function ManagementReportsTab({ notify }: { notify: (type: 'success' | 'error' | 'info', text: string) => void }) {
  const [range, setRange] = useState<RangeKey>('today');
  const [group, setGroup] = useState<GroupKey>('sales');
  // «الكل وجمبه السيلز وغيرهم» (8 Oct 2026): every team first, then each.
  const [team, setTeam] = useState<TeamKey | 'all'>('all');
  const [report, setReport] = useState<Report | null>(null);
  const [catalog, setCatalog] = useState<ReportCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const preset = REPORT_RANGES.find(item => item.key === range) || REPORT_RANGES[0];
  const to = preset.offset ? cairoDaysAgo(preset.offset) : cairoDateOnly();
  const from = cairoDaysAgo(preset.offset + preset.days - 1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await mysqlAdmin.adminGet<Report>(`/admin/reports/management?from=${from}&to=${to}`));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذّر تحميل التقرير');
    } finally { setLoading(false); }
  }, [notify, from, to]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { mysqlAdmin.adminGet<ReportCatalogEntry[]>('/admin/reports/catalog').then(setCatalog).catch(() => notify('error', 'تعذّر تحميل قائمة التقارير')); }, [notify]);

  const period = report ? (report.from === report.to ? report.from : `${report.from} → ${report.to}`) : '';
  const teamData = team === 'all' ? undefined : report?.teams[team];
  const teamRows = (team === 'sales' ? teamData?.reps : teamData?.rows) || [];
  const teamTotals = team === 'sales' ? teamData?.team : teamData?.totals;

  return (
    <div className="space-y-5" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-l from-slate-800 to-slate-700 p-5 text-white print:hidden">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-extrabold"><BarChart3 size={22} /> تقارير الإدارة</h2>
          <p className="text-sm text-white/70">ستة أقسام، كل تقرير ليه وصف وتصدير Excel وطباعة — {period || '…'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {REPORT_RANGES.map(item => (
            <button key={item.key} type="button" onClick={() => setRange(item.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${range === item.key ? 'bg-white text-slate-800' : 'bg-white/10 text-white hover:bg-white/20'}`}>
              {item.label}
            </button>
          ))}
          <button type="button" onClick={() => void load()} className="rounded-lg bg-white/10 p-1.5 hover:bg-white/20" title="تحديث">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      {report && (
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
      )}

      <nav className="flex flex-wrap gap-1 print:hidden" aria-label="أقسام التقارير">
        {GROUPS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setGroup(key)} data-testid={`report-group-${key}`}
            className={`rounded-xl px-4 py-2 text-sm font-bold ${group === key ? 'bg-slate-800 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-slate-50'}`}>{label}</button>
        ))}
      </nav>

      <section className="space-y-3">
        {catalog.filter(entry => entry.group === group).map(entry => <ReportCard key={`${entry.key}:${from}:${to}`} entry={entry} from={from} to={to} notify={notify} />)}
      </section>

      {group === 'sales' && report && (
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
      )}

      {group === 'operations' && (
        <>
          <WeeklyBranchReport notify={notify} />
          <OwnerWhatsappReportCard notify={notify} />
        </>
      )}
    </div>
  );
}
