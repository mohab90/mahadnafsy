import React from 'react';
import { Pencil } from 'lucide-react';
import type { Course, DaqqiDayOfWeek, DaqqiTimeSlot } from '../../../../types';
import type { DaqqiDraftType } from './daqqiScheduleUtils';

interface NamedOption {
  id: string;
  name: string;
}

interface RoomOption {
  name: string;
  capacity?: number;
}

interface Props {
  open: boolean;
  roundCode?: string;
  draft: DaqqiDraftType;
  setDraft: React.Dispatch<React.SetStateAction<DaqqiDraftType>>;
  courses: Course[];
  instructors: NamedOption[];
  receptionStaff: NamedOption[];
  rooms: RoomOption[];
  daysOfWeek: readonly DaqqiDayOfWeek[];
  timeSlots: readonly DaqqiTimeSlot[];
  onClose: () => void;
  onSave: () => void;
}

export function DaqqiRoundEditorModal({
  open,
  roundCode,
  draft,
  setDraft,
  courses,
  instructors,
  receptionStaff,
  rooms,
  daysOfWeek,
  timeSlots,
  onClose,
  onSave,
}: Props) {
  if (!open) return null;

  const canSave = !!draft.courseId && !!draft.instructorId && !!draft.receptionId && !!draft.startDate;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-auto p-6" dir="rtl" onClick={(event) => event.stopPropagation()}>
        <h4 className="font-extrabold text-gray-900 text-lg mb-4 flex items-center gap-2"><Pencil size={16} className="text-amber-500" />تعديل الروند — {roundCode}</h4>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-600 font-bold mb-1 block">الكورس <span className="text-red-500">*</span></label>
            <select value={draft.courseId} onChange={(event) => setDraft({ ...draft, courseId: event.target.value })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
              <option value="">اختر الكورس...</option>
              {courses.map((course) => <option key={course.id} value={course.id}>{course.titleAr || course.title}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 font-bold mb-1 block">المحاضر <span className="text-red-500">*</span></label>
            <select value={draft.instructorId} onChange={(event) => setDraft({ ...draft, instructorId: event.target.value })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
              <option value="">اختر المحاضر...</option>
              {instructors.map((instructor) => <option key={instructor.id} value={instructor.id}>{instructor.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 font-bold mb-1 block">مسؤول الريسبشن <span className="text-red-500">*</span></label>
            <select value={draft.receptionId} onChange={(event) => setDraft({ ...draft, receptionId: event.target.value })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
              <option value="">اختر مسؤول الريسبشن...</option>
              {receptionStaff.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
            </select>
          </div>
          {rooms.length > 0 && (
            <div>
              <label className="text-xs text-gray-600 font-bold mb-1 block">القاعة</label>
              <select value={draft.roomId} onChange={(event) => setDraft({ ...draft, roomId: event.target.value })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
                <option value="">— بدون قاعة —</option>
                {rooms.map((room) => <option key={room.name} value={room.name}>{room.name}{room.capacity ? ` (${room.capacity} فرد)` : ''}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 font-bold mb-1 block">اليوم</label>
              <select value={draft.dayOfWeek} onChange={(event) => setDraft({ ...draft, dayOfWeek: event.target.value as DaqqiDayOfWeek })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
                {daysOfWeek.map((day) => <option key={day} value={day}>{day}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600 font-bold mb-1 block">الموعد</label>
              <select value={draft.timeSlot} onChange={(event) => setDraft({ ...draft, timeSlot: event.target.value as DaqqiTimeSlot })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none">
                {timeSlots.map((timeSlot) => <option key={timeSlot} value={timeSlot}>{timeSlot}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 font-bold mb-1 block">تاريخ البدء <span className="text-red-500">*</span></label>
            <input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none" />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onSave} disabled={!canSave} className="flex-1 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 disabled:opacity-40 transition">حفظ التعديلات</button>
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
        </div>
      </div>
    </div>
  );
}
