import React from 'react';
import { Play } from 'lucide-react';

interface PromoVideoSectionProps {
  thumbnail: string;
  promoVideoUrl: string;
  content: Record<string, string>;
  showPromoModal: boolean;
  setShowPromoModal: (show: boolean) => void;
  getEmbedUrl: (url: string) => string;
}

export const PromoVideoSection: React.FC<PromoVideoSectionProps> = ({
  thumbnail,
  promoVideoUrl,
  content,
  showPromoModal,
  setShowPromoModal,
  getEmbedUrl,
}) => {
  return (
    <>
      <section
          className="rounded-2xl overflow-hidden shadow-lg border border-gray-100 relative bg-black group cursor-pointer aspect-video flex items-center justify-center"
          onClick={() => promoVideoUrl && setShowPromoModal(true)}
      >
          {thumbnail && <img loading="lazy" decoding="async" src={thumbnail} className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-40 transition duration-500" alt="Video cover" />}
          <div className="relative z-10 w-20 h-20 bg-primary-600/90 rounded-full flex items-center justify-center text-white shadow-xl group-hover:scale-110 transition duration-300">
              <Play size={32} fill="currentColor" className="ml-1" />
          </div>
          <div className="absolute bottom-6 right-6 text-white z-10">
              <h3 className="font-bold text-xl">{content['courseDetails.promo.title'] || 'شاهد مقدمة تعريفية'}</h3>
              <p className="text-sm text-gray-200">{content['courseDetails.promo.subtitle'] || 'تعرف على محتويات الدبلومة في دقيقتين'}</p>
          </div>
          {!promoVideoUrl && (
              <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                  <span className="bg-black/50 text-white/70 text-xs px-3 py-1.5 rounded-full">سيتوفر قريباً</span>
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
                      className="absolute -top-10 left-0 text-white text-sm font-bold bg-white/20 px-3 py-1 rounded-full hover:bg-white/40 transition z-10"
                  >
                      ✕ إغلاق
                  </button>
                  <iframe
                      src={getEmbedUrl(promoVideoUrl) + '&autoplay=1'}
                      className="w-full h-full rounded-xl"
                      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                      allowFullScreen
                      referrerPolicy="strict-origin-when-cross-origin"
                      title="Promo Video"
                  />
              </div>
          </div>
      )}
    </>
  );
};
