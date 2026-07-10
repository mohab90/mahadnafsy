import React from 'react';
import { Star } from 'lucide-react';

interface CourseRatingSectionProps {
  ratingData: { avg: number; count: number; myRating: { rating: number; comment: string } | null } | null;
  isEnrolled: boolean;
  hoverStar: number;
  setHoverStar: (star: number) => void;
  ratingComment: string;
  setRatingComment: (comment: string) => void;
  ratingSubmitting: boolean;
  ratingNotice: string;
  onSubmitRating: (star: number) => void;
}

export const CourseRatingSection: React.FC<CourseRatingSectionProps> = ({
  ratingData,
  isEnrolled,
  hoverStar,
  setHoverStar,
  ratingComment,
  setRatingComment,
  ratingSubmitting,
  ratingNotice,
  onSubmitRating,
}) => {
  return (
    <section className="mt-10 bg-white border border-gray-100 rounded-2xl p-6 shadow-sm" id="rating-section">
      <h3 className="font-extrabold text-lg text-gray-800 mb-4 flex items-center gap-2">
        <Star size={20} className="text-amber-400 fill-amber-400" /> تقييمات الدورة
      </h3>
      {/* Aggregate */}
      {ratingData && ratingData.count > 0 && (
        <div className="flex items-center gap-4 mb-6 bg-amber-50 rounded-xl p-4">
          <div className="text-center">
            <p className="text-4xl font-extrabold text-amber-500">{ratingData.avg.toFixed(1)}</p>
            <div className="flex gap-0.5 mt-1 justify-center">
              {[1,2,3,4,5].map(s => (
                <Star key={s} size={14} className={s <= Math.round(ratingData.avg) ? 'text-amber-400 fill-amber-400' : 'text-gray-300 fill-gray-200'} />
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">{ratingData.count} تقييم</p>
          </div>
        </div>
      )}
      {/* Rate form for enrolled users */}
      {isEnrolled && (
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-sm font-bold text-gray-700 mb-3">{ratingData?.myRating ? 'تعديل تقييمك' : 'قيّم هذه الدورة'}</p>
          <div className="flex gap-1 mb-3">
            {[1,2,3,4,5].map(s => (
              <button key={s} type="button"
                onMouseEnter={() => setHoverStar(s)}
                onMouseLeave={() => setHoverStar(0)}
                onClick={() => onSubmitRating(s)}
                disabled={ratingSubmitting}
                className="focus:outline-none transition-transform hover:scale-125"
              >
                <Star size={28} className={s <= (hoverStar || ratingData?.myRating?.rating || 0) ? 'text-amber-400 fill-amber-400' : 'text-gray-300 fill-gray-200'} />
              </button>
            ))}
          </div>
          <textarea
            value={ratingComment}
            onChange={e => setRatingComment(e.target.value)}
            placeholder="أضف تعليقاً (اختياري)…"
            rows={2}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary-400 resize-none mb-2"
          />
          {ratingData?.myRating && (
            <button
              type="button"
              disabled={ratingSubmitting}
              onClick={() => onSubmitRating(ratingData.myRating!.rating)}
              className="text-xs bg-primary-600 hover:bg-primary-700 text-white font-bold px-4 py-1.5 rounded-lg transition mb-2 disabled:opacity-50"
            >
              {ratingSubmitting ? '…' : 'حفظ التعليق'}
            </button>
          )}
          {ratingNotice && <p className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2 mb-2">{ratingNotice}</p>}
        </div>
      )}
      {!isEnrolled && (!ratingData || ratingData.count === 0) && (
        <p className="text-sm text-gray-400">لا توجد تقييمات بعد. كن أول من يقيّم هذه الدورة بعد التسجيل!</p>
      )}
    </section>
  );
};
