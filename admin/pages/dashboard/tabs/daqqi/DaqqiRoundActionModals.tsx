import React from 'react';
import { ArrowLeftRight, BookOpen, X } from 'lucide-react';

import type { Course, DaqqiRound, SubscriberItem } from '../../../../types';

export type DaqqiTransferModalState = { subscriberId: string; fromRoundId: string } | null;
export type DaqqiPostponeModalState = { roundId: string; newDate: string } | null;

const getCurrentWeekKey = (): string => {
  const d = new Date();
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return monday.toISOString().slice(0, 10);
};

const courseTitle = (courses: Course[], courseId?: string) => {
  const course = courses.find(c => c.id === courseId);
  return course?.titleAr || course?.title || courseId || '';
};

interface TransferModalProps {
  modal: DaqqiTransferModalState;
  targetId: string;
  setTargetId: (id: string) => void;
  rounds: DaqqiRound[];
  subscribers: SubscriberItem[];
  courses: Course[];
  onClose: () => void;
  onConfirm: () => void;
}

export const DaqqiTransferRoundModal: React.FC<TransferModalProps> = ({
  modal,
  targetId,
  setTargetId,
  rounds,
  subscribers,
  courses,
  onClose,
  onConfirm,
}) => {
  if (!modal) return null;
  const fromRound = rounds.find(r => r.id === modal.fromRoundId);
  const subscriber = subscribers.find(s => s.id === modal.subscriberId);
  const available = rounds.filter(r => r.id !== modal.fromRoundId && !r.attendees.find(a => a.subscriberId === modal.subscriberId));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-extrabold text-gray-900 text-lg flex items-center gap-2"><ArrowLeftRight size={18} className="text-amber-500" />نقل لروند أخرى</h4>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 mb-4">
          <p className="font-bold text-gray-800 text-sm">{subscriber?.name || modal.subscriberId}</p>
          <p className="text-xs text-gray-500 mt-0.5">من: {fromRound?.code} - {courseTitle(courses, fromRound?.courseId)}</p>
        </div>
        <div>
          <label className="text-xs text-gray-600 font-bold mb-2 block">اختر الروند المستهدف</label>
          {available.length === 0 ? <p className="text-sm text-gray-400 italic py-6 text-center">لا توجد روندات أخرى متاحة للنقل.</p> : (
            <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
              {available.map(round => (
                <div
                  key={round.id}
                  onClick={() => setTargetId(round.id)}
                  className={`flex items-center gap-3 border rounded-xl px-3 py-2.5 cursor-pointer transition ${targetId === round.id ? 'border-amber-400 bg-amber-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-800 truncate">{courseTitle(courses, round.courseId)} <span className="text-xs text-gray-400 font-mono">{round.code}</span></p>
                    <p className="text-xs text-gray-500">{round.dayOfWeek} - {round.timeSlot} - {round.startDate}</p>
                  </div>
                  <span className="text-xs bg-green-50 text-green-700 font-bold px-2 py-0.5 rounded-full flex-shrink-0">{round.attendees.length} حاضر</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
          <button onClick={onConfirm} disabled={!targetId} className="flex-1 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 disabled:opacity-40 transition">تأكيد النقل</button>
        </div>
      </div>
    </div>
  );
};

interface ToskeenModalProps {
  subscriberId: string | null;
  targetRoundId: string;
  setTargetRoundId: (id: string) => void;
  rounds: DaqqiRound[];
  subscribers: SubscriberItem[];
  courses: Course[];
  onClose: () => void;
  onConfirm: () => void;
}

export const DaqqiToskeenRoundModal: React.FC<ToskeenModalProps> = ({
  subscriberId,
  targetRoundId,
  setTargetRoundId,
  rounds,
  subscribers,
  courses,
  onClose,
  onConfirm,
}) => {
  if (!subscriberId) return null;
  const subscriber = subscribers.find(s => s.id === subscriberId);
  const available = rounds.filter(r => !r.attendees.find(a => a.subscriberId === subscriberId));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-extrabold text-gray-900 text-lg flex items-center gap-2"><BookOpen size={18} className="text-amber-500" /> تسكين في روند</h4>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
        </div>
        {subscriber && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm flex-shrink-0">{subscriber.name.charAt(0)}</div>
              <div>
                <p className="font-bold text-gray-800 text-sm">{subscriber.name}</p>
                <a href={`tel:${subscriber.phone}`} className="text-xs text-blue-600">{subscriber.phone}</a>
              </div>
            </div>
            {subscriber.enrolledCourseIds.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-gray-500 mb-1.5">الكورسات المسجل بها:</p>
                <div className="flex flex-wrap gap-1">
                  {subscriber.enrolledCourseIds.map(courseId => {
                    const course = courses.find(c => c.id === courseId);
                    return course ? <span key={courseId} className="inline-flex text-[10px] bg-white border border-blue-300 text-blue-700 px-2 py-0.5 rounded-full font-semibold">{course.titleAr || course.title}</span> : null;
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        <div>
          <label className="text-xs text-gray-600 font-bold mb-2 block">اختر الروند</label>
          {available.length === 0 ? <p className="text-sm text-gray-400 italic py-6 text-center">العميل مسكن في جميع الروندات المتاحة.</p> : (
            <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
              {available.map(round => {
                const isMatchingCourse = subscriber?.enrolledCourseIds.includes(round.courseId) ?? false;
                return (
                  <div
                    key={round.id}
                    onClick={() => setTargetRoundId(round.id)}
                    className={`flex items-center gap-3 border rounded-xl px-3 py-2.5 cursor-pointer transition ${
                      targetRoundId === round.id
                        ? 'border-amber-400 bg-amber-50 shadow-sm'
                        : isMatchingCourse
                          ? 'border-blue-300 bg-blue-50/60 hover:border-blue-400'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-bold text-gray-800 truncate">{courseTitle(courses, round.courseId)} <span className="text-xs text-gray-400 font-mono">#{round.code}</span></p>
                        {isMatchingCourse && <span className="text-[10px] bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full font-bold flex-shrink-0">كورس العميل</span>}
                      </div>
                      <p className="text-xs text-gray-500">{round.dayOfWeek} - {round.timeSlot} - {round.startDate}</p>
                      {round.receptionName && <p className="text-[10px] text-gray-400 mt-0.5">{round.receptionName}</p>}
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${round.status === 'active' ? 'bg-green-50 text-green-700' : round.status === 'new' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>{round.attendees.length} حاضر</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
          <button onClick={onConfirm} disabled={!targetRoundId} className="flex-1 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 disabled:opacity-40 transition">تأكيد التسكين</button>
        </div>
      </div>
    </div>
  );
};

interface PostponeModalProps {
  modal: DaqqiPostponeModalState;
  setModal: (modal: Exclude<DaqqiPostponeModalState, null>) => void;
  rounds: DaqqiRound[];
  courses: Course[];
  onClose: () => void;
  onConfirmStartDate: () => void;
  onUpdateRound: (round: DaqqiRound) => void;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}

export const DaqqiPostponeRoundModal: React.FC<PostponeModalProps> = ({
  modal,
  setModal,
  rounds,
  courses,
  onClose,
  onConfirmStartDate,
  onUpdateRound,
  notify,
}) => {
  if (!modal) return null;
  const round = rounds.find(r => r.id === modal.roundId);
  const thisWeek = getCurrentWeekKey();
  const isPostponedThisWeek = (round?.postponedWeeks || []).includes(thisWeek);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-extrabold text-gray-900 text-lg flex items-center gap-2">تأجيل الروند</h4>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
        </div>
        {round && <p className="text-xs text-gray-500 mb-4 bg-gray-50 rounded-xl px-3 py-2">الروند: <span className="font-bold text-gray-800">#{round.code}</span> - {courseTitle(courses, round.courseId)}</p>}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1.5">تغيير تاريخ بداية الكورس</label>
            <input
              type="date"
              value={modal.newDate}
              onChange={e => setModal({ ...modal, newDate: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button onClick={onConfirmStartDate} disabled={!modal.newDate} className="w-full py-2.5 bg-orange-500 text-white rounded-xl text-sm font-bold hover:bg-orange-600 disabled:opacity-40 transition">تأكيد تغيير تاريخ البداية</button>
          {round?.status === 'active' && (
            <div className="border-t border-gray-100 pt-4">
              <label className="block text-xs font-bold text-gray-600 mb-2">تأجيل محاضرة هذا الأسبوع</label>
              <button
                onClick={() => {
                  const weeks = round.postponedWeeks || [];
                  onUpdateRound({ ...round, postponedWeeks: isPostponedThisWeek ? weeks.filter(w => w !== thisWeek) : [...weeks, thisWeek] });
                  onClose();
                  notify('success', isPostponedThisWeek ? 'تم إلغاء تأجيل المحاضرة.' : 'تم تأجيل محاضرة هذا الأسبوع.');
                }}
                className={`w-full py-2.5 rounded-xl text-sm font-bold transition ${isPostponedThisWeek ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-amber-500 text-white hover:bg-amber-600'}`}
              >
                {isPostponedThisWeek ? 'إلغاء تأجيل هذا الأسبوع' : 'تأجيل محاضرة هذا الأسبوع'}
              </button>
            </div>
          )}
          <button onClick={onClose} className="w-full py-2 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
        </div>
      </div>
    </div>
  );
};
