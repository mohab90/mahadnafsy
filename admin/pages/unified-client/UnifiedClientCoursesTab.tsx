import React, { useState } from 'react';
import { BookOpen, Plus, X } from 'lucide-react';

import type { Course, CourseAccessSetting, SubscriberItem } from '../../types';
import { normalizeAccess } from './constants';

type AccessPreset = { p1: number; p2: number };

type UnifiedClientCoursesTabProps = {
  subscriber: SubscriberItem;
  courses: Course[];
  showGrantFromCourses: boolean;
  setShowGrantFromCourses: (value: boolean) => void;
  grantFromCourseId: string;
  setGrantFromCourseId: (value: string) => void;
  updateSubscriber: (subscriber: SubscriberItem) => Promise<boolean>;
  getCourseLectures: (courseId: string) => unknown[];
  canManageCourseAccess: boolean;
  accessSaving: Record<string, boolean>;
  accessMsg: Record<string, { text: string; ok: boolean } | undefined>;
  getPreset: (courseId: string) => AccessPreset;
  setAccessPresets: React.Dispatch<React.SetStateAction<Record<string, AccessPreset>>>;
  manualLimitDraft: Record<string, string>;
  setManualLimitDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  applyAccessLevel: (courseId: string, mode: CourseAccessSetting['mode'], lectureLimit?: number) => void | Promise<void>;
  isAdmin: boolean;
};

