import React from 'react';
import { Pencil } from 'lucide-react';
import { useSiteData } from '../../../../context/SiteDataContext';
import type { DaqqiRound, DaqqiDayOfWeek, DaqqiTimeSlot } from '../../../../types';

export type DaqqiDraftType = {
  courseId: string; instructorId: string; receptionId: string; roomId: string;
  dayOfWeek: DaqqiDayOfWeek; startDate: string; timeSlot: DaqqiTimeSlot;
};

interface Props {
  roundId: string;
  rounds: DaqqiRound[];
  draft: DaqqiDraftType;
  onChange: (d: DaqqiDraftType) => void;
  onSave: () => void;
  onClose: () => void;
}

export function DaqqiEditRoundModal({ roundId, rounds, draft, onChange, onSave, onClose }: Props) {
  const { courses, therapists, staffMembers, content } = useSiteData();
  const editRound = rounds.find(r => r.id === roundId);
  const instructorOptions = therapists;
  const receptionOptions = staffMembers.filter(s => s.role === 'reception_daqqi' && s.status === 'active');
  const daysOfWeek: DaqqiDayOfWeek[] = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const timeSlotsList: DaqqiTimeSlot[] = ['صباحاً', 'ظهراً', 'مساءً'];
  const daqqiRooms = (() => {
    try {
      const raw = content['institute.branches'];
      if (!raw) return [] as { name: string; capacity: number }[];
      const branches: { id: string; label: string; rooms?: { name: string; capacity: number }[] }[] = JSON.parse(raw);
      const norm = (v: string) => v.toUpperCase().replace(/[-\s]/g, '_');
      const daqBranch = branches.find(b => norm(b.id) === 'DAQQI' || (b.label || '').includes('دق'));
      return daqBranch?.rooms || [] as { name: string; capacity: number }[];
    } catch { return [] as { name: string; capacity: number }[]; }
  })();

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-auto p-6" dir="rtl" onClick={e => e.stopPropagation()}>
        <h4 className="font-extrabold text-gray-900 text-lg mb-4 flex items-center gap-2"><Pencil size={16} className="text-amber-500" />تعديل الروند — {editRound?.code}</h4>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-600 font-bold mb-1 block">الكورس <span className="text-red-500">*</span></label>
            <select value={draft.courseId} onChange={e => onChange({ ...draft, courseId: e.target.value })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
              <option value="">اختر الكورس...</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.titleAr || c.title}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 font-bold mb-1 block">المحاضر <span className="text-red-500">*</span></label>
            <select value={draft.instructorId} onChange={e => onChange({ ...draft, instructorId: e.target.value })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
              <option value="">اختر المحاضر...</option>
              {instructorOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 font-bold mb-1 block">مسؤول الريسبشن <span className="text-red-500">*</span></label>
            <select value={draft.receptionId} onChange={e => onChange({ ...draft, receptionId: e.target.value })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
              <option value="">اختر مسؤول الريسبشن...</option>
              {receptionOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {daqqiRooms.length > 0 && (
            <div>
              <label className="text-xs text-gray-600 font-bold mb-1 block">القاعة</label>
              <select value={draft.roomId} onChange={e => onChange({ ...draft, roomId: e.target.value })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
                <option value="">— بدون قاعة —</option>
                {daqqiRooms.map(r => <option key={r.name} value={r.name}>{r.name}{r.capacity ? ` (${r.capacity} فرد)` : ''}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 font-bold mb-1 block">اليوم</label>
              <select value={draft.dayOfWeek} onChange={e => onChange({ ...draft, dayOfWeek: e.target.value as DaqqiDayOfWeek })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
                {daysOfWeek.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600 font-bold mb-1 block">الموعد</label>
              <select value={draft.timeSlot} onChange={e => onChange({ ...draft, timeSlot: e.target.value as DaqqiTimeSlot })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
                {timeSlotsList.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 font-bold mb-1 block">تاريخ البدء <span className="text-red-500">*</span></label>
            <input type="date" value={draft.startDate} onChange={e => onChange({ ...draft, startDate: e.target.value })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none" />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onSave} disabled={!draft.courseId || !draft.instructorId || !draft.receptionId || !draft.startDate} className="flex-1 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 disabled:opacity-40 transition">حفظ التعديلات</button>
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
        </div>
      </div>
    </div>
  );
}
