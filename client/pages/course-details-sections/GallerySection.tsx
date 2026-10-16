import React from 'react';
import { Award, FileText, QrCode, Star } from 'lucide-react';
import { cdnImg } from '../../lib/img';
import { useEscapeKey } from '../../../shared/ui/useEscapeKey';

interface GallerySectionProps {
  content: Record<string, string>;
  globalContent: Record<string, string>;
  galleryImages: string[];
  certificateTemplateUrl: string;
  galleryLightboxIdx: number | null;
  setGalleryLightboxIdx: (idx: number | null) => void;
}

export const GallerySection: React.FC<GallerySectionProps> = ({
  content,
  globalContent,
  galleryImages,
  certificateTemplateUrl,
  galleryLightboxIdx,
  setGalleryLightboxIdx,
}) => {
  // Escape closes the lightbox. It had no key handling at all.
  useEscapeKey(() => setGalleryLightboxIdx(null), galleryLightboxIdx !== null);

  let galleryImgs: string[] = [];
  try { galleryImgs = JSON.parse(globalContent['institute.gallery.images'] || '[]'); } catch {}

  const h2 = 'mb-5 text-2xl font-black leading-tight text-ink sm:text-3xl';
  return (
    <>
      {/* Graduates & Certificates Gallery with Promo Video */}
      <section className="rounded-[28px] border border-line bg-white p-5 sm:p-7">
           <h2 className={h2}>{content['courseDetails.gallery.title'] || 'معرض الخريجين والاعتمادات'}</h2>

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
                   className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
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

           <div className="flex flex-col items-center gap-4 rounded-[24px] bg-ink p-5 text-center text-white sm:flex-row sm:text-right">
              {/* Certificate Decorative Preview */}
              <div className="relative flex h-20 w-28 flex-shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl bg-gradient-to-br from-primary-700 to-[#4c0519] shadow-lg ring-2 ring-gold/60">
                <div className="absolute inset-0 opacity-10" style={{backgroundImage:'repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 50%)',backgroundSize:'10px 10px'}} />
                <Award size={24} className="relative z-10 text-gold-pale" />
                <div className="relative z-10 px-1 text-center">
                  <p className="text-[9px] font-extrabold leading-tight text-white">شهادة</p>
                  <p className="text-[8px] font-bold leading-tight text-gold-pale">معتمدة</p>
                </div>
                <div className="absolute bottom-1 flex gap-0.5 text-gold-pale">
                  {[...Array(5)].map((_,i) => <Star key={i} size={6} fill="currentColor" />)}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-base font-black text-white">{content['courseDetails.gallery.certificateTitle'] || 'شهادة إتمام معتمدة'}</h4>
                <p className="mt-0.5 text-sm text-white/65">{content['courseDetails.gallery.certificateSubtitle'] || 'شهادة موثقة قابلة للتحقق عبر QR Code'}</p>
                <div className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start">
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-white/20">
                    <Award size={11} className="text-gold-light" /> معتمدة من المعهد
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-white/20">
                    <QrCode size={11} className="text-gold-light" /> QR للتحقق
                  </span>
                </div>
              </div>
              <div className="flex-shrink-0">
                {certificateTemplateUrl ? (
                  certificateTemplateUrl.startsWith('data:image') || /\.(jpg|jpeg|png|webp|gif)$/i.test(certificateTemplateUrl) ? (
                    <a href={certificateTemplateUrl} target="_blank" rel="noreferrer" className="block">
                      <img loading="lazy" decoding="async" src={cdnImg(certificateTemplateUrl, 240)} width={96} height={64} alt="نموذج الشهادة" className="h-16 w-24 rounded-xl object-cover shadow-md ring-2 ring-gold/60 transition hover:shadow-lg" />
                    </a>
                  ) : (
                    <a href={certificateTemplateUrl} target="_blank" rel="noreferrer"
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-gold-light px-4 text-sm font-black text-ink transition hover:bg-gold-pale">
                      <FileText size={14} />{content['courseDetails.gallery.previewCta'] || 'معاينة'}
                    </a>
                  )
                ) : (
                  // No template uploaded yet — this used to render as a live-looking
                  // "معاينة" button that silently did nothing when clicked. Say so
                  // instead of offering a click that cannot lead anywhere.
                  <span className="inline-flex min-h-[44px] cursor-default items-center gap-1.5 rounded-xl bg-white/10 px-4 text-xs font-bold text-white/60 ring-1 ring-white/15"
                    title="لم يتم رفع نموذج الشهادة بعد">
                    <FileText size={14} />نموذج الشهادة قريباً
                  </span>
                )}
              </div>
           </div>
      </section>

      {/* ── Graduate Gallery ── */}
      {galleryImgs.length > 0 && (
        <section className="rounded-[28px] border border-line bg-white p-5 sm:p-7">
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
