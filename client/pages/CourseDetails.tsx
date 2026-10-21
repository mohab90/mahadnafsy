import React, { useEffect, useMemo, useState } from 'react';
import { useEscapeKey } from '../../shared/ui/useEscapeKey';
import { useParams, useNavigate } from 'react-router-dom';
import { LeadItem } from '../types';
import { useSiteData } from '../context/SiteDataContext';
import { mysqlClient, mysqlCatalog } from '../lib/mysqlapi';
import { CourseBookingCard, CourseHeroSection, scrollToLeadForm } from './course-details-sections/CourseHeroSection';
import { PromoVideoSection } from './course-details-sections/PromoVideoSection';
import { AboutSection, PainPointsSection } from './course-details-sections/PainPointsAndAboutSection';
import { LecturePlayerSection } from './course-details-sections/LecturePlayerSection';
import { GallerySection } from './course-details-sections/GallerySection';
import { FaqSection } from './course-details-sections/ReviewsFaqSection';
import { LeadFormSection } from './course-details-sections/LeadFormSection';
import { CourseRatingSection } from './course-details-sections/CourseRatingSection';
import { CertificateShowcase, FinalCtaSection, InstructorSection, ProofSection, RelatedCoursesSection, SectionNav, ValueStackSection } from './course-details-sections/CourseSalesSections';
import { CourseUpsellModal } from './course-details-sections/CourseUpsellModal';
import { MobileStickyCta } from './course-details-sections/MobileStickyCta';
import CourseCertificate from '../components/CourseCertificate';
import { isExpiryActive } from '../../shared/cairoDate';
import { CAIRO_TIME_ZONE } from '../../shared/cairoDate';
import { LECTURE_ACCESS_CHECK_FAILED, lectureAccessRefusal } from '../lib/lectureVideo';

