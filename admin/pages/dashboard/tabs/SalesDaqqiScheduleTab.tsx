import { useCallback, useMemo, useState } from 'react';
import { CalendarDays, Clock, DoorOpen, GraduationCap, RefreshCw, Sparkles } from 'lucide-react';
import { mysqlAdmin, type SalesScheduleRound } from '../../../lib/mysqlapi';
import { useVisibleInterval } from '../../../../shared/useVisibleInterval';
import type { NotifyFn } from '../../../types';

/**
 * «جدول الدقي» — for the whole sales team (8 Oct 2026): the courses a new client
 * can still join at the branch — not started yet, or on their first or second
 * lecture. From the third lecture a course leaves this list, and the list never
 * shows who is in a course. The server decides both (daqqi-rounds/sales-schedule).
 */
const BRANCH_LABEL: Record<string, string> = { DAQQI: 'فرع الدقي', TAGAMOA: 'فرع التجمع' };
const dayFormat = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayOf = (ymd: string | null) => {
  if (!ymd) return '';
  const at = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isFinite(at) ? dayFormat.format(at) : ymd;
};

type Filter = 'all' | 'soon' | 'started';
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'soon', label: 'لسه ما بدأتش' },
  { key: 'started', label: 'بدأت' },
];

function Stage({ lecture, startDate }: { lecture: number; startDate: string }) {
  if (lecture === 0) {
    return <span className="text-[11px] font-bold bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full">🆕 تبدأ {dayOf(startDate)}</span>;
  }
  if (lecture === 1) {
    return <span className="text-[11px] font-bold bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full">المحاضرة الأولى</span>;
  }
  return <span className="text-[11px] font-bold bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full">المحاضرة التانية — آخر فرصة للحجز</span>;
}

export default function SalesDaqqiScheduleTab({ notify }: { notify: NotifyFn }) {
  const [rounds, setRounds] = useState<SalesScheduleRound[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRounds(await mysqlAdmin.listDaqqiSalesSchedule());
    } catch {
      notify('error', 'تعذر تحميل جدول الدقي');
      setRounds(current => current ?? []);
    } finally {
      setLoading(false);
    }
  }, [notify]);
  // A course moves from «تبدأ» to its lectures, and off the list, by the date.
  useVisibleInterval(() => { void load(); }, 10 * 60 * 1000);

  const groups = useMemo(() => {
    const shown = (rounds || [])
      .filter(round => filter === 'all' || (filter === 'soon' ? round.lecture === 0 : round.lecture > 0))
      .sort((a, b) => (a.lecture === 0) === (b.lecture === 0)
        ? a.startDate.localeCompare(b.startDate)
        : a.lecture === 0 ? -1 : 1);
    const byBranch = new Map<string, SalesScheduleRound[]>();
    for (const round of shown) byBranch.set(round.branch, [...(byBranch.get(round.branch) || []), round]);
    return [...byBranch.entries()].sort(([a], [b]) => (a === 'DAQQI' ? -1 : b === 'DAQQI' ? 1 : a.localeCompare(b)));
  }, [rounds, filter]);

  const soonCount = (rounds || []).filter(round => round.lecture === 0).length;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="bg-gradient-to-l from-amber-50 to-white border border-amber-100 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-gray-800 flex items-center gap-2"><CalendarDays size={20} className="text-amber-600" /> جدول الدقي</h2>
          <p className="text-xs text-gray-500 mt-1">الكورسات الجديدة واللي لسه بادئة — تقدر تحجز فيها دلوقتي. أول ما الكورس يوصل المحاضرة التالتة بيختفي من هنا.</p>
        </div>
        <div className="flex items-center gap-2">
          {FILTERS.map(option => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              className={`text-xs font-bold px-3 py-1.5 rounded-full border transition ${filter === option.key ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300'}`}
            >
              {option.label}{option.key === 'soon' && soonCount > 0 ? ` (${soonCount})` : ''}
            </button>
          ))}
          <button type="button" onClick={() => { void load(); }} disabled={loading} title="تحديث"
            className="p-2 rounded-full border border-gray-200 bg-white text-gray-500 hover:text-amber-600 disabled:opacity-40">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {rounds === null ? (
        <div className="text-center py-16 text-gray-400 text-sm">جارٍ تحميل الجدول…</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 bg-white border border-gray-100 rounded-2xl">
          <Sparkles size={36} className="mx-auto text-gray-200 mb-2" />
          <p className="text-sm text-gray-500 font-semibold">مفيش كورس متاح للحجز في الدقي دلوقتي</p>
          <p className="text-xs text-gray-400 mt-1">أول ما يتفتح روند جديد هيظهر هنا.</p>
        </div>
      ) : groups.map(([branch, list]) => (
        <section key={branch} className="space-y-2">
          <p className="text-sm font-extrabold text-gray-700">{BRANCH_LABEL[branch] || branch} <span className="text-gray-400 font-semibold">· {list.length} كورس</span></p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map(round => (
              <div key={round.id} className={`bg-white border rounded-2xl p-4 shadow-sm ${round.lecture === 2 ? 'border-amber-200' : round.lecture === 0 ? 'border-emerald-200' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <p className="font-extrabold text-gray-800 text-sm leading-snug">{round.courseTitle || 'كورس'}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">روند {round.code}</p>
                  </div>
                  <Stage lecture={round.lecture} startDate={round.startDate} />
                </div>
                <div className="space-y-1.5 text-xs text-gray-600">
                  <p className="flex items-center gap-1.5"><Clock size={13} className="text-gray-400" /> كل {round.dayOfWeek} · {round.timeSlot}</p>
                  {round.instructorName && <p className="flex items-center gap-1.5"><GraduationCap size={13} className="text-gray-400" /> {round.instructorName}</p>}
                  {round.room && <p className="flex items-center gap-1.5"><DoorOpen size={13} className="text-gray-400" /> {round.room}</p>}
                  {round.lecture > 0 && round.nextSession && (
                    <p className="flex items-center gap-1.5"><CalendarDays size={13} className="text-gray-400" /> المحاضرة الجاية: {dayOf(round.nextSession)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
