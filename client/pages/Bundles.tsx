import React from 'react';
import { Layers, Map as MapIcon, ArrowLeft, Check, Send, Award, Clock } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useSiteData } from '../context/SiteDataContext';
import { cdnImg, cdnSrcSet } from '../lib/img';
import { discountPercent, formatPrice, isDiscounted } from '../../shared/priceFormat';
import { useSeo } from '../lib/useSeo';
import PageHeader from '../components/PageHeader';

const Bundles: React.FC = () => {
  const { bundles, content, currency, remoteReady, catalogFailed, retryCatalog } = useSiteData();
  const navigate = useNavigate();

  useSeo({ title: 'المسارات والباقات | معهد الدراسات النفسية', path: '/bundles', description: 'مسارات تعليمية متكاملة وباقات مجمعة بخصومات تصل إلى 40% — من المبتدئ إلى المحترف.' });

  // A bundle with no courses attached has nothing to show, so the list skips
  // it. The empty-state check below uses the same list for the same reason.
  const visibleBundles = bundles.filter(b => b.courses && b.courses.length > 0);

  return (
    <div className="min-h-screen bg-white">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1.5"><MapIcon size={15} />{visibleBundles.length} مسار تعليمي وباقة متاحة</span>}
        title={content['bundles.title'] || 'المسارات التعليمية والباقات'}
        subtitle={content['bundles.subtitle'] || 'خطط دراسية متكاملة تأخذ بيدك من البداية وحتى الاحتراف، أو باقات توفيرية تجمع لك أهم الدبلومات.'}
      >
        <ul className="mx-auto grid max-w-3xl grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:justify-center sm:gap-3">
          {[
            { icon: MapIcon, label: 'مسارات متكاملة', sub: 'من المبتدئ للمحترف' },
            { icon: Layers, label: 'باقات توفيرية', sub: 'وفر حتى 40%' },
            { icon: Award, label: 'شهادات معتمدة', sub: 'دولياً ومحلياً' },
            { icon: Clock, label: 'مرونة كاملة', sub: 'ادرس بوقتك' },
          ].map(({ icon: Icon, label, sub }) => (
            <li key={label} className="flex items-center gap-2.5 rounded-2xl bg-white px-3 py-2.5 text-right ring-1 ring-line sm:px-4">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700"><Icon size={18} /></span>
              <span className="min-w-0">
                <b className="block text-sm font-extrabold text-ink">{label}</b>
                <span className="block text-xs text-muted">{sub}</span>
              </span>
            </li>
          ))}
        </ul>
      </PageHeader>

      <section className="py-14 sm:py-20">
        <div className="container mx-auto px-4">
          {/* Path Explanation */}
          <div className="mb-12 grid grid-cols-1 gap-4 sm:mb-16 md:grid-cols-2 md:gap-6">
            <div className="flex items-start gap-4 rounded-[24px] border border-line bg-paper p-5 sm:p-7">
              <span className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-ink text-gold-pale">
                <MapIcon size={24} />
              </span>
              <div className="min-w-0">
                <h2 className="mb-1.5 text-lg font-black text-ink sm:text-xl">{content['bundles.info.pathsTitle'] || 'مسارات التعلم (Learning Paths)'}</h2>
                <p className="text-[15px] leading-relaxed text-muted-body">{content['bundles.info.pathsDesc'] || 'خطة منهجية مرتبة خطوة بخطوة. لا تحتاج للتفكير "بم أبدأ؟"، نحن نرسم لك الطريق لتصبح متخصصاً محترفاً.'}</p>
              </div>
            </div>
            <div className="flex items-start gap-4 rounded-[24px] border border-line bg-paper p-5 sm:p-7">
              <span className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
                <Layers size={24} />
              </span>
              <div className="min-w-0">
                <h2 className="mb-1.5 text-lg font-black text-ink sm:text-xl">{content['bundles.info.bundlesTitle'] || 'الباقات المجمعة (Bundles)'}</h2>
                <p className="text-[15px] leading-relaxed text-muted-body">{content['bundles.info.bundlesDesc'] || 'مجموعة كورسات في تخصص معين بسعر مخفض جداً مقارنة بشراء كل كورس بمفرده.'}</p>
              </div>
            </div>
          </div>

          {/* List */}
          {/* An empty list is not the same thing as a list that has not arrived.
              Keyed on length alone, the spinner never stopped for an institute
              with no bundles published: the page said "loading" forever. */}
          {/* Checked against the list that is actually drawn, not the raw one. The
              list below hides any bundle with no courses attached, so a set of
              bundles that were all still empty produced neither the list nor this
              message — just a hero, two info cards and nothing else. */}
          {visibleBundles.length === 0 && (
            remoteReady && catalogFailed ? (
              <div className="flex flex-col items-center justify-center gap-4 rounded-[24px] border border-dashed border-line-deep bg-paper px-4 py-20 text-center">
                <p className="text-lg font-black text-ink">تعذر تحميل المسارات. تحقق من اتصالك وحاول مرة أخرى.</p>
                <button type="button" onClick={retryCatalog} className="rounded-xl bg-primary-700 px-6 py-2.5 font-bold text-white hover:bg-primary-800">إعادة المحاولة</button>
              </div>
            ) : remoteReady ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-[24px] border border-dashed border-line-deep bg-paper px-4 py-20 text-center">
                <p className="text-lg font-black text-ink">لا توجد مسارات متاحة حالياً</p>
                <p className="text-sm text-muted">تابعنا — يتم إضافة مسارات جديدة باستمرار.</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 py-24">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-line border-t-primary-700" />
                <p className="text-sm text-muted">جاري تحميل المسارات...</p>
              </div>
            )
          )}
          <div className="space-y-8 sm:space-y-10">
            {visibleBundles.map(bundle => {
              const price = bundle.price?.[currency] ?? 0;
              const saving = price > 0 ? discountPercent(bundle.originalPrice?.[currency], bundle.price?.[currency]) : 0;
              const cover = bundle.courses[0]?.thumbnail || bundle.thumbnail;
              return (
                <article
                  key={bundle.id}
                  className="grid overflow-hidden rounded-[28px] border border-line bg-white transition duration-300 hover:shadow-[0_30px_50px_-30px_rgba(26,15,18,.35)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
                >
                  {/* The path at a glance: what it is and what it costs. */}
                  <div className="relative flex flex-col bg-ink p-6 text-white sm:p-8">
                    {cover && (
                      <div className="mb-6 aspect-[16/10] overflow-hidden rounded-[20px] bg-white/5">
                        <img loading="lazy" decoding="async" src={cdnImg(cover, 640)} srcSet={cdnSrcSet(cover, [400, 640, 800])} sizes="(min-width: 1024px) 420px, calc(100vw - 80px)" width={640} height={400} className="h-full w-full object-cover" alt="" />
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="rounded-full bg-gold-light px-3.5 py-1 text-[13px] font-extrabold text-ink">{content['bundles.card.badge'] || 'مسار كامل'}</span>
                      {saving > 0 && <span className="text-sm font-black text-gold-pale">وفّر {saving}%</span>}
                    </div>
                    <h2 className="mt-4 text-2xl font-black leading-snug sm:text-[28px]">{bundle.title}</h2>
                    {bundle.description && <p className="mt-2 line-clamp-3 text-[15px] leading-relaxed text-white/65">{bundle.description}</p>}

                    <div className="mt-auto pt-6">
                      <div className="border-t border-white/10 pt-5">
                        {price > 0 ? (
                          <>
                            {isDiscounted(bundle.originalPrice?.[currency], bundle.price?.[currency]) && (
                              <p className="text-[13px] text-white/55">{content['bundles.card.oldPricePrefix'] || 'بدلاً من'} <s className="tabular-nums">{formatPrice(bundle.originalPrice?.[currency], currency)}</s></p>
                            )}
                            <p className="mt-1 text-4xl font-black tabular-nums">{formatPrice(bundle.price?.[currency], currency)}</p>
                          </>
                        ) : (
                          <p className="text-sm font-bold text-gold-pale">السعر غير متاح في دولتك حاليًا</p>
                        )}
                      </div>
                      <Link
                        to={`/bundle/${bundle.slug || bundle.id}`}
                        className="mt-5 flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-gold-light px-5 text-base font-black text-ink transition hover:brightness-105"
                      >
                        {content['bundles.card.detailsCta'] || 'عرض تفاصيل المسار'}
                        <ArrowLeft size={18} />
                      </Link>
                    </div>
                  </div>

                  {/* The programmes in it, in order. */}
                  <div className="flex flex-col p-5 sm:p-8">
                    <h3 className="flex items-center gap-2 text-lg font-black text-ink">
                      <Layers size={20} className="flex-none text-primary-700" />
                      {content['bundles.card.journeyTitle'] || 'رحلة التعلم'} ({bundle.courses.length} {content['bundles.card.stationsLabel'] || 'محطات'})
                    </h3>

                    <ol className="mt-5 flex-1 space-y-2.5">
                      {bundle.courses.map(course => (
                        <li key={course.id}>
                          <Link
                            to={`/c/${course.slug || course.id}`}
                            className="group flex min-h-[60px] items-center gap-3 rounded-2xl border border-line bg-paper p-2.5 transition hover:border-line-deep hover:bg-white sm:p-3"
                          >
                            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary-50 text-primary-700"><Check size={14} strokeWidth={3} /></span>
                            <span className="h-12 w-12 flex-none overflow-hidden rounded-xl bg-sand">
                              {course?.thumbnail && <img loading="lazy" decoding="async" src={cdnImg(course.thumbnail, 120)} width={48} height={48} className="h-full w-full object-cover" alt={course.title} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <b className="block text-[15px] font-bold leading-snug text-ink transition group-hover:text-primary-700">{course.title}</b>
                              <span className="mt-0.5 block truncate text-xs text-muted">{course.duration} • {course.instructor}</span>
                            </span>
                            <ArrowLeft size={16} className="flex-none text-muted-faint transition group-hover:text-primary-700" />
                          </Link>
                        </li>
                      ))}
                    </ol>

                    <div className="mt-6 flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-1 text-xs font-extrabold text-muted-strong ring-1 ring-line">
                        <Check size={13} className="text-primary-700" />
                        {content['bundles.benefits.certificate'] || 'شهادة مجمعة للمسار'}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-1 text-xs font-extrabold text-muted-strong ring-1 ring-line">
                        <Check size={13} className="text-primary-700" />
                        {content['bundles.benefits.supervision'] || 'إشراف مهني مجاني'}
                      </span>
                    </div>

                    <div className="mt-6 flex flex-col gap-2.5 border-t border-line pt-6 sm:flex-row sm:flex-wrap">
                      {price > 0 ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/checkout?type=bundle&id=${bundle.id}`)}
                          className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-primary-700 px-6 text-[15px] font-black text-white transition hover:bg-primary-800"
                        >
                          <Check size={16} /> اشترك الآن واحصل على خصم إضافي
                        </button>
                      ) : (
                        <span className="inline-flex min-h-[52px] items-center justify-center rounded-2xl bg-paper px-6 text-[15px] font-extrabold text-muted-strong ring-1 ring-line">
                          تواصل معنا لتجهيز السعر
                        </span>
                      )}
                      <Link
                        to={`/bundle/${bundle.slug || bundle.id}#register-form`}
                        className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border-[1.5px] border-ink/15 bg-white px-6 text-[15px] font-extrabold text-ink transition hover:border-ink/40"
                      >
                        <Send size={16} /> سجل بياناتك للتواصل
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Bundles;
