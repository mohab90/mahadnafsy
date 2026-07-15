import React from 'react';
import { BarChart3, BookOpen, Eye, Radio, Search, TrendingUp, Users, Video } from 'lucide-react';
import type { Course, CourseLectureItem, SubscriberItem } from '../../../../types';

type AccessStats = {
  full: number;
  preview: number;
  limited: number;
};

interface Props {
  courses: Course[];
  filteredCourses: Course[];
  lecturesCount: number;
  subscribers: SubscriberItem[];
  search: string;
  onSearchChange: (value: string) => void;
  getCourseLectures: (courseId: string) => CourseLectureItem[];
  onEditCourse: (course: Course) => void;
  onOpenLectures: (courseId: string) => void;
  onOpenSubscribers: (courseId: string) => void;
  onShowAccessStats: (course: Course, stats: AccessStats) => void;
  onOpenAnalytics: (courseId: string) => void;
  onDeleteCourse: (courseId: string) => void;
  notifyMissingLiveUrl: () => void;
}

const safeStoredImageSrc = (image: string | undefined) => {
  const value = String(image || '').trim();
  if (!value || /top4top\.io/i.test(value)) return '';
  return value;
};

const countAccessMode = (subscribers: SubscriberItem[], mode: keyof AccessStats) => (
  subscribers
    .flatMap((subscriber) => Object.values(subscriber.courseAccess || {}))
    .filter((entry) => {
      if (entry === 'full') return mode === 'full';
      if (entry === 'preview' || !entry) return mode === 'preview';
      return entry.mode === mode;
    }).length
);

const normalizeAccessMode = (entry?: SubscriberItem['courseAccess'][string]) => {
  if (entry === 'full') return 'full';
  if (entry === 'preview' || !entry) return 'preview';
  return entry.mode || 'preview';
};

