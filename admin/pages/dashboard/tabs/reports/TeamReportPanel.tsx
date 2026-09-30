import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { useAuth } from '../../../../context/AuthContext';
import { cairoDateOnly, cairoDaysAgo } from '../../../../../shared/cairoDate';
import { REPORT_RANGES, TEAM_LABELS, type RangeKey, type TeamKey } from './teamReportColumns';
import { TeamReportTable } from './TeamReportTable';

// Who may read each team's report — mirrors TEAM_READERS in
// api/routes/management-reports.js. The screens it sits on open more widely
// (online_hub to anyone with manage_subscribers), so it shows only for them.
const READERS: Record<Exclude<TeamKey, 'sales'>, string[]> = {
  online: ['manage_sales_team', 'view_perf_online'],
  support: ['manage_sales_team', 'view_perf_cx'],
  daqqi: ['manage_sales_team', 'view_perf_daqqi'],
};

type Report = { from: string; to: string; rows: Record<string, string | number | null>[]; totals: Record<string, number | null> };

/**
 * A team's daily report on the team's own screen — «التقرير اليومي» for the
 * online, customer-service and Dokki teams, as the sales team has one
 * (api/lib/teamReports.js).
 */
export function TeamReportPanel({ team, notify }: {
  team: Exclude<TeamKey, 'sales'>;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}) {
  const { authUser } = useAuth();
  const permissions = authUser?.permissions;
  const canRead = permissions === '*' || (Array.isArray(permissions) && READERS[team].some(key => permissions.includes(key)));
  const [range, setRange] = useState<RangeKey>('today');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (key: RangeKey) => {
    const preset = REPORT_RANGES.find(item => item.key === key) || REPORT_RANGES[0];
    const to = preset.offset ? cairoDaysAgo(preset.offset) : cairoDateOnly();
    const from = cairoDaysAgo(preset.offset + preset.days - 1);
    setLoading(true);
    try {
      setReport(await mysqlAdmin.adminGet<Report>(`/admin/reports/teams/${team}?from=${from}&to=${to}`));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذّر تحميل التقرير');
    } finally { setLoading(false); }
  }, [notify, team]);
  useEffect(() => { if (canRead) void load(range); }, [canRead, load, range]);

  if (!canRead) return null;
  const period = report ? (report.from === report.to ? report.from : `${report.from} → ${report.to}`) : '';

  return (
    <section className="space-y-3 rounded-2xl border border-indigo-200 bg-white p-4" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-bold text-gray-900">
          <CalendarDays size={17} className="text-indigo-600" /> التقرير اليومي — {TEAM_LABELS[team]}
          {period && <span className="text-xs font-normal text-gray-500">({period})</span>}
        </h3>
        <div className="flex flex-wrap items-center gap-1">
          {REPORT_RANGES.map(item => (
            <button key={item.key} type="button" onClick={() => setRange(item.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${range === item.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-indigo-50'}`}>
              {item.label}
            </button>
          ))}
          <button type="button" onClick={() => void load(range)} className="rounded-lg bg-gray-100 p-1.5 hover:bg-indigo-50" title="تحديث">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>
      {report ? <TeamReportTable team={team} rows={report.rows} totals={report.totals} />
        : <div className="py-8 text-center text-sm text-gray-400">{loading ? 'جارٍ تجهيز التقرير…' : 'مفيش بيانات'}</div>}
    </section>
  );
}
