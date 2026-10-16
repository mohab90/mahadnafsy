import React, { useState, useEffect, useMemo } from 'react';
import { useEscapeKey } from '../../shared/ui/useEscapeKey';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CheckCircle, Clock, Users, Star, Award, ChevronRight, Quote, Send, BookOpen, GraduationCap, Phone, Briefcase, MessageCircle } from 'lucide-react';
import { LeadItem } from '../types';
import { useSiteData } from '../context/SiteDataContext';
import CourseCard from '../components/CourseCard';
import { cdnImg } from '../lib/img';
import { isExpiryActive } from '../../shared/cairoDate';
import { formatPrice, isDiscounted } from '../../shared/priceFormat';
import { offerHours, offerIsShown, offerPrices, offerRemainingMs, offerDiscountPercent } from '../../shared/siteOffers';
import { useSeo } from '../lib/useSeo';
import { VideoSurface } from '../components/VideoSurface';
import { expressPrice } from '../lib/consultations';
import { goalsFromCourses, recommendedCourse } from '../../shared/homeGoals';
import GoalFinder from '../components/home/GoalFinder';
import WhyChooseSection from '../components/home/WhyChooseSection';
import CertificateCheck from '../components/home/CertificateCheck';
import PaymentBand from '../components/home/PaymentBand';
import PathsSection from '../components/home/PathsSection';

