import React, { useMemo, useEffect } from 'react';
import { useSiteData } from '../context/SiteDataContext';

const InstituteGallery: React.FC = () => {
  const { content } = useSiteData();
  useEffect(() => { document.title = 'معرض صور المعهد | معهد الدراسات النفسية'; }, []);

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
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50 py-10">
      <div className="container mx-auto px-4">
        <header className="text-center max-w-3xl mx-auto mb-10">
          <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-3">{content['institute.gallery.title'] || 'معرض صور المعهد'}</h1>
          <p className="text-gray-600">{content['institute.gallery.subtitle'] || 'صور من القاعات، الفعاليات، والأنشطة التدريبية داخل المعهد.'}</p>
        </header>

        {images.length === 0 ? (
          <div className="max-w-xl mx-auto rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-500">
            لا توجد صور متاحة حاليا.
          </div>
        ) : (
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {images.map((src, idx) => (
              <article key={`${src}-${idx}`} className="rounded-2xl overflow-hidden border border-gray-200 shadow-sm bg-white">
                <img src={src} alt={`Institute gallery ${idx + 1}`} className="w-full h-64 object-cover" />
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  );
};

export default InstituteGallery;
