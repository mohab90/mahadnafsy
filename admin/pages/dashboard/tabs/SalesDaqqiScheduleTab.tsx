import { useCallback, useMemo, useState } from 'react';
import { CalendarDays, Lock, RefreshCw, Sparkles } from 'lucide-react';
import { mysqlAdmin, type SalesScheduleRound } from '../../../lib/mysqlapi';
import { useVisibleInterval } from '../../../../shared/useVisibleInterval';
import { cairoDateOnly, cairoDaysAhead, cairoWeekStart } from '../../../../shared/cairoDate';
import type { NotifyFn } from '../../../types';
import { DaqqiScheduleHeader, type DaqqiScheduleView } from './daqqi/DaqqiScheduleHeader';
import { DAQQI_DAYS_OF_WEEK, DAQQI_TIME_SLOTS, DAQQI_TIME_SLOT_COLORS as timeSlotColors } from './daqqi/daqqiScheduleConfig';

/**
 * «جدول الدقي» for the whole sales team. «بنفس تصميم جدول الدقي العادي ولكن بفلتر اتوماتيك على الجديد
 * أو اللى لسه بدأ محاضرة أو 2 فقط … ويقدر يشوفه بشكل التقويم» (14 Oct 2026): the same table and the
 * same two-week calendar as the desk's schedule (DaqqiScheduleTab), read-only, with the filter
 * already applied by the server — not started yet, or on the first or second lecture. From the
 * third lecture a course leaves the list, and the list never shows who is in a course or any money
 * (api/routes/daqqi-rounds sales-schedule).
 */
const BRANCH_LABEL: Record<string, string> = { DAQQI: 'فرع الدقي', TAGAMOA: 'فرع التجمع' };
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

type Stage = '' | '0' | '1' | '2';
const STAGES: Array<[Stage, string]> = [['', 'كل المتاح'], ['0', 'جديد (لسه ما بدأش)'], ['1', 'المحاضرة الأولى'], ['2', 'المحاضرة التانية']];

