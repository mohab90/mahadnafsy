import React from 'react';
import { Pencil } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
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
    <Modal
      open
      onClose={onClose}
      title="تعديل الروند"
      subtitle={roundCode}
      icon={<Pencil size={16} className="text-amber-500" />}
      footer={(
        <>
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
          <button onClick={onSave} disabled={!canSave} className="px-5 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 disabled:opacity-40 transition">حفظ التعديلات</button>
        </>
      )}
    >
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
          {/* Always rendered — see the matching field on the create form. A
              branch with no halls configured used to get no field at all. */}
          <div>
            <label className="text-xs text-gray-600 font-bold mb-1 block">القاعة</label>
            <input
              list="daqqi-room-options-edit"
              value={draft.roomId}
              onChange={(event) => setDraft({ ...draft, roomId: event.target.value })}
              placeholder={rooms.length ? 'اختر قاعة أو اكتب اسمها...' : 'اكتب اسم القاعة (اختياري)'}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
            />
            <datalist id="daqqi-room-options-edit">
              {rooms.map((room) => <option key={room.name} value={room.name}>{room.capacity ? `${room.capacity} فرد` : ''}</option>)}
            </datalist>
            <p className="text-[10px] text-gray-400 mt-1">القاعة الواحدة لا تقبل روندين في نفس اليوم والتوقيت.</p>
          </div>
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
    </Modal>
  );
}
