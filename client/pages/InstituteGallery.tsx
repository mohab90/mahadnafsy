import React, { useMemo, useEffect } from 'react';
import { useSiteData } from '../context/SiteDataContext';
import { useSeo } from '../lib/useSeo';
import { cdnImg, cdnSrcSet } from '../lib/img';
import PageHeader from '../components/PageHeader';

const InstituteGallery: React.FC = () => {
  const { content } = useSiteData();
  useSeo({ title: 'معرض صور المعهد | معهد الدراسات النفسية', path: '/institute-gallery', description: 'صور من داخل معهد الدراسات النفسية وقاعات التدريب والفعاليات.' });

  const images = useMemo(() => {
    const raw = content['institute.gallery.images'] || '[]';
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
    } catch {
      return [];
    }
  }, [content]);

  return (
    <div className="min-h-screen bg-white">
      <PageHeader
        eyebrow="من داخل المعهد"
        title={content['institute.gallery.title'] || 'معرض صور المعهد'}
        subtitle={content['institute.gallery.subtitle'] || 'صور من القاعات، الفعاليات، والأنشطة التدريبية داخل المعهد.'}
      />

      <div className="container mx-auto px-4 py-14 sm:py-20">
        {images.length === 0 ? (
          <div className="mx-auto max-w-xl rounded-[24px] border border-line bg-paper p-8 text-center text-muted">
            لا توجد صور متاحة حاليا.
          </div>
        ) : (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
            {images.map((src, idx) => (
              <article key={`${src}-${idx}`} className="group overflow-hidden rounded-[24px] bg-sand ring-1 ring-line">
                <img
                  loading={idx < 2 ? undefined : 'lazy'}
                  decoding="async"
                  src={cdnImg(src, 800)}
                  srcSet={cdnSrcSet(src, [400, 640, 800, 1000])}
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  alt={`Institute gallery ${idx + 1}`}
                  width={800}
                  height={600}
                  className="aspect-[4/3] h-auto w-full object-cover transition duration-500 motion-safe:group-hover:scale-[1.03]"
                />
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  );
};

export default InstituteGallery;
