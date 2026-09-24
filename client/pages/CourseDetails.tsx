import React, { useEffect, useMemo, useState } from 'react';
import { useEscapeKey } from '../../shared/ui/useEscapeKey';
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
import CourseCertificate from '../components/CourseCertificate';
import { isExpiryActive } from '../../shared/cairoDate';
import { CAIRO_TIME_ZONE } from '../../shared/cairoDate';

const CourseDetails: React.FC = () => {
                const { courses, subscribers, discounts, addPublicLead, getCourseLectures, getCourseChapters, content: globalContent, testimonials, currency, authUser, bundles, mySubscriberId, mySubscriberLoaded, refreshMySubscriber } = useSiteData();
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
    // getCourseLectures is deliberately not a dependency: SiteDataContext builds
    // it fresh on every provider render, so listing it here would re-run this
    // course fetch on each of them. It is only read to test whether the cached
    // catalog already has the curriculum, which id/slug/courseFromCtx cover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, slug, courseFromCtx]);
  const course = courseFromCtx ?? apiFallbackCourse;
  const [, setShowLeadForm] = useState(true);
    const [selectedLectureId, setSelectedLectureId] = useState('');
    // Resolved playable URL — paid lectures no longer ship their URL publicly; fetched on demand.
    // Stored with its lecture, so the render that switches lectures never hands
    // the new player the previous lecture's ticket (UserDashboardVideoPlayer has
    // the whole story).
    const [resolvedLecture, setResolvedLecture] = useState({ lectureId: '', url: '' });
    const resolvedLectureUrl = resolvedLecture.lectureId === selectedLectureId ? resolvedLecture.url : '';
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
        if (!selectedLecture || selectedLecture.locked) return;
        const lectureId = selectedLecture.id;
        if (selectedLecture.videoUrl) { setResolvedLecture({ lectureId, url: selectedLecture.videoUrl }); return; }
        mysqlClient.getLectureAccess(lectureId)
            .then(r => { if (!cancelled && r.accessible && r.video_url) setResolvedLecture({ lectureId, url: r.video_url }); })
            .catch(() => {});
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
        onPreviewCertificate={() => setCertModalOpen(true)}
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

      {certModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setCertModalOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="relative w-full max-w-4xl">
            <button
              onClick={() => setCertModalOpen(false)}
              aria-label="إغلاق"
              className="absolute -top-3 -left-3 z-10 w-9 h-9 bg-white rounded-full shadow-xl flex items-center justify-center text-gray-600 hover:text-red-500 transition text-xl leading-none"
            >
              ×
            </button>
            <CourseCertificate
              studentName={globalContent['courseDetails.cert.sampleName'] || 'اسم الطالب'}
              studentNameEn={globalContent['courseDetails.cert.sampleNameEn'] || 'Student Name'}
              courseName={course.title}
              courseNameEn={course.titleEn}
              instructorName={course.instructor || globalContent['courseDetails.cert.instructorName'] || 'معهد الدراسات النفسية'}
              certNumber="SAMPLE-2025"
              issuedAt={new Date().toLocaleDateString('ar-EG-u-nu-latn', { timeZone: CAIRO_TIME_ZONE })}
              onClose={() => setCertModalOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default CourseDetails;
