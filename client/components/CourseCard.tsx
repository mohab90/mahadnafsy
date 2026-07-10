import React from 'react';
import { Link } from 'react-router-dom';
import { Clock, Star, Users } from 'lucide-react';
import { Course, Currency } from '../types';
import { cdnImg } from '../lib/img';

interface CourseCardProps {
  course: Course;
  currency: Currency;
}

const CourseCard: React.FC<CourseCardProps> = ({ course, currency }) => {
  const currentPrice = course.price?.[currency] ?? 0;
  const oldPrice = course.originalPrice?.[currency] ?? 0;
  const currencySymbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';

  // Use real student count from the database
  const displayStudents = Math.max(0, Number(course.students) || 0);

  // Use real rating from the database
  const displayRating = course.rating || 0;

  // Strip HTML tags from short description safely
  const plainDescription = (course.shortDescription || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

  return (
    <div className="glass-card hover:-translate-y-2 hover:shadow-2xl transition-all duration-300 border border-gray-100/60 flex flex-col h-full group">
      <div className="relative overflow-hidden rounded-t-2xl">
        {course?.thumbnail && <img loading="lazy" decoding="async" src={cdnImg(course.thumbnail, 500)} alt={course.title} className="w-full h-48 object-cover transform group-hover:scale-105 transition-transform duration-500" />}
        <span className="absolute top-3 right-3 bg-white/90 backdrop-blur-md text-gray-800 px-3 py-1 text-xs font-bold rounded-lg shadow-sm">
          {course.type === 'Mix' ? 'مختلط (مسجل+لايف)' : course.type === 'Live' ? 'بث مباشر' : 'مسجل'}
        </span>
      </div>
      
      <div className="p-5 flex-grow flex flex-col">
        <div className="flex items-center gap-2 mb-2 text-xs text-primary-600 font-semibold">
           <span className="bg-primary-50 px-2 py-1 rounded">{course.category === 'Therapy' ? 'علاج نفسي' : 'عام'}</span>
           <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded">{course.level}</span>
        </div>

        <Link to={`/c/${course.slug || course.id}`} className="block mb-2">
          <h3 className="text-lg font-bold text-gray-900 line-clamp-2 hover:text-primary-600 transition">
            {course.title}
          </h3>
        </Link>
        
        <p className="text-gray-500 text-sm line-clamp-2 mb-4 flex-grow">
          {plainDescription}
        </p>

        <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
          <div className="flex items-center gap-1">
            <Users size={14} />
            <span>{displayStudents} طالب</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock size={14} />
            <span>{course.duration}</span>
          </div>
          <div className="flex items-center gap-1 text-yellow-500 font-bold">
            <Star size={14} fill="currentColor" />
            <span>{displayRating}</span>
          </div>
        </div>

        <div className="mt-auto border-t pt-4 flex justify-between items-center">
          <div className="flex flex-col">
            <span className="text-xs text-gray-400 line-through">{oldPrice} {currencySymbol}</span>
            <span className="text-lg font-bold text-primary-700">{currentPrice} {currencySymbol}</span>
          </div>
          <Link to={`/c/${course.slug || course.id}`} className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
            التفاصيل
          </Link>
        </div>
      </div>
    </div>
  );
};

export default CourseCard;