import React from 'react';
import { Course, DaqqiRound, SubscriberItem } from '../../types';

interface Props {
  subDaqqiRounds: DaqqiRound[];
  courses: Course[];
  subscriber: SubscriberItem;
}

/** Read-only Daqqi (in-person) rounds schedule for a subscriber (extracted from UnifiedClientPage). */
export default function DaqqiRoundsTab({ subDaqqiRounds, courses, subscriber }: Props) {
  return (
    <div id="section-daqqi" className="space-y-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-1 h-5 rounded-full bg-slate-500 flex-shrink-0" />
        <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-2 flex-1">
          🗓️ جدول كورسات الدقي
        </h3>
        <span className="text-[11px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{subDaqqiRounds.length}</span>
      </div>
      {subDaqqiRounds.map(round => {
        const roundCourse = courses.find(c => c.id === round.courseId);
        const attendee = round.attendees.find(a => a.subscriberId === subscriber.id);
        const coursePrice = roundCourse?.price?.EGP ?? 0;
        const remaining = coursePrice > 0 ? Math.max(0, coursePrice - (attendee?.amountPaid ?? 0)) : 0;
        const statusColors: Record<string, string> = { new: 'bg-blue-100 text-blue-700', active: 'bg-green-100 text-green-700', finished: 'bg-gray-100 text-gray-600' };
        const statusLabels: Record<string, string> = { new: 'جديدة', active: 'جارية', finished: 'منتهية' };
        return (
          <div key={round.id} className="border border-gray-200 rounded-xl p-4 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <p className="font-extrabold text-gray-900 text-sm">{roundCourse?.title || round.courseId}</p>
                <p className="text-xs text-gray-500 mt-0.5">روند رقم: <span className="font-mono font-bold text-indigo-600">#{round.code}</span></p>
              </div>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${statusColors[round.status] || 'bg-gray-100 text-gray-600'}`}>
                {statusLabels[round.status] || round.status}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-gray-50 rounded-lg p-2">
                <p className="text-gray-400 text-[10px]">اليوم</p>
                <p className="font-bold text-gray-700">{round.dayOfWeek}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2">
                <p className="text-gray-400 text-[10px]">الموعد</p>
                <p className="font-bold text-gray-700">{round.timeSlot}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2">
                <p className="text-gray-400 text-[10px]">تاريخ البدء</p>
                <p className="font-bold text-gray-700">{round.startDate}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2">
                <p className="text-gray-400 text-[10px]">المحاضر</p>
                <p className="font-bold text-gray-700 truncate">{round.instructorName}</p>
              </div>
            </div>
            {attendee && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="bg-green-50 rounded-lg p-2 text-center border border-green-100">
                  <p className="font-extrabold text-green-700">{(attendee.amountPaid || 0).toLocaleString()} ج.م</p>
                  <p className="text-[10px] text-gray-400">مدفوع</p>
                </div>
                <div className={`rounded-lg p-2 text-center border ${remaining > 0 ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'}`}>
                  {remaining > 0
                    ? <><p className="font-extrabold text-red-600">{remaining.toLocaleString()} ج.م</p><p className="text-[10px] text-gray-400">متبقي</p></>
                    : <><p className="font-bold text-green-700 text-sm">✅</p><p className="text-[10px] text-gray-400">مكتمل</p></>}
                </div>
                <div className="bg-blue-50 rounded-lg p-2 text-center border border-blue-100">
                  <p className="font-extrabold text-blue-700">{attendee.attendedLectures ?? 0}</p>
                  <p className="text-[10px] text-gray-400">محاضرات حضرها</p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
