import { useEffect, useState } from 'react';
import { CalendarRange, HandCoins, Target, Users } from 'lucide-react';
import type { StaffMember } from '../../../types';
import { cairoMonthProgress, CAIRO_TIME_ZONE } from '../../../../shared/cairoDate';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { useStaffHomeSummary } from '../useStaffHomeSummary';
import MyWorkRecordPanel from '../staff-settings/MyWorkRecordPanel';

type Notify = (kind: 'success' | 'error' | 'warning' | 'info', message: string) => void;

const egp = (value: number) => `${Math.round(value).toLocaleString('ar-EG-u-nu-latn')} ج.م`;

/** A booking desk counts people it signed up; a collection officer counts money. */
function ConversionTarget({ staff }: { staff: StaffMember }) {
  // This month's signups, counted by the database (GET /api/staff/home-summary): the ring and the four weeks.
  const { summary } = useStaffHomeSummary(staff);
  const monthlyTarget = Math.max(1, Number(staff.monthlyLeadsTarget || 10) || 10);
  const achieved = summary?.signups.month ?? 0;
  const { dayOfMonth, daysInMonth } = cairoMonthProgress();
  const dailyTargetPace = achieved / Math.max(1, dayOfMonth);
  const weeksData = (summary?.signups.weeks ?? [0, 0, 0, 0]).map((count, index) => ({ label: `أسبوع ${index + 1}`, count }));
  const m = {
    monthlyTarget, achieved, dailyTargetPace, weeksData,
    pct: Math.min(100, Math.round((achieved / monthlyTarget) * 100)),
    daysLeft: daysInMonth - dayOfMonth,
    projectedEnd: Math.round(dailyTargetPace * daysInMonth),
    maxWeekCount: Math.max(...weeksData.map(week => week.count), 1),
  };
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-3">
        <div className="mb-4 flex items-center gap-2">
          <Target size={17} className="text-emerald-600" />
          <h3 className="font-extrabold text-gray-900">هدف الشهر</h3>
          <span className="mr-auto text-xs text-gray-400">
            {new Date().toLocaleDateString('ar-EG-u-nu-latn', { month: 'long', year: 'numeric', timeZone: CAIRO_TIME_ZONE })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div className="relative h-32 w-32 flex-shrink-0">
            <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
              <circle cx="64" cy="64" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="10" />
              <circle cx="64" cy="64" r={radius} fill="none" strokeWidth="10" strokeLinecap="round"
                stroke={m.pct >= 100 ? '#f59e0b' : m.pct >= 75 ? '#10b981' : m.pct >= 50 ? '#3b82f6' : '#8b5cf6'}
                strokeDasharray={circumference} strokeDashoffset={circumference - (m.pct / 100) * circumference} />
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div><div className="text-2xl font-black text-gray-900">{m.pct}%</div><div className="text-[10px] text-gray-400">من الهدف</div></div>
            </div>
          </div>
          <div className="min-w-[200px] flex-1 space-y-3 text-sm">
            <div className="flex justify-between text-gray-600"><span>اتحقق</span><strong className="text-gray-900">{m.achieved} من {m.monthlyTarget}</strong></div>
            <div className="flex justify-between text-gray-600"><span>المعدل اليومي</span><strong className="text-gray-900">{m.dailyTargetPace.toFixed(1)} / يوم</strong></div>
            <div className="flex justify-between text-gray-600"><span>المتوقع آخر الشهر</span>
              <strong className={m.projectedEnd >= m.monthlyTarget ? 'text-emerald-600' : 'text-amber-600'}>{m.projectedEnd}</strong></div>
            {m.pct < 100 && m.daysLeft > 0 && (
              <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
                فاضلك <strong>{m.monthlyTarget - m.achieved}</strong> في <strong>{m.daysLeft}</strong> يوم — يعني {((m.monthlyTarget - m.achieved) / m.daysLeft).toFixed(1)} في اليوم.
              </p>
            )}
          </div>
        </div>
      </section>
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
        <h3 className="mb-4 flex items-center gap-2 font-extrabold text-gray-900"><CalendarRange size={16} className="text-indigo-500" /> أسابيع الشهر</h3>
        <div className="flex h-32 items-end gap-3 px-1">
          {m.weeksData.map((week, index) => (
            <div key={week.label} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-xs font-bold text-gray-700">{week.count}</span>
              <div className="w-full rounded-t-lg"
                style={{ height: `${Math.max(8, (week.count / m.maxWeekCount) * 96)}px`, opacity: week.count ? 1 : 0.3,
                  background: index === m.weeksData.length - 1 ? 'linear-gradient(180deg,#10b981,#059669)' : 'linear-gradient(180deg,#6366f1,#4f46e5)' }} />
              <span className="text-[10px] text-gray-400">{week.label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

type PaymentFigures = { today: number; week: number; month: number; paying: number };

function CollectionFigures({ staff }: { staff: StaffMember }) {
  // The money of the person's own clients, summed by the database (GET /api/staff/payments?summary=1).
  const { summary } = useStaffHomeSummary(staff);
  const [figures, setFigures] = useState<PaymentFigures>({ today: 0, week: 0, month: 0, paying: 0 });
  useEffect(() => {
    let cancelled = false;
    mysqlAdmin.adminGet<{ summary?: PaymentFigures }>('/staff/payments?summary=1&limit=1')
      .then(answer => { if (!cancelled && answer.summary) setFigures(answer.summary); })
      .catch(() => { /* the cards stay at zero */ });
    return () => { cancelled = true; };
  }, []);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[
        { label: 'اتحصّل النهارده', value: egp(figures.today), icon: HandCoins, tone: 'from-emerald-500 to-teal-600' },
        { label: 'الأسبوع ده', value: egp(figures.week), icon: HandCoins, tone: 'from-sky-500 to-blue-600' },
        { label: 'الشهر ده', value: egp(figures.month), icon: HandCoins, tone: 'from-indigo-500 to-violet-600' },
        { label: 'عملاء دفعوا الشهر ده', value: `${figures.paying} من ${summary?.clients ?? 0}`, icon: Users, tone: 'from-amber-400 to-orange-500' },
      ].map(({ label, value, icon: Icon, tone }) => (
        <div key={label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <span className={`mb-2 grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br ${tone} text-white`}><Icon size={17} /></span>
          <div className="text-lg font-black text-gray-900">{value}</div>
          <div className="text-[11px] font-bold text-gray-500">{label}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * أدائي — the numbers of the job, whichever job it is, then the server's record
 * of achievements and targets month by month.
 */
export function MyPerformanceSection({ staff, notify }: {
  staff: StaffMember; notify: Notify;
}) {
  const role = String(staff.role || '').toLowerCase();
  return (
    <div className="space-y-5">
      {role === 'collection'
        ? <CollectionFigures staff={staff} />
        : <ConversionTarget staff={staff} />}
      <MyWorkRecordPanel notify={notify} part="record" />
    </div>
  );
}