export function CourseListPanel({
  courses,
  filteredCourses,
  lecturesCount,
  subscribers,
  search,
  onSearchChange,
  getCourseLectures,
  onEditCourse,
  onOpenLectures,
  onOpenSubscribers,
  onShowAccessStats,
  onOpenAnalytics,
  onDeleteCourse,
  notifyMissingLiveUrl,
}: Props) {
  const courseAccessStatsMap = React.useMemo(() => {
    const map = new Map<string, AccessStats>();
    courses.forEach((course) => {
      map.set(course.id, { full: 0, preview: 0, limited: 0 });
    });
    subscribers.forEach((subscriber) => {
      (subscriber.enrolledCourseIds || []).forEach((courseId) => {
        const stats = map.get(courseId);
        if (!stats) return;
        const mode = normalizeAccessMode(subscriber.courseAccess?.[courseId]);
        if (mode === 'full') stats.full++;
        else if (mode === 'limited') stats.limited++;
        else stats.preview++;
      });
    });
    return map;
  }, [courses, subscribers]);

  const getCourseAccessStats = (courseId: string) => courseAccessStatsMap.get(courseId) ?? { full: 0, preview: 0, limited: 0 };

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
          <p className="text-xs text-gray-500">إجمالي الكورسات</p>
          <p className="text-2xl font-extrabold text-gray-900">{courses.length}</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
          <p className="text-xs text-gray-500">إجمالي المحاضرات</p>
          <p className="text-2xl font-extrabold text-gray-900">{lecturesCount}</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
          <p className="text-xs text-gray-500">مشتركين Full</p>
          <p className="text-2xl font-extrabold text-green-700">{countAccessMode(subscribers, 'full')}</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
          <p className="text-xs text-gray-500">مشتركين Preview</p>
          <p className="text-2xl font-extrabold text-amber-700">{countAccessMode(subscribers, 'preview')}</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
          <p className="text-xs text-gray-500">مشتركين Limited</p>
          <p className="text-2xl font-extrabold text-blue-700">{countAccessMode(subscribers, 'limited')}</p>
        </div>
      </div>

      <div className="mb-4">
        <div className="relative">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="بحث باسم الكورس أو المحاضر أو التصنيف"
            className="w-full border border-gray-300 rounded-xl pr-10 pl-3 py-2.5"
          />
        </div>
      </div>

      <div className="space-y-3 max-h-[560px] overflow-auto">
        {filteredCourses.map((course) => {
          const lectureCount = getCourseLectures(course.id).length;
          const enrolled = subscribers.filter((subscriber) => subscriber.enrolledCourseIds.includes(course.id)).length;
          const accessStats = getCourseAccessStats(course.id);
          const thumbnailSrc = safeStoredImageSrc(course.thumbnail);

          return (
            <div key={course.id} className="border border-gray-200 rounded-2xl p-4 bg-white">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                <div className="flex gap-3">
                  {thumbnailSrc ? (
                    <img src={thumbnailSrc} alt={course.title} className="w-20 h-20 rounded-xl object-cover border border-gray-200" />
                  ) : (
                    <div className="w-20 h-20 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center">
                      <BookOpen size={24} className="text-gray-300" />
                    </div>
                  )}
                  <div>
                    <h4 className="font-extrabold text-gray-900">{course.title}</h4>
                    <p className="text-xs text-gray-500 mt-1">المحاضر: {course.instructor} • {course.category} • {course.type}</p>
                    <p className="text-xs text-gray-500">السعر: {course.price.EGP} EGP | قبل الخصم: {course.originalPrice.EGP} EGP</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs min-w-[240px]">
                  <div className="bg-gray-50 rounded-lg px-2 py-1.5 border border-gray-200">محاضرات: <span className="font-bold">{lectureCount}</span></div>
                  <div className="bg-gray-50 rounded-lg px-2 py-1.5 border border-gray-200">مشتركين: <span className="font-bold">{enrolled}</span></div>
                  <div className="bg-green-50 rounded-lg px-2 py-1.5 border border-green-200 text-green-700">Full: <span className="font-bold">{accessStats.full}</span></div>
                  <div className="bg-amber-50 rounded-lg px-2 py-1.5 border border-amber-200 text-amber-700">Preview: <span className="font-bold">{accessStats.preview}</span></div>
                  <div className="bg-blue-50 rounded-lg px-2 py-1.5 border border-blue-200 text-blue-700 col-span-2">Limited: <span className="font-bold">{accessStats.limited}</span></div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => window.open(`https://mahadnafsy.com/c/${course.slug || course.id}`, '_blank')} className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium"><Eye size={14} className="inline ml-1" />عرض</button>
                <button onClick={() => onEditCourse(course)} className="px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 text-sm font-medium">تعديل</button>
                <button onClick={() => onOpenLectures(course.id)} className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium"><Video size={14} className="inline ml-1" />المحاضرات</button>
                <button onClick={() => onOpenSubscribers(course.id)} className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium"><Users size={14} className="inline ml-1" />العملاء المسجلين ({enrolled})</button>
                <button onClick={() => {
                  if (!course.liveSessionUrl) {
                    notifyMissingLiveUrl();
                    return;
                  }
                  window.open(course.liveSessionUrl, '_blank');
                }} className="px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-sm font-medium"><Radio size={14} className="inline ml-1" />بث مباشر</button>
                <button onClick={() => onShowAccessStats(course, accessStats)} className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-medium"><BarChart3 size={14} className="inline ml-1" />إحصائيات</button>
                <button onClick={() => onOpenAnalytics(course.id)} className="px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 text-sm font-medium"><TrendingUp size={14} className="inline ml-1" />مشاهدات المحاضرات</button>
                <button onClick={() => onDeleteCourse(course.id)} className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm font-medium">حذف</button>
              </div>
            </div>
          );
        })}
        {filteredCourses.length === 0 && <p className="text-sm text-gray-500">لا توجد كورسات مطابقة للبحث الحالي.</p>}
      </div>
    </>
  );
}
