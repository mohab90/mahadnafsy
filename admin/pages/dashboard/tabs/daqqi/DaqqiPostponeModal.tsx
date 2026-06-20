import React from 'react';
import { X } from 'lucide-react';
import type { DaqqiRound, Course } from '../../../../types';

const getCurrentWeekKey = (): string => {
  const d = new Date();
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return monday.toISOString().slice(0, 10);
};

interface PostponeModalData {
  roundId: string;
  newDate: string;
}

interface Props {
  modal: PostponeModalData;
  onChange: (m: PostponeModalData) => void;
  onClose: () => void;
  onConfirm: () => void;
  onToggleWeek: (roundId: string) => void;
  rounds: DaqqiRound[];
  courses: Course[];
}

export function DaqqiPostponeModal({ modal, onChange, onClose, onConfirm, onToggleWeek, rounds, courses }: Props) {
  const pmRound = rounds.find(r => r.id === modal.roundId);
  const thisWeek = getCurrentWeekKey();
  const isPostponedThisWeek = (pmRound?.postponedWeeks || []).includes(thisWeek);
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-extrabold text-gray-900 text-lg flex items-center gap-2">📅 تأجيل الروند</h4>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
        </div>
        {pmRound && <p className="text-xs text-gray-500 mb-4 bg-gray-50 rounded-xl px-3 py-2">الروند: <span className="font-bold text-gray-800">#{pmRound.code}</span> — {courses.find(c => c.id === pmRound.courseId)?.titleAr || pmRound.courseId}</p>}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1.5">تغيير تاريخ بداية الكورس</label>
            <input type="date" value={modal.newDate} onChange={e => onChange({ ...modal, newDate: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onClick={onConfirm} disabled={!modal.newDate} className="w-full py-2.5 bg-orange-500 text-white rounded-xl text-sm font-bold hover:bg-orange-600 disabled:opacity-40 transition">تأكيد تغيير تاريخ البداية</button>
          {pmRound?.status === 'active' && (
            <div className="border-t border-gray-100 pt-4">
              <label className="block text-xs font-bold text-gray-600 mb-2">تأجيل محاضرة هذا الأسبوع</label>
              <button
                onClick={() => onToggleWeek(modal.roundId)}
                className={`w-full py-2.5 rounded-xl text-sm font-bold transition ${isPostponedThisWeek ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-amber-500 text-white hover:bg-amber-600'}`}
              >{isPostponedThisWeek ? '↩ إلغاء تأجيل هذا الأسبوع' : '⏸ تأجيل محاضرة هذا الأسبوع'}</button>
            </div>
          )}
          <button onClick={onClose} className="w-full py-2 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
        </div>
      </div>
    </div>
  );
}
