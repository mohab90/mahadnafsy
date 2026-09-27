import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { cairoDateOnly, cairoDaysAgo } from '../../../../../shared/cairoDate';

/**
 * «أداء الفريق» opens on the day: per rep, what they did and what came of it —
 * calls, the leads they received, follow-ups, bookings and money — for today,
 * yesterday, or the last 7, 15 or 30 days. Figures come from the server
 * (api/lib/teamDailyReport.js), over Cairo days, so they do not depend on how
 * much of the leads list this screen happens to hold.
 */
type RepRow = {
  id: string; name: string;
  calls: number; whatsapp: number; meetings: number; contacts: number; leadsContacted: number;
  newLeads: number; followUpsDue: number; followUpsOverdue: number;
  bookings: number; installments: number; moneyEgp: number;
};
type Report = {
  from: string; to: string; today: string;
  team: {
    newLeads: number; newLeadsUnassigned: number; calls: number; whatsapp: number; contacts: number;
    leadsContacted: number; followUpsDue: number; followUpsOverdue: number;
    bookings: number; installments: number; moneyEgp: number;
  };
  reps: RepRow[];
  unattributed: { bookings: number; installments: number; moneyEgp: number } | null;
};

const RANGES = [
  { key: 'today', label: 'النهارده', days: 1, offset: 0 },
  { key: 'yesterday', label: 'أمس', days: 1, offset: 1 },
  { key: '7', label: '7 أيام', days: 7, offset: 0 },
  { key: '15', label: '15 يوم', days: 15, offset: 0 },
  { key: '30', label: '30 يوم', days: 30, offset: 0 },
] as const;
type RangeKey = typeof RANGES[number]['key'];

const n = (value: number) => value.toLocaleString('ar-EG-u-nu-latn');

export function TeamDailyReport({ notify }: { notify: (type: 'success' | 'error' | 'info', text: string) => void }) {
  const [range, setRange] = useState<RangeKey>('today');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (key: RangeKey) => {
    const preset = RANGES.find(item => item.key === key) || RANGES[0];
    const to = preset.offset ? cairoDaysAgo(preset.offset) : cairoDateOnly();
    const from = cairoDaysAgo(preset.offset + preset.days - 1);
    setLoading(true);
    try {
      setReport(await mysqlAdmin.adminGet<Report>(`/admin/crm/team-report?from=${from}&to=${to}`));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذّر تحميل التقرير');
    } finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(range); }, [load, range]);

  const team = report?.team;
  const cards: Array<[string, string, string]> = team ? [
    ['ليدز جديدة دخلت', n(team.newLeads), team.newLeadsUnassigned ? `${n(team.newLeadsUnassigned)} منهم مستنيين توزيع` : 'كلهم اتوزعوا'],
    ['مكالمات', n(team.calls), `${n(team.leadsContacted)} عميل اتكلم · ${n(team.whatsapp)} واتساب`],
    ['حجوزات', n(team.bookings), team.installments ? `+ ${n(team.installments)} قسط` : 'بدون أقساط'],
    ['الفلوس', `${n(team.moneyEgp)} ج.م`, 'اللي اتحصّل في الفترة'],
    ['متابعات', n(team.followUpsDue), `${n(team.followUpsOverdue)} متأخرة لحد النهارده`],
  ] : [];
  const period = report ? (report.from === report.to ? report.from : `${report.from} → ${report.to}`) : '';

  return (
    <section className="space-y-3 rounded-2xl border border-indigo-200 bg-white p-4" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-bold text-gray-900">
          <CalendarDays size={17} className="text-indigo-600" /> التقرير اليومي للفريق
          {period && <span className="text-xs font-normal text-gray-500">({period})</span>}
        </h3>
        <div className="flex flex-wrap items-center gap-1">
          {RANGES.map(item => (
            <button key={item.key} type="button" onClick={() => setRange(item.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                range === item.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-indigo-50'}`}>
              {item.label}
            </button>
          ))}
          <button type="button" onClick={() => { void load(range); }} className="rounded-lg p-2 text-gray-500" aria-label="تحديث">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      {team && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {cards.map(([label, value, hint]) => (
            <div key={label} className="rounded-xl bg-indigo-50/70 p-3">
              <div className="text-[11px] font-bold text-gray-600">{label}</div>
              <div className="mt-0.5 text-xl font-black text-indigo-700">{value}</div>
              <div className="text-[10px] text-gray-500">{hint}</div>
            </div>
          ))}
        </div>
      )}

      {report && (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                {['السيلز', 'مكالمات', 'واتساب', 'عملاء اتكلموا', 'ليدز جديدة استلمها', 'متابعات الفترة', 'متأخرة', 'حجوزات', 'أقساط', 'الفلوس (ج.م)'].map(title => (
                  <th key={title} className="px-2 py-2 text-right font-bold">{title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.reps.map(rep => (
                <tr key={rep.id} className="border-t border-gray-100">
                  <td className="px-2 py-1.5 font-bold text-gray-800">{rep.name}</td>
                  <td className="px-2 py-1.5">{n(rep.calls)}</td>
                  <td className="px-2 py-1.5">{n(rep.whatsapp)}</td>
                  <td className="px-2 py-1.5">{n(rep.leadsContacted)}</td>
                  <td className="px-2 py-1.5">{n(rep.newLeads)}</td>
                  <td className="px-2 py-1.5">{n(rep.followUpsDue)}</td>
                  <td className={`px-2 py-1.5 ${rep.followUpsOverdue ? 'font-bold text-red-600' : ''}`}>{n(rep.followUpsOverdue)}</td>
                  <td className="px-2 py-1.5">{n(rep.bookings)}</td>
                  <td className="px-2 py-1.5">{n(rep.installments)}</td>
                  <td className="px-2 py-1.5 font-bold text-emerald-700">{n(rep.moneyEgp)}</td>
                </tr>
              ))}
              {report.unattributed && (report.unattributed.bookings > 0 || report.unattributed.installments > 0) && (
                <tr className="border-t border-gray-100 bg-amber-50/60 text-amber-800">
                  <td className="px-2 py-1.5 font-bold" title="عميل مدفوع مش متسجل عليه سيلز">من غير سيلز</td>
                  <td className="px-2 py-1.5" colSpan={6}>مدفوعات لعملاء مش متسجل عليهم سيلز — حدد السيلز من كارت العميل عشان تتحسب له</td>
                  <td className="px-2 py-1.5">{n(report.unattributed.bookings)}</td>
                  <td className="px-2 py-1.5">{n(report.unattributed.installments)}</td>
                  <td className="px-2 py-1.5 font-bold">{n(report.unattributed.moneyEgp)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
