import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { Bundle, Currency } from '../../types';
import { discountPercent, formatPrice, isDiscounted } from '../../../shared/priceFormat';
import { bundlesForHome } from '../../../shared/homePaths';

type Content = Record<string, string | undefined>;

/**
 * «المسارات التعليمية الكاملة» — each path is drawn as the steps a student
 * takes (1 ← 2 ← 3), with the saving in a seal on the card. The featured card
 * (the one that saves the most) is dark. Everything comes from the bundles the
 * marketing team publishes; nothing here is typed.
 */
const PathsSection: React.FC<{ content: Content; bundles: Bundle[]; currency: Currency }> = ({ content, bundles, currency }) => {
  const shown = bundlesForHome(bundles);
  if (shown.length === 0) return null;
  const saving = (bundle: Bundle) => discountPercent(bundle.originalPrice?.[currency], bundle.price?.[currency]);
  const bestSaving = Math.max(...shown.map(saving));

  return (
    <section id="paths" className="scroll-mt-24 bg-[#fffaf5] py-14 sm:py-24">
      <div className="container mx-auto px-4">
        <div className="mx-auto mb-12 max-w-2xl text-center sm:mb-14">
          <span className="text-sm font-extrabold text-amber-700">{content['home.paths.badge'] || 'الطريق المختصر للاحتراف'}</span>
          <h2 className="mb-3 mt-2 text-3xl font-black leading-tight text-gray-900 sm:text-4xl lg:text-[46px]">{content['home.paths.title'] || 'المسارات التعليمية الكاملة'}</h2>
          <p className="text-base leading-relaxed text-gray-500 sm:text-lg">
            {content['home.paths.subtitle'] || 'وفر وقتك ومالك مع باقاتنا المجمعة التي تضم مجموعة من الدبلومات في تخصص معين بخصومات تصل إلى 40%'}
          </p>
        </div>

        <div className="grid gap-x-6 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((bundle, index) => {
            const pct = saving(bundle);
            const featured = bestSaving > 0 && pct === bestSaving && index === shown.findIndex(b => saving(b) === bestSaving);
            const dark = featured;
            return (
              <article
                key={bundle.id}
                className={`relative flex flex-col rounded-[28px] border p-6 pt-8 transition hover:-translate-y-1.5 hover:shadow-2xl sm:p-7 sm:pt-9 ${dark ? 'border-[#1b0a12] bg-[#1b0a12] text-white' : 'border-[#f0e4dc] bg-white text-gray-900'} ${index === 2 ? 'md:col-span-2 lg:col-span-1' : ''}`}
              >
                {pct > 0 && (
                  <div className="absolute -top-7 left-5 flex h-[84px] w-[84px] flex-col items-center justify-center rounded-full border-4 border-[#fffaf5] bg-secondary-500 text-center font-black leading-tight text-[#1b0a12] shadow-lg">
                    <span className="text-xs">وفّر</span>
                    <span className="text-2xl tabular-nums">{pct}%</span>
                  </div>
                )}
                <span className={`mb-3 self-start rounded-full px-3.5 py-1 text-[13px] font-extrabold ${dark ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-700'}`}>
                  {dark ? 'الأكثر توفيراً' : `باقة ${bundle.courses.length} برامج`}
                </span>
                <h3 className="mb-1.5 pe-20 text-2xl font-black leading-snug">{bundle.title}</h3>
                {bundle.shortDescription && <p className={`mb-5 line-clamp-2 text-[15px] leading-relaxed ${dark ? 'text-white/70' : 'text-gray-500'}`}>{bundle.shortDescription.replace(/<[^>]*>/g, '').trim()}</p>}

                <ol className="mb-5 flex-1">
                  {bundle.courses.map((course, i) => (
                    <li key={course.id || i} className="relative flex gap-3.5 pb-4 last:pb-0">
                      {i < bundle.courses.length - 1 && (
                        <span aria-hidden="true" className={`absolute start-[15px] top-8 bottom-0.5 border-s-2 border-dashed ${dark ? 'border-white/30' : 'border-[#d9c7bf]'}`} />
                      )}
                      <span className={`relative z-[1] flex h-8 w-8 flex-none items-center justify-center rounded-full text-[15px] font-black ${dark ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-700'}`}>{i + 1}</span>
                      <span className="min-w-0 flex-1 pt-1">
                        <b className="block text-base leading-snug">{course.title}</b>
                        {Number(course.price?.[currency]) > 0 && (
                          <span className={`text-sm tabular-nums ${dark ? 'text-white/70' : 'text-gray-500'}`}>{formatPrice(course.price?.[currency], currency)}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>

                <div className={`mb-4 rounded-[18px] px-4 py-3.5 ${dark ? 'bg-white/10' : 'bg-primary-50'}`}>
                  {isDiscounted(bundle.originalPrice?.[currency], bundle.price?.[currency]) && (
                    <p className={`text-[13px] ${dark ? 'text-white/70' : 'text-gray-500'}`}>بدل <s className="tabular-nums">{formatPrice(bundle.originalPrice?.[currency], currency)}</s> اشتراك منفصل</p>
                  )}
                  <p className="text-4xl font-black tabular-nums">{formatPrice(bundle.price?.[currency], currency)}</p>
                </div>
                <Link
                  to={`/enroll?bundle=${encodeURIComponent(bundle.id)}`}
                  className={`flex min-h-[52px] items-center justify-center rounded-2xl text-[17px] font-black transition hover:brightness-105 ${dark ? 'bg-secondary-500 text-[#1b0a12]' : 'bg-primary-600 text-white'}`}
                >
                  احجز المسار كامل
                </Link>
                <Link to={`/bundle/${bundle.id}`} className={`mt-2 inline-flex min-h-[44px] items-center justify-center text-sm font-bold ${dark ? 'text-white/80 hover:text-white' : 'text-gray-500 hover:text-gray-800'}`}>التفاصيل</Link>
              </article>
            );
          })}
        </div>

        <div className="mt-10 text-center">
          <Link to="/bundles" className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-gray-300 bg-white px-8 font-bold text-gray-700 transition hover:bg-gray-50">
            {content['home.paths.viewAll'] || 'عرض جميع المسارات'} <ChevronRight size={18} className="rtl:rotate-180" />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default PathsSection;
