import React from 'react';
import { BookOpen, Shield, X } from 'lucide-react';

import type { Course, CourseAccessSetting, SubscriberItem } from '../../types';
import { normalizeAccess } from './constants';

type AccessPreset = { p1: number; p2: number };
type AccessMessage = { ok: boolean; text: string };

interface UnifiedClientAccessModalProps {
  open: boolean;
  subscriber?: SubscriberItem;
  canManageCourseAccess: boolean;
  courses: Course[];
  getCourseLectures: (courseId: string) => unknown[];
  accessSaving: Record<string, boolean>;
  accessMsg: Record<string, AccessMessage | undefined>;
  accessPresets: Record<string, AccessPreset>;
  setAccessPresets: React.Dispatch<React.SetStateAction<Record<string, AccessPreset>>>;
  manualLimitDraft: Record<string, string>;
  setManualLimitDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  getPreset: (courseId: string) => AccessPreset;
  applyAccessLevel: (courseId: string, mode: CourseAccessSetting['mode'], lectureLimit?: number) => void | Promise<void>;
  onClose: () => void;
}

export function UnifiedClientAccessModal({
  open,
  subscriber,
  canManageCourseAccess,
  courses,
  getCourseLectures,
  accessSaving,
  accessMsg,
  setAccessPresets,
  manualLimitDraft,
  setManualLimitDraft,
  getPreset,
  applyAccessLevel,
  onClose,
}: UnifiedClientAccessModalProps) {
  if (!open || !subscriber || !canManageCourseAccess) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()} dir="rtl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
              <Shield size={18} className="text-violet-600" />
            </div>
            <div>
              <h2 className="font-extrabold text-gray-900 text-base">صلاحية الفيديوهات</h2>
              <p className="text-xs text-gray-400">{subscriber.name} - {subscriber.enrolledCourseIds.length} كورس مسجل</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {subscriber.enrolledCourseIds.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <BookOpen size={40} className="mx-auto mb-3 text-gray-200" />
              <p className="text-sm">لا يوجد كورسات مسجلة</p>
            </div>
          ) : subscriber.enrolledCourseIds.map(courseId => {
            const course = courses.find(item => item.id === courseId);
            const access = normalizeAccess(subscriber.courseAccess?.[courseId]);
            const totalLectures = getCourseLectures(courseId).length;
            const watched = Number(subscriber.lectureProgress?.[courseId]) || 0;
            const percent = totalLectures > 0 ? Math.round((watched / totalLectures) * 100) : 0;
            const saving = accessSaving[courseId] ?? false;
            const message = accessMsg[courseId];
            const preset = getPreset(courseId);
            const currentManual = manualLimitDraft[courseId] ?? String(access.lectureLimit || preset.p1);
            const accessBadge = access.mode === 'full'
              ? { label: 'وصول كامل', cls: 'bg-green-100 text-green-700' }
              : access.mode === 'preview'
              ? { label: 'غير مفعل', cls: 'bg-gray-100 text-gray-500' }
              : { label: `محدود - ${access.lectureLimit || 1} فيديو`, cls: 'bg-blue-100 text-blue-700' };

            return (
              <div key={courseId} className="border border-gray-200 rounded-2xl p-4 bg-gray-50/50">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <p className="font-bold text-gray-800 text-sm leading-tight flex-1">{course?.title || courseId}</p>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${accessBadge.cls}`}>{accessBadge.label}</span>
                </div>

                {totalLectures > 0 && (
                  <div className="mb-3">
                    <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                      <span>التقدم</span>
                      <span>{watched} / {totalLectures} فيديو ({percent}%)</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full transition-all ${percent >= 80 ? 'bg-green-500' : percent >= 40 ? 'bg-amber-500' : 'bg-blue-400'}`} style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <p className="text-[11px] text-gray-400 font-semibold">تغيير الصلاحية:</p>
                  <div className="flex flex-wrap gap-2 items-center">
                    <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                      <button disabled={saving} onClick={() => applyAccessLevel(courseId, 'limited', preset.p1)}
                        className={`text-xs font-bold text-amber-700 hover:text-amber-900 transition disabled:opacity-50 ${access.mode === 'limited' && access.lectureLimit === preset.p1 ? 'underline' : ''}`}>
                        مقدم
                      </button>
                      <input type="number" min={1} value={preset.p1}
                        onChange={e => setAccessPresets(prev => ({ ...prev, [courseId]: { ...getPreset(courseId), p1: Number(e.target.value) || 1 } }))}
                        className="w-10 text-xs text-center border border-amber-200 rounded px-1 py-0.5 focus:outline-none bg-white" />
                      <span className="text-[10px] text-amber-500">فيديو</span>
                    </div>
                    <div className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5">
                      <button disabled={saving} onClick={() => applyAccessLevel(courseId, 'limited', preset.p2)}
                        className={`text-xs font-bold text-blue-700 hover:text-blue-900 transition disabled:opacity-50 ${access.mode === 'limited' && access.lectureLimit === preset.p2 ? 'underline' : ''}`}>
                        +قسط
                      </button>
                      <input type="number" min={1} value={preset.p2}
                        onChange={e => setAccessPresets(prev => ({ ...prev, [courseId]: { ...getPreset(courseId), p2: Number(e.target.value) || 1 } }))}
                        className="w-10 text-xs text-center border border-blue-200 rounded px-1 py-0.5 focus:outline-none bg-white" />
                      <span className="text-[10px] text-blue-500">فيديو</span>
                    </div>
                    <button disabled={saving} onClick={() => applyAccessLevel(courseId, 'full')}
                      className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition disabled:opacity-50 ${access.mode === 'full' ? 'bg-green-600 text-white border-green-600' : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'}`}>
                      فتح كامل
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-500">تحديد يدوي:</span>
                    <input type="number" min={1} value={currentManual}
                      onChange={e => setManualLimitDraft(prev => ({ ...prev, [courseId]: e.target.value }))}
                      className="w-16 text-sm text-center border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-violet-300" />
                    <span className="text-[11px] text-gray-500">فيديو</span>
                    <button disabled={saving} onClick={() => applyAccessLevel(courseId, 'limited', Math.max(1, Number(currentManual) || 1))}
                      className="px-3 py-1 text-xs font-bold bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition disabled:opacity-50">
                      حفظ
                    </button>
                  </div>
                  {saving && <span className="text-[11px] text-gray-400 animate-pulse">جاري الحفظ...</span>}
                  {message?.text && <span className={`text-[11px] font-semibold ${message.ok ? 'text-green-600' : 'text-red-500'}`}>{message.text}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
