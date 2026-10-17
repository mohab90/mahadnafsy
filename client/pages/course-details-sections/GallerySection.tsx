import React from 'react';
import { cdnImg } from '../../lib/img';
import { useEscapeKey } from '../../../shared/ui/useEscapeKey';

interface GallerySectionProps {
  content: Record<string, string>;
  globalContent: Record<string, string>;
  galleryImages: string[];
  galleryLightboxIdx: number | null;
  setGalleryLightboxIdx: (idx: number | null) => void;
}

export const GallerySection: React.FC<GallerySectionProps> = ({
  content,
  globalContent,
  galleryImages,
  galleryLightboxIdx,
  setGalleryLightboxIdx,
}) => {
  // Escape closes the lightbox. It had no key handling at all.
  useEscapeKey(() => setGalleryLightboxIdx(null), galleryLightboxIdx !== null);

  let galleryImgs: string[] = [];
  try { galleryImgs = JSON.parse(globalContent['institute.gallery.images'] || '[]'); } catch {}

  // The certificate has its own section now (CertificateShowcase), so this is
  // the course's own photos and the institute's — and nothing when there are none.
  if (galleryImages.length === 0 && galleryImgs.length === 0) return null;
  const h2 = 'mb-5 text-[26px] font-black leading-tight text-ink sm:text-[34px]';
  return (
    <>
      {galleryImages.length > 0 && (
      <section>
           <h2 className={h2}>{content['courseDetails.gallery.title'] || 'من داخل البرنامج'}</h2>

           {galleryImages.length > 0 && (
             <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
                {galleryImages.map((img, index) => (
                    <button
                        type="button"
                        key={`${img}-${index}`}
                        className="group aspect-[4/3] overflow-hidden rounded-2xl bg-sand ring-1 ring-line"
                        onClick={() => setGalleryLightboxIdx(index)}
                    >
                        <img loading="lazy" decoding="async" src={cdnImg(img, 400)} width={400} height={300} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" alt="Graduate" />
                    </button>
                ))}
             </div>
           )}

           {/* Gallery Lightbox */}
           {galleryLightboxIdx !== null && (
               <div
                   className="fixed inset-0 z-[90] bg-black/90 flex items-center justify-center p-4"
                   onClick={() => setGalleryLightboxIdx(null)}
               >
                   <button
                       onClick={() => setGalleryLightboxIdx(null)}
                       aria-label="إغلاق"
                       className="absolute left-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/20 text-lg font-bold text-white transition hover:bg-white/40"
                   >
                       ✕
                   </button>
                   {galleryLightboxIdx > 0 && (
                       <button
                           aria-label="السابق"
                           className="absolute left-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-2xl text-white transition hover:bg-white/40"
                           onClick={(e) => { e.stopPropagation(); setGalleryLightboxIdx(galleryLightboxIdx - 1); }}
                       >
                           &#8249;
                       </button>
                   )}
                   <img
                       src={cdnImg(galleryImages[galleryLightboxIdx], 1200)}
                       alt="Gallery"
                       decoding="async"
                       className="max-h-[80vh] max-w-full rounded-2xl object-contain shadow-2xl"
                       onClick={(e) => e.stopPropagation()}
                   />
                   {galleryLightboxIdx < galleryImages.length - 1 && (
                       <button
                           aria-label="التالي"
                           className="absolute right-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-2xl text-white transition hover:bg-white/40"
                           onClick={(e) => { e.stopPropagation(); setGalleryLightboxIdx(galleryLightboxIdx + 1); }}
                       >
                           &#8250;
                       </button>
                   )}
                   <div className="absolute bottom-4 text-sm tabular-nums text-white/70">
                       {galleryLightboxIdx + 1} / {galleryImages.length}
                   </div>
               </div>
           )}

      </section>
      )}

      {/* ── Graduate Gallery ── */}
      {galleryImgs.length > 0 && (
        <section>
          <h2 className={h2}>{content['courseDetails.graduates.title'] || 'معرض صور الخريجين'}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {galleryImgs.slice(0, 8).map((img, i) => (
              <div key={i} className="aspect-square overflow-hidden rounded-2xl bg-sand">
                <img loading="lazy" decoding="async" src={cdnImg(img, 400)} width={400} height={400} alt="خريج" className="h-full w-full object-cover transition duration-500 hover:scale-105" />
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
};
