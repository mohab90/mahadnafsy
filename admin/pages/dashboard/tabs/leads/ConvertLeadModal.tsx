import React from 'react';
import { CheckCircle } from 'lucide-react';
import type { AccessMode, Course, LeadItem } from '../../../../types';

export interface ConvertLeadModalState {
  lead: LeadItem | null;
  courseId: string;
  accessMode: AccessMode;
}

interface ConvertLeadModalProps {
  state: ConvertLeadModalState;
  courses: Course[];
  setState: React.Dispatch<React.SetStateAction<ConvertLeadModalState>>;
  onConfirm: () => void;
}

const closedState: ConvertLeadModalState = { lead: null, courseId: '', accessMode: 'full' };

export function ConvertLeadModal({ state, courses, setState, onConfirm }: ConvertLeadModalProps) {
  if (!state.lead) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setState(closedState)}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <h3 className="font-bold text-gray-900 text-lg mb-1">تحويل lead لمشترك</h3>
        <p className="text-sm text-gray-500 mb-4">
          اختر الكورس المناسب للعميل <span className="font-bold text-gray-800">{state.lead.name}</span> لتسجيله كمشترك.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">الكورس / البرنامج</label>
            <select className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm" value={state.courseId} onChange={(event) => setState({ ...state, courseId: event.target.value })}>
              <option value="">اختر كورس...</option>
              {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">نوع الوصول</label>
            <select className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm" value={state.accessMode} onChange={(event) => setState({ ...state, accessMode: event.target.value as AccessMode })}>
              <option value="full">وصول كامل</option>
              <option value="preview">تجربة</option>
              <option value="limited">محدود</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onConfirm} disabled={!state.courseId} className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-1.5">
            <CheckCircle size={16} /> تحويل العميل
          </button>
          <button onClick={() => setState(closedState)} className="flex-1 border border-gray-300 text-gray-700 font-bold py-2.5 rounded-xl text-sm hover:bg-gray-50">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
