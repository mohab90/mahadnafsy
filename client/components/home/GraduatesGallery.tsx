import React from 'react';
import { Camera, Expand } from 'lucide-react';
import { Reveal } from './Reveal';

export type GalleryPhoto = { src: string; alt: string };

// Graduation days at the institute — real photos, not stock.
export const GRADUATION_PHOTOS: GalleryPhoto[] = [
  { src: 'celebration.jpg', alt: 'خريجات المعهد يحتفلن بشهاداتهن' },
  { src: 'grad-cert.jpg', alt: 'خريجة تستلم شهاداتها من المعهد' },
  { src: 'women-group.jpg', alt: 'دفعة من خريجات المعهد بلبس التخرج' },
  { src: 'handover.jpg', alt: 'تسليم شهادة لخريجة من المعهد' },
  { src: 'class-selfie.jpg', alt: 'متدربو المعهد في قاعة التدريب يوم التخرج' },
  { src: 'booklets.jpg', alt: 'خريجة مع المحاضرة في حفل التخرج' },
];

const SPAN = ['md:col-span-2 md:row-span-2', '', 'md:col-span-2', '', 'md:col-span-2', 'md:col-span-2'];

/**
 * «من حفلات التخرج» — a wall of the institute's own graduation photos. On a
 * phone it slides sideways; any photo opens full size.
 */
const GraduatesGallery: React.FC<{ graduates: string; onOpen: (index: number) => void }> = ({ graduates, onOpen }) => (
  <section id="graduates" className="scroll-mt-24 overflow-hidden bg-white pb-16 pt-6 sm:pb-24 sm:pt-10">
    <div className="container mx-auto px-4">
      <Reveal className="mb-8 flex flex-col items-center gap-4 text-center sm:mb-10 lg:flex-row lg:items-end lg:justify-between lg:text-right">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-[#a87a1c]"><Camera size={16} /> صور حقيقية من المعهد</span>
          <h2 className="mt-2 text-3xl font-black leading-tight text-[#1a0f12] sm:text-4xl lg:text-[44px]">خريجينا هم أكبر دليل</h2>
          <p className="mt-3 text-base leading-relaxed text-[#6b5b55] sm:text-lg">أكتر من {graduates.replace(/^\+/, '')} خريج استلموا شهاداتهم من المعهد. دي لحظات من أيام تخرجهم، والدور عليك.</p>
        </div>
      </Reveal>

      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:mx-0 md:grid md:grid-flow-dense md:auto-rows-[190px] md:grid-cols-4 md:gap-4 md:overflow-visible md:px-0 lg:auto-rows-[220px]">
        {GRADUATION_PHOTOS.map((photo, i) => (
          <button
            key={photo.src}
            type="button"
            onClick={() => onOpen(i)}
            aria-label={`عرض الصورة: ${photo.alt}`}
            className={`group relative h-[260px] w-[78%] flex-none snap-start overflow-hidden rounded-[24px] bg-[#f4ebe3] sm:w-[48%] md:h-auto md:w-auto ${SPAN[i]}`}
          >
            <img src={`${import.meta.env.BASE_URL}brand/grads/${photo.src}`} alt={photo.alt} loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
            <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
            <span aria-hidden="true" className="absolute bottom-3 left-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-[#1a0f12] opacity-0 transition group-hover:opacity-100"><Expand size={18} /></span>
          </button>
        ))}
      </div>
    </div>
  </section>
);

export default GraduatesGallery;
