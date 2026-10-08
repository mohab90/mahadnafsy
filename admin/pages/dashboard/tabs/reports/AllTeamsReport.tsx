import { REPORT_NOTE, TEAM_LABELS, type TeamKey } from './teamReportColumns';

// «في تقارير الفرق خلي في الكل وجمبه السيلز وغيرهم» (8 Oct 2026): every team on
// one screen — a line per team, then every employee in one table, with the
// figures they share (contacts, money, what they closed) beside their team.
type Row = Record<string, string | number | null>;
type Team = { rows?: Row[]; reps?: Row[]; totals?: Record<string, number | null> | null; team?: Record<string, number | null> | null };

const n = (value: unknown) => Number(value || 0).toLocaleString('ar-EG-u-nu-latn');
const money = (row: Row) => Number(row.moneyEgp ?? row.collectedEgp ?? 0);
const closed = (team: TeamKey, row: Row) => Number(team === 'sales' ? row.bookings : team === 'support' ? row.problemsResolved : row.payments) || 0;
const CLOSED_LABEL: Record<TeamKey, string> = { sales: 'حجوزات', online: 'دفعات', support: 'مشاكل حلها', daqqi: 'دفعات', tagamoa: 'دفعات' };

export function AllTeamsReport({ teams }: { teams: Partial<Record<TeamKey, Team>> }) {
  const keys = (Object.keys(TEAM_LABELS) as TeamKey[]).filter(key => teams[key]);
  const people = keys.flatMap(key => ((key === 'sales' ? teams[key]?.reps : teams[key]?.rows) || []).map(row => ({ team: key, row })));
  const sum = (key: TeamKey, pick: (row: Row) => number) => ((key === 'sales' ? teams[key]?.reps : teams[key]?.rows) || []).reduce((total, row) => total + pick(row), 0);
  const ranked = [...people].sort((a, b) => money(b.row) - money(a.row) || (Number(b.row.calls) || 0) - (Number(a.row.calls) || 0));
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-sky-50 text-sky-900">
            <tr>{['الفريق', 'الموظفين', 'مكالمات', 'واتساب', 'اللي قفلوه', 'الفلوس'].map(title => <th key={title} className="px-2 py-2 text-right">{title}</th>)}</tr>
          </thead>
          <tbody>
            {keys.map(key => (
              <tr key={key} className="border-t border-gray-100">
                <td className="px-2 py-1.5 font-bold text-gray-800">{TEAM_LABELS[key]}</td>
                <td className="px-2 py-1.5">{n(((key === 'sales' ? teams[key]?.reps : teams[key]?.rows) || []).length)}</td>
                <td className="px-2 py-1.5">{n(sum(key, row => Number(row.calls) || 0))}</td>
                <td className="px-2 py-1.5">{n(sum(key, row => Number(row.whatsapp) || 0))}</td>
                <td className="px-2 py-1.5">{n(sum(key, row => closed(key, row)))} <span className="text-gray-400">{CLOSED_LABEL[key]}</span></td>
                <td className="px-2 py-1.5 font-bold text-emerald-700">{n(sum(key, money))} ج.م</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>{['الموظف', 'الفريق', 'مكالمات', 'واتساب', 'اللي قفله', 'الفلوس'].map(title => <th key={title} className="px-2 py-2 text-right">{title}</th>)}</tr>
          </thead>
          <tbody>
            {ranked.length === 0 ? (
              <tr><td colSpan={6} className="py-6 text-center text-gray-400">مفيش موظفين</td></tr>
            ) : ranked.map(({ team, row }) => (
              <tr key={`${team}-${String(row.id)}`} className="border-t border-gray-100">
                <td className="px-2 py-1.5 font-bold text-gray-800">{row.name}</td>
                <td className="px-2 py-1.5 text-gray-500">{TEAM_LABELS[team]}</td>
                <td className="px-2 py-1.5">{n(row.calls)}</td>
                <td className="px-2 py-1.5">{n(row.whatsapp)}</td>
                <td className="px-2 py-1.5">{n(closed(team, row))} <span className="text-gray-400">{CLOSED_LABEL[team]}</span></td>
                <td className="px-2 py-1.5 font-bold text-emerald-700">{money(row) ? `${n(money(row))} ج.م` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-5 text-gray-500">{REPORT_NOTE}</p>
    </div>
  );
}
