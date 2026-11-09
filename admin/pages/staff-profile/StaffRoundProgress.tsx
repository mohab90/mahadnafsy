import { useEffect, useState } from 'react';
import { Target } from 'lucide-react';
import { mysqlAdmin, type RoundProgress } from '../../lib/mysqlapi';

type OnRounds = Extract<RoundProgress, { onRounds: true }>;

const n = (value: number | null | undefined) => Number(value || 0).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 });
const day = (iso: string | null) => (iso ? iso.slice(8, 10).replace(/^0/, '') + '/' + iso.slice(5, 7).replace(/^0/, '') : '');

/** The employee's current round (GET /admin/hr/staff/:id/round-progress, the same computation as the payroll): null while loading, or for anyone not on the round scheme. */
export function useRoundProgress(staffId: string | undefined): OnRounds | null {
  const [progress, setProgress] = useState<OnRounds | null>(null);
  useEffect(() => {
    if (!staffId) return undefined;
    let live = true;
    setProgress(null);
    mysqlAdmin.getRoundProgress(staffId).then(answer => { if (live) setProgress(answer.onRounds ? answer : null); }).catch(() => { if (live) setProgress(null); });
    return () => { live = false; };
  }, [staffId]);
  return progress;
}

/**
 * «الروند الحالي» (9 Nov 2026): the rep's round — its dates, the bookings counted so far (a dearer course counts as more than one), the next step with how many
 * bookings are left to reach it and what it pays, and what the round before it paid. The amounts are the plan's, worked out by the system.
 */
export default function StaffRoundProgress({ progress }: { progress: OnRounds }) {
  const { current, previous } = progress;
  const target = current.nextStep;
  const done = current.stepReached;
  const pct = target ? Math.min(100, Math.round((current.bookings / target.bookings) * 100)) : 100;
  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 shadow-sm" dir="rtl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Target size={17} className="text-emerald-600" />
        <h3 className="font-extrabold text-gray-900">{progress.halfMonths ? 'الروند الحالي' : 'تارجيت الشهر'}</h3>
        <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
          من {day(current.from)} لـ {day(current.to)}
        </span>
        <span className="mr-auto text-xs text-gray-500">بيبدأ من {n(progress.firstTarget)} حجز</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-white p-3 text-center">
          <div className="text-3xl font-black text-emerald-700">{n(current.bookings)}</div>
          <div className="text-xs text-gray-500">حجز اتحسب لحد دلوقتي</div>
        </div>
        <div className="rounded-xl bg-white p-3 text-center">
          <div className="text-xl font-black text-gray-900">{n(current.amount)} <span className="text-xs font-bold text-gray-500">ج.م</span></div>
          <div className="text-xs text-gray-500">{done ? `مكافأة الروند دلوقتي (خطوة ${n(done.bookings)})` : 'مكافأة الروند دلوقتي'}</div>
        </div>
        <div className="rounded-xl bg-white p-3 text-center">
          {target ? (
            <>
              <div className="text-xl font-black text-indigo-700">فاضل {n(target.remaining)} حجز</div>
              <div className="text-xs text-gray-500">للخطوة {n(target.bookings)} ← {n(target.amount)} ج.م</div>
            </>
          ) : (
            <>
              <div className="text-xl font-black text-amber-600">وصلت لآخر خطوة</div>
              <div className="text-xs text-gray-500">{current.nextBookingWorth ? `كل حجز زيادة بيضيف ${n(current.nextBookingWorth)} ج.م` : ''}</div>
            </>
          )}
        </div>
      </div>
      {target && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white" title={`${pct}%`}>
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
      )}
      {previous.map(round => (
        <p key={round.round} className="mt-3 rounded-xl bg-white px-3 py-2 text-sm text-gray-700">
          نتيجة الروند الأول ({round.label}): <b>{n(round.bookings)}</b> حجز ← <b className="text-emerald-700">{n(round.amount)} ج.م</b>
        </p>
      ))}
      <p className="mt-2 text-[11px] text-gray-500">الحجز بيتحسب بسعره (الكورس الأغلى بيتحسب أكتر من حجز). مكافأة الشهر لحد دلوقتي {n(progress.monthTotal)} ج.م — بتتعتمد مع المرتب.</p>
    </section>
  );
}
