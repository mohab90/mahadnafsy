import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

// «تقرير أسبوعي لمدير الدقي: الحضور، والأسابيع اللي ماتأكدتش، والمتبقي على كل
// روند» and «الواتساب يتابع لوحده أي عميل غاب محاضرتين … نوقفها شوية» (9 Oct 2026):
// this week's report (api/lib/dokkiWeeklyReport.js) and the branch's two switches.
type Row = { id: string; code: string; course: string; reception: string; clients: number; came: number; lecture: number; unconfirmedWeeks: number; thisWeekAnswered: boolean; owed: number; owing: number };
type Report = { branchLabel: string; week: string; rounds: Row[]; totals: { rounds: number; clients: number; came: number; unconfirmedWeeks: number; owed: number; owing: number }; message: string };
type Switches = { absenceFollowUp: boolean; weeklyReport: boolean; dailyBrief: boolean };
type Daily = { rounds: Array<{ id: string; owing: unknown[] }>; message: string };
const n = (value: number) => Number(value || 0).toLocaleString('ar-EG-u-nu-latn');

export function DokkiWeeklyPanel({ branch, canSwitch, notify }: {
  branch: string; canSwitch: boolean; notify: (type: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [switches, setSwitches] = useState<Switches | null>(null);
  const [showMessage, setShowMessage] = useState(false);
  const [daily, setDaily] = useState<Daily | null>(null);
  const [showDaily, setShowDaily] = useState(false);

  const load = useCallback(() => {
    const query = branch ? `?branch=${encodeURIComponent(branch)}` : '';
    mysqlAdmin.adminGet<Report>(`/admin/daqqi/weekly-report${query}`).then(setReport).catch(() => setReport(null));
    mysqlAdmin.adminGet<Switches>('/admin/daqqi/automation').then(setSwitches).catch(() => setSwitches(null));
    mysqlAdmin.adminGet<Daily>(`/admin/daqqi/daily-brief${query}`).then(setDaily).catch(() => setDaily(null));
  }, [branch]);
  useEffect(() => { load(); }, [load]);

  const flip = async (key: keyof Switches) => {
    if (!switches) return;
    try {
      const saved = await mysqlAdmin.adminPut<Switches>('/admin/daqqi/automation', { [key]: !switches[key] });
      setSwitches({ absenceFollowUp: saved.absenceFollowUp, weeklyReport: saved.weeklyReport, dailyBrief: saved.dailyBrief });
      notify('success', 'اتحفظ');
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر الحفظ'); }
  };

  if (!report) return null;
  return (
    <section className="space-y-3 rounded-2xl border border-teal-200 bg-white p-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-extrabold text-gray-900"><CalendarCheck size={16} className="text-teal-600" /> تقرير {report.branchLabel} الأسبوعي — أسبوع {report.week}</h3>
        <button onClick={() => setShowMessage(value => !value)} className="text-xs font-bold text-teal-700 hover:underline">{showMessage ? 'اخفي رسالة الواتساب' : 'شوف رسالة الواتساب'}</button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['روندات شغالة', n(report.totals.rounds), 'bg-teal-50 text-teal-800'],
          ['حضروا الأسبوع ده', `${n(report.totals.came)} / ${n(report.totals.clients)}`, 'bg-sky-50 text-sky-800'],
          ['أسابيع مش متأكدة', n(report.totals.unconfirmedWeeks), report.totals.unconfirmedWeeks ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'],
          ['المتبقي على العملاء', `${n(report.totals.owed)} ج.م`, 'bg-rose-50 text-rose-800'],
        ].map(([label, value, cls]) => (
          <div key={label} className={`rounded-xl px-3 py-2 ${cls}`}><p className="text-[11px] font-bold">{label}</p><p className="text-lg font-black">{value}</p></div>
        ))}
      </div>
      {showMessage && <pre className="whitespace-pre-wrap rounded-xl bg-teal-50 p-3 text-xs leading-6 text-gray-800">{report.message}</pre>}
      {/* «بيبعت اشعار كل يوم لمدير الفرع ومسئول الروند» (10 Oct 2026): today's rounds, as the 9 a.m. WhatsApp has them. */}
      {daily && (
        <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-sky-900">☀️ محاضرات النهارده: {n(daily.rounds.length)} روند{daily.rounds.length ? ` · ${n(daily.rounds.reduce((sum, round) => sum + round.owing.length, 0))} عميل عليهم فلوس` : ''}</span>
            {daily.message && <button onClick={() => setShowDaily(value => !value)} className="font-bold text-sky-700 hover:underline">{showDaily ? 'اخفي رسالة الصبح' : 'شوف رسالة الصبح'}</button>}
          </div>
          {showDaily && <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-white p-3 leading-6 text-gray-800">{daily.message}</pre>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>{['الروند', 'الريسبشن', 'المحاضرة', 'حضروا الأسبوع ده', 'أسابيع مش متأكدة', 'المتبقي'].map(title => <th key={title} className="px-2 py-2 text-right">{title}</th>)}</tr>
          </thead>
          <tbody>
            {report.rounds.map(row => (
              <tr key={row.id} className="border-t border-gray-100">
                <td className="px-2 py-1.5"><span className="font-mono font-bold text-purple-700">{row.code}</span> <span className="text-gray-600">{row.course}</span></td>
                <td className="px-2 py-1.5 text-gray-600">{row.reception || '—'}</td>
                <td className="px-2 py-1.5">م{n(row.lecture)}</td>
                <td className="px-2 py-1.5">{n(row.came)} / {n(row.clients)}</td>
                <td className={`px-2 py-1.5 font-bold ${row.unconfirmedWeeks ? 'text-amber-700' : 'text-emerald-700'}`}>{row.unconfirmedWeeks ? n(row.unconfirmedWeeks) : '✓'}{!row.thisWeekAnswered && row.lecture > 0 ? ' · الأسبوع ده؟' : ''}</td>
                <td className="px-2 py-1.5">{row.owed ? `${n(row.owed)} ج.م (${n(row.owing)})` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {switches && (
        <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3 text-xs">
          <label className={`flex items-center gap-2 rounded-xl border px-3 py-2 font-bold ${canSwitch ? 'cursor-pointer' : 'opacity-60'}`}>
            <input type="checkbox" disabled={!canSwitch} checked={switches.dailyBrief} onChange={() => void flip('dailyBrief')} />
            كل يوم الساعة 9: محاضرات النهارده واللي عليهم فلوس — للمدير ولريسبشن كل روند
          </label>
          <label className={`flex items-center gap-2 rounded-xl border px-3 py-2 font-bold ${canSwitch ? 'cursor-pointer' : 'opacity-60'}`}>
            <input type="checkbox" disabled={!canSwitch} checked={switches.weeklyReport} onChange={() => void flip('weeklyReport')} />
            التقرير ده يوصل للمدير على الواتساب كل سبت الساعة 10
          </label>
          <label className={`flex items-center gap-2 rounded-xl border px-3 py-2 font-bold ${canSwitch ? 'cursor-pointer' : 'opacity-60'} ${switches.absenceFollowUp ? 'border-emerald-300 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
            <input type="checkbox" disabled={!canSwitch} checked={switches.absenceFollowUp} onChange={() => void flip('absenceFollowUp')} />
            واتساب متابعة للعميل اللي غاب محاضرتين {switches.absenceFollowUp ? '(شغال)' : '(مقفول — لحد ما واتساب الفرع يتظبط)'}
          </label>
        </div>
      )}
    </section>
  );
}
