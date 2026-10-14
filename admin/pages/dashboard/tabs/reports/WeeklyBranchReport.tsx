import { useCallback, useEffect, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { cairoDateOnly, cairoDaysAgo, cairoDaysAhead } from '../../../../../shared/cairoDate';

/**
 * «التقرير الأسبوعي للفروع» (11 Oct 2026): per branch, the week's income,
 * expenses and net in EGP, what clients still owe by how long they have owed
 * it, and each sales rep's leads of the week and how many have paid — Saturday
 * to Friday (api/lib/weeklyBranchReport.js). With the switch on, the last week
 * goes on WhatsApp every Saturday morning to the daily report's numbers.
 */
type Bucket = { key: string; label: string; amountEgp: number; clients: number };
type Rep = { id: string; name: string; assigned: number; converted: number; rate: number };
type Branch = {
  branch: string; label: string; incomeEgp: number; payments: number; expensesEgp: number; expenses: number;
  netEgp: number; owedEgp: number; aging: Bucket[]; reps: Rep[]; leadsAssigned: number; leadsConverted: number;
};
type Report = {
  from: string; to: string; branches: Branch[];
  totals: { incomeEgp: number; expensesEgp: number; netEgp: number; owedEgp: number; leadsAssigned: number; leadsConverted: number };
  agingBuckets: { key: string; label: string }[];
  unconverted: { branch: string; currency: string; amount: number; kind: string }[];
};
type Whatsapp = { enabled: boolean; phones: string[]; preview?: string };
type Notify = (type: 'success' | 'error' | 'info', text: string) => void;

const n = (value: number) => Math.round(value || 0).toLocaleString('ar-EG-u-nu-latn');
const rate = (converted: number, assigned: number) => (assigned ? `${Math.round((converted / assigned) * 1000) / 10}%` : '—');

/** The Saturday that starts the week holding `day` (YYYY-MM-DD). Noon, so the Cairo day is the day named. */
export function saturdayOf(day: string): string {
  return cairoDaysAgo((new Date(`${day}T12:00:00Z`).getUTCDay() + 1) % 7, `${day}T12:00:00Z`);
}
const shift = (day: string, days: number) => cairoDaysAhead(days, `${day}T12:00:00Z`);

export function WeeklyBranchReport({ notify }: { notify: Notify }) {
  // null: the last week that has ended, as the server decides it.
  const [week, setWeek] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [whatsapp, setWhatsapp] = useState<Whatsapp | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const load = useCallback(async (target: string | null) => {
    setLoading(true);
    try {
      setReport(await mysqlAdmin.adminGet<Report>(`/admin/reports/weekly-branches${target ? `?week=${target}` : ''}`));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل التقرير الأسبوعي');
    } finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(week); }, [load, week]);
  useEffect(() => {
    mysqlAdmin.adminGet<Whatsapp>('/admin/reports/weekly-branches/whatsapp').then(setWhatsapp).catch(() => { /* the switch stays hidden */ });
  }, []);

  const toggle = async (enabled: boolean) => {
    try {
      const saved = await mysqlAdmin.adminPut<Whatsapp & { ok: boolean }>('/admin/reports/weekly-branches/whatsapp', { enabled });
      setWhatsapp(prev => ({ ...saved, preview: prev?.preview }));
      notify('success', enabled ? 'هيوصل كل سبت الصبح على واتساب' : 'التقرير الأسبوعي على واتساب اتقفل');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الحفظ');
    }
  };

  const from = report?.from || '';
  const today = cairoDateOnly();
  const buckets = report?.agingBuckets || [];
  const cell = 'px-2 py-1.5 text-center';

  return (
    <section className="space-y-3 rounded-2xl border border-indigo-200 bg-white p-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-bold text-gray-800">
          <CalendarRange size={15} className="text-indigo-600" /> التقرير الأسبوعي للفروع
          {report && <span className="text-xs font-normal text-gray-500">— من السبت {report.from} للجمعة {report.to}</span>}
        </h4>
        <div className="flex items-center gap-1">
          <button type="button" disabled={!from || loading} onClick={() => setWeek(shift(from, -7))}
            className="rounded-lg bg-gray-100 p-1.5 hover:bg-gray-200 disabled:opacity-40" title="الأسبوع اللي قبله"><ChevronRight size={14} /></button>
          <input type="date" value={from} max={today} onChange={event => event.target.value && setWeek(saturdayOf(event.target.value))}
            className="rounded-lg border border-gray-200 px-2 py-1 text-xs" aria-label="اختار الأسبوع" />
          <button type="button" disabled={!from || loading || shift(from, 7) > today} onClick={() => setWeek(shift(from, 7))}
            className="rounded-lg bg-gray-100 p-1.5 hover:bg-gray-200 disabled:opacity-40" title="الأسبوع اللي بعده"><ChevronLeft size={14} /></button>
        </div>
      </div>

      {whatsapp && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs">
          <label className="flex items-center gap-2 font-bold text-emerald-800">
            <input type="checkbox" checked={whatsapp.enabled} onChange={event => void toggle(event.target.checked)} />
            <MessageCircle size={13} /> ابعته واتساب كل سبت الصبح
          </label>
          <span className="text-emerald-700">
            {whatsapp.phones.length ? `للأرقام: ${whatsapp.phones.join('، ')}` : 'مفيش أرقام — احفظها في «التقرير اليومي على واتساب» تحت'}
          </span>
          {whatsapp.preview && (
            <button type="button" onClick={() => setShowPreview(open => !open)} className="font-bold text-emerald-700 underline">
              {showPreview ? 'اخفي الرسالة' : 'شوف الرسالة'}
            </button>
          )}
          {showPreview && whatsapp.preview && <pre className="w-full whitespace-pre-wrap rounded-lg bg-white p-3 text-[11px] text-gray-700">{whatsapp.preview}</pre>}
        </div>
      )}

      {!report ? (
        <p className="py-8 text-center text-xs text-gray-400">{loading ? 'جارٍ تجهيز التقرير…' : 'مفيش بيانات'}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-xs">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="px-2 py-1.5 text-right">الفرع</th>
                  <th className={cell}>الدخل</th><th className={cell}>المصروفات</th><th className={cell}>الصافي</th>
                  {buckets.map(bucket => <th key={bucket.key} className={cell} title={bucket.label}>متأخر {bucket.key} يوم</th>)}
                  <th className={cell}>ليدز الأسبوع</th><th className={cell}>دفعوا</th><th className={cell}>النسبة</th>
                </tr>
              </thead>
              <tbody>
                {report.branches.map(row => (
                  <tr key={row.branch} className="border-b border-gray-50">
                    <td className="px-2 py-1.5 font-bold text-gray-800">{row.label}</td>
                    <td className={cell} title={`${n(row.payments)} دفعة`}>{n(row.incomeEgp)}</td>
                    <td className={cell} title={`${n(row.expenses)} مصروف`}>{n(row.expensesEgp)}</td>
                    <td className={`${cell} font-bold ${row.netEgp < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{n(row.netEgp)}</td>
                    {row.aging.map(bucket => <td key={bucket.key} className={cell} title={`${n(bucket.clients)} عميل`}>{n(bucket.amountEgp)}</td>)}
                    <td className={cell}>{n(row.leadsAssigned)}</td>
                    <td className={cell}>{n(row.leadsConverted)}</td>
                    <td className={cell}>{rate(row.leadsConverted, row.leadsAssigned)}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-extrabold text-gray-900">
                  <td className="px-2 py-1.5">الإجمالي (ج.م)</td>
                  <td className={cell}>{n(report.totals.incomeEgp)}</td>
                  <td className={cell}>{n(report.totals.expensesEgp)}</td>
                  <td className={cell}>{n(report.totals.netEgp)}</td>
                  {buckets.map(bucket => (
                    <td key={bucket.key} className={cell}>
                      {n(report.branches.reduce((sum, row) => sum + (row.aging.find(item => item.key === bucket.key)?.amountEgp || 0), 0))}
                    </td>
                  ))}
                  <td className={cell}>{n(report.totals.leadsAssigned)}</td>
                  <td className={cell}>{n(report.totals.leadsConverted)}</td>
                  <td className={cell}>{rate(report.totals.leadsConverted, report.totals.leadsAssigned)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400">
            المتأخرات: اللي لسه على العملاء لحد آخر الأسبوع، من أول دفعة في الكورس. «دفعوا»: من الليدز اللي اتوزعت على السيلز في الأسبوع، اللي بقوا عملاء ودفعوا.
          </p>
          {report.unconverted.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              مبالغ بعملة أجنبية من غير سعر صرف متسجل ومفيش سعر النهارده — مش محسوبة: {report.unconverted.map(row => `${row.amount} ${row.currency}`).join('، ')}
            </p>
          )}
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {report.branches.filter(row => row.reps.length).map(row => (
              <div key={row.branch} className="rounded-xl border border-gray-100 p-3">
                <h5 className="mb-1 text-xs font-bold text-gray-700">{row.label} — السيلز</h5>
                <table className="w-full text-[11px]">
                  <tbody>
                    {row.reps.map(rep => (
                      <tr key={rep.id}>
                        <td className="py-0.5 text-gray-700">{rep.name}</td>
                        <td className="py-0.5 text-center text-gray-500">{n(rep.converted)} / {n(rep.assigned)}</td>
                        <td className="py-0.5 text-center font-bold">{rate(rep.converted, rep.assigned)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