// Countdown for the timed offer, from the moment the marketing team started it
// (offer.timerStartedAt, «ابدأ العداد» in التسويق ← الخصومات) for as many hours
// as they set there (offer.durationHours, 24 unless changed).
//
// It used to fall back to localStorage when no timestamp was set: the first
// visit wrote "now" into the browser, and any visit more than 24 hours later
// wrote "now" again. That is not a deadline, it is a stopwatch restarting for
// every visitor forever. A countdown nobody set is not shown, and one that has
// run out takes the offer off the page (see offerIsShown).
function useOfferCountdown(content: Record<string, string | undefined>) {
  const calc = () => {
    const remaining = offerRemainingMs(content);
    if (remaining === null) return null;
    return {
      h: Math.floor(remaining / 3600000),
      m: Math.floor((remaining % 3600000) / 60000),
      s: Math.floor((remaining % 60000) / 1000),
    };
  };
  const startedAt = content['offer.timerStartedAt'] || '';
  const hours = offerHours(content);
  const [time, setTime] = useState(calc);
  useEffect(() => {
    setTime(calc());
    if (!startedAt) return undefined;
    const id = setInterval(() => { if (!document.hidden) setTime(calc()); }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, hours]);
  return time;
}

const Home: React.FC = () => {
        const { courses, bundles, testimonials, therapists, addPublicLead, content, discounts, currency } = useSiteData();
    const [offerLeadName, setOfferLeadName] = useState('');
    const [offerLeadPhone, setOfferLeadPhone] = useState('');
    const [offerLeadBranch, setOfferLeadBranch] = useState('');
    const [offerLeadNotice, setOfferLeadNotice] = useState('');
  const [showVideoModal, setShowVideoModal] = useState(false);
  // A video lightbox. It sat on z-[9999], the highest number in either app.
  useEscapeKey(() => setShowVideoModal(false), showVideoModal);
  const currencySymbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';
  const timer = useOfferCountdown(content);
  const offerShown = offerIsShown(content);

  // «مش عارف تبدأ منين؟» — interests and the recommended course both come from the course list.
  const goals = useMemo(() => goalsFromCourses(courses), [courses]);
  const [goalPick, setGoalPick] = useState('');
  const goalId = goals.some(g => g.id === goalPick) ? goalPick : (goals[0]?.id || '');
  const goalCourse = useMemo(() => (goalId ? recommendedCourse(courses, goalId) : null), [courses, goalId]);

  useSeo({ title: 'الرئيسية | معهد الدراسات النفسية', path: '/', description: 'المنصة الأكاديمية الأولى عربياً لتعليم الصحة النفسية والعلاج النفسي — دبلومات معتمدة وتدريب عملي.' });

  // Helper filters
    const bestSellingCourses = [...courses].sort((a, b) => b.students - a.students).slice(0, 6);
    const featuredInstructors = [...therapists]
      .filter(t => t.showOnHome)
      .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99))
      .slice(0, 4);

    const handleOfferLeadSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!offerLeadName.trim() || !offerLeadPhone.trim()) {
            setOfferLeadNotice('يرجى إدخال الاسم ورقم الهاتف.');
            return;
        }

        const generatedEmail = `${offerLeadPhone.replace(/\D/g, '') || Date.now()}@lead.local`;
        const payload = {
            id: `l-${Date.now()}`,
            name: offerLeadName.trim(),
            email: generatedEmail,
            phone: offerLeadPhone.trim(),
            source: 'عرض 24 ساعة',
            status: 'new' as const,
            leadType: 'course' as const,
            enrolledCourseId: content['offer.courseId'] || '',
            branch: offerLeadBranch as LeadItem['branch'],
            createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        };
        try {
            await addPublicLead(payload);
            setOfferLeadName('');
            setOfferLeadPhone('');
            setOfferLeadBranch('');
            setOfferLeadNotice('تم تسجيل الطلب وسيظهر داخل العملاء المحتملين.');
        } catch {
            setOfferLeadNotice('تعذر تسجيل الطلب حاليًا. من فضلك حاول مرة أخرى أو تواصل معنا على واتساب.');
        }
    };

    return (
    <div className="animate-fade-in bg-white">
      {/* ── Offer strip: the timed offer, with its countdown, on every visit ── */}
      {offerShown && (
        <div className="bg-primary-600 text-white">
          <div className="container mx-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-center text-sm font-bold sm:text-[15px]">
            <span>عرض الـ{offerHours(content)} ساعة على {content['home.offer.title'] || 'دبلومة العلاج السلوكي الجدلي (DBT)'}</span>
            {timer && (
              <span dir="ltr" className="rounded-full bg-black/25 px-3.5 py-0.5 font-black tabular-nums">
                {String(timer.h).padStart(2, '0')} : {String(timer.m).padStart(2, '0')} : {String(timer.s).padStart(2, '0')}
              </span>
            )}
            <a href="#offer" className="underline underline-offset-4">احجز الآن</a>
          </div>
        </div>
      )}

      {/* ── Hero: the offer in one sentence, one booking button, and «مش عارف تبدأ منين؟» where the photo used to be ── */}
      <section
        className="relative overflow-hidden bg-[#1b0a12] text-white"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.07) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
      >
        <div aria-hidden="true" className="absolute -left-36 -top-32 h-[460px] w-[460px] rounded-full bg-primary-600 opacity-20" />
        <div className="container relative z-10 mx-auto grid items-center gap-16 px-4 pb-20 pt-14 sm:pt-16 lg:grid-cols-[1.15fr_1fr] lg:gap-12 lg:pb-24 lg:pt-20">
          <div className="text-center lg:text-right">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/25 px-4 py-1.5 text-sm font-bold text-amber-200">
              <span className="h-2 w-2 rounded-full bg-secondary-500" />
              {content?.['home.hero.badge'] || 'المنصة الرائدة في العالم العربي'}
            </div>
            <h1 className="mb-5 text-[34px] font-black leading-[1.2] sm:text-5xl lg:text-6xl xl:text-7xl">
              ابدأ مسارك المهني في <span className="text-primary-400">الصحة النفسية</span> بتدريب عملي وشهادة معتمدة
            </h1>
            <p className="mx-auto mb-8 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg lg:mx-0">
              {content?.['home.heroSubtitle'] || 'انضم إلى آلاف المتدربين في المنصة الأكاديمية الأولى لتعليم الصحة النفسية. دبلومات معتمدة، وتدريب عملي مع نخبة الخبراء.'}
            </p>
            <div className="mb-10 flex flex-col gap-3.5 sm:flex-row sm:justify-center lg:justify-start">
              <Link to="/enroll" className="inline-flex min-h-[56px] items-center justify-center gap-3 rounded-2xl bg-primary-600 px-9 text-lg font-extrabold text-white shadow-xl shadow-primary-600/40 transition hover:-translate-y-0.5 hover:bg-primary-500">
                <span>احجز مكانك الآن</span>
                <ArrowRight size={22} className="rtl:rotate-180" />
              </Link>
              <Link to="/courses" className="inline-flex min-h-[56px] items-center justify-center rounded-2xl border-[1.5px] border-white/40 px-8 text-lg font-bold text-white transition hover:bg-white/10">
                <span>{content?.['home.hero.primaryCta'] || 'ابدأ رحلتك الآن'}</span>
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-4">
              {[
                { value: content['home.stats.programs']  || '50+', label: content['home.stats.programsLabel']  || 'برنامج تدريبي' },
                { value: content['home.stats.experts']   || '30+', label: content['home.stats.expertsLabel']   || 'خبير ومدرب' },
                { value: content['home.stats.graduates'] || '12K', label: content['home.stats.graduatesLabel'] || 'خريج' },
                { value: content['home.stats.rating']    || '4.9', label: 'تقييم الطلاب' },
              ].map((stat, i) => (
                <div key={i}>
                  <div className="text-4xl font-black leading-none tabular-nums">{stat.value}</div>
                  <div className="mt-1.5 text-sm text-white/70">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          <GoalFinder goals={goals} goalId={goalId} onPick={setGoalPick} course={goalCourse} currency={currency} />
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-b border-gray-100 bg-white py-5">
        <div className="container mx-auto grid grid-cols-1 gap-x-7 gap-y-4 px-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Award, text: 'شهادات معتمدة بكود تحقق' },
            { icon: Users, text: 'تدريب عملي مع الخبراء' },
            { icon: Clock, text: 'دفع كاش أو تقسيط' },
            { icon: MessageCircle, text: 'دعم مباشر على واتساب' },
          ].map(({ icon: Icon, text }, i) => (
            <div key={i} className="flex items-center gap-3 text-[15px] font-bold text-gray-800">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-primary-50 text-primary-600"><Icon size={20} /></span>
              {text}
            </div>
          ))}
        </div>
      </section>

      {/* SECTION: Best Selling Courses */}
      <section id="programs" className="scroll-mt-24 bg-[#fffaf5] py-14 sm:py-24 scroll-reveal">
        <div className="container mx-auto px-4">
          <div className="mb-10 sm:mb-12">
            <span className="text-sm font-extrabold tracking-wide text-amber-700">{content['home.bestSellers.badge'] || 'الأكثر طلباً'}</span>
            <h2 className="mt-2 text-3xl font-black leading-tight text-gray-900 sm:text-4xl lg:text-[44px]">{content['home.bestSellers.title'] || 'الدبلومات الأكثر مبيعاً'}</h2>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 lg:gap-8">
            {bestSellingCourses.map(course => (
              <div key={course.id} className="glow-card hover-float rounded-2xl overflow-hidden">
                <CourseCard course={course} currency={currency} />
              </div>
            ))}
          </div>

          <div className="mt-10 text-center">
            <Link to="/courses" className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-gray-300 bg-white px-8 font-bold text-gray-700 transition hover:bg-gray-50">
              عرض جميع الكورسات <ChevronRight size={18} className="rtl:rotate-180" />
            </Link>
          </div>
        </div>
      </section>

      {/* SECTION: Featured Discounted Course */}
      {(() => {
        const featuredId = content['home.featured.courseId'];
        const featuredPct = Number(content['home.featured.discountPercent'] || 0);
        const featuredCourse = featuredId ? courses.find(c => c.id === featuredId) : null;
        if (!featuredCourse || !featuredCourse.price || !featuredPct) return null;
        const origPrice = featuredCourse.price[currency] ?? 0;
        const discountedPrice = Math.round(origPrice * (1 - featuredPct / 100));
        const sym = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';
        // Also check active discount rules for this course. Expiry is a date
        // judged in Cairo, not an instant — see isExpiryActive.
        const ruleDiscount = discounts.find(d => d.active && d.type === 'course' && d.targetId === featuredId && isExpiryActive(d.expiresAt))
          ?? discounts.find(d => d.active && d.type === 'all_courses' && isExpiryActive(d.expiresAt));
        const finalPrice = ruleDiscount ? Math.round(discountedPrice * (1 - ruleDiscount.discountPercent / 100)) : discountedPrice;
        return (
          <section className="py-16 bg-gradient-to-br from-primary-900 via-primary-800 to-red-900 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-[400px] h-[400px] bg-secondary-500 rounded-full blur-[150px] opacity-20"></div>
            <div className="container mx-auto px-4 relative z-10">
              <div className="flex flex-col lg:flex-row items-center gap-10 bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-8 md:p-12">
                {/* Thumbnail */}
                {featuredCourse.thumbnail && (
                  <div className="w-full lg:w-80 flex-shrink-0 rounded-2xl overflow-hidden shadow-2xl">
                    <img src={cdnImg(featuredCourse.thumbnail, 700)} alt={featuredCourse.title} loading="lazy" className="w-full h-52 object-cover" />
                  </div>
                )}
                {/* Info */}
                <div className="flex-1 text-white text-center lg:text-right">
                  <div className="inline-flex items-center gap-2 bg-red-500/30 border border-red-400/50 text-red-300 px-4 py-1 rounded-full text-sm font-bold mb-4">
                    <Star size={14} fill="currentColor" /> عرض خاص — خصم {featuredPct}% إضافي
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold mb-3">{featuredCourse.title}</h2>
                  <p className="text-gray-300 mb-6 leading-relaxed max-w-xl">{(featuredCourse.shortDescription || '').replace(/<[^>]*>/g, '').trim()}</p>
                  <div className="flex items-center justify-center lg:justify-start gap-6 mb-8">
                    <div className="text-center">
                      <p className="text-gray-400 line-through text-base">{origPrice} {sym}</p>
                      <p className="text-4xl font-extrabold text-white">{finalPrice} {sym}</p>
                    </div>
                    <div className="h-12 w-px bg-white/20"></div>
                    <div className="text-left">
                      <p className="text-green-400 font-bold">خصم {featuredPct}%</p>
                      <p className="text-gray-400 text-xs">عرض محدود</p>
                    </div>
                  </div>
                  <Link to={`/c/${featuredCourse.slug || featuredCourse.id}`}
                    className="inline-flex items-center gap-2 bg-white text-primary-800 hover:bg-gray-100 font-bold px-8 py-4 rounded-xl shadow-lg transition text-lg">
                    <Check size={20} /> اشترك الآن واحصل على خصم إضافي
                  </Link>
                </div>
              </div>
            </div>
          </section>
        );
      })()}

      {/* SECTION: timed offer with registration form — off when switched off or its countdown has run out */}
      {offerShown && <section id="offer" className="py-16 bg-gray-900 relative overflow-hidden scroll-mt-24">
         {/* Background Elements */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-primary-600 rounded-full blur-[150px] opacity-20"></div>
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-secondary-600 rounded-full blur-[150px] opacity-20"></div>
          
          <div className="container mx-auto px-4 relative z-10">
              <div className="flex flex-col lg:flex-row items-center gap-12 border border-gray-700 bg-white/5 backdrop-blur-lg p-8 md:p-12 rounded-3xl">
                  {/* Offer Details */}
                  <div className="flex-1 text-center lg:text-right">
                      <div className="inline-flex items-center gap-2 bg-red-500/20 border border-red-500/50 text-red-400 px-4 py-1 rounded-full text-sm font-bold mb-6 animate-pulse">
                          <Clock size={16} />
                          {content['home.offer.badge'] || 'عرض لمدة 24 ساعة فقط'}
                      </div>
                      <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">{content['home.offer.title'] || 'دبلومة العلاج السلوكي الجدلي (DBT)'}</h2>
                      <p className="text-gray-300 mb-8 text-lg leading-relaxed max-w-2xl">
                          {(content['home.offer.description'] || 'احصل على الدبلومة الأكثر طلباً في سوق العمل بسعر لا يصدق. العرض يشمل الحقيبة التدريبية كاملة + 3 جلسات إشراف مجانية.').replace(/<[^>]*>/g, '').trim()}
                      </p>
                      
                      {/* Price Tag */}
                      {(() => {
                        const offerCid = content['offer.courseId'];
                        const offerCourse = offerCid ? courses.find(c => c.id === offerCid) : null;
                        const pctOff = offerDiscountPercent(content);
                        const sym24 = currencySymbol;
                        // The offer's own price (typed by marketing) or the course's, in the visitor's currency.
                        const prices = offerPrices(content, offerCourse, currency);
                        const displayOld = prices
                          ? `${prices.oldPrice} ${sym24}`
                          : content[`home.offer.oldPrice.${currency}`] || content['home.offer.oldPrice'] || `4500 ${sym24}`;
                        const displayNew = prices
                          ? `${prices.newPrice} ${sym24}`
                          : content[`home.offer.newPrice.${currency}`] || content['home.offer.newPrice'] || `2500 ${sym24}`;
                        return (
                          <div className="flex items-center justify-center lg:justify-start gap-6 mb-8">
                            <div className="text-center">
                              <p className="text-gray-400 line-through text-lg">{displayOld}</p>
                              <p className="text-4xl font-extrabold text-white">{displayNew}</p>
                            </div>
                            <div className="h-12 w-px bg-gray-700"></div>
                            <div className="text-left">
                              <p className="text-green-400 font-bold text-sm">{content['home.offer.discount'] || `خصم ${pctOff}%`}</p>
                              <p className="text-gray-400 text-xs">{content['home.offer.validUntil'] || 'ساري حتى منتصف الليل'}</p>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Timer — only once the admin has actually started one */}
                      {timer && (
                        <div className="flex justify-center lg:justify-start gap-4">
                            {[
                              { val: String(timer.h).padStart(2,'0'), label: 'ساعات' },
                              { val: String(timer.m).padStart(2,'0'), label: 'دقائق' },
                              { val: String(timer.s).padStart(2,'0'), label: 'ثواني' },
                            ].map((item, i) => (
                                <div key={i} className="bg-gray-800 rounded-lg p-3 w-20 text-center border border-gray-700">
                                    <span className="block text-2xl font-bold text-white font-mono">{item.val}</span>
                                    <span className="text-xs text-gray-400">{item.label}</span>
                                </div>
                            ))}
                        </div>
                      )}
                  </div>

                  {/* Registration Form in Offer */}
                  <div className="w-full lg:w-1/3">
                      <div className="bg-white rounded-2xl p-6 shadow-2xl relative">
                          <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-6 py-1 rounded-full text-sm font-bold shadow-lg whitespace-nowrap">
                                      {content['home.offer.formBadge'] || 'سجل الآن واضمن السعر'}
                          </div>
                          
                          <form className="mt-4 space-y-4" onSubmit={handleOfferLeadSubmit}>
                              <div className="bg-gray-50 border border-gray-200 p-3 rounded-lg text-center mb-4">
                                  <p className="text-xs text-gray-500">أنت تسجل لـ:</p>
                                  <p className="font-bold text-primary-700 text-sm">{content['home.offer.registerFor'] || 'دبلومة العلاج السلوكي الجدلي (عرض 24س)'}</p>
                              </div>
                              
                              <div>
                                  <label className="block text-xs font-bold text-gray-700 mb-1">{content['home.offer.formNameLabel'] || 'الاسم الكامل'}</label>
                                  <input type="text" value={offerLeadName} onChange={(e) => setOfferLeadName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none" placeholder={content['home.offer.formNamePlaceholder'] || 'الاسم الثلاثي'} />
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-gray-700 mb-1">{content['home.offer.formPhoneLabel'] || 'رقم الهاتف (واتساب)'}</label>
                                  <input type="tel" value={offerLeadPhone} onChange={(e) => setOfferLeadPhone(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none" placeholder={content['home.offer.formPhonePlaceholder'] || '01xxxxxxxxx'} />
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-gray-700 mb-1">{content['home.offer.formBranchLabel'] || 'الفرع الأقرب'}</label>
                                  <select value={offerLeadBranch} onChange={(e) => setOfferLeadBranch(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white">
                                      <option value="">{content['home.offer.formBranchPlaceholder'] || 'اختر الفرع الأقرب إليك'}</option>
                                      {(() => {
                                        let db: { id: string; label: string; internal_only?: boolean }[] = [];
                                        try { db = JSON.parse(content['institute.branches'] || '[]'); } catch {}
                                        db = db.filter(b => !b.internal_only);
                                        return db.length > 0
                                          ? db.map(b => <option key={b.id} value={b.id}>{b.label}</option>)
                                          : (<>
                                              <option value="daqqi">{content['home.offer.formBranchGiza'] || 'فرع الدقي'}</option>
                                              <option value="tagamoa">{content['home.offer.formBranchCairo'] || 'فرع التجمع'}</option>
                                              <option value="online-egypt">{content['home.offer.formBranchOnline'] || 'أونلاين محلي (مصر)'}</option>
                                              <option value="online-saudi">{content['home.offer.formBranchSaudi'] || 'أونلاين سعودي'}</option>
                                              <option value="online-abroad">{content['home.offer.formBranchAbroad'] || 'أونلاين دولي'}</option>
                                              <option value="other">{content['home.offer.formBranchOther'] || 'أخرى'}</option>
                                            </>);
                                      })()}
                                  </select>
                              </div>

                              {offerLeadNotice && <div className="text-xs text-center rounded-lg px-3 py-2 bg-green-50 border border-green-200 text-green-700">{offerLeadNotice}</div>}

                              <button type="submit" className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-3 rounded-xl transition shadow-lg mt-2 flex items-center justify-center gap-2">
                                  <Send size={16} />
                                  {content['home.offer.registerButton'] || 'حجز العرض الآن'}
                              </button>
                              <p className="text-[10px] text-center text-gray-400">{content['home.offer.registerNote'] || 'سيقوم فريق المبيعات بالتواصل معك لتأكيد الحجز والدفع'}</p>
                          </form>
                      </div>
                  </div>
              </div>
          </div>
      </section>}

      {/* SECTION: why choose the institute — tour video + reasons, then the certificate check right under it */}
      <section id="why" className="relative scroll-mt-24 overflow-hidden bg-[#f6ede6] py-14 sm:py-24">
        <div aria-hidden="true" className="absolute -right-36 -top-36 h-[420px] w-[420px] rounded-full bg-primary-200 opacity-55" />
        <div className="container relative mx-auto px-4">
          <WhyChooseSection content={content} onPlay={() => setShowVideoModal(true)} />
          <CertificateCheck />
        </div>
      </section>

      {/* SECTION: payment — its own full-width band, kept short */}
      <PaymentBand content={content} course={goalCourse} currency={currency} />

      {/* SECTION: learning paths & bundles */}
      <PathsSection content={content} bundles={bundles} currency={currency} />

      {showVideoModal && content['home.video.url'] && (
        <div
          className="fixed inset-0 bg-black/90 z-[9999] flex items-center justify-center"
          onClick={() => setShowVideoModal(false)}
        >
          <button
            className="absolute top-4 right-4 text-white bg-white/10 rounded-full p-2 hover:bg-white/20 transition"
            onClick={() => setShowVideoModal(false)}
            aria-label="إغلاق"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <div className="w-full max-w-4xl px-4" onClick={e => e.stopPropagation()}>
            <div className="relative aspect-video rounded-2xl overflow-hidden shadow-2xl">
              <VideoSurface url={content['home.video.url']} title="فيديو المعهد" autoplay />
            </div>
          </div>
        </div>
      )}

      {/* SECTION: Featured Instructors */}
      {featuredInstructors.length > 0 && (
      <section className="py-20 bg-gray-50 scroll-reveal">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <span className="text-secondary-600 font-bold tracking-wider text-sm uppercase">نخبة الخبراء</span>
            <h2 className="text-3xl font-bold text-gray-900 mt-2">المدربون والخبراء</h2>
            <p className="text-gray-500 mt-2">تعلم على يد أفضل الأطباء والمعالجين النفسيين في الوطن العربي</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {featuredInstructors.map(t => (
              <Link key={t.id} to={`/instructor/${t.id}`} className="group block bg-white rounded-2xl overflow-hidden shadow-md glow-card hover-float transition duration-300">
                <div className="relative h-64 overflow-hidden">
                  <img
                    src={t.image || `https://randomuser.me/api/portraits/men/${t.id}.jpg`}
                    alt={t.name}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
                  <div className="absolute bottom-4 right-4 left-4 text-white">
                    <p className="font-bold text-base leading-tight">{t.name}</p>
                    <p className="text-xs text-gray-300 mt-0.5">{t.title || t.specialty}</p>
                  </div>
                  {t.featured && (
                    <div className="absolute top-3 left-3 bg-secondary-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">★ مميز</div>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  {t.focusAreas && t.focusAreas.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {t.focusAreas.slice(0, 3).map((area, i) => (
                        <span key={i} className="text-[10px] bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full font-medium">{area}</span>
                      ))}
                    </div>
                  )}
                  {t.bio && <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{t.bio}</p>}
                  <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <GraduationCap size={12} className="text-primary-500" />
                      {t.experience} سنة خبرة
                    </span>
                    <span className="text-xs text-amber-500 font-bold flex items-center gap-1">
                      <Star size={11} fill="currentColor" />
                      {t.rating}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <div className="text-center mt-8">
            <Link to="/instructors" className="inline-flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-8 py-3 rounded-xl font-bold hover:bg-gray-50 transition">
              عرض جميع الخبراء <ChevronRight size={18} className="rtl:rotate-180" />
            </Link>
          </div>
        </div>
      </section>
      )}

      {/* SECTION: Express Consultation Banner — «اعرض قسم الاستشارة في الرئيسية» */}
      {content['consultation.show_on_home'] !== 'false' && (
      <section className="py-20 bg-white relative overflow-hidden">
        {/* Subtle background accents */}
        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-primary-50 rounded-full blur-[120px] opacity-60 -translate-x-1/2 -translate-y-1/2"></div>
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-secondary-50 rounded-full blur-[100px] opacity-50 translate-x-1/3 translate-y-1/3"></div>

        <div className="container mx-auto px-4 relative z-10">

          {/* Header */}
          <div className="text-center mb-12">
            <span className="inline-flex items-center gap-2 text-xs font-bold text-primary-600 bg-primary-50 border border-primary-100 px-4 py-1.5 rounded-full mb-4">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              متاح الآن — جلسة فورية
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-3">
              {content['home.express.title'] || 'تحدث مع معالج نفسي متخصص الآن'}
            </h2>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">
              {content['home.express.subtitle'] || 'جلسة خاصة عبر الإنترنت. احجز في دقائق واحصل على دعم فوري.'}
            </p>
          </div>

          {/* Main card — two columns */}
          <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-0 rounded-3xl overflow-hidden shadow-xl border border-gray-100">

            {/* LEFT: Therapist visual + features */}
            <div className="bg-gradient-to-br from-primary-700 to-primary-900 p-10 flex flex-col justify-between animate-float">
              {/* Icon: therapist at desk */}
              <div className="mb-8">
                <svg viewBox="0 0 120 100" className="w-40 h-32 mx-auto" fill="none" xmlns="http://www.w3.org/2000/svg">
                  {/* Desk */}
                  <rect x="10" y="72" width="100" height="6" rx="3" fill="white" fillOpacity="0.25"/>
                  <rect x="18" y="78" width="6" height="18" rx="2" fill="white" fillOpacity="0.2"/>
                  <rect x="96" y="78" width="6" height="18" rx="2" fill="white" fillOpacity="0.2"/>
                  {/* Monitor */}
                  <rect x="40" y="44" width="40" height="28" rx="4" fill="white" fillOpacity="0.2" stroke="white" strokeOpacity="0.4" strokeWidth="1.5"/>
                  <rect x="44" y="48" width="32" height="18" rx="2" fill="white" fillOpacity="0.12"/>
                  {/* Monitor stand */}
                  <rect x="57" y="72" width="6" height="4" fill="white" fillOpacity="0.2"/>
                  <rect x="52" y="74" width="16" height="2" rx="1" fill="white" fillOpacity="0.15"/>
                  {/* Person body */}
                  <ellipse cx="60" cy="35" rx="9" ry="10" fill="white" fillOpacity="0.9"/>
                  {/* Head */}
                  <circle cx="60" cy="20" r="9" fill="white" fillOpacity="0.9"/>
                  {/* Arms on desk */}
                  <path d="M51 42 Q42 52 38 65" stroke="white" strokeOpacity="0.7" strokeWidth="5" strokeLinecap="round"/>
                  <path d="M69 42 Q78 52 82 65" stroke="white" strokeOpacity="0.7" strokeWidth="5" strokeLinecap="round"/>
                  {/* Book/notebook on desk */}
                  <rect x="22" y="62" width="20" height="10" rx="2" fill="white" fillOpacity="0.3"/>
                  <rect x="24" y="64" width="16" height="1.5" rx="1" fill="white" fillOpacity="0.4"/>
                  <rect x="24" y="67" width="12" height="1.5" rx="1" fill="white" fillOpacity="0.4"/>
                  {/* Coffee cup */}
                  <rect x="82" y="62" width="10" height="10" rx="2" fill="white" fillOpacity="0.3"/>
                  <path d="M92 66 Q97 66 97 70" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" fill="none"/>
                </svg>
                <p className="text-white/60 text-xs text-center mt-1">معالجك ينتظرك</p>
              </div>

              {/* Feature list */}
              <div className="space-y-3">
                {[
                  { icon: <CheckCircle size={15}/>, text: 'خصوصية تامة ومحادثة آمنة' },
                  { icon: <Clock size={15}/>, text: 'استجابة خلال ساعات' },
                  { icon: <Award size={15}/>, text: 'معالجون معتمدون ومتخصصون' },
                  { icon: <Phone size={15}/>, text: 'فيديو أو صوت أو نص — اختيارك' },
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-3 text-white/90">
                    <span className="text-secondary-200 flex-shrink-0">{f.icon}</span>
                    <span className="text-sm">{f.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT: Price card */}
            <div className="bg-gray-50 p-10 flex flex-col justify-center items-center text-center animate-float" style={{animationDelay:'0.4s'}}>
              <p className="text-gray-400 text-sm mb-2 font-medium">سعر الجلسة الواحدة</p>

              {/* Price display */}
              <div className="flex items-end justify-center gap-2 mb-6">
                {expressPrice(content, currency) > 0 ? (<>
                  <span className="text-6xl font-extrabold text-gray-900 leading-none">
                    {expressPrice(content, currency).toLocaleString('ar-EG-u-nu-latn')}
                  </span>
                  <span className="text-2xl font-bold text-primary-600 mb-2">{currencySymbol}</span>
                </>) : (
                  <span className="text-2xl font-bold text-gray-700">احجز ونبلغك بالسعر</span>
                )}
              </div>

              {/* Session type badges */}
              <div className="flex flex-wrap gap-2 justify-center mb-8">
                {['جلسة فردية', 'سرية تامة', 'أونلاين'].map((tag, i) => (
                  <span key={i} className="text-xs bg-white border border-gray-200 text-gray-600 px-3 py-1 rounded-full font-medium">
                    {tag}
                  </span>
                ))}
              </div>

              <Link
                to="/consultations"
                className="w-full bg-primary-700 hover:bg-primary-800 text-white font-extrabold py-4 rounded-2xl transition shadow-md shadow-primary-200 text-lg mb-3 block"
              >
                احجز جلستك الآن
              </Link>
              <p className="text-gray-400 text-xs">{content['home.express.note'] || 'سيتواصل معك المعالج خلال ساعات'}</p>
            </div>
          </div>

        </div>
      </section>
      )}

      {/* SECTION: Testimonials */}
      <section className="py-24 bg-gray-50">
          <div className="container mx-auto px-4">
              <div className="text-center mb-16">
                  <h2 className="text-3xl font-bold text-gray-900 mb-4">{content['home.testimonials.title'] || 'ماذا يقول عملاؤنا؟'}</h2>
                  <p className="text-gray-500">{content['home.testimonials.subtitle'] || 'قصص نجاح حقيقية من خريجي المعهد'}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  {testimonials.map((testimonial) => (
                      <div key={testimonial.id} className="bg-white p-8 rounded-2xl border border-gray-100 relative hover:shadow-lg transition duration-300">
                          <Quote size={40} className="text-primary-200 absolute top-6 left-6" />
                          <p className="text-gray-700 leading-relaxed mb-6 relative z-10">
                              "{testimonial.text}"
                          </p>
                          <div className="flex items-center gap-4">
                              {testimonial.image ? <img src={cdnImg(testimonial.image, 120)} loading="lazy" className="w-12 h-12 rounded-full object-cover" alt={testimonial.name} /> : <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold text-sm">{(testimonial.name||'?')[0]}</div>}
                              <div>
                                  <h4 className="font-bold text-gray-900 text-sm">{testimonial.name}</h4>
                                  <p className="text-xs text-primary-600 font-medium">{testimonial.role}</p>
                              </div>
                          </div>
                      </div>
                  ))}
              </div>
          </div>
      </section>

      {/* Booking call to action — the page ends on the same goal it starts with */}
      <section className="bg-[#fffaf5] px-4 pb-16 pt-4 sm:pb-20">
        <div className="container relative mx-auto overflow-hidden rounded-[32px] bg-primary-600 px-5 py-12 text-center text-white sm:px-10 sm:py-14">
          <div aria-hidden="true" className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary-700" />
          <div className="relative">
            <h2 className="mb-3.5 text-3xl font-black leading-tight sm:text-5xl">جاهز تبدأ مسارك المهني؟</h2>
            <p className="mx-auto mb-7 max-w-xl text-base leading-relaxed text-primary-100 sm:text-lg">
              اختار برنامجك واحجز مكانك الآن، كاش بخصم أكبر أو بالتقسيط. وفريقنا معاك في كل خطوة.
            </p>
            <div className="flex flex-col items-stretch justify-center gap-3.5 sm:flex-row sm:items-center">
              <Link to="/enroll" className="inline-flex min-h-[56px] items-center justify-center rounded-2xl bg-white px-9 text-lg font-black text-primary-700 transition hover:bg-primary-50">احجز مكانك الآن</Link>
              <Link to="/courses" className="inline-flex min-h-[56px] items-center justify-center rounded-2xl border-[1.5px] border-white/70 px-8 text-lg font-extrabold text-white transition hover:bg-white/10">تصفح الكورسات</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Hiring and contact slide — «هل لديك استفسار؟ تواصل معنا», lecturer and job applications; right before the footer */}
      <section id="join" className="relative scroll-mt-24 overflow-hidden bg-[#1b0a12] py-16 text-white sm:py-20">
        <div aria-hidden="true" className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary-600 opacity-25" />
        <div className="container relative mx-auto px-4 text-center">
          <span className="text-sm font-extrabold tracking-wide text-amber-300">فرص العمل والتواصل</span>
          <h2 className="mb-3.5 mt-2 text-3xl font-black leading-tight sm:text-4xl">هل لديك استفسار؟ تواصل معنا</h2>
          <p className="mx-auto mb-8 max-w-xl text-base leading-relaxed text-white/75 sm:text-lg">
            فريقنا مستعد للإجابة على جميع أسئلتك عن البرامج والاشتراكات والاستشارات النفسية.
          </p>
          <div className="mx-auto grid max-w-3xl gap-3.5 sm:grid-cols-3">
            <Link to="/contact" className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-2xl bg-white px-6 font-black text-primary-700 shadow transition hover:-translate-y-0.5 hover:bg-primary-50">
              <Phone size={18} />
              تواصل معنا
            </Link>
            <Link to="/join" className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-2xl border border-white/30 bg-white/10 px-6 font-bold transition hover:-translate-y-0.5 hover:bg-white/20">
              <GraduationCap size={18} />
              انضم إلينا كمحاضر
            </Link>
            <Link to="/join-us" className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-2xl border border-white/30 bg-white/10 px-6 font-bold transition hover:-translate-y-0.5 hover:bg-white/20">
              <Briefcase size={18} />
              انضم إلينا كموظف
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
