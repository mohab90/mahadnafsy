import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Check, PlayCircle, Calendar, Award, MessageCircle, Share2, AlertCircle, ChevronDown, ChevronUp, Users, Play, FileText, Send, Lock, Star, Quote, X, Gift, ShieldCheck, Clock, HelpCircle } from 'lucide-react';
import { LeadItem } from '../types';
import { useSiteData } from '../context/SiteDataContext';
import { SafeHtml } from '../components/SafeHtml';
import { mysqlClient, mysqlCatalog } from '../lib/mysqlapi';

// Default FAQ — editable from لوحة التحكم → صفحات الموقع → صفحة الكورسات (key: courseDetails.faqList).
// Format: one "السؤال :: الجواب" per line.
const DEFAULT_FAQ = [
  'هل الشهادة معتمدة وموثّقة؟ :: نعم، شهاداتنا معتمدة وموثّقة برقم تسلسلي، ويمكن توثيقها من جهات خارجية حسب البرنامج.',
  'المحتوى مسجّل أم مباشر؟ :: حسب نوع البرنامج (مسجّل / مباشر / هجين) موضّح أعلى الصفحة، والمسجّل تقدر تشاهده في أي وقت.',
  'كم مدة الوصول للمحتوى؟ :: وصول كامل لمدة سنة من تاريخ الاشتراك.',
  'هل يوجد تقسيط؟ :: نعم، نوفّر خطط تقسيط مرنة — تواصل معنا على واتساب لمعرفة التفاصيل.',
  'ماذا لو لم يناسبني البرنامج؟ :: لديك ضمان استرداد خلال 7 أيام إن لم يكن البرنامج مناسباً لك.',
  'هل أحصل على دعم أثناء الدراسة؟ :: نعم، دعم مستمر عبر المجتمع والواتساب طوال فترة البرنامج.',
].join('\n');

