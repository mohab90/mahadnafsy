import React from 'react';
import type { Bundle, Course } from '../../types';
import { UnifiedClientCourseOptions } from './UnifiedClientCourseOptions';

type Props = {
  open: boolean;
  bundles: Bundle[];
  courses: Course[];
  courseId: string;
  accessMode: 'full' | 'limited';
  partialCount: number;
  saving: boolean;
  setCourseId: (value: string) => void;
  setAccessMode: (value: 'full' | 'limited') => void;
  setPartialCount: (value: number) => void;
  onSubmit: () => void;
  onClose: () => void;
};

export const UnifiedClientConvertModal: React.FC<Props> = ({
  open,
  bundles,
  courses,
  courseId,
  accessMode,
  partialCount,
  saving,
  setCourseId,
  setAccessMode,
  setPartialCount,
  onSubmit,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4" onClick={event => event.stopPropagation()} dir="rtl">
        <h2 className="font-bold text-lg text-gray-800">تحويل إلى مشترك</h2>
        <div>
          <label className="text-xs text-gray-600 mb-1 block">الكورس *</label>
          <select value={courseId} onChange={event => setCourseId(event.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="">اختر الكورس</option>
            <UnifiedClientCourseOptions bundles={bundles} courses={courses} />
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-600 mb-1 block">نوع الوصول</label>
          <div className="grid grid-cols-2 gap-2">
            {(['full', 'limited'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setAccessMode(mode)}
                className={`py-2 rounded-lg text-sm font-medium border-2 ${accessMode === mode ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500'}`}
              >
                {mode === 'full' ? 'وصول كامل' : 'محدود'}
              </button>
            ))}
          </div>
        </div>
        {accessMode === 'limited' && (
          <div>
            <label className="text-xs text-gray-600 mb-1 block">عدد المحاضرات</label>
            <input
              type="number"
              min={1}
              value={partialCount}
              onChange={event => setPartialCount(Number(event.target.value))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onSubmit} disabled={!courseId || saving} className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 disabled:opacity-40">
            تحويل
          </button>
          <button type="button" onClick={onClose} className="flex-1 py-2.5 bg-gray-200 rounded-lg text-sm">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
};
