import React from 'react';
import { Link } from 'react-router-dom';
import type { Course, Currency } from '../../types';
import { cdnImg } from '../../lib/img';
import { formatPrice } from '../../../shared/priceFormat';

interface RelatedCoursesSidebarProps {
  content: Record<string, string>;
  courses: Course[];
  currentCourseId: string;
  currency: Currency;
  currencySymbol: string;
}

export const RelatedCoursesSidebar: React.FC<RelatedCoursesSidebarProps> = ({ content, courses, currentCourseId, currency }) => {
  // formatPrice already writes the symbol, so currencySymbol is not printed a
  // second time (it read «7,900 ج.م ج.م»).
  return (
    <div className="hidden lg:block">
        {/* Sidebar place holder for related courses or generic info */}
        <div className="sticky top-24 rounded-[28px] border border-line bg-paper p-5">
           <h3 className="mb-4 text-lg font-black text-ink">{content['courseDetails.sidebar.title'] || 'دبلومات قد تهمك'}</h3>
           <div className="space-y-3">
              {courses.filter(c => c.id !== currentCourseId).slice(0, 2).map(c => (
                  <Link key={c.id} to={`/c/${c.slug || c.id}`} className="group flex gap-3 rounded-2xl bg-white p-3 ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-25px_rgba(26,15,18,.35)]">
                      <span className="h-16 w-20 flex-none overflow-hidden rounded-xl bg-sand">
                        <img loading="lazy" decoding="async" src={cdnImg(c.thumbnail, 160)} width={80} height={64} className="h-full w-full object-cover" alt="" />
                      </span>
                      <div className="min-w-0">
                          <h4 className="line-clamp-2 text-sm font-extrabold leading-snug text-ink transition group-hover:text-primary-700">{c.title}</h4>
                          <p className="mt-1 text-sm font-black tabular-nums text-ink">{formatPrice(c.price[currency], currency)}</p>
                      </div>
                  </Link>
              ))}
           </div>
        </div>
    </div>
  );
};
