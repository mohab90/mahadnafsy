import React from 'react';
import { Key, X } from 'lucide-react';
import type { SubscriberItem, Course, Bundle } from '../../types';

interface Props {
  subscriber: SubscriberItem;
  courses: Course[];
  bundles: Bundle[];
  grantDraft: { courseId: string; note: string };
  setGrantDraft: (v: { courseId: string; note: string }) => void;
  onGrant: () => void;
  onClose: () => void;
}

/** "منح كورس" — grant a course to a subscriber (full access). Extracted/added for UnifiedClientPage. */
export default function GrantCourseModal({ subscriber, courses, bundles, grantDraft, setGrantDraft, onGrant, onClose }: Props) {
  const bundledIds = new Set(bundles.flatMap(b => b.courses.map(x => x.id)));
  const enrolled = new Set(subscriber.enrolledCourseIds);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center text-violet-600"><Key size={18} /></div>
            <div>
              <p className="font-extrabold text-gray-900 text-sm">منح كورس</p>
              <p className="text-[11px] text-gray-400">{subscriber.name} — وصول كامل فوري</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-xs text-gray-600 mb-1 block font-medium">الكورس *</label>
            <select value={grantDraft.courseId} onChange={e => setGrantDraft({ ...grantDraft, courseId: e.target.value })}
              className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm">
              <option value="">— اختر الكورس —</option>
              {bundles.map(b => (
                <optgroup key={b.id} label={`📌 ${b.title}`}>
                  {b.courses.map(c => <option key={c.id} value={c.id}>{c.title}{enrolled.has(c.id) ? ' ✓ (مسجّل)' : ''}</option>)}
                </optgroup>
              ))}
              <optgroup label="🎓 كورسات فردية">
                {courses.filter(c => !bundledIds.has(c.id)).map(c => <option key={c.id} value={c.id}>{c.title}{enrolled.has(c.id) ? ' ✓ (مسجّل)' : ''}</option>)}
              </optgroup>
            </select>
          </div>
          {grantDraft.courseId && enrolled.has(grantDraft.courseId) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
              العميل مسجّل بالفعل في هذا الكورس — سيتم رفع صلاحيته إلى «وصول كامل».
            </div>
          )}
          <div>
            <label className="text-xs text-gray-600 mb-1 block font-medium">ملاحظة (اختياري)</label>
            <input value={grantDraft.note} onChange={e => setGrantDraft({ ...grantDraft, note: e.target.value })}
              placeholder="مثال: منحة / تعويض"
              className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onGrant} disabled={!grantDraft.courseId}
              className="flex-1 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-bold hover:bg-violet-700 disabled:opacity-40">
              🔑 منح الوصول الكامل
            </button>
            <button onClick={onClose} className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}
