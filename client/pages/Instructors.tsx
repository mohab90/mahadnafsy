import React from 'react';
import { Link } from 'react-router-dom';
import { Star, Shield, ArrowLeft, CalendarCheck2, Globe, GraduationCap } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { isConsultationEnabled, meetingProviderLabels } from '../lib/consultations';
import { cdnImg, cdnSrcSet } from '../lib/img';
import { useSeo } from '../lib/useSeo';
import PageHeader from '../components/PageHeader';

const Instructors: React.FC = () => {
  const { therapists, content } = useSiteData();
  useSeo({ title: 'الخبراء والمدربين | معهد الدراسات النفسية', path: '/instructors', description: 'نخبة الخبراء والمدربين في معهد الدراسات النفسية — سِيَر ذاتية وتخصصات كل محاضر.' });
  return (
    <div className="min-h-screen bg-white">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1.5"><GraduationCap size={15} />{therapists.length} خبير ومدرب معتمد</span>}
        title={content['instructors.title'] || 'نخبة المدربين والخبراء'}
        subtitle={content['instructors.subtitle'] || 'تعلم على يد أفضل الأطباء والمعالجين النفسيين في الوطن العربي. خبرة أكاديمية وعملية تمتد لسنوات.'}
      >
        <ul className="mx-auto grid max-w-3xl grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-center">
          {[
            { icon: GraduationCap, label: 'خبراء معتمدون', sub: 'دكاترة ومتخصصون' },
            { icon: Star, label: 'تقييم مرتفع', sub: '4.9 من 5 نجوم' },
            { icon: Globe, label: 'وصول عالمي', sub: 'خبرة دولية' },
            { icon: Shield, label: 'كفاءة موثقة', sub: 'سنوات من الخبرة' },
          ].map(({ icon: Icon, label, sub }) => (
            <li key={label} className="flex min-w-0 items-center gap-2.5 rounded-2xl bg-white px-3 py-2.5 text-right ring-1 ring-line sm:px-4">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700"><Icon size={18} /></span>
              <span className="min-w-0">
                <b className="block text-sm font-extrabold leading-tight text-ink">{label}</b>
                <span className="block text-xs text-muted">{sub}</span>
              </span>
            </li>
          ))}
        </ul>
      </PageHeader>

      <section className="py-14 sm:py-20">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:gap-8">
            {[...therapists].sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99)).map((instructor) => {
              const bookable = isConsultationEnabled(instructor);
              return (
                <Link
                  to={`/instructor/${instructor.id}`}
                  key={instructor.id}
                  className="group flex h-full flex-col rounded-[28px] border border-line bg-white p-3 transition duration-300 hover:-translate-y-1 hover:shadow-[0_30px_50px_-25px_rgba(26,15,18,.35)]"
                >
                  <div className="relative aspect-[4/5] overflow-hidden rounded-[22px] bg-sand">
                    {instructor.image ? (
                      <img
                        loading="lazy"
                        decoding="async"
                        src={cdnImg(instructor.image, 500)}
                        srcSet={cdnSrcSet(instructor.image, [320, 400, 640, 800])}
                        sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"
                        width={400}
                        height={500}
                        alt={instructor.name}
                        className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                      />
                    ) : (
                      <span aria-hidden="true" className="flex h-full w-full items-center justify-center text-6xl font-black text-line-deep">{instructor.name?.[0] ?? '?'}</span>
                    )}
                    <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-ink/85 to-transparent" />
                    {bookable && (
                      <div className="absolute inset-x-3 top-3 flex flex-wrap gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-extrabold text-ink shadow-sm">
                          <CalendarCheck2 size={13} className="text-green-600" />
                          متاح للحجز
                        </span>
                        {instructor.consultationSettings && (
                          <span className="rounded-full bg-ink/80 px-3 py-1 text-xs font-extrabold text-gold-pale">
                            {meetingProviderLabels[instructor.consultationSettings.meetingProvider]}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="absolute inset-x-4 bottom-4 text-white">
                      <span className="line-clamp-1 text-[13px] text-white/80">{instructor.title}</span>
                      <h3 className="text-xl font-black leading-snug">{instructor.name}</h3>
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col px-2 pb-2 pt-4">
                    <div className="mb-3 flex items-center justify-between text-[13px] font-bold text-muted">
                      {Number(instructor.experience) > 0 ? (
                        <span className="inline-flex items-center gap-1"><GraduationCap size={15} className="text-primary-700" />{instructor.experience} {content['instructors.card.experienceSuffix'] || 'سنة خبرة'}</span>
                      ) : <span />}
                      {Number(instructor.rating) > 0 && <span className="inline-flex items-center gap-1 text-gold-deep"><Star size={14} fill="currentColor" />{instructor.rating}</span>}
                    </div>

                    <p className="mb-4 line-clamp-3 text-sm leading-relaxed text-muted-body">
                      {instructor.bio || (content['instructors.card.bioFallback'] || 'خبير متخصص في مجاله مع سنوات عديدة من الخبرة الأكاديمية والعملية...')}
                    </p>

                    {(instructor.focusAreas || []).length > 0 && (
                      <div className="mb-4 flex flex-wrap gap-1.5">
                        {(instructor.focusAreas || []).slice(0, 3).map((item) => (
                          <span key={item} className="rounded-full bg-paper px-3 py-1 text-xs font-extrabold text-muted-strong ring-1 ring-line">{item}</span>
                        ))}
                      </div>
                    )}

                    <span className="mt-auto inline-flex min-h-[44px] items-center gap-1.5 border-t border-line pt-3 text-[15px] font-extrabold text-primary-700 transition-all group-hover:gap-2.5">
                      {content['instructors.card.profileCta'] || 'عرض الملف الشخصي'}
                      <ArrowLeft size={17} />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Instructors;
