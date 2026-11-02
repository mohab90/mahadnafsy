import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Loader2 } from 'lucide-react';
import { CAIRO_TIME_ZONE, cairoMonthOnly } from '../../../../shared/cairoDate';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';

// «خلي كل موظف يشوف كل التفاصيل بتاعت الراتب بتاعه غيابات واذونات وغيره»: the signed-in employee's own month
// (GET /api/staff/me/month-detail) — the days the fingerprint judged, the permissions and leave of the month,
// the bonus with what was required and reached, and the payslip once payroll is approved.

type Day = {
  date: string; status: string; checkIn: string | null; checkOut: string | null; lateMinutes: number; earlyLeaveMinutes: number;
  deductionDays: number; permit: string | null; flag: string | null; onLeave: boolean; note: string | null;
};
type Leave = { id: string; type: string; status: string; from: string; to: string; startTime: string | null; endTime: string | null; totalDays: number; reason: string | null; adminNote: string | null };
type Bonus = { id: string; type: string; amount: number; currency: string; status: string; note: string | null; targetValue: number | null; achievedValue: number | null; targetUnit: string | null };
type Payslip = {
  status: string; base: number; allowances: number; commission: number; bonus: number; bonusNote: string | null;
  lateDeduction: number; absenceDeduction: number; advanceDeduction: number; otherDeduction: number; deductionsNote: string | null; net: number;
};
type MonthDetail = {
  month: number; year: number;
  summary: { present: number; absent: number; lateDays: number; lateMinutes: number; deductionDays: number; oneStamp: number };
  days: Day[]; leaves: Leave[]; bonuses: Bonus[]; payslip: Payslip | null;
};

const STATUS_AR: Record<string, [string, string]> = {
  PRESENT: ['حاضر', 'bg-emerald-50 text-emerald-700'], LATE: ['متأخر', 'bg-amber-50 text-amber-700'], ABSENT: ['غايب', 'bg-red-50 text-red-700'],
  HALF_DAY: ['نص يوم', 'bg-amber-50 text-amber-700'], LEAVE: ['إجازة', 'bg-sky-50 text-sky-700'], HOLIDAY: ['عطلة', 'bg-gray-100 text-gray-600'], REMOTE: ['عن بعد', 'bg-indigo-50 text-indigo-700'],
};
const LEAVE_AR: Record<string, string> = {
  ANNUAL: 'إجازة سنوية', SICK: 'إجازة مرضية', UNPAID: 'إجازة بدون راتب', MATERNITY: 'إجازة أمومة', EMERGENCY: 'إجازة طارئة', PERMISSION: 'إذن نصف يوم',
  OTHER: 'إجازة', LATE_PERMIT: 'إذن صباحي (تأخير)', EARLY_LEAVE: 'إذن مسائي (انصراف مبكر)',
};
const REQUEST_AR: Record<string, string> = { PENDING: 'مستني الرد', APPROVED: 'معتمد', REJECTED: 'مرفوض' };
const FLAG_AR: Record<string, string> = { missing_check_out: 'بصمة حضور بس', missing_check_in: 'بصمة انصراف بس' };
const UNIT_AR: Record<string, string> = { clients: 'عميل', bookings: 'حجز', egp: 'جنيه' };
const permitText = (permit: string | null) => (permit
  ? permit.split('+').map(p => (p.includes('morning') ? 'إذن صباحي' : p.includes('evening') ? 'إذن مسائي' : p)).join(' + ') : '');
const egp = (value: number) => `${Number(value || 0).toLocaleString('ar-EG-u-nu-latn')} ج.م`;
const num = (value: number) => Number(value || 0).toLocaleString('ar-EG-u-nu-latn');
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: CAIRO_TIME_ZONE });

const Row = ({ label, value, tone = '' }: { label: string; value: string; tone?: string }) => (
  <div className="flex items-center justify-between gap-3 border-b border-gray-50 py-1.5 text-sm last:border-0">
    <span className="text-gray-500">{label}</span><span className={`font-semibold ${tone || 'text-gray-800'}`}>{value}</span>
  </div>
);

