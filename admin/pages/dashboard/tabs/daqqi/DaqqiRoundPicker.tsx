// The list a client is housed from: one card per round with its number, the
// doctor and the appointment.
//
// «نخلي في القايمه دي اللى يظهر اسم الدكتور مش اسم الرسيبشن … رقم الروند واسم
// الدكتور والموعد». The housing dialog on «عملاء الدقي» listed «code — reception —
// day slot» in a <select>, the schedule's dialog listed the reception under each
// card, and the booking screen had no way to house a client at all. One picker
// now, used by all of them, so the same round reads the same wherever it is
// chosen.

import type { Course, DaqqiRound } from '../../../../types';
import { DAQQI_TIME_SLOT_COLORS, DAQQI_STATUS_COLORS } from './daqqiScheduleConfig';
import { orderRoundsForClient } from './daqqiScheduleUtils';

const courseTitleOf = (courses: Course[], courseId?: string) => {
  const course = courses.find(c => c.id === courseId);
  return course?.titleAr || course?.title || courseId || '';
};

const STATUS_LABEL: Record<string, string> = { new: 'جديد', active: 'شغال', finished: 'منتهي' };

export function DaqqiRoundPicker({ rounds, courses, selectedId, onSelect, clientCourseIds = [], currentRoundId = '', emptyText = 'مفيش روندات متاحة.' }: {
  rounds: DaqqiRound[];
  courses: Course[];
  selectedId: string;
  onSelect: (roundId: string) => void;
  /** The courses the client holds, so their rounds are marked and come first. */
  clientCourseIds?: string[];
  /** The round the client is in now, marked. */
  currentRoundId?: string;
  emptyText?: string;
}) {
  const ordered = orderRoundsForClient(rounds, clientCourseIds);
  if (ordered.length === 0) return <p className="py-6 text-center text-sm italic text-gray-400">{emptyText}</p>;
  return (
    <div className="max-h-72 space-y-2 overflow-y-auto" role="radiogroup" aria-label="اختر الروند">
      {ordered.map(round => {
        const status = round.status || 'new';
        const isClientCourse = clientCourseIds.includes(round.courseId);
        const selected = selectedId === round.id;
        const hall = round.room || round.roomName;
        return (
          <button
            key={round.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(round.id)}
            className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-right transition ${
              selected
                ? 'border-amber-400 bg-amber-50 shadow-sm'
                : isClientCourse
                  ? 'border-blue-300 bg-blue-50/60 hover:border-blue-400'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            } ${status === 'finished' && !selected ? 'opacity-70' : ''}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-md bg-purple-50 px-1.5 py-0.5 font-mono text-xs font-bold text-purple-700">{round.code || '—'}</span>
                <span className="truncate text-sm font-bold text-gray-800">{courseTitleOf(courses, round.courseId)}</span>
                {isClientCourse && <span className="shrink-0 rounded-full border border-blue-200 bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">كورس العميل</span>}
                {currentRoundId === round.id && <span className="shrink-0 rounded-full border border-indigo-200 bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">الروند الحالي</span>}
              </div>
              <p className="mt-1 text-xs font-semibold text-gray-700">👨‍🏫 {round.instructorName || 'المحاضر لسه متحددش'}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                <span className="font-semibold text-gray-700">{round.dayOfWeek}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${DAQQI_TIME_SLOT_COLORS[round.timeSlot] || ''}`}>{round.timeSlot}</span>
                <span>{round.startDate ? `من ${round.startDate}` : 'بدون تاريخ'}</span>
                {hall && <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-semibold text-slate-700">{hall}</span>}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${DAQQI_STATUS_COLORS[status] || ''}`}>{STATUS_LABEL[status] || status}</span>
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-700">{round.attendees.length} حاضر</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