export function UnifiedClientCoursesTab({
  subscriber,
  courses,
  showGrantFromCourses,
  setShowGrantFromCourses,
  grantFromCourseId,
  setGrantFromCourseId,
  updateSubscriber,
  getCourseLectures,
  canManageCourseAccess,
  accessSaving,
  accessMsg,
  getPreset,
  setAccessPresets,
  manualLimitDraft,
  setManualLimitDraft,
  applyAccessLevel,
  isAdmin,
}: UnifiedClientCoursesTabProps) {
  const [courseMutationId, setCourseMutationId] = useState<string | null>(null);
  const persistCourses = async (courseIds: string[], mutationId: string) => {
    if (courseMutationId) return false;
    setCourseMutationId(mutationId);
    try {
      return await updateSubscriber({ ...subscriber, enrolledCourseIds: courseIds });
    } finally {
      setCourseMutationId(null);
    }
  };

  return (
    <div id="section-courses" className="space-y-4">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-1 h-5 rounded-full bg-indigo-500 flex-shrink-0" />
                        <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-2 flex-1">
                          <BookOpen size={14} className="text-indigo-500" /> الكورسات
                        </h3>
                        <span className="text-[11px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{subscriber.enrolledCourseIds.length}</span>
                      </div>
                      {/* Add course quick button */}
                      <button onClick={() => setShowGrantFromCourses(true)}
                        className="w-full py-2.5 border-2 border-dashed border-emerald-200 rounded-xl text-emerald-600 hover:bg-emerald-50 text-sm flex items-center justify-center gap-2">
                        <Plus size={16} /> إضافة كورس جديد
                      </button>
                      {showGrantFromCourses && (
                        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => { setShowGrantFromCourses(false); setGrantFromCourseId(''); }}>
                          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5" dir="rtl" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between mb-4">
                              <p className="font-extrabold text-gray-900">+ إضافة كورس</p>
                              <button onClick={() => { setShowGrantFromCourses(false); setGrantFromCourseId(''); }} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500"><X size={16} /></button>
                            </div>
                            <select value={grantFromCourseId} onChange={e => setGrantFromCourseId(e.target.value)}
                              className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm mb-3">
                              <option value="">اختر كورساً...</option>
                              {courses.filter(c => !subscriber.enrolledCourseIds.includes(c.id)).map(c => (
                                <option key={c.id} value={c.id}>{c.title}</option>
                              ))}
                            </select>
                            <div className="flex gap-2">
                              <button
                                disabled={!grantFromCourseId || !!courseMutationId}
                                onClick={async () => {
                                  if (!grantFromCourseId) return;
                                  const saved = await persistCourses([...subscriber.enrolledCourseIds, grantFromCourseId], grantFromCourseId);
                                  if (!saved) return;
                                  setShowGrantFromCourses(false); setGrantFromCourseId('');
                                }}
                                className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-40">
                                ✅ إضافة
                              </button>
                              <button onClick={() => { setShowGrantFromCourses(false); setGrantFromCourseId(''); }}
                                className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm">إلغاء</button>
                            </div>
                          </div>
                        </div>
                      )}

                      {subscriber.enrolledCourseIds.length === 0 ? (
                        <div className="text-center py-10 text-gray-400"><BookOpen size={40} className="mx-auto mb-2 text-gray-200" /><p>لا يوجد كورسات</p></div>
                      ) : subscriber.enrolledCourseIds.map(courseId => {
                        const course = courses.find(c => c.id === courseId);
                        const access = normalizeAccess(subscriber.courseAccess?.[courseId]);
                        const totalLec = getCourseLectures(courseId).length;
                        const watched = Number(subscriber.lectureProgress?.[courseId]) || 0;
                        const pct = totalLec > 0 ? Math.round((watched / totalLec) * 100) : 0;
                        const accessLabel: Record<string, string> = {
                          full: 'وصول كامل',
                          preview: 'لم يُفعَّل (مجاني)',
                          limited: `محدود — ${access.lectureLimit || 1} فيديو${totalLec > 0 ? ` من ${totalLec}` : ''}`,
                        };
                        const saving = accessSaving[courseId] ?? false;
                        const msg = accessMsg[courseId];
                        const preset = getPreset(courseId);
                        const curManual = manualLimitDraft[courseId] ?? String(access.lectureLimit || preset.p1);
                        return (
                          <div key={courseId} className="border border-gray-200 rounded-xl p-4">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <p className="font-bold text-gray-800">{course?.title || courseId}</p>
                              <span className={`px-2 py-0.5 rounded text-[11px] font-semibold flex-shrink-0 ${access.mode === 'full' ? 'bg-green-100 text-green-700' : access.mode === 'preview' ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-700'}`}>{accessLabel[access.mode]}</span>
                            </div>
                            {totalLec > 0 && (
                              <>
                                <div className="w-full bg-gray-100 rounded-full h-2 mt-2 mb-1">
                                  <div className={`h-2 rounded-full ${pct >= 80 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                                </div>
                                <p className="text-xs text-gray-500">{watched} / {totalLec} محاضرة · {pct}%</p>
                              </>
                            )}

                            {/* ── Access Level Buttons (admin or online_manager) ── */}
                            {canManageCourseAccess && (
                            <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                              <p className="text-[11px] text-gray-400 mb-1 font-semibold">تغيير صلاحية الوصول</p>

                              {/* Quick presets row */}
                              <div className="flex flex-wrap gap-2 items-center">
                                {/* Preset 1: مقدم */}
                                <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                                  <button
                                    disabled={saving}
                                    onClick={() => applyAccessLevel(courseId, 'limited', preset.p1)}
                                    className={`text-xs font-bold text-amber-700 hover:text-amber-900 transition disabled:opacity-50 ${access.mode === 'limited' && access.lectureLimit === preset.p1 ? 'underline' : ''}`}
                                  >
                                    مقدم
                                  </button>
                                  <input
                                    type="number" min={1}
                                    value={preset.p1}
                                    onChange={e => setAccessPresets(p => ({ ...p, [courseId]: { ...getPreset(courseId), p1: Number(e.target.value) || 1 } }))}
                                    className="w-10 text-xs text-center border border-amber-200 rounded px-1 py-0.5 focus:outline-none"
                                  />
                                  <span className="text-[10px] text-amber-500">فيديو</span>
                                </div>

                                {/* Preset 2: قسط */}
                                <div className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1">
                                  <button
                                    disabled={saving}
                                    onClick={() => applyAccessLevel(courseId, 'limited', preset.p2)}
                                    className={`text-xs font-bold text-blue-700 hover:text-blue-900 transition disabled:opacity-50 ${access.mode === 'limited' && access.lectureLimit === preset.p2 ? 'underline' : ''}`}
                                  >
                                    +قسط
                                  </button>
                                  <input
                                    type="number" min={1}
                                    value={preset.p2}
                                    onChange={e => setAccessPresets(p => ({ ...p, [courseId]: { ...getPreset(courseId), p2: Number(e.target.value) || 1 } }))}
                                    className="w-10 text-xs text-center border border-blue-200 rounded px-1 py-0.5 focus:outline-none"
                                  />
                                  <span className="text-[10px] text-blue-500">فيديو</span>
                                </div>

                                {/* Full Access */}
                                <button
                                  disabled={saving}
                                  onClick={() => applyAccessLevel(courseId, 'full')}
                                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition disabled:opacity-50 ${access.mode === 'full' ? 'bg-green-600 text-white border-green-600' : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'}`}
                                >
                                  ✅ فتح كامل
                                </button>
                              </div>

                              {/* Manual direct input */}
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-gray-500">تحديد يدوي:</span>
                                <input
                                  type="number" min={1}
                                  value={curManual}
                                  onChange={e => setManualLimitDraft(p => ({ ...p, [courseId]: e.target.value }))}
                                  className="w-16 text-sm text-center border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300"
                                />
                                <span className="text-[11px] text-gray-500">فيديو</span>
                                <button
                                  disabled={saving}
                                  onClick={() => {
                                    const lim = Math.max(1, Number(curManual) || 1);
                                    applyAccessLevel(courseId, 'limited', lim);
                                  }}
                                  className="px-3 py-1 text-xs font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
                                >
                                  حفظ
                                </button>
                              </div>

                              {/* Status / saving indicator */}
                              {saving && <span className="text-[11px] text-gray-400 animate-pulse">جارٍ الحفظ...</span>}
                              {msg?.text && <span className={`text-[11px] font-semibold ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</span>}
                            </div>
                            )}

                            {isAdmin && (
                            <button disabled={courseMutationId === courseId} onClick={() => void persistCourses(subscriber.enrolledCourseIds.filter(id => id !== courseId), courseId)}
                              className="mt-2 text-xs text-red-400 hover:text-red-600 hover:underline disabled:opacity-50">{courseMutationId === courseId ? 'جارٍ الحفظ...' : 'إزالة من الاشتراك'}</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
  );
}
