import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, TrendingDown, TrendingUp, UserCheck } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { useVisibleInterval } from '../../../../../shared/useVisibleInterval';
import { alertsOf, BOARD_ROWS, changePct, type OverviewBoardData } from './boardFigures';

const n = (value: number) => Math.round(value).toLocaleString('ar-EG-u-nu-latn');
const TONES = { rose: 'border-rose-200 bg-rose-50 text-rose-800', amber: 'border-amber-200 bg-amber-50 text-amber-800', sky: 'border-sky-200 bg-sky-50 text-sky-800' } as const;

function Change({ now, before, lowerIsBetter }: { now: number; before: number; lowerIsBetter?: boolean }) {
  const pct = changePct(now, before);
  if (pct === null) return <span className="text-gray-300">—</span>;
  const good = lowerIsBetter ? pct <= 0 : pct >= 0;
  const Icon = pct >= 0 ? TrendingUp : TrendingDown;
  return <span className={`inline-flex items-center gap-0.5 font-bold ${good ? 'text-emerald-600' : 'text-rose-600'}`}><Icon size={11} />{pct > 0 ? '+' : ''}{n(pct)}٪</span>;
}

/** «نظرة عامة»'s top: today against yesterday and the same weekday last week, what needs an action, who is in now. One server answer (GET /api/admin/overview/board). */
export default function OverviewBoard() {
  const [board, setBoard] = useState<OverviewBoardData | null>(null);
  const navigate = useNavigate();
  const load = useCallback(() => { mysqlAdmin.getOverviewBoard().then(setBoard).catch(() => { /* the rest of the page is unaffected */ }); }, []);
  useVisibleInterval(load, 60_000);
  if (!board) return null;
  const { today, yesterday, lastWeek } = board.periods;
  const alerts = alertsOf(board);
  return (
    <section className="space-y-3" dir="rtl" data-testid="overview-board">
      {board.live && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-2.5 text-sm">
          <UserCheck size={16} className="text-emerald-600" />
          <button type="button" onClick={() => navigate('/dashboard/presence_now')} className="font-bold text-emerald-800 hover:underline">{n(board.live.staffOnline)} موظف أونلاين دلوقتي</button>
          <span className="text-gray-300">·</span>
          <button type="button" onClick={() => navigate('/dashboard/presence_now')} className="font-bold text-sky-800 hover:underline">{n(board.live.clientsOnline)} عميل أونلاين دلوقتي</button>
        </div>
      )}
      {alerts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {alerts.map(alert => (
            <button key={alert.key} type="button" onClick={() => navigate(alert.to)} className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold ${TONES[alert.tone]}`}>
              <AlertTriangle size={13} />{alert.text}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr><th className="px-4 py-2 text-right">الأرقام</th><th className="px-2">النهارده</th><th className="px-2">إمبارح</th><th className="px-2">التغيير</th><th className="px-2">نفس اليوم الأسبوع اللي فات</th><th className="px-2">التغيير</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {BOARD_ROWS.map(row => (
              <tr key={row.key} className="text-center">
                <td className="px-4 py-2 text-right font-bold text-gray-700">{row.label}</td>
                <td className="px-2 text-base font-extrabold text-gray-900">{n(today[row.key])}</td>
                <td className="px-2 text-gray-500">{n(yesterday[row.key])}</td>
                <td className="px-2"><Change now={today[row.key]} before={yesterday[row.key]} lowerIsBetter={row.lowerIsBetter} /></td>
                <td className="px-2 text-gray-500">{n(lastWeek[row.key])}</td>
                <td className="px-2"><Change now={today[row.key]} before={lastWeek[row.key]} lowerIsBetter={row.lowerIsBetter} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