export function MyMonthDetail() {
  const [month, setMonth] = useState(cairoMonthOnly());
  const [detail, setDetail] = useState<MonthDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [y, m] = month.split('-');
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/staff/me/month-detail?month=${parseInt(m, 10)}&year=${y}`, { credentials: 'include', headers: adminAuthHeaders() });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'تعذر تحميل تفاصيل الشهر');
      setDetail(payload as MonthDetail);
    } catch (err) {
      setDetail(null); setError(err instanceof Error ? err.message : 'تعذر تحميل تفاصيل الشهر');
    } finally { setLoading(false); }
  }, [month]);
  useEffect(() => { void load(); }, [load]);

  const pay = detail?.payslip;
  const deductions = pay ? pay.lateDeduction + pay.absenceDeduction + pay.advanceDeduction + pay.otherDeduction : 0;

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-extrabold text-gray-900">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-violet-50 text-violet-600"><CalendarClock size={16} /></span>مرتبي وحضوري — تفاصيل الشهر
        </h3>
        <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm" />
      </div>

      {loading ? <div className="py-8 text-center text-gray-400"><Loader2 className="mx-auto animate-spin" size={20} /></div>
        : error ? <p className="py-6 text-center text-sm text-red-600">{error}</p>
          : detail && (
            <>
              <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
                {([
                  ['حضور', detail.summary.present, 'bg-emerald-50 text-emerald-700'], ['غياب', detail.summary.absent, 'bg-red-50 text-red-700'],
                  ['أيام تأخير', detail.summary.lateDays, 'bg-amber-50 text-amber-700'], ['دقايق تأخير', detail.summary.lateMinutes, 'bg-gray-50 text-gray-700'],
                  ['أيام خصم', detail.summary.deductionDays, 'bg-rose-50 text-rose-700'],
                ] as [string, number, string][]).map(([label, value, tone]) => (
                  <div key={label} className={`rounded-xl px-2 py-3 ${tone}`}><div className="text-xl font-black">{num(value)}</div><div className="text-[10px] font-bold opacity-80">{label}</div></div>
                ))}
              </div>
              {detail.summary.oneStamp > 0 && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{num(detail.summary.oneStamp)} يوم فيهم بصمة واحدة بس — الموارد البشرية بتراجعهم ومش بيتخصم عليهم من غير مراجعة.</p>
              )}

              <div className="rounded-xl border border-gray-100 p-3">
                <h4 className="mb-2 text-sm font-extrabold text-gray-900">كشف المرتب</h4>
                {pay ? (
                  <>
                    <Row label="الراتب الأساسي" value={egp(pay.base)} />
                    {pay.allowances > 0 && <Row label="البدلات" value={`+${egp(pay.allowances)}`} tone="text-emerald-700" />}
                    {pay.commission > 0 && <Row label="العمولة" value={`+${egp(pay.commission)}`} tone="text-emerald-700" />}
                    {pay.bonus > 0 && <Row label={`مكافآت${pay.bonusNote ? ` — ${pay.bonusNote}` : ''}`} value={`+${egp(pay.bonus)}`} tone="text-emerald-700" />}
                    {pay.absenceDeduction > 0 && <Row label="خصم الغياب" value={`−${egp(pay.absenceDeduction)}`} tone="text-red-600" />}
                    {pay.lateDeduction > 0 && <Row label="خصم التأخير والانصراف المبكر" value={`−${egp(pay.lateDeduction)}`} tone="text-red-600" />}
                    {pay.advanceDeduction > 0 && <Row label="سلف" value={`−${egp(pay.advanceDeduction)}`} tone="text-red-600" />}
                    {pay.otherDeduction > 0 && <Row label={`خصومات أخرى${pay.deductionsNote ? ` — ${pay.deductionsNote}` : ''}`} value={`−${egp(pay.otherDeduction)}`} tone="text-red-600" />}
                    <div className="mt-2 flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2.5">
                      <span className="text-sm font-extrabold text-emerald-900">الصافي{deductions > 0 ? ` (بعد خصم ${egp(deductions)})` : ''}</span>
                      <span className="text-lg font-black text-emerald-700">{egp(pay.net)}</span>
                    </div>
                  </>
                ) : <p className="py-3 text-center text-sm text-gray-400">كشف مرتب الشهر ده لسه ما اتعتمدش — حضورك وإذونك تحت بتتحسب منها.</p>}
              </div>

              {detail.bonuses.length > 0 && (
                <div className="rounded-xl border border-gray-100 p-3">
                  <h4 className="mb-2 text-sm font-extrabold text-gray-900">التارجت والمكافأة</h4>
                  {detail.bonuses.map(b => (
                    <div key={b.id} className="border-b border-gray-50 py-2 text-sm last:border-0">
                      {b.targetValue != null && (
                        <Row label="المطلوب" value={`${num(b.targetValue)} ${b.targetUnit ? UNIT_AR[b.targetUnit] || '' : ''}`} />
                      )}
                      {b.achievedValue != null && (
                        <Row label="المحقق" value={`${num(b.achievedValue)} ${b.targetUnit ? UNIT_AR[b.targetUnit] || '' : ''}`} />
                      )}
                      <Row label={`${b.type === 'deduction' ? 'خصم' : 'مكافأة'}${b.note ? ` — ${b.note}` : ''}`}
                        value={`${egp(b.amount)} · ${b.status === 'APPROVED' ? 'معتمدة' : 'مستنية الاعتماد'}`} tone={b.type === 'deduction' ? 'text-red-600' : 'text-emerald-700'} />
                    </div>
                  ))}
                </div>
              )}

              {detail.leaves.length > 0 && (
                <div className="rounded-xl border border-gray-100 p-3">
                  <h4 className="mb-2 text-sm font-extrabold text-gray-900">الإجازات والأذونات</h4>
                  {detail.leaves.map(l => (
                    <Row key={l.id}
                      label={`${LEAVE_AR[l.type] || l.type} — ${l.from === l.to ? dayLabel(l.from) : `${dayLabel(l.from)} إلى ${dayLabel(l.to)}`}${l.startTime ? ` (${l.startTime}–${l.endTime || ''})` : ''}`}
                      value={REQUEST_AR[l.status] || l.status} tone={l.status === 'REJECTED' ? 'text-red-600' : l.status === 'PENDING' ? 'text-amber-700' : 'text-emerald-700'} />
                  ))}
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-gray-50 text-right text-xs font-bold text-gray-500">
                    <tr><th className="px-3 py-2">اليوم</th><th className="px-3 py-2">الحالة</th><th className="px-3 py-2">حضور</th><th className="px-3 py-2">انصراف</th><th className="px-3 py-2">تأخير</th><th className="px-3 py-2">إذن</th><th className="px-3 py-2">خصم</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {detail.days.map(d => {
                      const [label, tone] = STATUS_AR[d.status] || [d.status, 'bg-gray-100 text-gray-600'];
                      return (
                        <tr key={d.date}>
                          <td className="px-3 py-2 text-gray-800">{dayLabel(d.date)}</td>
                          <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tone}`}>{label}</span>{d.flag && <span className="mr-1 text-[11px] text-amber-700">{FLAG_AR[d.flag] || d.flag}</span>}</td>
                          <td className="px-3 py-2 tabular-nums">{d.checkIn || '—'}</td>
                          <td className="px-3 py-2 tabular-nums">{d.checkOut || '—'}{d.earlyLeaveMinutes > 0 && <span className="mr-1 text-[11px] text-amber-700">قبل الميعاد {num(d.earlyLeaveMinutes)} د</span>}</td>
                          <td className="px-3 py-2 tabular-nums">{d.lateMinutes > 0 ? `${num(d.lateMinutes)} د` : '—'}</td>
                          <td className="px-3 py-2 text-xs text-sky-700">{permitText(d.permit) || (d.onLeave ? 'إجازة معتمدة' : '')}</td>
                          <td className={`px-3 py-2 tabular-nums ${d.deductionDays > 0 ? 'font-bold text-red-600' : 'text-gray-300'}`}>{d.deductionDays > 0 ? `${num(d.deductionDays)} يوم` : '—'}</td>
                        </tr>
                      );
                    })}
                    {detail.days.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-gray-400">مفيش حضور متسجل للشهر ده لسه</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
    </section>
  );
}
