import React from 'react';
import { Play } from 'lucide-react';
import { cdnImg, cdnSrcSet } from '../../lib/img';
import { useEscapeKey } from '../../../shared/ui/useEscapeKey';
import { VideoSurface } from '../../components/VideoSurface';

interface PromoVideoSectionProps {
  thumbnail: string;
  promoVideoUrl: string;
  content: Record<string, string>;
  showPromoModal: boolean;
  setShowPromoModal: (show: boolean) => void;
}

export const PromoVideoSection: React.FC<PromoVideoSectionProps> = ({
  thumbnail,
  promoVideoUrl,
  content,
  showPromoModal,
  setShowPromoModal,
}) => {
  // A lightbox is not a dialog and should not be dressed as one — but Escape
  // closes it, which it did not before: you could open the promo video and only
  // get out again with the mouse.
  useEscapeKey(() => setShowPromoModal(false), showPromoModal);

  return (
    <>
      <section
          className="group relative flex aspect-video cursor-pointer items-center justify-center overflow-hidden rounded-[28px] bg-ink shadow-[0_40px_80px_-45px_rgba(26,15,18,.6)]"
          onClick={() => promoVideoUrl && setShowPromoModal(true)}
      >
          {thumbnail && (
            <img
              loading="lazy"
              decoding="async"
              src={cdnImg(thumbnail, 800)}
              srcSet={cdnSrcSet(thumbnail, [400, 640, 800, 1000])}
              sizes="(min-width: 1024px) 800px, 100vw"
              width={800}
              height={450}
              className="absolute inset-0 h-full w-full object-cover opacity-60 transition duration-500 group-hover:opacity-45"
              alt="Video cover"
            />
          )}
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink/90 to-transparent" />
          <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full bg-primary-700 text-white shadow-[0_16px_30px_-12px_rgba(159,18,57,.9)] ring-8 ring-white/15 transition duration-300 group-hover:scale-110 motion-reduce:transform-none sm:h-20 sm:w-20">
              <Play size={30} fill="currentColor" className="ml-1" />
          </div>
          <div className="absolute bottom-4 right-4 left-4 z-10 text-white sm:bottom-6 sm:right-6">
              <h3 className="text-lg font-black sm:text-xl">{content['courseDetails.promo.title'] || 'شاهد مقدمة تعريفية'}</h3>
              <p className="text-sm text-white/70">{content['courseDetails.promo.subtitle'] || 'تعرف على محتويات الدبلومة في دقيقتين'}</p>
          </div>
          {!promoVideoUrl && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                  <span className="rounded-full bg-ink/70 px-3 py-1.5 text-xs font-bold text-white/80">سيتوفر قريباً</span>
              </div>
          )}
      </section>

      {showPromoModal && promoVideoUrl && (
          <div
              className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
              onClick={() => setShowPromoModal(false)}
          >
              <div
                  className="relative w-full max-w-3xl aspect-video"
                  onClick={(e) => e.stopPropagation()}
              >
                  <button
                      onClick={() => setShowPromoModal(false)}
                      className="absolute -top-12 left-0 z-10 min-h-[40px] rounded-full bg-white/20 px-4 text-sm font-bold text-white transition hover:bg-white/40"
                  >
                      ✕ إغلاق
                  </button>
                  <VideoSurface
                      url={promoVideoUrl}
                      title={content['courseDetails.promo.title'] || 'فيديو تعريفي'}
                      autoplay
                      className="rounded-2xl"
                  />
              </div>
          </div>
      )}
    </>
  );
};
