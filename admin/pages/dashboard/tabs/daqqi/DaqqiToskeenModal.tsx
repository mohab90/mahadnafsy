import React from 'react';
import { BookOpen, X } from 'lucide-react';
import type { DaqqiRound, SubscriberItem, Course } from '../../../../types';

interface Props {
  subId: string;
  targetRoundId: string;
  onTargetChange: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  rounds: DaqqiRound[];
  subscribers: SubscriberItem[];
  courses: Course[];
}

export function DaqqiToskeenModal({ subId, targetRoundId, onTargetChange, onClose, onConfirm, rounds, subscribers, courses }: Props) {
  const toskeenSub = subscribers.find(s => s.id === subId);
  const available = rounds.filter(r => !r.attendees.find(a => a.subscriberId === subId));
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-extrabold text-gray-900 text-lg flex items-center gap-2"><BookOpen size={18} className="text-amber-500" /> تسكين في روند</h4>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
        </div>
        {toskeenSub && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm flex-shrink-0">{toskeenSub.name.charAt(0)}</div>
              <div>
                <p className="font-bold text-gray-800 text-sm">{toskeenSub.name}</p>
                <a href={`tel:${toskeenSub.phone}`} className="text-xs text-blue-600">{toskeenSub.phone}</a>
              </div>
            </div>
            {toskeenSub.enrolledCourseIds.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-gray-500 mb-1.5">الكورسات المسجّل بها:</p>
                <div className="flex flex-wrap gap-1">
                  {toskeenSub.enrolledCourseIds.map(cid => {
                    const c = courses.find(x => x.id === cid);
                    return c ? <span key={cid} className="inline-flex text-[10px] bg-white border border-blue-300 text-blue-700 px-2 py-0.5 rounded-full font-semibold">{c.titleAr || c.title}</span> : null;
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        <div>
          <label className="text-xs text-gray-600 font-bold mb-2 block">اختر الروند</label>
          {available.length === 0 ? <p className="text-sm text-gray-400 italic py-6 text-center">العميل مسكّن في جميع الروندات المتاحة.</p> : (
            <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
              {available.map(r => {
                const c = courses.find(x => x.id === r.courseId);
                const isMatchingCourse = toskeenSub?.enrolledCourseIds.includes(r.courseId) ?? false;
                return (
                  <div key={r.id} onClick={() => onTargetChange(r.id)} className={`flex items-center gap-3 border rounded-xl px-3 py-2.5 cursor-pointer transition ${
                    targetRoundId === r.id
                      ? 'border-amber-400 bg-amber-50 shadow-sm'
                      : isMatchingCourse
                        ? 'border-blue-300 bg-blue-50/60 hover:border-blue-400'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-bold text-gray-800 truncate">{c?.titleAr || c?.title || r.courseId} <span className="text-xs text-gray-400 font-mono">#{r.code}</span></p>
                        {isMatchingCourse && <span className="text-[10px] bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full font-bold flex-shrink-0">✓ كورس العميل</span>}
                      </div>
                      <p className="text-xs text-gray-500">{r.dayOfWeek} — {r.timeSlot} — {r.startDate}</p>
                      {r.receptionName && <p className="text-[10px] text-gray-400 mt-0.5">👤 {r.receptionName}</p>}
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${r.status === 'active' ? 'bg-green-50 text-green-700' : r.status === 'new' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>{r.attendees.length} حاضر</span>
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
}