const CourseDetails: React.FC = () => {
                const { courses, subscribers, discounts, addPublicLead, getCourseLectures, getCourseChapters, content: globalContent, testimonials, therapists, currency, authUser, bundles, mySubscriberId, mySubscriberLoaded, refreshMySubscriber } = useSiteData();
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
    // Always fetch the full course. The cached catalog is the light list — it
    // carries no description and no promo video — so a course found there drew
    // an empty «تفاصيل البرنامج» and «سيتوفر قريباً» over a video it has. The
    // same call brings the curriculum for anonymous visitors, whose bulk
    // lectures list is login-gated.
    let cancelled = false;
    mysqlCatalog.getCourse(lookup).then(data => {
      if (cancelled || !data?.id) return;
      setApiFallbackCourse(data as unknown as typeof courses[0]);
      setApiFallbackLectures(((data.lectures || []) as unknown as ReturnType<typeof getCourseLectures>));
      setApiFallbackChapters(((data.chapters || []) as unknown as ReturnType<typeof getCourseChapters>));
    }).catch(() => {}).finally(() => { if (!cancelled) setFallbackTried(true); });
    return () => { cancelled = true; };
  }, [id, slug]);
  // The catalog's entry (prices in the visitor's currency, already loaded) with
  // the full course laid over it once it arrives.
  const lookupKey = id ?? slug;
  const fullCourse = apiFallbackCourse && (courseFromCtx
    ? apiFallbackCourse.id === courseFromCtx.id
    : apiFallbackCourse.id === lookupKey || apiFallbackCourse.slug === lookupKey) ? apiFallbackCourse : null;
  const course = useMemo(
    () => (courseFromCtx && fullCourse ? { ...fullCourse, ...courseFromCtx, description: fullCourse.description || courseFromCtx.description, promoVideoUrl: fullCourse.promoVideoUrl || courseFromCtx.promoVideoUrl, galleryImages: fullCourse.galleryImages?.length ? fullCourse.galleryImages : courseFromCtx.galleryImages, courseModules: fullCourse.courseModules?.length ? fullCourse.courseModules : courseFromCtx.courseModules, certificateTemplateUrl: fullCourse.certificateTemplateUrl || courseFromCtx.certificateTemplateUrl } : (courseFromCtx ?? fullCourse)),
    [courseFromCtx, fullCourse],
  );
    const [selectedLectureId, setSelectedLectureId] = useState('');
    // Resolved playable URL — paid lectures no longer ship their URL publicly; fetched on demand.
    // Stored with its lecture, so the render that switches lectures never hands
    // the new player the previous lecture's ticket (UserDashboardVideoPlayer has
    // the whole story).
    // A refusal is kept with it, so the player says why instead of spinning.
    const [resolvedLecture, setResolvedLecture] = useState({ lectureId: '', url: '', error: '' });
    const resolvedLectureUrl = resolvedLecture.lectureId === selectedLectureId ? resolvedLecture.url : '';
    const lectureAccessError = resolvedLecture.lectureId === selectedLectureId ? resolvedLecture.error : '';
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

  const currentPrice = course?.price[currency] ?? 0;
  const oldPrice = course?.originalPrice[currency] ?? 0;
  const currencySymbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';

  // Find applicable discount rule (course-specific takes priority over all_courses)
  // Expiry is a date, judged in Cairo: `new Date('2026-09-15')` is midnight UTC,
  // so an offer set to run through the 15th used to vanish from this page at
  // 02:00 Cairo that morning while the admin's own list still called it active.
  const applicableDiscount = course
    ? (discounts.find(d => d.active && d.type === 'course' && d.targetId === course.id && isExpiryActive(d.expiresAt)) ??
    discounts.find(d => d.active && d.type === 'all_courses' && isExpiryActive(d.expiresAt)))
    : undefined;
  const discountedPrice = applicableDiscount ? Math.round(currentPrice * (1 - applicableDiscount.discountPercent / 100)) : null;
  // Cash discount (applied on checkout for direct online payment)
        // Prefer the globally-loaded lists (logged-in students), else the
        // on-demand fetch (anonymous visitors, whose bulk list is login-gated).
        const ctxChapters = course && courseFromCtx ? getCourseChapters(course.id) : [];
        const chapters = ctxChapters.length > 0 ? ctxChapters : (course ? apiFallbackChapters : []);
        // Memoized because both branches minted a fresh array on every render —
        // getCourseLectures returns a new filtered list, and the `: []` fallback
        // is a new literal. That defeated the lecturesWithLock memo below, which
        // lists lectures as a dependency and so re-mapped the whole curriculum
        // every render.
        const ctxLectures = useMemo(
            () => (course && courseFromCtx ? getCourseLectures(course.id) : []),
            [course, courseFromCtx, getCourseLectures],
        );
        const lectures = useMemo(
            () => (ctxLectures.length > 0 ? ctxLectures : (course ? apiFallbackLectures : [])),
            [ctxLectures, course, apiFallbackLectures],
        );
        // Keyed on the id the server resolved. Matching authUser.email found
        // nothing for a WhatsApp-only client, so their own enrolled course
        // rendered as "preview".
        const subscriber = mySubscriberId
            ? subscribers.find((row) => row.id === mySubscriberId)
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
        // Must match getPreviewLimit() in api/routes/public.js — the server is
        // what actually withholds the video URLs, so a larger number here would
        // only render locks the API never opens.
        const previewLimit = Number.isFinite(previewLimitRaw) && previewLimitRaw > 0 ? Math.floor(previewLimitRaw) : 1;
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
                // A lecture marked free is open wherever it sits; the server
                // hands out its video for the same reason.
                locked: accessMode !== 'full' && index >= unlockedLectureCount && !lecture.isPreview,
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
        if (!selectedLecture || selectedLecture.locked) return;
        const lectureId = selectedLecture.id;
        if (selectedLecture.videoUrl) { setResolvedLecture({ lectureId, url: selectedLecture.videoUrl, error: '' }); return; }
        mysqlClient.getLectureAccess(lectureId)
            .then(r => {
                if (cancelled) return;
                if (r.accessible && r.video_url) setResolvedLecture({ lectureId, url: r.video_url, error: '' });
                else setResolvedLecture({ lectureId, url: '', error: lectureAccessRefusal(r) });
            })
            .catch(() => { if (!cancelled) setResolvedLecture({ lectureId, url: '', error: LECTURE_ACCESS_CHECK_FAILED }); });
        return () => { cancelled = true; };
        // Keyed on the fields that decide the answer rather than the
        // selectedLecture object, which is re-derived on every render — listing
        // it would re-request a signed video URL continuously.
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
        // Keyed on uid: one refresh per signed-in visit to this page.
        // refreshMySubscriber is rebuilt by the context each render, and authUser
        // is replaced on every token refresh — listing either would re-fetch the
        // subscriber repeatedly while the page is open.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authUser?.uid]);

    // NOTE: the `if (!course)` loader/not-found guard was moved to just before the main
    // render below. It MUST come after every hook call — otherwise the hooks declared
    // later in this component (ratings, upsell, SEO, completion…) are skipped while the
    // course is still resolving, then run once it loads → "Rendered more hooks than during
    // the previous render" (React #310) crash. Keep all hooks above the guard.


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
      setRatingData(() => ({ avg: res.avg, count: res.count, myRating: { rating: star, comment: ratingComment } }));
      setRatingNotice('شكراً! تم حفظ تقييمك.');
    } catch { setRatingNotice('حدث خطأ، حاول مجدداً.'); }
    setRatingSubmitting(false);
  };

  // ── Upsell popup: show when enrolled user opens a lecture ─────────────────
  const [showUpsell, setShowUpsell] = useState(false);
  const [certModalOpen, setCertModalOpen] = useState(false);
  // A certificate on a dark ground is a viewer, not a dialog — a white panel
  // with a header row would be wrong. Escape is right for both.
  useEscapeKey(() => setCertModalOpen(false), certModalOpen);
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
    const seoTitle = (course as any).seo_title || course.title || 'معهد الدراسات النفسية';
    const seoDesc  = (course as any).seo_description || course.shortDescription?.replace(/<[^>]*>/g,'').slice(0,160) || '';
    const seoKw    = (course as any).seo_keywords || '';
    document.title = seoTitle + ' — معهد الدراسات النفسية';
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
    // The two that were missing, and the two that cost the most. `canonical`
    // stayed on the homepage for the whole session, which tells Google this
    // course is a duplicate of the front page; `og:url` did the same to every
    // shared link. The prerendered HTML gets them right for crawlers that do
    // not run JavaScript — this keeps them right once the app is navigating.
    const url = `https://mahadnafsy.com/c/${course.slug || course.id}`;
    setOg('og:url', url);
    const canonical = document.head.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', url);
    return () => { document.title = 'معهد الدراسات النفسية'; };
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
    // subscriber and course are keyed on the fields this actually reads
    // (lectureProgress, id) rather than the objects, which are rebuilt whenever
    // the subscriber list refreshes — depending on them would re-request the
    // completions list on every refresh. completionCert IS listed: it guards the
    // fetch, and re-running once after it is set is what stops the second call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriber?.lectureProgress, isEnrolled, lectures, course?.id, completionCert]);

  // Loader / not-found guard — placed AFTER all hooks (see note above) to satisfy Rules of Hooks.
  if (!course) {
    // Still resolving (context list not loaded yet, or direct API fallback in-flight) → loader, not an error.
    if (!fallbackTried) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 bg-paper py-32 text-muted">
          <div className="h-10 w-10 rounded-full border-4 border-line border-t-primary-700 motion-safe:animate-spin"></div>
          <p className="text-sm font-bold">{globalContent['common.loading'] || 'جارٍ التحميل...'}</p>
        </div>
      );
    }
    return <div className="bg-paper px-4 py-24 text-center text-lg font-bold text-muted-body">{globalContent['courseDetails.notFound'] || 'الكورس غير موجود'}</div>;
  }

  const goEnroll = () => navigate(`/enroll?course=${encodeURIComponent(course.id)}`);

  return (
    <div className="bg-white pb-24 motion-safe:animate-fade-in lg:pb-0">
      <CourseHeroSection
        course={course}
        content={content}
        lectureCount={lectures.length}
        promoVideoUrl={promoVideoUrl}
        onPlayPromo={() => setShowPromoModal(true)}
        isSubscribed={isSubscribed}
        rating={ratingData}
      />
      <PromoVideoSection
        promoVideoUrl={promoVideoUrl}
        content={content}
        showPromoModal={showPromoModal}
        setShowPromoModal={setShowPromoModal}
      />

      <SectionNav showBook={!isSubscribed && currentPrice > 0} courseId={course.id} />

      {/* The story on the right, the booking card on the left following it down
          the page; on a phone the card comes straight after the first screen. */}
      <div className="container mx-auto px-4 py-10 sm:py-14">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_370px] xl:grid-cols-[minmax(0,1fr)_390px] xl:gap-14">
            <aside className="lg:col-start-2 lg:row-start-1">
                <div className="lg:sticky lg:top-[136px]">
                    <CourseBookingCard
                        course={course}
                        content={content}
                        currentPrice={currentPrice}
                        oldPrice={oldPrice}
                        discountedPrice={discountedPrice}
                        currencySymbol={currencySymbol}
                        applicableDiscount={applicableDiscount}
                        isSubscribed={isSubscribed}
                        onBuyNow={handleBuyNow}
                        onPreviewCertificate={() => setCertModalOpen(true)}
                    />
                </div>
            </aside>

            <div className="min-w-0 space-y-14 sm:space-y-20 lg:col-start-1 lg:row-start-1">
                {accessMode !== 'full' && <PainPointsSection content={content} courseId={course.id} isSubscribed={isSubscribed} />}

                <AboutSection content={content} description={course.description} modules={course.courseModules} />

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
                    lectureAccessError={lectureAccessError}
                    lectureGateNotice={lectureGateNotice}
                    setLectureGateNotice={setLectureGateNotice}
                    authUserEmail={authUser?.email}
                    // A student already in the course with some lectures still
                    // locked is paying it off — to their balance, not to buy it again.
                    onLockedLectureClick={() => navigate(isEnrolled ? '/my-account?section=payments' : `/checkout?type=course&id=${course.id}`)}
                />

                <InstructorSection course={course} therapists={therapists} content={content} />

                <CertificateShowcase course={course} content={content} onPreview={() => setCertModalOpen(true)} />

                <ProofSection content={content} testimonials={testimonials} rating={ratingData} students={Number(course.students) || 0} />

                <GallerySection
                    content={content}
                    globalContent={globalContent}
                    galleryImages={galleryImages}
                    galleryLightboxIdx={galleryLightboxIdx}
                    setGalleryLightboxIdx={setGalleryLightboxIdx}
                />

                <ValueStackSection
                    course={course}
                    content={content}
                    lectureCount={lectures.length}
                    currentPrice={currentPrice}
                    oldPrice={oldPrice}
                    discountedPrice={discountedPrice}
                    currencySymbol={currencySymbol}
                    isSubscribed={isSubscribed}
                />

                <FaqSection content={content} openFaq={openFaq} setOpenFaq={setOpenFaq} />

                {!isSubscribed && (
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
                )}

                {/* The visitor already sees the average in «خريجينا بيتكلموا»; this is where a student rates. */}
                {isEnrolled && (
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
                )}
            </div>
        </div>
      </div>

      <FinalCtaSection course={course} content={content} isSubscribed={isSubscribed} />
      <RelatedCoursesSection content={content} courses={courses} currentCourseId={course.id} currency={currency} />

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
        onBuyNow={goEnroll}
        onRegisterClick={scrollToLeadForm}
      />

      {certModalOpen && (
        <CourseCertificate
          studentName={globalContent['courseDetails.cert.sampleName'] || 'اسم الطالب'}
          studentNameEn={globalContent['courseDetails.cert.sampleNameEn'] || 'Student Name'}
          courseName={course.title}
          courseNameEn={course.titleEn}
          instructorName={course.instructor || globalContent['courseDetails.cert.instructorName'] || 'معهد الدراسات النفسية'}
          certNumber="SAMPLE-2025"
          issuedAt={new Date().toLocaleDateString('ar-EG-u-nu-latn', { timeZone: CAIRO_TIME_ZONE })}
          onClose={() => setCertModalOpen(false)}
          sample
        />
      )}
    </div>
  );
};

export default CourseDetails;
