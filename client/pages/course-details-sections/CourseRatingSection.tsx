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
    <section className="rounded-[28px] border border-line bg-white p-5 sm:p-7" id="rating-section">
      <h3 className="mb-4 flex items-center gap-2 text-xl font-black text-ink">
        <Star size={20} className="text-gold" fill="currentColor" /> تقييمات الدورة
      </h3>
      {/* Aggregate */}
      {ratingData && ratingData.count > 0 && (
        <div className="mb-6 flex items-center gap-4 rounded-[22px] bg-paper p-4 ring-1 ring-line">
          <div className="text-center">
            <p className="text-4xl font-black tabular-nums text-ink">{ratingData.avg.toFixed(1)}</p>
            <div className="mt-1 flex justify-center gap-0.5">
              {[1,2,3,4,5].map(s => (
                <Star key={s} size={14} className={s <= Math.round(ratingData.avg) ? 'text-gold' : 'text-line-deep'} fill="currentColor" />
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">{ratingData.count} تقييم</p>
          </div>
        </div>
      )}
      {/* Rate form for enrolled users */}
      {isEnrolled && (
        <div className="rounded-[22px] bg-paper p-4 ring-1 ring-line">
          <p className="mb-3 text-sm font-extrabold text-ink">{ratingData?.myRating ? 'تعديل تقييمك' : 'قيّم هذه الدورة'}</p>
          <div className="mb-3 flex gap-1">
            {[1,2,3,4,5].map(s => (
              <button key={s} type="button"
                onMouseEnter={() => setHoverStar(s)}
                onMouseLeave={() => setHoverStar(0)}
                onClick={() => onSubmitRating(s)}
                disabled={ratingSubmitting}
                aria-label={`${s} من 5`}
                className="flex h-11 w-11 items-center justify-center rounded-xl transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 motion-safe:hover:scale-110"
              >
                <Star size={28} className={s <= (hoverStar || ratingData?.myRating?.rating || 0) ? 'text-gold' : 'text-line-deep'} fill="currentColor" />
              </button>
            ))}
          </div>
          <textarea
            value={ratingComment}
            onChange={e => setRatingComment(e.target.value)}
            placeholder="أضف تعليقاً (اختياري)…"
            rows={2}
            className="mb-2 w-full resize-none rounded-xl border border-line-strong bg-white px-4 py-3 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:ring-4 focus:ring-primary-600/10"
          />
          {ratingData?.myRating && (
            <button
              type="button"
              disabled={ratingSubmitting}
              onClick={() => onSubmitRating(ratingData.myRating!.rating)}
              className="mb-2 inline-flex min-h-[44px] items-center rounded-xl bg-primary-700 px-5 text-sm font-black text-white transition hover:bg-primary-800 disabled:opacity-50"
            >
              {ratingSubmitting ? '…' : 'حفظ التعليق'}
            </button>
          )}
          {ratingNotice && <p className="mb-2 rounded-xl bg-green-50 px-3 py-2 text-sm font-bold text-green-700">{ratingNotice}</p>}
        </div>
      )}
      {!isEnrolled && (!ratingData || ratingData.count === 0) && (
        <p className="text-sm text-muted">لا توجد تقييمات بعد. كن أول من يقيّم هذه الدورة بعد التسجيل!</p>
      )}
    </section>
  );
};