const stageBadge = (lecture: number) => (lecture === 0
  ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700">جديد</span>
  : lecture === 1
    ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">م 1</span>
    : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800" title="آخر فرصة للحجز">م 2 — آخر فرصة</span>);

export default function SalesDaqqiScheduleTab({ notify }: { notify: NotifyFn }) {
  const [rounds, setRounds] = useState<SalesScheduleRound[] | null>(null);
  const [view, setView] = useState<DaqqiScheduleView>('table');
  const [course, setCourse] = useState('');
  const [instructor, setInstructor] = useState('');
  const [day, setDay] = useState('');
  const [slot, setSlot] = useState('');
  const [stage, setStage] = useState<Stage>('');
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

  const all = useMemo(() => rounds || [], [rounds]);
  const courses = useMemo(() => [...new Map(all.map(round => [round.courseId, round.courseTitle || round.courseId])).entries()], [all]);
  const instructors = useMemo(() => [...new Map(all.filter(round => round.instructorId).map(round => [round.instructorId, round.instructorName])).entries()], [all]);
  const shown = useMemo(() => all
    .filter(round => (!course || round.courseId === course) && (!instructor || round.instructorId === instructor)
      && (!day || round.dayOfWeek === day) && (!slot || round.timeSlot === slot) && (stage === '' || String(round.lecture) === stage))
    .sort((a, b) => a.startDate.localeCompare(b.startDate)), [all, course, instructor, day, slot, stage]);
  const hasFilters = Boolean(course || instructor || day || slot || stage);
  const clear = () => { setCourse(''); setInstructor(''); setDay(''); setSlot(''); setStage(''); };
  const selectCls = 'border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[110px] bg-white';

  const renderWeek = (label: string, offset: number) => {
    const todayStr = cairoDateOnly();
    const start = cairoWeekStart(0);
    const days = Array.from({ length: 7 }, (_, index) => {
      const dateStr = cairoDaysAhead(offset + index, start);
      const date = new Date(`${dateStr}T00:00:00Z`);
      return { dateStr, dayName: DAQQI_DAYS_OF_WEEK[date.getUTCDay()], dayNum: date.getUTCDate(), month: MONTHS[date.getUTCMonth()] };
    });
    return (
      <div className="mb-5" key={label}>
        <div className="mb-2 flex items-center gap-2 px-1 text-xs font-bold text-gray-500">
          <span className="inline-block h-3.5 w-1 rounded-full bg-primary-400" />{label}
        </div>
        <div className="grid min-w-[980px] grid-cols-7 gap-2">
          {days.map(({ dateStr, dayName, dayNum, month }) => {
            const list = shown.filter(round => round.dayOfWeek === dayName).sort((a, b) => a.timeSlot.localeCompare(b.timeSlot));
            const isToday = dateStr === todayStr;
            return (
              <div key={dateStr} className={`rounded-xl border transition-all ${isToday ? 'border-primary-400 shadow-md' : list.length ? 'border-gray-200 bg-white shadow-sm' : 'border-dashed border-gray-100 bg-gray-50/30'}`}>
                <div className={`rounded-t-xl border-b px-2 py-2.5 text-center ${isToday ? 'border-primary-200 bg-primary-100/50' : 'border-gray-100 bg-gradient-to-b from-gray-50 to-white'}`}>
                  <span className={`text-[11px] font-extrabold ${isToday ? 'text-primary-700' : 'text-gray-700'}`}>{dayName}</span>
                  <div className={`mt-0.5 text-[11px] font-semibold ${isToday ? 'text-primary-600' : 'text-gray-500'}`}>{dayNum} {month}</div>
                  {isToday && <div className="mt-0.5 inline-block rounded-full bg-primary-50 px-2 text-[9px] font-bold text-primary-500">اليوم</div>}
                  {list.length > 0 && <span className="mt-0.5 block text-[10px] font-bold text-primary-500">{list.length} روند</span>}
                </div>
                <div className="min-h-[80px] space-y-2 p-1.5">
                  {list.map(round => {
                    const tone = round.lecture === 0 ? 'bg-blue-50 border-blue-200' : round.lecture === 1 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200';
                    return (
                      <div key={round.id} className={`rounded-lg border p-2 ${tone}`}>
                        <div className="mb-1 flex items-center justify-between gap-1">
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${timeSlotColors[round.timeSlot] || ''}`}>{round.timeSlot}</span>
                          {stageBadge(round.lecture)}
                        </div>
                        <p className="truncate text-[11px] font-bold leading-tight text-gray-800">{round.courseTitle || '—'}</p>
                        {round.instructorName && <p className="mt-0.5 truncate text-[10px] text-gray-500">{round.instructorName}</p>}
                        {round.room && <p className="truncate text-[10px] text-gray-400">🚪 {round.room}</p>}
                        <p className="mt-1 font-mono text-[9px] text-gray-400">{round.startDate}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <article className="flex flex-col gap-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" dir="rtl">
      <DaqqiScheduleHeader view={view} setView={setView} hideCreateRound onCreateRound={() => {}} />

      {/* The server's filter, shown so nobody wonders where the rest went. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <Lock size={13} className="shrink-0" />
        <span className="font-bold">فلتر تلقائي:</span>
        <span>الكورسات الجديدة واللي لسه في المحاضرة الأولى أو التانية — أول ما الكورس يوصل التالتة بيختفي من هنا.</span>
        <span className="mr-auto rounded-full bg-white px-2 py-0.5 font-bold">{all.length} روند متاح</span>
        <button type="button" onClick={() => { void load(); }} disabled={loading} title="تحديث" className="rounded-full border border-amber-200 bg-white p-1.5 text-amber-700 disabled:opacity-40">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
        <select value={course} onChange={e => setCourse(e.target.value)} className={`${selectCls} min-w-[130px]`}>
          <option value="">كل الكورسات</option>
          {courses.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </select>
        <select value={instructor} onChange={e => setInstructor(e.target.value)} className={`${selectCls} min-w-[130px]`}>
          <option value="">كل الدكاترة</option>
          {instructors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={day} onChange={e => setDay(e.target.value)} className={selectCls}>
          <option value="">كل الأيام</option>
          {DAQQI_DAYS_OF_WEEK.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={slot} onChange={e => setSlot(e.target.value)} className={selectCls}>
          <option value="">كل المواعيد</option>
          {DAQQI_TIME_SLOTS.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={stage} onChange={e => setStage(e.target.value as Stage)} className={selectCls}>
          {STAGES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        {hasFilters && <button type="button" onClick={clear} className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100">مسح الفلاتر</button>}
      </div>

      {rounds === null ? (
        <div className="py-16 text-center text-sm text-gray-400">جارٍ تحميل الجدول…</div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 py-14 text-center">
          <Sparkles size={34} className="mx-auto mb-2 text-gray-200" />
          <p className="text-sm font-semibold text-gray-500">{all.length ? 'مفيش روند يطابق الفلتر' : 'مفيش كورس متاح للحجز في الدقي دلوقتي'}</p>
          <p className="mt-1 text-xs text-gray-400">{all.length ? 'امسح الفلاتر.' : 'أول ما يتفتح روند جديد هيظهر هنا.'}</p>
        </div>
      ) : view === 'table' ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 lg:overflow-x-visible">
          <table className="w-full min-w-[820px] table-fixed text-sm lg:min-w-0">
            <colgroup>
              <col className="w-[8%]" /><col className="w-[24%]" /><col className="w-[17%]" /><col className="w-[9%]" /><col className="w-[16%]" /><col className="w-[11%]" /><col className="w-[15%]" />
            </colgroup>
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-700">
                {['الكود', 'الكورس', 'الميعاد', 'القاعة', 'المحاضر والريسبشن', 'المحاضرة', 'المحاضرة الجاية'].map(title => (
                  <th key={title} className="border-b border-gray-200 px-2 py-2.5 text-right font-semibold">{title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((round, index) => (
                <tr key={round.id} className={`${index % 2 ? 'bg-gray-50' : 'bg-white'} border-b border-gray-100 align-top`}>
                  <td className="break-words px-2 py-2.5 font-mono text-xs font-bold text-purple-700">{round.code || '—'}</td>
                  <td className="px-2 py-2.5 text-xs">
                    <span className="break-words font-bold text-gray-800">{round.courseTitle || '—'}</span>
                    <div className="mt-0.5 text-[10px] font-semibold text-gray-400">{BRANCH_LABEL[round.branch] || round.branch}</div>
                  </td>
                  <td className="px-2 py-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="font-semibold text-gray-800">{round.dayOfWeek}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${timeSlotColors[round.timeSlot] || ''}`}>{round.timeSlot}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-gray-400">من {round.startDate}</div>
                  </td>
                  <td className="px-1 py-2.5 text-[11px]">
                    {round.room ? <span className="inline-block max-w-full break-words rounded-md bg-slate-100 px-1 py-0.5 text-[10px] font-semibold leading-tight text-slate-700">{round.room}</span> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-2 py-2.5 text-xs">
                    <div className="break-words text-gray-800">{round.instructorName || '—'}</div>
                    {round.receptionName && <div className="break-words text-[11px] text-gray-500">ريسبشن: {round.receptionName}</div>}
                  </td>
                  <td className="px-2 py-2.5">{stageBadge(round.lecture)}</td>
                  <td className="px-2 py-2.5 text-xs text-gray-600">{round.nextSession || (round.lecture === 0 ? `تبدأ ${round.startDate}` : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto pb-4">
          {renderWeek('الأسبوع الحالي', 0)}
          {renderWeek('الأسبوع القادم', 7)}
        </div>
      )}
      <p className="flex items-center gap-1 text-[11px] text-gray-400"><CalendarDays size={12} /> للقراءة والحجز فقط — بدون أسماء الحاضرين أو الأموال.</p>
    </article>
  );
}
