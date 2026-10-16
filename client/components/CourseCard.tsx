import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, Flame, Users } from 'lucide-react';
import { Course, Currency } from '../types';
import { cdnImg, cdnSrcSet } from '../lib/img';
import { discountPercent, formatPrice, isDiscounted } from '../../shared/priceFormat';

interface CourseCardProps {
  course: Course;
  currency: Currency;
  /** «الأكثر طلباً» on the picture. */
  topSeller?: boolean;
  className?: string;
}


/**
 * One programme, the same everywhere on the site: picture, saving, how many
 * took it, its price against the old one, and a button straight to booking.
 */
const CourseCard: React.FC<CourseCardProps> = ({ course, currency, topSeller, className = '' }) => {
  const price = course.price?.[currency] ?? 0;
  const was = course.originalPrice?.[currency] ?? 0;
  const off = price > 0 && isDiscounted(was, price) ? discountPercent(was, price) : 0;
  const students = Math.max(0, Number(course.students) || 0);
  const blurb = (course.shortDescription || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  const href = `/c/${course.slug || course.id}`;

  return (
    <article className={`group flex h-full flex-col overflow-hidden rounded-[24px] border border-line bg-white transition duration-300 hover:-translate-y-1.5 hover:shadow-[0_30px_50px_-25px_rgba(26,15,18,.35)] ${className}`}>
      <Link to={href} className="relative block aspect-[16/10] overflow-hidden bg-sand">
        {course.thumbnail && <img src={cdnImg(course.thumbnail, 640)} srcSet={cdnSrcSet(course.thumbnail, [320, 500, 640, 800])} sizes="(min-width: 1024px) 380px, (min-width: 768px) 46vw, 82vw" alt={course.title} loading="lazy" decoding="async" width={640} height={400} className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />}
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          {topSeller ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-ink/85 px-3 py-1 text-xs font-extrabold text-gold-pale backdrop-blur"><Flame size={13} /> الأكثر طلباً</span>
          ) : <span />}
          {off > 0 && <span className="rounded-full bg-primary-700 px-3 py-1 text-xs font-black text-white">وفّر {off}%</span>}
        </div>
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-bold text-muted">
          {students > 0 && <span className="inline-flex items-center gap-1"><Users size={14} className="text-primary-700" />{students.toLocaleString('ar-EG-u-nu-latn')} متدرب</span>}
          {course.duration && <span className="inline-flex items-center gap-1"><BookOpen size={14} className="text-primary-700" />{course.duration}</span>}
          <span className="rounded-full bg-paper px-2.5 py-0.5 text-[12px] text-muted-strong ring-1 ring-line">{course.type === 'Mix' ? 'مسجل + لايف' : course.type === 'Live' ? 'بث مباشر' : 'مسجل'}</span>
        </div>
        <h3 className="text-[19px] font-black leading-snug text-ink"><Link to={href} className="hover:text-primary-700">{course.title.trim()}</Link></h3>
        {blurb && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">{blurb}</p>}
        <div className="mt-auto flex items-end justify-between gap-3 pt-5">
          {price > 0 ? (
            <div>
              {off > 0 && <s className="block text-sm tabular-nums text-muted-faint">{formatPrice(was, currency)}</s>}
              <span className="whitespace-nowrap text-[22px] font-black leading-none tabular-nums text-ink sm:text-[26px]">{formatPrice(price, currency)}</span>
            </div>
          ) : (
            <span className="text-sm font-bold text-gold-deep">السعر غير متاح في دولتك حاليًا</span>
          )}
          <Link to={`/enroll?course=${encodeURIComponent(course.id)}`} className="inline-flex min-h-[46px] flex-none items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary-700 px-3.5 text-[15px] font-extrabold text-white transition hover:bg-primary-800">
            احجز مكانك
            <ArrowLeft size={17} />
          </Link>
        </div>
      </div>
    </article>
  );
};

export default CourseCard;
