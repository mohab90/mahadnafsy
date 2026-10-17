import React from 'react';
import { useEscapeKey } from '../../../shared/ui/useEscapeKey';
import { VideoSurface } from '../../components/VideoSurface';

// The promo video's lightbox. Its cover and play button are in the hero
// (CourseHeroSection), beside the title, where the video does the most selling.
interface PromoVideoSectionProps {
  promoVideoUrl: string;
  content: Record<string, string>;
  showPromoModal: boolean;
  setShowPromoModal: (show: boolean) => void;
}

export const PromoVideoSection: React.FC<PromoVideoSectionProps> = ({
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
      {showPromoModal && promoVideoUrl && (
          <div
              className="fixed inset-0 z-[90] bg-black/85 flex items-center justify-center p-4"
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
