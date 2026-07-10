import React from 'react';
import { Link } from 'react-router-dom';
import type { Course, Currency } from '../../types';

interface RelatedCoursesSidebarProps {
  content: Record<string, string>;
  courses: Course[];
  currentCourseId: string;
  currency: Currency;
  currencySymbol: string;
}

export const RelatedCoursesSidebar: React.FC<RelatedCoursesSidebarProps> = ({ content, courses, currentCourseId, currency, currencySymbol }) => {
  return (
    <div className="hidden lg:block">
        {/* Sidebar place holder for related courses or generic info */}
        <div className="bg-gray-50 p-6 rounded-2xl sticky top-[500px] border border-gray-200">
           <h3 className="font-bold mb-4 text-lg">{content['courseDetails.sidebar.title'] || 'دبلومات قد تهمك'}</h3>
           <div className="space-y-4">
              {courses.filter(c => c.id !== currentCourseId).slice(0, 2).map(c => (
                  <Link key={c.id} to={`/c/${c.slug || c.id}`} className="flex gap-3 group bg-white p-3 rounded-xl shadow-sm hover:shadow-md transition">
                      <img loading="lazy" decoding="async" src={c.thumbnail} className="w-20 h-16 object-cover rounded-lg" alt="" />
                      <div>
                          <h4 className="text-sm font-bold text-gray-800 group-hover:text-primary-600 line-clamp-2 transition">{c.title}</h4>
                          <p className="text-xs text-primary-600 font-bold mt-1">{c.price[currency]} {currencySymbol}</p>
                      </div>
                  </Link>
              ))}
           </div>
        </div>
    </div>
  );
};