const CourseDetails: React.FC = () => {
                const { courses, subscribers, discounts, addPublicLead, getCourseLectures, getCourseChapters, content: globalContent, testimonials, currency, authUser, bundles, mySubscriberLoaded, refreshMySubscriber } = useSiteData();
  const { id, slug } = useParams<{ id: string; slug: string }>();
  const navigate = useNavigate();
    // Support both /course/:id and /c/:slug routes
    const courseFromCtx = courses.find(c => c.id === (id ?? slug) || c.slug === (slug ?? id));
  // API fallback: if course not in context (e.g. unpublished preview or freshly added),
  // fetch directly from /api/courses/:id which returns regardless of is_published status
  const [apiFallbackCourse, setApiFallbackCourse] = useState<typeof courses[0] | null>(null);
  const [apiFallbackLectures, setApiFallbackLectures] = useState<ReturnType<typeof getCourseLectures>>([]);
  const [apiFallbackChapters, setApiFallbackChapters] = useState<ReturnType<typeof getCourseChapters>>([]);
  // Whether the direct API fallback has finished trying — distinguishes "still loading"
  // from "genuinely not found", so freshly-added courses (not yet in the cached list)
  // show a loader instead of flashing "الكورس غير موجود".
  const [fallbackTried, setFallbackTried] = useState(false);
  useEffect(() => {
    setFallbackTried(false);
    if (courseFromCtx) { setApiFallbackCourse(null); return; }
    const lookup = id ?? slug;
    if (!lookup) { setFallbackTried(true); return; }
    mysqlCatalog.getCourse(lookup).then(data => {
      if (!data?.id) return;
      setApiFallbackCourse(data as unknown as typeof courses[0]);
      setApiFallbackLectures(((data.lectures || []) as unknown as ReturnType<typeof getCourseLectures>));
      setApiFallbackChapters(((data.chapters || []) as unknown as ReturnType<typeof getCourseChapters>));
    }).catch(() => {}).finally(() => setFallbackTried(true));
  }, [id, slug, courseFromCtx]);
  const course = courseFromCtx ?? apiFallbackCourse;
  const [showLeadForm, setShowLeadForm] = useState(true);
    const [selectedLectureId, setSelectedLectureId] = useState('');
    // Resolved playable URL — paid lectures no longer ship their URL publicly; fetched on demand.
    const [resolvedLectureUrl, setResolvedLectureUrl] = useState('');
    const [lectureGateNotice, setLectureGateNotice] = useState('');
    const [leadName, setLeadName] = useState('');
    const [leadPhone, setLeadPhone] = useState('');
    const [leadBranch, setLeadBranch] = useState('');
    const [leadNotice, setLeadNotice] = useState('');
    const [showPromoModal, setShowPromoModal] = useState(false);
    const [galleryLightboxIdx, setGalleryLightboxIdx] = useState<number | null>(null);

        const content = course ? { ...globalContent, ...(course.detailsContent || {}) } : globalContent;
        const promoVideoUrl = course ? (course.promoVideoUrl || content['courseDetails.promo.videoUrl'] || '') : '';
        const galleryImages = course?.galleryImages && course.galleryImages.length > 0
            ? course.galleryImages
            : [];
        const certificateTemplateUrl = course ? (course.certificateTemplateUrl || content['courseDetails.gallery.certificateUrl'] || '') : '';

  const currentPrice = course?.price[currency] ?? 0;
  const oldPrice = course?.originalPrice[currency] ?? 0;
  const currencySymbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';

  // Find applicable discount rule (course-specific takes priority over all_courses)
  const now = new Date();
  const applicableDiscount = course
    ? (discounts.find(d => d.active && d.type === 'course' && d.targetId === course.id && (!d.expiresAt || new Date(d.expiresAt) >= now)) ??
    discounts.find(d => d.active && d.type === 'all_courses' && (!d.expiresAt || new Date(d.expiresAt) >= now)))
    : undefined;
  const discountedPrice = applicableDiscount ? Math.round(currentPrice * (1 - applicableDiscount.discountPercent / 100)) : null;
  // Cash discount (applied on checkout for direct online payment)
  const cashDiscountPct = Number(globalContent['checkout.cashDiscountPercent'] || 0);
  const basePrice = discountedPrice !== null ? discountedPrice : currentPrice;
  const cashPrice = cashDiscountPct > 0 ? Math.round(basePrice * (1 - cashDiscountPct / 100)) : null;
        const chapters = course ? (courseFromCtx ? getCourseChapters(course.id) : apiFallbackChapters) : [];
        const lectures = course ? (courseFromCtx ? getCourseLectures(course.id) : apiFallbackLectures) : [];
        const subscriber = authUser?.email
            ? subscribers.find((row) =>
                row.email.toLowerCase() === authUser.email!.toLowerCase()
              )
            : undefined;
        // subscriberLoading: logged in but subscriber data not fetched yet — avoid flashing "Preview"
        const subscriberLoading = !!authUser && !mySubscriberLoaded;
        const rawAccess = course ? subscriber?.courseAccess?.[course.id] : undefined;
        // isEnrolled: subscriber has this course in their enrolledCourseIds list
        const isEnrolled = !!(course && subscriber && subscriber.enrolledCourseIds?.includes(String(course.id)));
        // accessMode: explicit limited/full from courseAccess takes priority over enrollment status
        const accessMode: 'preview' | 'full' | 'limited' =
            typeof rawAccess === 'object' && rawAccess !== null && rawAccess.mode === 'limited'
                ? 'limited'
                : rawAccess === 'full' || (typeof rawAccess === 'object' && rawAccess !== null && rawAccess.mode === 'full')
                    ? 'full'
                    : rawAccess === 'preview'
                        ? 'preview'
                        : isEnrolled
                            ? 'full'   // enrolled with no explicit limit = full access
                            : 'preview';
        const previewLimitRaw = Number(content['courseDetails.previewLectureLimit'] || 1);
        const previewLimit = Number.isFinite(previewLimitRaw) && previewLimitRaw > 0 ? Math.floor(previewLimitRaw) : 2;
        const limitedCountRaw = typeof rawAccess === 'object' ? Number(rawAccess.lectureLimit || 1) : 1;
        const limitedCount = Number.isFinite(limitedCountRaw) && limitedCountRaw > 0 ? Math.floor(limitedCountRaw) : 1;
        const unlockedLectureCount =
            subscriberLoading
                ? lectures.length  // while loading, show all unlocked (prevents false-lock flash)
                : accessMode === 'full'
                    ? lectures.length
                    : accessMode === 'limited'
                        ? Math.min(limitedCount, lectures.length)
                        : Math.min(previewLimit, lectures.length);
        // Is the current user subscribed to this course?
        const isSubscribed = !!subscriber && course ? subscriber.enrolledCourseIds?.includes(String(course.id)) ?? false : false;
        const lecturesWithLock = useMemo(
            () => lectures.map((lecture, index) => ({
                ...lecture,
                locked: accessMode !== 'full' && index >= unlockedLectureCount,
            })),
            [lectures, accessMode, unlockedLectureCount]
        );
        const selectedLecture = useMemo(
            () => lecturesWithLock.find((lecture) => lecture.id === selectedLectureId) || null,
            [lecturesWithLock, selectedLectureId]
        );
    // Resolve the playable URL: preview lectures carry it; paid (unlocked) ones are fetched
    // on demand from the auth-gated endpoint (the public catalog withholds paid URLs).
    useEffect(() => {
        let cancelled = false;
        setResolvedLectureUrl('');
        if (!selectedLecture || selectedLecture.locked) return;
        if (selectedLecture.videoUrl) { setResolvedLectureUrl(selectedLecture.videoUrl); return; }
        mysqlClient.getLectureAccess(selectedLecture.id)
            .then(r => { if (!cancelled && r.accessible && r.video_url) setResolvedLectureUrl(r.video_url); })
            .catch(() => {});
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedLectureId, selectedLecture?.locked, selectedLecture?.videoUrl]);
    const curriculumItems = lectures.length > 0 ? lectures.map((l) => l.title) :
      course?.courseModules ? course.courseModules.map((m) => m.title) : (course?.modules ?? []);

    useEffect(() => {
        const firstOpen = lecturesWithLock.find((lecture) => !lecture.locked);
        if (!firstOpen) {
            setSelectedLectureId('');
            return;
        }
        setSelectedLectureId((prev) => (prev && lecturesWithLock.some((lecture) => lecture.id === prev && !lecture.locked) ? prev : firstOpen.id));
    }, [course?.id, unlockedLectureCount, accessMode, lecturesWithLock]);

    // Refresh subscriber data when this page mounts (ensures fresh enrollment status, especially on mobile)
    useEffect(() => {
        if (authUser) refreshMySubscriber();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authUser?.uid]);

    // NOTE: the `if (!course)` loader/not-found guard was moved to just before the main
    // render below. It MUST come after every hook call — otherwise the hooks declared
    // later in this component (ratings, upsell, SEO, completion…) are skipped while the
    // course is still resolving, then run once it loads → "Rendered more hooks than during
    // the previous render" (React #310) crash. Keep all hooks above the guard.

    // --- deobfuscate stored video URL ---
    const _vk2 = '\x6d\x68\x64\x2d\x6e\x61\x66\x73\x79\x2d\x32\x30\x32\x36';
    const deobfV2 = (raw: string): string => {
        if (!raw || !raw.startsWith('enc:')) return raw;
        try {
            return atob(raw.slice(4)).split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ _vk2.charCodeAt(i % _vk2.length))).join('');
        } catch { return raw; }
    };

    const getEmbedUrl = (url: string) => {
        const plain = deobfV2(url);
        if (!plain) return '';
        // controls=1: required — YouTube blocks playback (Error 153) if controls=0
        // modestbranding=1: minimal branding in controls bar
        // rel=0: no related videos at end
        // iv_load_policy=3: no annotations
        // playsinline=1: mobile inline play
        // NOTE: enablejsapi removed — causes Error 153 when referrer is not set
        const params = '?autoplay=0&controls=1&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3&color=white&playsinline=1';
        if (plain.includes('youtube.com/watch?v=')) {
            const videoId = new URL(plain).searchParams.get('v') || '';
            return `https://www.youtube-nocookie.com/embed/${videoId}${params}`;
        }
        if (plain.includes('youtu.be/')) {
            const videoId = plain.split('youtu.be/')[1]?.split('?')[0] || '';
            return `https://www.youtube-nocookie.com/embed/${videoId}${params}`;
        }
        if (plain.includes('youtube.com/embed/')) {
            const videoId = plain.split('embed/')[1]?.split('?')[0] || '';
            return `https://www.youtube-nocookie.com/embed/${videoId}${params}`;
        }
        return plain;
    };

  const handleBuyNow = () => {
    if (!course) return;
    navigate(`/checkout?type=course&id=${course.id}`);
  };

    const handleLeadSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!course) return;
        if (!leadName.trim() || !leadPhone.trim() || !leadBranch.trim()) {
            setLeadNotice('يرجى استكمال الاسم ورقم الهاتف والفرع.');
            return;
        }

        const generatedEmail = `${leadPhone.replace(/\D/g, '') || Date.now()}@lead.local`;
        const payload = {
            id: `l-${Date.now()}`,
            name: leadName.trim(),
            email: generatedEmail,
            phone: leadPhone.trim(),
            source: 'تسجيل اهتمام',
            status: 'new' as const,
            leadType: 'course' as const,
            enrolledCourseId: course.id,
            interestedCourseIds: [course.id],
            branch: leadBranch as LeadItem['branch'],
            interestLevel: 'high' as const,
            assignedSalesId: '',
            assignedSalesName: '',
            communications: [],
            notes: '',
            createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        };

        addPublicLead(payload);
        setLeadName('');
        setLeadPhone('');
        setLeadBranch('');
        setLeadNotice('تم تسجيل بياناتك وسيتم التواصل معك خلال 48 ساعة من خدمة العملاء.');
    };

  // ── Course rating state ────────────────────────────────────────────────────
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [ratingData, setRatingData] = useState<{ avg: number; count: number; myRating: { rating: number; comment: string } | null } | null>(null);
  const [hoverStar, setHoverStar] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingNotice, setRatingNotice] = useState('');

  useEffect(() => {
    if (!course?.id) return;
    mysqlClient.getCourseRatings(course.id)
      .then(data => { setRatingData(data); if (data.myRating) setRatingComment(data.myRating.comment || ''); })
      .catch(() => {});
  }, [course?.id]);

  const handleSubmitRating = async (star: number) => {
    if (!isEnrolled || ratingSubmitting) return;
    setRatingSubmitting(true);
    try {
      const res = await mysqlClient.rateCourse(course.id, star, ratingComment) as any;
      setRatingData(prev => ({ avg: res.avg, count: res.count, myRating: { rating: star, comment: ratingComment } }));
      setRatingNotice('شكراً! تم حفظ تقييمك.');
    } catch { setRatingNotice('حدث خطأ، حاول مجدداً.'); }
    setRatingSubmitting(false);
  };

  // ── Upsell popup: show when enrolled user opens a lecture ─────────────────
  const [showUpsell, setShowUpsell] = useState(false);
  const [completionCert, setCompletionCert] = useState<string | null>(null);

  // Bundles containing this course (for upsell)
  const relatedBundles = useMemo(() => {
    if (!course || !bundles) return [];
    return bundles.filter(b => (b.courses?.map(c => c.id) ?? []).includes(course.id) && !subscriber?.enrolledCourseIds?.some(eid => (b.courses?.map(c => c.id) ?? []).includes(eid) && eid !== course.id));
  }, [course, bundles, subscriber]);

  // Track lecture view when a lecture is selected
  const prevLectureRef = React.useRef<string>('');
  useEffect(() => {
    if (selectedLectureId && selectedLectureId !== prevLectureRef.current && !selectedLecture?.locked) {
      prevLectureRef.current = selectedLectureId;
      mysqlClient.trackLectureView(selectedLectureId).catch(() => {});
    }
  }, [selectedLectureId, selectedLecture?.locked]);

  // ── SEO meta tags ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!course) return;
    const seoTitle = (course as any).seo_title || course.title || 'مهاد نفسي';
    const seoDesc  = (course as any).seo_description || course.shortDescription?.replace(/<[^>]*>/g,'').slice(0,160) || '';
    const seoKw    = (course as any).seo_keywords || '';
    document.title = seoTitle + ' — مهاد نفسي';
    const setMeta = (name: string, content: string) => {
      let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!el) { el = document.createElement('meta'); el.name = name; document.head.appendChild(el); }
      el.content = content;
    };
    const setOg = (prop: string, content: string) => {
      let el = document.querySelector(`meta[property="${prop}"]`) as HTMLMetaElement | null;
      if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el); }
      el.content = content;
    };
    if (seoDesc)  { setMeta('description', seoDesc); setOg('og:description', seoDesc); }
    if (seoKw)    setMeta('keywords', seoKw);
    setOg('og:title', seoTitle);
    if (course.thumbnail) setOg('og:image', course.thumbnail);
    setOg('og:type', 'article');
    return () => { document.title = 'مهاد نفسي'; };
  }, [course]);


  // Detect course completion: all unlocked lectures have progress ≥ 90%
  useEffect(() => {
    if (!isEnrolled || !subscriber || lectures.length === 0) return;
    const lp = subscriber.lectureProgress || {};
    const allDone = lectures.every(l => (lp[l.id] as number || 0) >= 90);
    if (allDone && !completionCert) {
      mysqlClient.getMyCompletions().then(completions => {
        const mine = (completions as any[]).find(c => c.course_id === course.id);
        if (mine) { setCompletionCert(mine.certificate_code); setShowUpsell(true); }
      }).catch(() => {});
    }
  }, [subscriber?.lectureProgress, isEnrolled, lectures, course?.id]);

  // Loader / not-found guard — placed AFTER all hooks (see note above) to satisfy Rules of Hooks.
  if (!course) {
    // Still resolving (context list not loaded yet, or direct API fallback in-flight) → loader, not an error.
    if (!fallbackTried) {
      return (
        <div className="flex flex-col items-center justify-center py-32 gap-3 text-gray-400">
          <div className="w-10 h-10 border-4 border-gray-200 border-t-primary-600 rounded-full animate-spin"></div>
          <p className="text-sm">{globalContent['common.loading'] || 'جارٍ التحميل...'}</p>
        </div>
      );
    }
    return <div className="text-center py-20">{globalContent['courseDetails.notFound'] || 'الكورس غير موجود'}</div>;
  }

  return (
    <div className="bg-white animate-fade-in pb-20 lg:pb-0">
      {/* Header Banner */}
      <div className="bg-gray-900 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary-900 via-primary-800 to-gray-900 opacity-95 z-10"></div>
        <img loading="lazy" decoding="async" src={course.thumbnail} alt={course.title} className="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-overlay" />
        
        <div className="container mx-auto px-4 py-12 md:py-16 relative z-20">
          <div className="flex flex-col lg:flex-row gap-12 items-start">
            {/* Left Content */}
            <div className="flex-1">
              <div className="flex gap-3 mb-6">
                 <span className="bg-secondary-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg shadow-secondary-500/20">{course.level}</span>
                 <span className="bg-white/10 backdrop-blur border border-white/20 text-white text-xs font-bold px-3 py-1 rounded-full">{course.category === 'Therapy' ? (content['courseDetails.category.therapy'] || 'علاج نفسي') : (content['courseDetails.category.general'] || 'صحة نفسية')}</span>
              </div>
              <h1 className="text-3xl md:text-5xl font-extrabold mb-6 leading-tight">{course.title}</h1>
                            <SafeHtml
                                html={course.shortDescription || ''}
                                className="text-lg md:text-xl text-gray-200 mb-8 leading-relaxed max-w-2xl border-r-4 border-secondary-500 pr-4"
                            />
              
              <div className="flex flex-wrap gap-6 mb-8 text-sm font-medium">
                <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-lg backdrop-blur-sm">
                  <PlayCircle size={18} className="text-secondary-400" />
                                    <span>{course.type === 'Mix' ? (content['courseDetails.type.mix'] || 'نظام هجين (مسجل + لايف)') : course.type === 'Live' ? (content['courseDetails.type.live'] || 'بث مباشر تفاعلي') : (content['courseDetails.type.recorded'] || 'مسجل بجودة عالية')}</span>
                </div>
                <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-lg backdrop-blur-sm">
                  <Users size={18} className="text-secondary-400" />
                                    <span>{course.students} {content['courseDetails.studentsSuffix'] || 'طالب مشترك'}</span>
                </div>
                <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-lg backdrop-blur-sm">
                    <Award size={18} className="text-secondary-400" />
                                        <span>{content['courseDetails.certificateBadge'] || 'شهادة معتمدة'}</span>
                </div>
              </div>
              
              <div className="flex items-center gap-4 bg-gray-800/50 p-4 rounded-xl border border-gray-700 w-fit">
                 <img loading="lazy" decoding="async" src={`https://ui-avatars.com/api/?name=${course.instructor}&background=random`} className="w-12 h-12 rounded-full border-2 border-secondary-500" alt={course.instructor} />
                 <div>
                          <p className="text-xs text-gray-400">{content['courseDetails.instructorLabel'] || 'مدرب الدبلومة'}</p>
                    <p className="font-bold text-white text-lg">{course.instructor}</p>
                 </div>
              </div>
            </div>

            {/* Right Card (Pricing) - Desktop Only */}
            <div className="hidden lg:block w-96 relative">
               <div className="bg-white text-gray-900 rounded-2xl p-6 shadow-2xl border-t-8 border-primary-600 sticky top-24">
                  <div className="mb-6 text-center border-b pb-4 border-gray-100">
                    <p className="text-gray-400 text-sm line-through mb-1">{content['courseDetails.price.originalLabel'] || 'السعر الرسمي:'} {discountedPrice !== null ? currentPrice : oldPrice} {currencySymbol}</p>
                    <div className="flex justify-center items-center gap-3">
                        <span className="text-4xl font-extrabold text-primary-600">{discountedPrice !== null ? discountedPrice : currentPrice} <span className="text-xl">{currencySymbol}</span></span>
                    </div>
                    {applicableDiscount ? (
                      <span className="bg-red-100 text-red-600 text-xs font-bold px-3 py-1 rounded-full mt-2 inline-block">
                        خصم {applicableDiscount.discountPercent}%{applicableDiscount.label ? ` — ${applicableDiscount.label}` : ''}
                      </span>
                    ) : (
                      <span className="bg-red-100 text-red-600 text-xs font-bold px-3 py-1 rounded-full mt-2 inline-block">{content['courseDetails.price.discountBadge'] || 'خصم لفترة محدودة'}</span>
                    )}
                  </div>

                  {isSubscribed ? (
                    <div className="w-full bg-green-50 border-2 border-green-500 text-green-700 font-bold py-4 rounded-xl mb-3 flex justify-center items-center gap-2 text-lg">
                      <Check size={22} className="text-green-600" />
                      أنت مشترك في هذا الكورس
                    </div>
                  ) : (
                    <>
                      <button onClick={handleBuyNow} className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-4 rounded-xl mb-3 transition shadow-lg shadow-primary-500/30 text-lg flex justify-center items-center gap-2">
                        {content['courseDetails.price.cta'] || 'احجز الآن واستفد بخصم إضافي'}
                        <Check size={20} />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setTimeout(() => document.getElementById('lead-form')?.scrollIntoView({ behavior: 'smooth' }), 100)}
                    className="w-full bg-white border-2 border-primary-600 text-primary-700 font-bold py-3 rounded-xl mb-4 transition hover:bg-primary-50 flex justify-center items-center gap-2"
                  >
                    <Send size={18} />
                    سجل بياناتك للتواصل
                  </button>
                  
                  <div className="space-y-3 text-sm text-gray-600 mb-6 bg-gray-50 p-4 rounded-lg">
                                         <p className="flex items-center gap-2"><Check size={16} className="text-green-500" /> {content['courseDetails.price.feature1'] || 'وصول لمدة سنة واحدة للمحتوى'}</p>
                                         <p className="flex items-center gap-2"><Check size={16} className="text-green-500" /> {content['courseDetails.price.feature2'] || 'شهادة إتمام موثقة برقم تسلسلي'}</p>
                                         <p className="flex items-center gap-2"><Check size={16} className="text-green-500" /> {content['courseDetails.price.feature3'] || 'المادة العلمية + نماذج العمل'}</p>
                  </div>

                  {/* Trust strip — guarantee + limited seats (editable: لوحة التحكم → صفحات الموقع → صفحة الكورسات) */}
                  <div className="space-y-2 mb-4">
                    <div className="flex items-start gap-2 bg-green-50 border border-green-100 rounded-xl px-3 py-2 text-xs text-green-800">
                      <ShieldCheck size={15} className="shrink-0 mt-0.5 text-green-600" />
                      <span>{content['courseDetails.guaranteeText'] || 'ضمان استرداد خلال 7 أيام إن لم يناسبك البرنامج — اشترك بثقة.'}</span>
                    </div>
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-xs text-amber-800">
                      <Clock size={15} className="shrink-0 mt-0.5 text-amber-600" />
                      <span>{content['courseDetails.seatsNote'] || 'المقاعد محدودة لكل دفعة لضمان جودة المتابعة — احجز مكانك مبكراً.'}</span>
                    </div>
                  </div>

                  <div className="flex justify-center gap-4">
                      <button className="text-gray-500 hover:text-primary-600 text-sm flex items-center gap-1 transition">
                                                    <Share2 size={16} /> {content['courseDetails.actions.share'] || 'مشاركة'}
                      </button>
                      <a href={`https://wa.me/${(content['footer.whatsapp'] || '201096203090').replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-green-600 text-sm flex items-center gap-1 transition">
                                                    <MessageCircle size={16} /> {content['courseDetails.actions.whatsapp'] || 'استفسار واتساب'}
                      </a>
                  </div>
               </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            <div className="lg:col-span-2 space-y-12">
                
                {/* Marketing Video Section */}
                <section
                    className="rounded-2xl overflow-hidden shadow-lg border border-gray-100 relative bg-black group cursor-pointer aspect-video flex items-center justify-center"
                    onClick={() => promoVideoUrl && setShowPromoModal(true)}
                >
                    {course.thumbnail && <img loading="lazy" decoding="async" src={course.thumbnail} className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-40 transition duration-500" alt="Video cover" />}
                    <div className="relative z-10 w-20 h-20 bg-primary-600/90 rounded-full flex items-center justify-center text-white shadow-xl group-hover:scale-110 transition duration-300">
                        <Play size={32} fill="currentColor" className="ml-1" />
                    </div>
                    <div className="absolute bottom-6 right-6 text-white z-10">
                        <h3 className="font-bold text-xl">{content['courseDetails.promo.title'] || 'شاهد مقدمة تعريفية'}</h3>
                        <p className="text-sm text-gray-200">{content['courseDetails.promo.subtitle'] || 'تعرف على محتويات الدبلومة في دقيقتين'}</p>
                    </div>
                    {!promoVideoUrl && (
                        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                            <span className="bg-black/50 text-white/70 text-xs px-3 py-1.5 rounded-full">سيتوفر قريباً</span>
                        </div>
                    )}
                </section>

                {/* Promo Video Modal */}
                {showPromoModal && promoVideoUrl && (
                    <div
                        className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
                        onClick={() => setShowPromoModal(false)}
                    >
                        <div
                            className="relative w-full max-w-3xl aspect-video"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                onClick={() => setShowPromoModal(false)}
                                className="absolute -top-10 left-0 text-white text-sm font-bold bg-white/20 px-3 py-1 rounded-full hover:bg-white/40 transition z-10"
                            >
                                ✕ إغلاق
                            </button>
                            <iframe
                                src={getEmbedUrl(promoVideoUrl) + '&autoplay=1'}
                                className="w-full h-full rounded-xl"
                                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                                allowFullScreen
                                referrerPolicy="strict-origin-when-cross-origin"
                                title="Promo Video"
                            />
                        </div>
                    </div>
                )}

                {/* Pain Points & Solution */}
                <section className="bg-red-50 p-8 rounded-2xl border border-red-100">
                    <h2 className="text-2xl font-bold mb-6 text-gray-900 flex items-center gap-2">
                        <AlertCircle className="text-primary-600" />
                        {content['courseDetails.pain.title'] || 'هل هذه الدبلومة لك؟'}
                    </h2>
                    <div className="grid md:grid-cols-2 gap-6">
                        <div>
                            <h3 className="font-bold text-gray-800 mb-3">{content['courseDetails.pain.leftTitle'] || 'إذا كنت تعاني من:'}</h3>
                            <ul className="space-y-2">
                                <li className="flex gap-2 text-gray-600 text-sm">
                                    <span className="text-red-500">✕</span>
                                    {content['courseDetails.pain.left1'] || 'صعوبة في تطبيق النظريات عملياً داخل العيادة.'}
                                </li>
                                <li className="flex gap-2 text-gray-600 text-sm">
                                    <span className="text-red-500">✕</span>
                                    {content['courseDetails.pain.left2'] || 'عدم الثقة في التشخيص وصياغة الحالة.'}
                                </li>
                                <li className="flex gap-2 text-gray-600 text-sm">
                                    <span className="text-red-500">✕</span>
                                    {content['courseDetails.pain.left3'] || 'نقص الأدوات والفنيات العلاجية الحديثة.'}
                                </li>
                            </ul>
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-800 mb-3">{content['courseDetails.pain.rightTitle'] || 'فإن هذه الدبلومة ستمنحك:'}</h3>
                            <ul className="space-y-2">
                                <li className="flex gap-2 text-gray-600 text-sm">
                                    <Check className="text-green-500" size={18} />
                                    {content['courseDetails.pain.right1'] || 'تدريب عملي مكثف ورول بلاي (Role Play).'}
                                </li>
                                <li className="flex gap-2 text-gray-600 text-sm">
                                    <Check className="text-green-500" size={18} />
                                    {content['courseDetails.pain.right2'] || 'نماذج جاهزة لصياغة الحالة والتقييم.'}
                                </li>
                                <li className="flex gap-2 text-gray-600 text-sm">
                                    <Check className="text-green-500" size={18} />
                                    {content['courseDetails.pain.right3'] || 'ثقة كاملة لإدارة الجلسات العلاجية.'}
                                </li>
                            </ul>
                        </div>
                    </div>
                </section>

                {/* About */}
                <section>
                    <h2 className="text-2xl font-bold mb-4 text-gray-900 border-r-4 border-primary-600 pr-3">{content['courseDetails.about.title'] || 'تفاصيل البرنامج التدريبي'}</h2>
                    <div className="prose max-w-none text-gray-600 leading-loose">
                        <SafeHtml html={course.description || ''} />
                        <p className="mt-4">
                            {content['courseDetails.about.extraParagraph'] || 'تم تصميم هذا المنهج ليناسب المعايير الدولية في التدريب النفسي، حيث نركز على الجانب التطبيقي بنسبة 70% مقابل 30% للجانب النظري. ستحصل على حقيبة تدريبية كاملة تحتوي على المقاييس، استمارات التقييم، ودليل المعالج.'}
                        </p>
                    </div>
                </section>

                {/* Lecture Player with Access Control */}
                <section className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                        <h2 className="text-2xl font-bold text-gray-900 border-r-4 border-primary-600 pr-3">{content['courseDetails.player.title'] || 'تشغيل المحاضرات'}</h2>
                                                <div className={`px-3 py-1 rounded-full text-xs font-bold ${subscriberLoading ? 'bg-gray-100 text-gray-400' : accessMode === 'full' ? 'bg-green-100 text-green-700' : accessMode === 'limited' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                                                        {subscriberLoading
                                                            ? '⏳ جاري التحقق...'
                                                            : accessMode === 'full'
                                                            ? (content['courseDetails.player.fullBadge'] || 'صلاحية كاملة Full')
                                                            : accessMode === 'limited'
                                                                ? (content['courseDetails.player.limitedBadge'] || `صلاحية Limited - عدد ${unlockedLectureCount} محاضرة`)
                                                                : (content['courseDetails.player.previewBadge'] || `صلاحية Preview - أول ${unlockedLectureCount} محاضرة`)}
                        </div>
                    </div>

                    {lecturesWithLock.length === 0 && (
                        <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl p-4">
                            {content['courseDetails.player.empty'] || 'لا توجد محاضرات مضافة لهذا الكورس حتى الآن.'}
                        </div>
                    )}

                    {lecturesWithLock.length > 0 && (
                        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
                            <div
                                className="rounded-xl border border-gray-200 overflow-hidden bg-black aspect-video relative"
                                onContextMenu={(e) => e.preventDefault()}
                            >
                                {selectedLecture && !selectedLecture.locked ? (
                                    !resolvedLectureUrl ? (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white/70">
                                            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mb-3"></div>
                                            <p className="text-sm">جاري تحميل الفيديو...</p>
                                        </div>
                                    ) : (resolvedLectureUrl || '').includes('youtube.com') || (resolvedLectureUrl || '').includes('youtu.be') || (resolvedLectureUrl || '').startsWith('enc:') ? (
                                        <div className="relative w-full h-full">
                                          <iframe
                                            src={getEmbedUrl(resolvedLectureUrl)}
                                            className="w-full h-full"
                                            allow="autoplay; encrypted-media; fullscreen"
                                            allowFullScreen
                                            title={selectedLecture.title}
                                          />
                                          {/* Block YouTube channel name (top-left) — pointer-events:auto prevents clicking it */}
                                          <div className="absolute top-0 left-0 h-14 w-56 z-20 cursor-default" style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.92) 60%, transparent)' }} onClick={(e) => e.preventDefault()} />
                                          {/* Block YouTube logo (bottom-right) — pointer-events:auto prevents clicking it */}
                                          <div className="absolute bottom-0 right-0 h-10 w-44 z-20 cursor-default" style={{ background: 'linear-gradient(to left, rgba(0,0,0,0.92) 60%, transparent)' }} onClick={(e) => e.preventDefault()} />
                                          {/* Watermark */}
                                          <div className="absolute inset-0 z-10 pointer-events-none select-none overflow-hidden" aria-hidden="true">
                                            {Array.from({ length: 3 }, (_, row) =>
                                              Array.from({ length: 2 }, (_, col) => (
                                                <span
                                                  key={`wm-${row}-${col}`}
                                                  className="absolute text-white/25 text-[9px] font-semibold rotate-[-25deg] whitespace-nowrap"
                                                  style={{ top: `${15 + row * 28}%`, left: `${col * 55}%` }}
                                                >
                                                  {authUser?.email || 'معهد الدراسات النفسية'}
                                                </span>
                                              ))
                                            ).flat()}
                                          </div>
                                        </div>
                                    ) : (
                                        <video className="w-full h-full" controls src={resolvedLectureUrl} />
                                    )
                                ) : (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-5 relative">
                                        {selectedLecture?.thumbnail ? (
                                            <img loading="lazy" decoding="async" src={selectedLecture.thumbnail} className="absolute inset-0 w-full h-full object-cover opacity-30" alt="" />
                                        ) : null}
                                        <div className="relative z-10">
                                            <Lock className="mx-auto mb-2 text-white/90" size={28} />
                                            <p className="text-white font-bold">{content['courseDetails.player.lockedTitle'] || 'هذه المحاضرة مقفولة ضمن باقة Preview'}</p>
                                            <p className="text-gray-200 text-sm mt-1">{content['courseDetails.player.lockedHint'] || 'للانتقال للمشاهدة الكاملة، قم بالترقية إلى Full.'}</p>
                                            <button
                                              onClick={() => navigate(`/checkout?type=course&id=${course.id}`)}
                                              className="mt-4 bg-white text-primary-700 hover:bg-primary-50 font-bold px-5 py-2 rounded-xl text-sm transition shadow-lg"
                                            >
                                              🔓 اشترك وافتح جميع المحاضرات
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2 max-h-[420px] overflow-auto">
                                {chapters.length > 0 ? (() => {
                                  const chaptersWithLectures = chapters.map((ch) => ({
                                    chapter: ch,
                                    lectures: lecturesWithLock.filter((l) => l.chapterId === ch.id),
                                  }));
                                  const uncategorized = lecturesWithLock.filter((l) => !l.chapterId || !chapters.some((ch) => ch.id === l.chapterId));
                                  let globalIdx = 0;
                                  return (
                                    <>
                                      {chaptersWithLectures.map(({ chapter, lectures: chLectures }) => chLectures.length > 0 && (
                                        <div key={chapter.id}>
                                          <div className="text-xs font-bold text-primary-700 bg-primary-50 px-3 py-1.5 rounded-lg mb-1.5 flex items-center gap-1">
                                            <span className="w-5 h-5 bg-primary-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold">{chapter.order}</span>
                                            {chapter.title}
                                          </div>
                                          {chLectures.map((lecture) => {
                                            const idx = globalIdx++;
                                            return (
                                              <button key={lecture.id} onClick={() => { if (lecture.locked) { setLectureGateNotice(content['courseDetails.player.lockedNotice'] || 'هذه المحاضرة غير متاحة على صلاحية Preview.'); return; } setLectureGateNotice(''); setSelectedLectureId(lecture.id); }} className={`w-full text-right border rounded-xl p-3 transition mb-1 ${selectedLectureId === lecture.id ? 'border-primary-400 bg-primary-50' : 'border-gray-200 bg-white'} ${lecture.locked ? 'opacity-80' : ''}`}>
                                                <div className="flex items-center justify-between gap-2">
                                                  <div><p className="font-bold text-sm text-gray-800">{idx + 1}. {lecture.title}</p><p className="text-xs text-gray-500 mt-0.5">{lecture.duration} • {lecture.lectureType === 'live' ? 'Live' : 'Recorded'}</p></div>
                                                  {lecture.locked ? <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700"><Lock size={12} />Locked</span> : <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">Open</span>}
                                                </div>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      ))}
                                      {uncategorized.map((lecture) => {
                                        const idx = globalIdx++;
                                        return (
                                          <button key={lecture.id} onClick={() => { if (lecture.locked) { setLectureGateNotice(content['courseDetails.player.lockedNotice'] || 'هذه المحاضرة غير متاحة على صلاحية Preview.'); return; } setLectureGateNotice(''); setSelectedLectureId(lecture.id); }} className={`w-full text-right border rounded-xl p-3 transition ${selectedLectureId === lecture.id ? 'border-primary-400 bg-primary-50' : 'border-gray-200 bg-white'} ${lecture.locked ? 'opacity-80' : ''}`}>
                                            <div className="flex items-center justify-between gap-2">
                                              <div><p className="font-bold text-sm text-gray-800">{idx + 1}. {lecture.title}</p><p className="text-xs text-gray-500 mt-0.5">{lecture.duration} • {lecture.lectureType === 'live' ? 'Live' : 'Recorded'}</p></div>
                                              {lecture.locked ? <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700"><Lock size={12} />Locked</span> : <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">Open</span>}
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </>
                                  );
                                })() : lecturesWithLock.map((lecture, index) => (
                                    <button
                                      key={lecture.id}
                                      onClick={() => {
                                        if (lecture.locked) {
                                          setLectureGateNotice(content['courseDetails.player.lockedNotice'] || 'هذه المحاضرة غير متاحة على صلاحية Preview.');
                                          return;
                                        }
                                        setLectureGateNotice('');
                                        setSelectedLectureId(lecture.id);
                                      }}
                                      className={`w-full text-right border rounded-xl p-3 transition ${selectedLectureId === lecture.id ? 'border-primary-400 bg-primary-50' : 'border-gray-200 bg-white'} ${lecture.locked ? 'opacity-80' : ''}`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div>
                                                <p className="font-bold text-sm text-gray-800">{index + 1}. {lecture.title}</p>
                                                <p className="text-xs text-gray-500 mt-0.5">{lecture.duration} • {lecture.lectureType === 'live' ? 'Live' : 'Recorded'}</p>
                                            </div>
                                            {lecture.locked ? (
                                                <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700"><Lock size={12} />مقفل</span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">مفتوح</span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {lectureGateNotice && (
                        <div className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            {lectureGateNotice}
                        </div>
                    )}
                </section>

                {/* FAQ */}
                <section>
                    <h2 className="text-2xl font-bold mb-6 text-gray-900 border-r-4 border-primary-600 pr-3">{content['courseDetails.faq.title'] || 'أسئلة شائعة'}</h2>
                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition">
                            <h3 className="font-bold flex items-center gap-2 mb-2 text-gray-800">
                                <Award size={20} className="text-primary-500" />
                                {content['courseDetails.faq.q1'] || 'هل الشهادة معتمدة؟'}
                            </h3>
                            <p className="text-gray-600 text-sm leading-relaxed">{content['courseDetails.faq.a1'] || 'نعم، الشهادة معتمدة من المعهد وتحمل كود تحقق (QR Code). كما يمكن توثيقها من الخارجية وجهات دولية برسوم إضافية.'}</p>
                        </div>
                        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition">
                            <h3 className="font-bold flex items-center gap-2 mb-2 text-gray-800">
                                <PlayCircle size={20} className="text-primary-500" />
                                {content['courseDetails.faq.q2'] || 'هل يمكنني مشاهدة المحاضرات لاحقاً؟'}
                            </h3>
                            <p className="text-gray-600 text-sm leading-relaxed">{content['courseDetails.faq.a2'] || 'بالتأكيد! جميع المحاضرات (سواء المسجلة أو البث المباشر) تظل محفوظة في حسابك لمدة سنة واحدة ويمكنك الرجوع إليها في أي وقت.'}</p>
                        </div>
                    </div>
                </section>

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
                            <button className="flex items-center gap-1.5 bg-red-100 text-red-700 border border-red-200 text-xs font-bold px-4 py-2.5 rounded-xl">
                              <FileText size={14} />{content['courseDetails.gallery.previewCta'] || 'معاينة'}
                            </button>
                          )}
                        </div>
                     </div>
                </section>

                {/* ── Graduate Gallery ── */}
                {(() => {
                  let galleryImgs: string[] = [];
                  try { galleryImgs = JSON.parse(globalContent['institute.gallery.images'] || '[]'); } catch {}
                  if (galleryImgs.length === 0) return null;
                  return (
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
                  );
                })()}

                {/* ── Customer Reviews ── */}
                {testimonials.length > 0 && (
                  <section className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm">
                    <h2 className="text-2xl font-bold mb-6 text-gray-900 border-r-4 border-red-500 pr-3">{content['courseDetails.reviews.title'] || 'آراء طلاب الكورس'}</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                      {testimonials.slice(0, 3).map((t) => (
                        <div key={t.id} className="bg-gray-50 border border-gray-100 rounded-2xl p-5 relative shadow-sm hover:shadow-md transition">
                          <Quote size={28} className="text-red-200 absolute top-4 left-4" />
                          <div className="flex items-center gap-3 mb-3">
                            {t.image ? (
                              <img loading="lazy" decoding="async" src={t.image} alt={t.name} className="w-11 h-11 rounded-full object-cover border-2 border-red-200 flex-shrink-0" />
                            ) : (
                              <div className="w-11 h-11 rounded-full bg-red-100 text-red-700 flex items-center justify-center font-bold text-lg flex-shrink-0">{t.name.charAt(0)}</div>
                            )}
                            <div className="min-w-0">
                              <p className="font-bold text-gray-900 text-sm truncate">{t.name}</p>
                              <p className="text-xs text-gray-500 truncate">{t.role}</p>
                            </div>
                          </div>
                          <div className="flex gap-0.5 mb-2">
                            {[...Array(5)].map((_, i) => <Star key={i} size={13} className="text-yellow-400 fill-yellow-400" />)}
                          </div>
                          <p className="text-sm text-gray-700 leading-relaxed line-clamp-4 relative z-10">{t.text}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Lead Generation Form (Registration) */}
                <section id="lead-form" className="bg-gray-900 text-white p-8 rounded-3xl shadow-xl mt-8">
                    <div className="text-center mb-8">
                        <h2 className="text-2xl font-bold mb-2">{content['courseDetails.lead.title'] || 'لست متأكداً؟ سجل اهتمامك وسنتواصل معك'}</h2>
                        <p className="text-gray-400 text-sm">{content['courseDetails.lead.subtitle'] || 'املأ النموذج أدناه وسيقوم أحد مستشارينا الأكاديميين بالتواصل معك للإجابة على جميع استفساراتك.'}</p>
                    </div>
                    <form className="max-w-xl mx-auto space-y-4" onSubmit={handleLeadSubmit}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <input type="text" value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder={content['courseDetails.lead.namePlaceholder'] || 'الاسم الكامل'} className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-primary-500 transition" />
                            <input type="tel" value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} placeholder={content['courseDetails.lead.phonePlaceholder'] || 'رقم الهاتف'} className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-primary-500 transition" />
                        </div>
                        <select value={leadBranch} onChange={(e) => setLeadBranch(e.target.value)} className="w-full bg-gray-800 border border-gray-700 text-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:border-primary-500 transition">
                            <option value="">{content['courseDetails.lead.branchPlaceholder'] || 'اختر الفرع الأقرب إليك'}</option>
                            {(() => {
                              let db: { id: string; label: string }[] = [];
                              try { db = JSON.parse(content['institute.branches'] || '[]'); } catch {}
                              return db.length > 0
                                ? db.map(b => <option key={b.id} value={b.id}>{b.label}</option>)
                                : (<>
                                    <option value="online-egypt">{content['courseDetails.lead.branchOnline'] || 'أونلاين محلي'}</option>
                                    <option value="online-saudi">{content['courseDetails.lead.branchSaudi'] || 'أونلاين سعودي'}</option>
                                    <option value="online-abroad">{content['courseDetails.lead.branchAbroad'] || 'أونلاين دولي'}</option>
                                    <option value="tagamoa">{content['courseDetails.lead.branchCairo'] || 'فرع التجمع'}</option>
                                    <option value="daqqi">{content['courseDetails.lead.branchGiza'] || 'فرع الدقي'}</option>
                                  </>);
                            })()}
                            <option value="other">{content['courseDetails.lead.branchAlex'] || 'أخرى'}</option>
                        </select>
                        {leadNotice && <div className="text-sm rounded-lg px-3 py-2 bg-white/10 border border-white/10 text-gray-100">{leadNotice}</div>}
                        
                        <button type="submit" className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-3 rounded-xl transition flex justify-center items-center gap-2">
                             <Send size={18} />
                             {content['courseDetails.lead.submit'] || 'إرسال الطلب'}
                        </button>
                    </form>
                </section>

                {/* ── Course Rating Section ── */}
                <section className="mt-10 bg-white border border-gray-100 rounded-2xl p-6 shadow-sm" id="rating-section">
                  <h3 className="font-extrabold text-lg text-gray-800 mb-4 flex items-center gap-2">
                    <Star size={20} className="text-amber-400 fill-amber-400" /> تقييمات الدورة
                  </h3>
                  {/* Aggregate */}
                  {ratingData && ratingData.count > 0 && (
                    <div className="flex items-center gap-4 mb-6 bg-amber-50 rounded-xl p-4">
                      <div className="text-center">
                        <p className="text-4xl font-extrabold text-amber-500">{ratingData.avg.toFixed(1)}</p>
                        <div className="flex gap-0.5 mt-1 justify-center">
                          {[1,2,3,4,5].map(s => (
                            <Star key={s} size={14} className={s <= Math.round(ratingData.avg) ? 'text-amber-400 fill-amber-400' : 'text-gray-300 fill-gray-200'} />
                          ))}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{ratingData.count} تقييم</p>
                      </div>
                    </div>
                  )}
                  {/* Rate form for enrolled users */}
                  {isEnrolled && (
                    <div className="bg-gray-50 rounded-xl p-4">
                      <p className="text-sm font-bold text-gray-700 mb-3">{ratingData?.myRating ? 'تعديل تقييمك' : 'قيّم هذه الدورة'}</p>
                      <div className="flex gap-1 mb-3">
                        {[1,2,3,4,5].map(s => (
                          <button key={s} type="button"
                            onMouseEnter={() => setHoverStar(s)}
                            onMouseLeave={() => setHoverStar(0)}
                            onClick={() => handleSubmitRating(s)}
                            disabled={ratingSubmitting}
                            className="focus:outline-none transition-transform hover:scale-125"
                          >
                            <Star size={28} className={s <= (hoverStar || ratingData?.myRating?.rating || 0) ? 'text-amber-400 fill-amber-400' : 'text-gray-300 fill-gray-200'} />
                          </button>
                        ))}
                      </div>
                      <textarea
                        value={ratingComment}
                        onChange={e => setRatingComment(e.target.value)}
                        placeholder="أضف تعليقاً (اختياري)…"
                        rows={2}
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary-400 resize-none mb-2"
                      />
                      {ratingData?.myRating && (
                        <button
                          type="button"
                          disabled={ratingSubmitting}
                          onClick={() => handleSubmitRating(ratingData.myRating!.rating)}
                          className="text-xs bg-primary-600 hover:bg-primary-700 text-white font-bold px-4 py-1.5 rounded-lg transition mb-2 disabled:opacity-50"
                        >
                          {ratingSubmitting ? '…' : 'حفظ التعليق'}
                        </button>
                      )}
                      {ratingNotice && <p className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2 mb-2">{ratingNotice}</p>}
                    </div>
                  )}
                  {!isEnrolled && (!ratingData || ratingData.count === 0) && (
                    <p className="text-sm text-gray-400">لا توجد تقييمات بعد. كن أول من يقيّم هذه الدورة بعد التسجيل!</p>
                  )}
                </section>

                {/* FAQ — editable: لوحة التحكم → صفحات الموقع → صفحة الكورسات (courseDetails.faqList) */}
                <section>
                  <h2 className="text-2xl font-bold text-gray-900 mb-5 flex items-center gap-2">
                    <HelpCircle size={20} className="text-primary-600" /> {content['courseDetails.faqTitle'] || 'الأسئلة الشائعة'}
                  </h2>
                  <div className="space-y-2">
                    {(content['courseDetails.faqList'] || DEFAULT_FAQ).split('\n').map(l => l.split('::')).filter(p => p[0]?.trim() && p[1]?.trim()).map((p, i) => (
                      <div key={i} className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                        <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-right hover:bg-gray-50 transition">
                          <span className="font-bold text-gray-800 text-sm">{p[0].trim()}</span>
                          {openFaq === i ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
                        </button>
                        {openFaq === i && <div className="px-4 pb-3 text-sm text-gray-600 leading-relaxed">{p[1].trim()}</div>}
                      </div>
                    ))}
                  </div>
                </section>

            </div>

            <div className="hidden lg:block">
                {/* Sidebar place holder for related courses or generic info */}
                <div className="bg-gray-50 p-6 rounded-2xl sticky top-[500px] border border-gray-200">
                   <h3 className="font-bold mb-4 text-lg">{content['courseDetails.sidebar.title'] || 'دبلومات قد تهمك'}</h3>
                   <div className="space-y-4">
                      {courses.filter(c => c.id !== course.id).slice(0, 2).map(c => (
                          <Link key={c.id} to={`/c/${c.slug || c.id}`} className="flex gap-3 group bg-white p-3 rounded-xl shadow-sm hover:shadow-md transition">
                              <img loading="lazy" decoding="async" src={c.thumbnail} className="w-20 h-16 object-cover rounded-lg" alt="" />
                              <div>
                                  <h4 className="text-sm font-bold text-gray-800 group-hover:text-primary-600 line-clamp-2 transition">{c.title}</h4>
                                  <p className="text-xs text-primary-600 font-bold mt-1">{c.price[currency]} {currencySymbol}</p>
                              </div>
                          </Link>
                      ))}
                   </div>
                </div>
            </div>
        </div>
      </div>
            {/* ── Course Completion / Bundle Upsell Popup ─────────────────────────── */}
      {showUpsell && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowUpsell(false)}>
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-gradient-to-r from-green-500 to-emerald-600 p-6 text-white text-center relative">
              <button onClick={() => setShowUpsell(false)} className="absolute top-3 left-3 w-7 h-7 rounded-full bg-white/20 hover:bg-white/40 grid place-items-center transition"><X size={14} /></button>
              <div className="text-5xl mb-2">🎓</div>
              <h2 className="text-xl font-extrabold">مبروك! أتممت الكورس</h2>
              <p className="text-green-100 text-sm mt-1">{course.title}</p>
            </div>
            <div className="p-6">
              {completionCert && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-center">
                  <p className="text-xs text-amber-600 font-semibold mb-1">كود شهادتك الرقمية</p>
                  <p className="font-mono font-extrabold text-amber-800 text-lg tracking-wider">{completionCert}</p>
                  <p className="text-xs text-gray-400 mt-1">احتفظ بهذا الكود للتحقق من الشهادة</p>
                </div>
              )}
              {relatedBundles.length > 0 ? (
                <>
                  <p className="text-gray-700 font-semibold mb-3 flex items-center gap-2"><Gift size={16} className="text-primary-600" /> ارتقِ بمهاراتك — باقات تشمل هذا الكورس:</p>
                  <div className="space-y-3">
                    {relatedBundles.slice(0, 2).map(b => (
                      <div key={b.id} className="border border-gray-200 rounded-xl p-3 flex items-center gap-3 hover:border-primary-300 transition">
                        <img loading="lazy" decoding="async" src={b.thumbnail} alt="" className="w-14 h-12 object-cover rounded-lg flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-gray-800 text-sm line-clamp-1">{b.title}</p>
                          <p className="text-primary-600 font-extrabold text-sm">{b.price?.[currency]} {currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$'}</p>
                        </div>
                        <Link to={`/bundle/${b.id}`} onClick={() => setShowUpsell(false)} className="bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold px-3 py-2 rounded-lg transition flex-shrink-0">
                          عرض
                        </Link>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-center text-gray-500 text-sm py-2">استمر في تعلمك وتطوير مهاراتك!</p>
              )}
              <button onClick={() => setShowUpsell(false)} className="w-full mt-4 border-2 border-gray-200 text-gray-600 hover:bg-gray-50 font-bold py-2.5 rounded-xl transition text-sm">
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
            {/* Mobile Sticky CTA */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-50 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] pb-8 md:pb-4">
         <div className="flex gap-2 items-center max-w-lg mx-auto">
             <div className="flex-shrink-0">
                 <p className="text-xs text-gray-500 line-through">{discountedPrice !== null ? currentPrice : oldPrice} {currencySymbol}</p>
                 <p className="text-lg font-bold text-primary-700">{discountedPrice !== null ? discountedPrice : currentPrice} {currencySymbol}</p>
             </div>
             {isSubscribed ? (
               <div className="bg-green-50 border-2 border-green-500 text-green-700 px-4 py-3 rounded-xl font-bold flex-1 text-sm flex justify-center items-center gap-1">
                 <Check size={16} /> أنت مشترك
               </div>
             ) : (
               <button onClick={handleBuyNow} className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-3 rounded-xl font-bold flex-1 shadow-lg shadow-primary-500/30 transition text-sm flex justify-center items-center gap-1">
                 <Check size={16} />
                 احجز الآن واستفد بخصم
               </button>
             )}
             <button
               onClick={() => { setShowLeadForm(true); setTimeout(() => document.getElementById('lead-form')?.scrollIntoView({ behavior: 'smooth' }), 100); }}
               className="bg-white border-2 border-primary-600 text-primary-700 px-4 py-3 rounded-xl font-bold flex-1 transition text-sm flex justify-center items-center gap-1"
             >
               <Send size={14} /> سجل بياناتك
             </button>
         </div>
      </div>
    </div>
  );
};

export default CourseDetails;