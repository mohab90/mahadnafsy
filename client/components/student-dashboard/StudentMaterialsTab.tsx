import { Download, FileText } from 'lucide-react';

import type { Course, CourseMaterial, SubscriberItem } from '../../types';
import { cdnImg } from '../../lib/img';

type MaterialWithCourse = CourseMaterial & {
  courseName: string;
  courseId: string;
};

const hasFullAccess = (subscriber: SubscriberItem, courseId: string) => {
  const access = subscriber.courseAccess?.[courseId];
  return !access || access === 'full' || (typeof access === 'object' && access.mode === 'full');
};

export function StudentMaterialsTab({ subscriber, enrolledCourses }: { subscriber: SubscriberItem | undefined; enrolledCourses: Course[] }) {
  if (!subscriber) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-gray-100 bg-white p-12 text-center shadow-sm">
        <FileText size={36} className="mx-auto mb-3 text-gray-200" />
        <p className="text-gray-400">اشترك في كورس للوصول إلى المادة العلمية</p>
      </div>
    );
  }

  const allMaterials: MaterialWithCourse[] = [];
  enrolledCourses.forEach(course => {
    if (!course.materials || course.materials.length === 0) return;
    const fullAccess = hasFullAccess(subscriber, course.id);
    course.materials.forEach(material => {
      if (material.accessLevel === 'partial' || (material.accessLevel === 'full' && fullAccess)) {
        allMaterials.push({ ...material, courseName: course.title, courseId: course.id });
      }
    });
  });

  if (allMaterials.length === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-gray-100 bg-white p-12 text-center shadow-sm">
        <FileText size={36} className="mx-auto mb-3 text-gray-200" />
        <p className="mb-1 font-bold text-gray-500">لا توجد مادة علمية متاحة حاليا</p>
        <p className="text-xs text-gray-400">ستظهر هنا الملفات والمواد العلمية عند إضافتها من قبل الفريق</p>
      </div>
    );
  }

  const grouped = enrolledCourses
    .map(course => ({ course, materials: allMaterials.filter(material => material.courseId === course.id) }))
    .filter(group => group.materials.length > 0);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-700">
        <FileText size={16} />
        <span>المواد والملفات العلمية المتاحة لك بناء على اشتراكك: {allMaterials.length} ملف</span>
      </div>

      {grouped.map(({ course, materials }) => (
        <div key={course.id} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50 px-5 py-3">
            {course.thumbnail && <img src={cdnImg(course.thumbnail, 120)} alt="" loading="lazy" decoding="async" className="h-8 w-8 rounded-lg object-cover" />}
            <p className="text-sm font-bold text-gray-800">{course.title}</p>
          </div>
          <div className="divide-y divide-gray-50">
            {materials.map(material => (
              <div key={material.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-red-50">
                  <FileText size={18} className="text-red-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-800">{material.title}</p>
                  <p className="mt-0.5 text-[10px] text-gray-400">PDF</p>
                </div>
                <a
                  href={material.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  className="flex flex-shrink-0 items-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-primary-700"
                >
                  <Download size={13} /> تحميل
                </a>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
