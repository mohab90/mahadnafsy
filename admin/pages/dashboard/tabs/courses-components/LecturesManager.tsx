// @ts-nocheck
import React from 'react';
import { Plus, BookOpen, ChevronDown, Radio } from 'lucide-react';
import type { Course, CourseLectureItem, CourseChapterItem } from '../../../../types';

export type LectureDraft = { title: string; lectureType: 'recorded' | 'live'; videoUrl: string; duration: string; order: number; thumbnail: string; chapterId: string };
export type ChapterDraft = { title: string; order: number };
type D<T> = React.Dispatch<React.SetStateAction<T>>;
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Props {
  isAdmin: boolean;
  lectures: CourseLectureItem[];
  chapters: CourseChapterItem[];
  courses: Course[];
  lectureCourseId: string; setLectureCourseId: (v: string) => void;
  isLectureFormOpen: boolean; setIsLectureFormOpen: (v: boolean) => void;
  editingLectureId: string; setEditingLectureId: (v: string) => void;
  lectureDraft: LectureDraft; setLectureDraft: (v: LectureDraft) => void;
  isChapterFormOpen: boolean; setIsChapterFormOpen: (v: boolean) => void;
  setEditingChapterId: (v: string) => void;
  chapterDraft: ChapterDraft; setChapterDraft: (v: ChapterDraft) => void;
  selectedCourseLectures: CourseLectureItem[];
  expandedLectureCourses: Record<string, boolean>; setExpandedLectureCourses: D<Record<string, boolean>>;
  expandedLectureChapters: Record<string, boolean>; setExpandedLectureChapters: D<Record<string, boolean>>;
  getCourseChapters: (courseId: string) => CourseChapterItem[];
  getCourseLectures: (courseId: string) => CourseLectureItem[];
  saveLecture: () => void;
  startEditLecture: (row: CourseLectureItem) => void;
  deleteLecture: (id: string) => void;
  saveChapter: () => void;
  deleteChapter: (id: string) => void;
  updateCourse: (c: Course) => void;
  notify: NotifyFn;
}

