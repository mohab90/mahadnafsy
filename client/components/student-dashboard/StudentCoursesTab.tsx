import { Link } from 'react-router-dom';
import { BookOpen, CheckCircle, Clock, DollarSign, MessageSquare, Play } from 'lucide-react';

// The type is stored in English ('Recorded'); it reached the card as is.
const COURSE_TYPE_AR: Record<string, string> = { Recorded: 'مسجل', Live: 'بث مباشر', Mix: 'مختلط' };

import type { Course, CourseLectureItem, SubscriberItem } from '../../types';
import { toDialable } from '../../lib/whatsappLink';
import { moneySuffix, type CourseBalance, type InstallmentModalState } from '../../lib/itemBalance';

type Props = {
  enrolledCourses: Course[];
  subscriber: SubscriberItem | undefined;
  coursePayMap: Record<string, CourseBalance>;
  contentWhatsapp: string;
  getCourseLectures: (courseId: string) => CourseLectureItem[];
  onOpenPlayer: (courseId: string) => void;
  onOpenCertificates: () => void;
  setInstallModal: (value: InstallmentModalState) => void;
  setInstallAmount: (value: string) => void;
  setInstallIframeUrl: (value: string) => void;
  setInstallError: (value: string) => void;
};

const isFullAccess = (access: NonNullable<SubscriberItem['courseAccess']>[string] | undefined) =>
  !access || access === 'full' || (typeof access === 'object' && access !== null && access.mode === 'full');

export function StudentCoursesTab({
  enrolledCourses,
  subscriber,
  coursePayMap,
  contentWhatsapp,
  getCourseLectures,
  onOpenPlayer,
  onOpenCertificates,
  setInstallModal,
  setInstallAmount,
  setInstallIframeUrl,
  setInstallError,
}: Props) {
  if (enrolledCourses.length === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-gray-100 bg-white p-12 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
          <BookOpen size={28} className="text-amber-500" />
        </div>
        <p className="mb-2 text-lg font-bold text-gray-700">لم يتم تفعيل اشتراكك بعد</p>
        <p className="mb-6 text-sm text-gray-400">تواصل مع الإدارة لتفعيل حسابك وإضافة الكورسات المشترك بها</p>
        <a
          href={`https://wa.me/${toDialable(contentWhatsapp)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-green-500 px-6 py-3 font-bold text-white transition hover:bg-green-600"
        >
          <MessageSquare size={16} /> تواصل مع الإدارة
        </a>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {enrolledCourses.map(course => {
        const access = subscriber?.courseAccess?.[String(course.id)];
        const isFull = isFullAccess(access);
        const courseLectures = getCourseLectures(course.id);
        const totalLectures = courseLectures.length;
        const watchedLectures = totalLectures > 0
          ? Object.entries(subscriber?.lectureProgress || {}).filter(([lid, pct]) =>
              courseLectures.some(lecture => String(lecture.id) === lid) && (pct as number) >= 90,
            ).length
          : 0;
        const progressPct = totalLectures > 0 ? Math.round((watchedLectures / totalLectures) * 100) : 100;
        // The course's balance, or its track's (lib/itemBalance.ts), in its own currency.
        const paymentSummary = coursePayMap[course.id];
        const remaining = paymentSummary && paymentSummary.expected > 0 ? paymentSummary.remaining : null;
        const paidAll = paymentSummary ? paymentSummary.paid + paymentSummary.priorPaid : 0;
        const suffix = moneySuffix(paymentSummary?.currency);

        return (
          <div key={course.id} className="group overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md">
            <div className="relative h-44 overflow-hidden">
              {course.thumbnail
                ? <img src={course.thumbnail} alt={course.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                : <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary-100 to-primary-50 text-primary-400"><BookOpen size={48} /></div>}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              <span className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs font-bold ${isFull ? 'bg-green-500 text-white' : 'bg-yellow-400 text-gray-900'}`}>
                {isFull ? 'وصول كامل' : 'جزئي'}
              </span>
              <p className="absolute bottom-3 left-3 right-3 line-clamp-2 text-sm font-bold leading-tight text-white">{course.title}</p>
            </div>

            <div className="p-4">
              <div className="mb-3 flex items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1"><Clock size={12} /> {course.hours ? `${course.hours} ساعة` : course.duration || COURSE_TYPE_AR[course.type] || course.type}</span>
                <span className="flex items-center gap-1"><CheckCircle size={12} className="text-green-500" /> مشترك</span>
              </div>

              {paymentSummary && (
                <div className="mb-3 space-y-1 rounded-xl border border-gray-100 bg-gray-50 p-2.5 text-xs">
                  {paymentSummary.trackTitle && <p className="font-bold text-primary-700">ضمن مسار «{paymentSummary.trackTitle}»</p>}
                  <div className="flex justify-between">
                    <span className="text-gray-500">مدفوع</span>
                    <span className="font-bold text-green-700">{paidAll.toLocaleString('ar-EG-u-nu-latn')} {suffix}</span>
                  </div>
                  {paymentSummary.expected > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">الإجمالي</span>
                      <span className="font-bold text-gray-700">{paymentSummary.expected.toLocaleString('ar-EG-u-nu-latn')} {suffix}</span>
                    </div>
                  )}
                  {remaining !== null && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">الباقي</span>
                      <span className={`font-bold ${remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {remaining > 0 ? `${remaining.toLocaleString('ar-EG-u-nu-latn')} ${suffix}` : 'مكتمل'}
                      </span>
                    </div>
                  )}
                  {remaining !== null && (
                    <div className="mt-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                        <div className="h-full rounded-full bg-green-500" style={{ width: `${Math.min(100, Math.round((paidAll / paymentSummary.expected) * 100))}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {totalLectures > 0 && (
                <div className="mb-3">
                  <div className="mb-1 flex justify-between text-xs text-gray-500">
                    <span>التقدم</span>
                    <span className="font-bold">{progressPct}% ({watchedLectures}/{totalLectures})</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${progressPct}%` }} />
                  </div>
                </div>
              )}

              {progressPct === 100 && totalLectures > 0 && (
                <div className="mb-3 rounded-xl border border-green-200 bg-green-50 p-3 text-center">
                  <p className="mb-1 text-xs font-bold text-green-700">أتممت الكورس بنجاح</p>
                  <button onClick={onOpenCertificates} className="text-xs font-bold text-green-600 underline hover:text-green-800">
                    استلم شهادتك الآن
                  </button>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => onOpenPlayer(course.id)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary-600 py-2.5 text-sm font-bold text-white transition hover:bg-primary-700"
                >
                  <Play size={14} /> متابعة التعلم
                </button>
                {remaining !== null && remaining > 0 && (
                  <button
                    onClick={() => {
                      setInstallModal({
                        courseId: paymentSummary?.item || course.id, courseTitle: paymentSummary?.trackTitle || course.title,
                        remaining, currency: paymentSummary?.currency || 'EGP',
                      });
                      setInstallAmount(String(remaining));
                      setInstallIframeUrl('');
                      setInstallError('');
                    }}
                    className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-amber-600"
                  >
                    <DollarSign size={13} /> ادفع قسطا
                  </button>
                )}
                <Link
                  to={`/c/${course.slug || course.id}`}
                  className="flex items-center rounded-xl bg-gray-100 px-3 py-2.5 text-sm text-gray-600 transition hover:bg-gray-200"
                  title="تفاصيل الكورس"
                >
                  <BookOpen size={14} />
                </Link>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
