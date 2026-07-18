import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LeadItem } from '../types';
import { useSiteData } from '../context/SiteDataContext';
import { mysqlClient, mysqlCatalog } from '../lib/mysqlapi';
import { CourseHeroSection } from './course-details-sections/CourseHeroSection';
import { PromoVideoSection } from './course-details-sections/PromoVideoSection';
import { PainPointsAndAboutSection } from './course-details-sections/PainPointsAndAboutSection';
import { LecturePlayerSection } from './course-details-sections/LecturePlayerSection';
import { GallerySection } from './course-details-sections/GallerySection';
import { ReviewsFaqSection } from './course-details-sections/ReviewsFaqSection';
import { LeadFormSection } from './course-details-sections/LeadFormSection';
import { CourseRatingSection } from './course-details-sections/CourseRatingSection';
import { RelatedCoursesSidebar } from './course-details-sections/RelatedCoursesSidebar';
import { CourseUpsellModal } from './course-details-sections/CourseUpsellModal';
import { MobileStickyCta } from './course-details-sections/MobileStickyCta';

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
    const lookup = id ?? slug;
    if (!lookup) { setFallbackTried(true); return; }
    // Fetch the full course (incl. lectures/chapters) directly when it's not in
    // the cached catalog, OR when it is but its lectures aren't loaded globally.
    // The latter is the common anonymous-visitor case: the bulk lectures list is
    // now login-gated, so the curriculum for a public course page comes from
    // this on-demand fetch instead.
    const ctxLecs = courseFromCtx ? getCourseLectures(courseFromCtx.id) : [];
    if (courseFromCtx && ctxLecs.length > 0) { setApiFallbackCourse(null); setFallbackTried(true); return; }
    mysqlCatalog.getCourse(lookup).then(data => {
      if (!data?.id) return;
      if (!courseFromCtx) setApiFallbackCourse(data as unknown as typeof courses[0]);
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
        // Prefer the globally-loaded lists (logged-in students), else the
        // on-demand fetch (anonymous visitors, whose bulk list is login-gated).
        const ctxChapters = course && courseFromCtx ? getCourseChapters(course.id) : [];
        const chapters = ctxChapters.length > 0 ? ctxChapters : (course ? apiFallbackChapters : []);
        const ctxLectures = course && courseFromCtx ? getCourseLectures(course.id) : [];
        const lectures = ctxLectures.length > 0 ? ctxLectures : (course ? apiFallbackLectures : []);
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

    const handleLeadSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
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

        try {
            await addPublicLead(payload);
            setLeadName('');
            setLeadPhone('');
            setLeadBranch('');
            setLeadNotice('تم تسجيل بياناتك وسيتم التواصل معك خلال 48 ساعة من خدمة العملاء.');
        } catch {
            setLeadNotice('تعذر تسجيل بياناتك حاليًا. حاول مرة أخرى أو تواصل معنا على واتساب.');
        }
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
      const res = await mysqlClient.rateCourse(course!.id, star, ratingComment) as any;
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
        const mine = (completions as any[]).find(c => c.course_id === course!.id);
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
      <CourseHeroSection
        course={course}
        content={content}
        currentPrice={currentPrice}
        oldPrice={oldPrice}
        discountedPrice={discountedPrice}
        currencySymbol={currencySymbol}
        applicableDiscount={applicableDiscount}
        isSubscribed={isSubscribed}
        onBuyNow={handleBuyNow}
      />

      {/* Main Content */}
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            <div className="lg:col-span-2 space-y-12">

                <PromoVideoSection
                    thumbnail={course.thumbnail}
                    promoVideoUrl={promoVideoUrl}
                    content={content}
                    showPromoModal={showPromoModal}
                    setShowPromoModal={setShowPromoModal}
                    getEmbedUrl={getEmbedUrl}
                />

                <PainPointsAndAboutSection content={content} description={course.description} />

                <LecturePlayerSection
                    content={content}
                    subscriberLoading={subscriberLoading}
                    accessMode={accessMode}
                    unlockedLectureCount={unlockedLectureCount}
                    chapters={chapters}
                    lecturesWithLock={lecturesWithLock}
                    selectedLecture={selectedLecture}
                    selectedLectureId={selectedLectureId}
                    setSelectedLectureId={setSelectedLectureId}
                    resolvedLectureUrl={resolvedLectureUrl}
                    lectureGateNotice={lectureGateNotice}
                    setLectureGateNotice={setLectureGateNotice}
                    authUserEmail={authUser?.email}
                    onLockedLectureClick={() => navigate(`/checkout?type=course&id=${course.id}`)}
                    getEmbedUrl={getEmbedUrl}
                />

                <ReviewsFaqSection
                    content={content}
                    testimonials={testimonials}
                    openFaq={openFaq}
                    setOpenFaq={setOpenFaq}
                />

                <GallerySection
                    content={content}
                    globalContent={globalContent}
                    galleryImages={galleryImages}
                    certificateTemplateUrl={certificateTemplateUrl}
                    galleryLightboxIdx={galleryLightboxIdx}
                    setGalleryLightboxIdx={setGalleryLightboxIdx}
                />

                <LeadFormSection
                    content={content}
                    leadName={leadName}
                    setLeadName={setLeadName}
                    leadPhone={leadPhone}
                    setLeadPhone={setLeadPhone}
                    leadBranch={leadBranch}
                    setLeadBranch={setLeadBranch}
                    leadNotice={leadNotice}
                    onSubmit={handleLeadSubmit}
                />

                <CourseRatingSection
                    ratingData={ratingData}
                    isEnrolled={isEnrolled}
                    hoverStar={hoverStar}
                    setHoverStar={setHoverStar}
                    ratingComment={ratingComment}
                    setRatingComment={setRatingComment}
                    ratingSubmitting={ratingSubmitting}
                    ratingNotice={ratingNotice}
                    onSubmitRating={handleSubmitRating}
                />

            </div>

            <RelatedCoursesSidebar
                content={content}
                courses={courses}
                currentCourseId={course.id}
                currency={currency}
                currencySymbol={currencySymbol}
            />
        </div>
      </div>

      {showUpsell && (
        <CourseUpsellModal
          courseTitle={course.title}
          completionCert={completionCert}
          relatedBundles={relatedBundles}
          currency={currency}
          onClose={() => setShowUpsell(false)}
        />
      )}

      <MobileStickyCta
        currentPrice={currentPrice}
        oldPrice={oldPrice}
        discountedPrice={discountedPrice}
        currencySymbol={currencySymbol}
        isSubscribed={isSubscribed}
        onBuyNow={handleBuyNow}
        onRegisterClick={() => { setShowLeadForm(true); setTimeout(() => document.getElementById('lead-form')?.scrollIntoView({ behavior: 'smooth' }), 100); }}
      />
    </div>
  );
};

export default CourseDetails;
