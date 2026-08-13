import React from 'react';
import { Award, FileText, Star } from 'lucide-react';

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
  let galleryImgs: string[] = [];
  try { galleryImgs = JSON.parse(globalContent['institute.gallery.images'] || '[]'); } catch {}

  return (
    <>
      {/* Graduates & Certificates Gallery with Promo Video */}
      <section className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm">
           <h2 className="text-2xl font-bold mb-6 text-gray-900 border-r-4 border-primary-600 pr-3">{content['courseDetails.gallery.title'] || 'معرض الخريجين والاعتمادات'}</h2>

           <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {galleryImages.map((img, index) => (
                  <div
                      key={`${img}-${index}`}
                      className="rounded-lg overflow-hidden shadow-sm hover:shadow-md transition cursor-pointer group"
                      onClick={() => setGalleryLightboxIdx(index)}
                  >
                      <img loading="lazy" decoding="async" src={img} className="w-full h-24 object-cover group-hover:scale-110 transition duration-500" alt="Graduate" />
                  </div>
              ))}
           </div>

           {/* Gallery Lightbox */}
           {galleryLightboxIdx !== null && (
               <div
                   className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                   onClick={() => setGalleryLightboxIdx(null)}
               >
                   <button
                       onClick={() => setGalleryLightboxIdx(null)}
                       className="absolute top-4 left-4 text-white text-sm font-bold bg-white/20 px-3 py-1 rounded-full hover:bg-white/40 transition z-10"
                   >
                       ✕
                   </button>
                   {galleryLightboxIdx > 0 && (
                       <button
                           className="absolute left-4 top-1/2 -translate-y-1/2 text-white bg-white/20 rounded-full w-10 h-10 flex items-center justify-center hover:bg-white/40 transition z-10"
                           onClick={(e) => { e.stopPropagation(); setGalleryLightboxIdx(galleryLightboxIdx - 1); }}
                       >
                           &#8249;
                       </button>
                   )}
                   <img
                       src={galleryImages[galleryLightboxIdx]}
                       alt="Gallery"
                       className="max-h-[80vh] max-w-full rounded-xl shadow-2xl object-contain"
                       onClick={(e) => e.stopPropagation()}
                   />
                   {galleryLightboxIdx < galleryImages.length - 1 && (
                       <button
                           className="absolute right-4 top-1/2 -translate-y-1/2 text-white bg-white/20 rounded-full w-10 h-10 flex items-center justify-center hover:bg-white/40 transition z-10"
                           onClick={(e) => { e.stopPropagation(); setGalleryLightboxIdx(galleryLightboxIdx + 1); }}
                       >
                           &#8250;
                       </button>
                   )}
                   <div className="absolute bottom-4 text-white text-sm opacity-70">
                       {galleryLightboxIdx + 1} / {galleryImages.length}
                   </div>
               </div>
           )}

           <div className="flex items-center gap-4 bg-red-50 p-5 rounded-2xl border border-red-200">
              {/* Certificate Decorative Preview */}
              <div className="relative flex-shrink-0 w-28 h-20 bg-gradient-to-br from-red-700 to-red-900 rounded-xl shadow-lg flex flex-col items-center justify-center gap-1 border-2 border-red-300 overflow-hidden">
                <div className="absolute inset-0 opacity-10" style={{backgroundImage:'repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 50%)',backgroundSize:'10px 10px'}} />
                <Award size={24} className="text-yellow-300 relative z-10" />
                <div className="relative z-10 text-center px-1">
                  <p className="text-white font-extrabold text-[9px] leading-tight">شهادة</p>
                  <p className="text-yellow-200 font-bold text-[8px] leading-tight">معتمدة</p>
                </div>
                <div className="absolute bottom-1 flex gap-0.5">
                  {[...Array(5)].map((_,i) => <Star key={i} size={6} className="text-yellow-300 fill-yellow-300" />)}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-extrabold text-red-900 text-base">{content['courseDetails.gallery.certificateTitle'] || 'شهادة إتمام معتمدة'}</h4>
                <p className="text-xs text-red-700 mt-0.5">{content['courseDetails.gallery.certificateSubtitle'] || 'شهادة موثقة قابلة للتحقق عبر QR Code'}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-800 bg-red-100 border border-red-200 rounded-full px-2.5 py-0.5">
                    <Award size={11} /> معتمدة من المعهد
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-800 bg-red-100 border border-red-200 rounded-full px-2.5 py-0.5">
                    📱 QR للتحقق
                  </span>
                </div>
              </div>
              <div className="flex-shrink-0">
                {certificateTemplateUrl ? (
                  certificateTemplateUrl.startsWith('data:image') || /\.(jpg|jpeg|png|webp|gif)$/i.test(certificateTemplateUrl) ? (
                    <a href={certificateTemplateUrl} target="_blank" rel="noreferrer" className="block">
                      <img loading="lazy" decoding="async" src={certificateTemplateUrl} alt="نموذج الشهادة" className="w-24 h-16 object-cover rounded-xl border-2 border-red-300 shadow-md hover:shadow-lg transition" />
                    </a>
                  ) : (
                    <a href={certificateTemplateUrl} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 bg-red-700 hover:bg-red-800 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition shadow">
                      <FileText size={14} />{content['courseDetails.gallery.previewCta'] || 'معاينة'}
                    </a>
                  )
                ) : (
                  // No template uploaded yet — this used to render as a live-looking
                  // "معاينة" button that silently did nothing when clicked. Say so
                  // instead of offering a click that cannot lead anywhere.
                  <span className="flex items-center gap-1.5 bg-gray-100 text-gray-500 border border-gray-200 text-xs font-bold px-4 py-2.5 rounded-xl cursor-default"
                    title="لم يتم رفع نموذج الشهادة بعد">
                    <FileText size={14} />نموذج الشهادة قريباً
                  </span>
                )}
              </div>
           </div>
      </section>

      {/* ── Graduate Gallery ── */}
      {galleryImgs.length > 0 && (
        <section className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm">
          <h2 className="text-2xl font-bold mb-6 text-gray-900 border-r-4 border-primary-600 pr-3">{content['courseDetails.graduates.title'] || 'معرض صور الخريجين'}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {galleryImgs.slice(0, 8).map((img, i) => (
              <div key={i} className="rounded-xl overflow-hidden aspect-square">
                <img loading="lazy" decoding="async" src={img} alt="خريج" className="w-full h-full object-cover hover:scale-105 transition duration-500" />
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
};
