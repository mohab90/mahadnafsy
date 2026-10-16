import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import type { Bundle, Currency } from '../../types';
import { discountPercent, formatPrice, isDiscounted } from '../../../shared/priceFormat';
import { bundlesForHome } from '../../../shared/homePaths';
import { Reveal } from './Reveal';

type Content = Record<string, string | undefined>;

/**
 * «المسارات التعليمية الكاملة» — three paths, each listing the programmes in it,
 * the price of the path against the programmes bought one by one, and the
 * saving. The one that saves the most is raised and dark. Everything comes
 * from the bundles marketing publishes; nothing here is typed.
 */
const PathsSection: React.FC<{ content: Content; bundles: Bundle[]; currency: Currency }> = ({ content, bundles, currency }) => {
  const shown = bundlesForHome(bundles);
  if (shown.length === 0) return null;
  const saving = (bundle: Bundle) => discountPercent(bundle.originalPrice?.[currency], bundle.price?.[currency]);
  const bestSaving = Math.max(...shown.map(saving));
  const featuredIndex = bestSaving > 0 ? shown.findIndex(b => saving(b) === bestSaving) : -1;

  return (
    <section id="paths" className="scroll-mt-24 bg-white py-16 sm:py-24">
      <div className="container mx-auto px-4">
        <Reveal className="mx-auto mb-12 max-w-2xl text-center sm:mb-14">
          <span className="text-sm font-extrabold text-[#a87a1c]">{content['home.paths.badge'] || 'الطريق المختصر للاحتراف'}</span>
          <h2 className="mt-2 text-3xl font-black leading-tight text-[#1a0f12] sm:text-4xl lg:text-[44px]">{content['home.paths.title'] || 'المسارات التعليمية الكاملة'}</h2>
          <p className="mt-3 text-base leading-relaxed text-[#6b5b55] sm:text-lg">
            {content['home.paths.subtitle'] || 'وفر وقتك ومالك مع باقاتنا المجمعة التي تضم مجموعة من الدبلومات في تخصص معين بخصومات تصل إلى 40%'}
          </p>
        </Reveal>

        <div className="grid items-stretch gap-6 md:grid-cols-2 lg:grid-cols-3 lg:gap-7">
          {shown.map((bundle, index) => {
            const pct = saving(bundle);
            const dark = index === featuredIndex;
            return (
              <Reveal key={bundle.id} delay={index * 90} className={`h-full ${index === 2 ? 'md:col-span-2 lg:col-span-1' : ''}`}>
                <article className={`relative flex h-full flex-col rounded-[28px] p-6 transition duration-300 hover:-translate-y-1.5 sm:p-7 ${dark ? 'bg-[#1a0f12] text-white shadow-[0_40px_70px_-30px_rgba(26,15,18,.7)]' : 'border border-[#ecdfd6] bg-white text-[#1a0f12] hover:shadow-[0_30px_50px_-30px_rgba(26,15,18,.35)]'}`}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <span className={`rounded-full px-3.5 py-1 text-[13px] font-extrabold ${dark ? 'bg-[#e3b65a] text-[#1a0f12]' : 'bg-[#fbf7f2] text-[#5b4b46] ring-1 ring-[#ecdfd6]'}`}>
                      {dark ? 'الأكثر توفيراً' : `مسار من ${bundle.courses.length} برامج`}
                    </span>
                    {pct > 0 && <span className={`text-sm font-black ${dark ? 'text-[#f3c969]' : 'text-primary-700'}`}>وفّر {pct}%</span>}
                  </div>
                  <h3 className="text-2xl font-black leading-snug">{bundle.title}</h3>
                  {bundle.shortDescription && <p className={`mt-2 line-clamp-2 text-[15px] leading-relaxed ${dark ? 'text-white/65' : 'text-[#7a6a64]'}`}>{bundle.shortDescription.replace(/<[^>]*>/g, '').trim()}</p>}

                  <ul className="my-6 flex-1 space-y-2.5">
                    {bundle.courses.map((course, i) => (
                      <li key={course.id || i} className="flex items-start gap-2.5 text-[15px] font-bold leading-snug">
                        <span className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full ${dark ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-700'}`}><Check size={13} strokeWidth={3} /></span>
                        {course.title}
                      </li>
                    ))}
                  </ul>

                  <div className={`border-t pt-5 ${dark ? 'border-white/10' : 'border-[#ecdfd6]'}`}>
                    {isDiscounted(bundle.originalPrice?.[currency], bundle.price?.[currency]) && (
                      <p className={`text-[13px] ${dark ? 'text-white/55' : 'text-[#8f7f79]'}`}>بدل <s className="tabular-nums">{formatPrice(bundle.originalPrice?.[currency], currency)}</s> لو اشتركت في كل برنامج لوحده</p>
                    )}
                    <p className="mt-1 text-4xl font-black tabular-nums">{formatPrice(bundle.price?.[currency], currency)}</p>
                  </div>
                  <Link
                    to={`/enroll?bundle=${encodeURIComponent(bundle.id)}`}
                    className={`mt-5 flex min-h-[54px] items-center justify-center gap-2 rounded-2xl text-[17px] font-black transition ${dark ? 'bg-[#e3b65a] text-[#1a0f12] hover:brightness-105' : 'bg-primary-700 text-white hover:bg-primary-800'}`}
                  >
                    احجز المسار كامل
                    <ArrowLeft size={18} />
                  </Link>
                  <Link to={`/bundle/${bundle.id}`} className={`mt-1.5 inline-flex min-h-[44px] items-center justify-center text-sm font-bold ${dark ? 'text-white/70 hover:text-white' : 'text-[#7a6a64] hover:text-[#1a0f12]'}`}>تفاصيل المسار</Link>
                </article>
              </Reveal>
            );
          })}
        </div>

        <div className="mt-12 text-center">
          <Link to="/bundles" className="inline-flex min-h-[50px] items-center gap-2 rounded-2xl border-[1.5px] border-[#1a0f12]/15 px-8 text-base font-extrabold text-[#1a0f12] transition hover:border-[#1a0f12]/40">
            {content['home.paths.viewAll'] || 'عرض جميع المسارات'}
            <ArrowLeft size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default PathsSection;
