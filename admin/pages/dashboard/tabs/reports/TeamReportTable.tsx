import { REPORT_NOTE, TEAM_COLUMNS, TEAM_TOTAL_LABELS, type TeamKey } from './teamReportColumns';

type Row = Record<string, string | number | null>;

const n = (value: number | string | null | undefined) => Number(value || 0).toLocaleString('ar-EG-u-nu-latn');
const egp = (value: number) => `${n(value)} ج.م`;

/** One team's figures: its headline, then a row per employee. */
export function TeamReportTable({ team, rows, totals }: {
  team: TeamKey; rows: Row[]; totals?: Record<string, number | null> | null;
}) {
  const columns = TEAM_COLUMNS[team];
  return (
    <div className="space-y-3">
      {totals && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {Object.entries(TEAM_TOTAL_LABELS[team]).map(([key, label]) => (
            <span key={key} className="rounded-lg bg-gray-50 px-2 py-1 text-gray-700">{label}: <strong>{n(totals[key])}</strong></span>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-2 py-2 text-right">الموظف</th>
              {columns.map(column => <th key={column.key} className="px-2 py-2">{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length + 1} className="py-6 text-center text-gray-400">مفيش موظفين في الفريق ده</td></tr>
            ) : rows.map(row => (
              <tr key={String(row.id)} className="border-t border-gray-100">
                <td className="px-2 py-1.5 font-bold text-gray-800">{row.name}</td>
                {columns.map(column => (
                  <td key={column.key} className="px-2 py-1.5 text-center">
                    {row[column.key] === null ? '—' : column.money ? egp(Number(row[column.key] || 0)) : n(row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-5 text-gray-500">{REPORT_NOTE}</p>
    </div>
  );
}
