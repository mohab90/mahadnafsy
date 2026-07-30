import React from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';
import type { Course, CourseChapterItem, CourseLectureItem } from '../../../../types';

interface Props {
  courses: Course[];
  lectures: CourseLectureItem[];
  lectureCourseId: string;
  selectedCourseLectures: CourseLectureItem[];
  expandedLectureCourses: Record<string, boolean>;
  setExpandedLectureCourses: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  expandedLectureChapters: Record<string, boolean>;
  setExpandedLectureChapters: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  getCourseLectures: (courseId: string) => CourseLectureItem[];
  getCourseChapters: (courseId: string) => CourseChapterItem[];
  startEditLecture: (row: CourseLectureItem) => void;
  deleteLecture: (id: string) => Promise<boolean>;
}

export function CourseLectureList({
  courses,
  lectures,
  lectureCourseId,
  selectedCourseLectures,
  expandedLectureCourses,
  setExpandedLectureCourses,
  expandedLectureChapters,
  setExpandedLectureChapters,
  getCourseLectures,
  getCourseChapters,
  startEditLecture,
  deleteLecture,
}: Props) {
  return (
    <>
      {/* ===== Grouped lecture list: Course → Chapter → Lecture ===== */}
      <div className="mt-5 border-t pt-4 space-y-3 max-h-[600px] overflow-auto">
        {(() => {
          // Helper: single lecture row JSX
          const lectureRow = (row: typeof lectures[0]) => (
            <div key={row.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-xl p-3">
              <div>
                <p className="font-bold text-gray-800 text-sm">{row.title}</p>
                <p className="text-xs text-gray-500">{row.lectureType === 'live' ? 'لايف' : 'مسجلة'} • ترتيب {row.order}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEditLecture(row)} className="px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 text-sm">تعديل</button>
                <button onClick={() => void deleteLecture(row.id)} className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm">حذف</button>
              </div>
            </div>
          );

          // Chapter group: header + lecture rows
          const chapterGroup = (chId: string, chTitle: string, chOrder: number, rows: typeof lectures) => (
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
            // Single course selected — group by chapter
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
            // No course selected — accordion: course → chapter → lecture
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
                      {/* Course header — click to toggle */}
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
                      {/* Sections list — visible when course is expanded */}
                      {isCourseOpen && (
                        <div className="p-3 space-y-2 bg-gray-50">
                          {courseChapters.map((ch) => {
                            const chLectures = courseLectures.filter((l) => l.chapterId === ch.id).sort((a, b) => a.order - b.order);
                            if (chLectures.length === 0) return null;
                            const chKey = course.id + '__' + ch.id;
                            const isChOpen = !!expandedLectureChapters[chKey];
                            return (
                              <div key={ch.id} className="rounded-xl overflow-hidden border border-purple-200">
                                {/* Section header — click to toggle */}
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
    </>
  );
}