/** المحاضرات + الفصول manager — extracted from CoursesTab. */
export default function LecturesManager(p: Props) {
  const {
    isAdmin, lectures, chapters, courses, lectureCourseId, setLectureCourseId,
    isLectureFormOpen, setIsLectureFormOpen, editingLectureId, setEditingLectureId,
    lectureDraft, setLectureDraft, isChapterFormOpen, setIsChapterFormOpen, setEditingChapterId,
    chapterDraft, setChapterDraft, selectedCourseLectures, expandedLectureCourses, setExpandedLectureCourses,
    expandedLectureChapters, setExpandedLectureChapters, getCourseChapters, getCourseLectures,
    saveLecture, startEditLecture, deleteLecture, saveChapter, deleteChapter, updateCourse, notify,
  } = p;
  return (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="font-bold text-gray-900">محاضرات الكورسات وإضافة محاضرة داخل الكورس</h3>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => {
                const now = new Date();
                const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
                const backup = { _meta: { createdAt: now.toISOString(), type: 'lectures' }, lectures, chapters };
                const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `backup_lectures_${stamp}.json`; a.click();
                URL.revokeObjectURL(url);
              }}
              className="bg-green-50 text-green-700 border border-green-200 px-3 py-2 rounded-xl text-sm font-bold hover:bg-green-100 transition flex items-center gap-1"
            >
              💾 نسخة احتياطية
            </button>
          )}
          <button
            onClick={() => {
              if (isLectureFormOpen && !editingLectureId) { setIsLectureFormOpen(false); return; }
              setEditingLectureId('');
              setLectureDraft({ title: '', lectureType: 'recorded', videoUrl: '', duration: '', order: 1, thumbnail: '', chapterId: '' });
              setIsLectureFormOpen(true);
            }}
            className="bg-primary-600 hover:bg-primary-700 text-white rounded-xl px-4 py-2.5 font-bold text-sm"
          >
            <Plus size={16} className="inline ml-1" />
            {isLectureFormOpen ? 'إغلاق نموذج المحاضرة' : 'إضافة محاضرة'}
          </button>
        </div>
      </div>

      {isLectureFormOpen && (
        <div className="border border-gray-200 rounded-2xl p-4 mb-4 bg-gray-50/70 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select className="border border-gray-300 rounded-xl px-4 py-2.5" value={lectureCourseId} onChange={(e) => setLectureCourseId(e.target.value)}>
              <option value="">اختر الكورس</option>
              {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
            </select>
            <select className="border border-gray-300 rounded-xl px-4 py-2.5" value={lectureDraft.chapterId} onChange={(e) => setLectureDraft({ ...lectureDraft, chapterId: e.target.value })}>
              <option value="">بدون فصل (غير مصنف)</option>
              {lectureCourseId && getCourseChapters(lectureCourseId).map((ch) => <option key={ch.id} value={ch.id}>{ch.order}. {ch.title}</option>)}
            </select>
            <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="عنوان المحاضرة" value={lectureDraft.title} onChange={(e) => setLectureDraft({ ...lectureDraft, title: e.target.value })} />
            <select className="border border-gray-300 rounded-xl px-4 py-2.5" value={lectureDraft.lectureType} onChange={(e) => setLectureDraft({ ...lectureDraft, lectureType: e.target.value as 'recorded' | 'live' })}>
              <option value="recorded">مسجلة</option>
              <option value="live">لايف</option>
            </select>
            <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="المدة" value={lectureDraft.duration} onChange={(e) => setLectureDraft({ ...lectureDraft, duration: e.target.value })} />
            <input className="md:col-span-2 border border-gray-300 rounded-xl px-4 py-2.5" placeholder="رابط الفيديو / Zoom" value={lectureDraft.videoUrl} onChange={(e) => setLectureDraft({ ...lectureDraft, videoUrl: e.target.value })} />
            <input type="number" className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="الترتيب" value={lectureDraft.order} onChange={(e) => setLectureDraft({ ...lectureDraft, order: Number(e.target.value) })} />
            <input className="md:col-span-2 border border-gray-300 rounded-xl px-4 py-2.5" placeholder="رابط صورة غلاف المحاضرة (اختياري)" value={lectureDraft.thumbnail} onChange={(e) => setLectureDraft({ ...lectureDraft, thumbnail: e.target.value })} />
          </div>
          <button onClick={saveLecture} className="bg-primary-600 hover:bg-primary-700 text-white font-bold px-5 py-2.5 rounded-xl transition">{editingLectureId ? 'تحديث المحاضرة' : 'إضافة محاضرة'}</button>
        </div>
      )}

      {/* Chapter management panel */}
      {lectureCourseId && (
        <div className="border border-purple-200 bg-purple-50 rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-bold text-purple-800 text-sm">فصول الكورس (Chapters)</p>
            <button type="button" onClick={() => { setEditingChapterId(''); setChapterDraft({ title: '', order: (getCourseChapters(lectureCourseId).length + 1) }); setIsChapterFormOpen(true); }} className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-bold">+ فصل جديد</button>
          </div>
          {isChapterFormOpen && (
            <div className="flex flex-wrap gap-2 items-center mb-3 bg-white border border-purple-200 rounded-xl p-3">
              <input className="flex-1 min-w-[180px] border border-purple-200 rounded-lg px-3 py-2 text-sm" placeholder="عنوان الفصل" value={chapterDraft.title} onChange={(e) => setChapterDraft({ ...chapterDraft, title: e.target.value })} />
              <input type="number" className="w-20 border border-purple-200 rounded-lg px-3 py-2 text-sm" placeholder="الترتيب" value={chapterDraft.order} onChange={(e) => setChapterDraft({ ...chapterDraft, order: Number(e.target.value) })} />
              <button type="button" onClick={saveChapter} className="px-3 py-2 rounded-lg bg-purple-600 text-white text-sm font-bold">حفظ</button>
              <button type="button" onClick={() => { setIsChapterFormOpen(false); setEditingChapterId(''); setChapterDraft({ title: '', order: 1 }); }} className="px-3 py-2 rounded-lg bg-gray-200 text-gray-700 text-sm font-bold">إلغاء</button>
            </div>
          )}
          {getCourseChapters(lectureCourseId).length === 0 && !isChapterFormOpen && <p className="text-xs text-purple-400">لا توجد فصول لهذا الكورس. أضف فصلاً لتنظيم المحاضرات.</p>}
          <div className="space-y-2">
            {getCourseChapters(lectureCourseId).map((ch) => (
              <div key={ch.id} className="flex items-center justify-between bg-white border border-purple-200 rounded-xl px-3 py-2">
                <p className="text-sm text-gray-800 font-medium">{ch.order}. {ch.title}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setEditingChapterId(ch.id); setChapterDraft({ title: ch.title, order: ch.order }); setIsChapterFormOpen(true); }} className="text-xs px-2 py-1 rounded-lg bg-purple-50 text-purple-700 font-bold">تعديل</button>
                  <button type="button" onClick={() => { deleteChapter(ch.id); notify('success', 'تم حذف الفصل.'); }} className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-700 font-bold">حذف</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* ===== Grouped lecture list: Course → Chapter → Lecture ===== */}
      <div className="mt-5 border-t pt-4 space-y-3 max-h-[600px] overflow-auto">
        {(() => {
          const lectureRow = (row: CourseLectureItem) => (
            <div key={row.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-xl p-3">
              <div>
                <p className="font-bold text-gray-800 text-sm">{row.title}</p>
                <p className="text-xs text-gray-500">{row.lectureType === 'live' ? 'لايف' : 'مسجلة'} • ترتيب {row.order}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEditLecture(row)} className="px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 text-sm">تعديل</button>
                <button onClick={() => deleteLecture(row.id)} className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm">حذف</button>
              </div>
            </div>
          );

          const chapterGroup = (chId: string, chTitle: string, chOrder: number, rows: CourseLectureItem[]) => (
            <div key={chId} className="mb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-lg mb-1.5">
                <span className="w-5 h-5 bg-purple-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">{chOrder || '—'}</span>
                {chTitle}
                <span className="mr-auto text-purple-400 font-normal">({rows.length} محاضرة)</span>
              </div>
              <div className="space-y-1 pr-3">
                {rows.map(lectureRow)}
              </div>
            </div>
          );

          if (lectureCourseId) {
            const courseChapters = getCourseChapters(lectureCourseId).sort((a, b) => a.order - b.order);
            const uncategorized = selectedCourseLectures.filter((l) => !l.chapterId || !courseChapters.some((ch) => ch.id === l.chapterId)).sort((a, b) => a.order - b.order);
            if (selectedCourseLectures.length === 0) return <p className="text-sm text-gray-500 text-center py-6">لا توجد محاضرات لهذا الكورس. أضف محاضرة من الأعلى.</p>;
            return (
              <>
                {courseChapters.map((ch) => {
                  const chLectures = selectedCourseLectures.filter((l) => l.chapterId === ch.id).sort((a, b) => a.order - b.order);
                  if (chLectures.length === 0) return null;
                  return chapterGroup(ch.id, ch.title, ch.order, chLectures);
                })}
                {uncategorized.length > 0 && chapterGroup('__uncat__', 'غير مصنفة', 0, uncategorized)}
              </>
            );
          } else {
            const coursesWithLectures = courses.filter((c) => getCourseLectures(c.id).length > 0);
            if (coursesWithLectures.length === 0) return <p className="text-sm text-gray-500 text-center py-6">لا توجد محاضرات. اختر كورساً وأضف محاضرات.</p>;
            return (
              <>
                {coursesWithLectures.map((course) => {
                  const courseLectures = getCourseLectures(course.id);
                  const isCourseOpen = !!expandedLectureCourses[course.id];
                  const courseChapters = getCourseChapters(course.id).sort((a, b) => a.order - b.order);
                  const uncategorized = courseLectures.filter((l) => !l.chapterId || !courseChapters.some((ch) => ch.id === l.chapterId)).sort((a, b) => a.order - b.order);
                  return (
                    <div key={course.id} className="border border-indigo-200 rounded-2xl overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setExpandedLectureCourses((prev) => ({ ...prev, [course.id]: !prev[course.id] }))}
                        className="w-full flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 font-bold text-sm transition"
                      >
                        <BookOpen size={14} />
                        <span className="flex-1 text-right truncate">{course.title}</span>
                        <span className="bg-indigo-500 text-white text-xs font-normal px-2 py-0.5 rounded-full whitespace-nowrap">{courseLectures.length} محاضرة</span>
                        <ChevronDown size={14} className={`transition-transform duration-200 shrink-0 ${isCourseOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {isCourseOpen && (
                        <div className="p-3 space-y-2 bg-gray-50">
                          {courseChapters.map((ch) => {
                            const chLectures = courseLectures.filter((l) => l.chapterId === ch.id).sort((a, b) => a.order - b.order);
                            if (chLectures.length === 0) return null;
                            const chKey = course.id + '__' + ch.id;
                            const isChOpen = !!expandedLectureChapters[chKey];
                            return (
                              <div key={ch.id} className="rounded-xl overflow-hidden border border-purple-200">
                                <button
                                  type="button"
                                  onClick={() => setExpandedLectureChapters((prev) => ({ ...prev, [chKey]: !prev[chKey] }))}
                                  className="w-full flex items-center gap-2 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 transition"
                                >
                                  <span className="w-5 h-5 bg-purple-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">{ch.order || '—'}</span>
                                  <span className="flex-1 text-right">{ch.title}</span>
                                  <span className="text-purple-400 font-normal whitespace-nowrap">({chLectures.length} محاضرة)</span>
                                  <ChevronDown size={12} className={`transition-transform duration-200 shrink-0 ${isChOpen ? 'rotate-180' : ''}`} />
                                </button>
                                {isChOpen && (
                                  <div className="space-y-1 p-2 bg-white">
                                    {chLectures.map(lectureRow)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {uncategorized.length > 0 && (() => {
                            const chKey = course.id + '__uncat__';
                            const isChOpen = !!expandedLectureChapters[chKey];
                            return (
                              <div className="rounded-xl overflow-hidden border border-gray-200">
                                <button
                                  type="button"
                                  onClick={() => setExpandedLectureChapters((prev) => ({ ...prev, [chKey]: !prev[chKey] }))}
                                  className="w-full flex items-center gap-2 text-xs font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 transition"
                                >
                                  <span className="flex-1 text-right">غير مصنفة</span>
                                  <span className="text-gray-400 font-normal whitespace-nowrap">({uncategorized.length} محاضرة)</span>
                                  <ChevronDown size={12} className={`transition-transform duration-200 shrink-0 ${isChOpen ? 'rotate-180' : ''}`} />
                                </button>
                                {isChOpen && (
                                  <div className="space-y-1 p-2 bg-white">
                                    {uncategorized.map(lectureRow)}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            );
          }
        })()}
      </div>
      {lectureCourseId && (
        <div className="mt-4 border border-rose-200 bg-rose-50 rounded-xl p-4">
          <h4 className="font-bold text-rose-800 mb-2">البث المباشر للمشتركين</h4>
          <p className="text-xs text-rose-700 mb-3">يمكنك استخدام رابط اللايف المحفوظ في الكورس لبث مباشر للعملاء المشتركين فقط.</p>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              className="flex-1 min-w-[220px] border border-rose-200 rounded-lg px-3 py-2 text-sm"
              placeholder="رابط اللايف"
              value={courses.find((c) => c.id === lectureCourseId)?.liveSessionUrl || ''}
              onChange={(e) => {
                const targetCourse = courses.find((c) => c.id === lectureCourseId);
                if (!targetCourse) return;
                updateCourse({ ...targetCourse, liveSessionUrl: e.target.value });
              }}
            />
            <button
              onClick={() => {
                const url = courses.find((c) => c.id === lectureCourseId)?.liveSessionUrl;
                if (!url) { notify('error', 'لا يوجد رابط لايف محفوظ لهذا الكورس.'); return; }
                window.open(url, '_blank');
              }}
              className="px-3 py-2 rounded-lg bg-rose-600 text-white text-sm font-bold"
            >
              <Radio size={14} className="inline ml-1" />بدء لايف الآن
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

