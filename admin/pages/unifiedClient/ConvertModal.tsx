import React from 'react';
import type { Course, Bundle } from '../../types';

interface Props {
  courses: Course[];
  bundles: Bundle[];
  convertCourseId: string; setConvertCourseId: (v: string) => void;
  convertAccessMode: 'full' | 'limited'; setConvertAccessMode: (v: 'full' | 'limited') => void;
  convertPartialCount: number; setConvertPartialCount: (v: number) => void;
  isSaving: boolean;
  onConvert: () => void;
  onClose: () => void;
}

/** "تحويل إلى مشترك" modal (extracted from UnifiedClientPage). */
export default function ConvertModal({
  courses, bundles, convertCourseId, setConvertCourseId, convertAccessMode, setConvertAccessMode,
  convertPartialCount, setConvertPartialCount, isSaving, onConvert, onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4" onClick={e => e.stopPropagation()} dir="rtl">
        <h2 className="font-bold text-lg text-gray-800">تحويل إلى مشترك</h2>
        <div>
          <label className="text-xs text-gray-600 mb-1 block">الكورس *</label>
          <select value={convertCourseId} onChange={e => setConvertCourseId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="">اختر الكورس</option>
            {(() => {
              const bundledIds = new Set(bundles.flatMap(b => b.courses.map(x => x.id)));
              return (<>
                {bundles.map(b => (
                  <optgroup key={b.id} label={`📌 ${b.title}`}>
                    {b.courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </optgroup>
                ))}
                <optgroup label="🎓 الكورسات الفردية">
                  {courses.filter(c => !bundledIds.has(c.id)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </optgroup>
              </>);
            })()}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-600 mb-1 block">نوع الوصول</label>
          <div className="grid grid-cols-2 gap-2">
            {(['full', 'limited'] as const).map(m => (
              <button key={m} onClick={() => setConvertAccessMode(m)}
                className={`py-2 rounded-lg text-sm font-medium border-2 ${convertAccessMode === m ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500'}`}>
                {m === 'full' ? 'وصول كامل' : 'محدود'}
              </button>
            ))}
          </div>
        </div>
        {convertAccessMode === 'limited' && (
          <div>
            <label className="text-xs text-gray-600 mb-1 block">عدد المحاضرات</label>
            <input type="number" min={1} value={convertPartialCount} onChange={e => setConvertPartialCount(Number(e.target.value))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button onClick={onConvert} disabled={!convertCourseId || isSaving} className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 disabled:opacity-40">تحويل</button>
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-200 rounded-lg text-sm">إلغاء</button>
        </div>
      </div>
    </div>
  );
}
