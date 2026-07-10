import { useEffect, useRef, useState } from 'react';
import type {
  Course, Bundle, Therapist, TestimonialItem,
  CourseLectureItem, CourseChapterItem,
  CommunityPostItem, CommunityLibraryItem, CommunityVideoItem, CommunityEventItem,
} from '../../types';
import { mysqlCatalog, mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const persistCourseToCollection = (_course: Course) => { /* PG-only — no Firestore write */ };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const persistBundleToCollection = (_bundle: Bundle) => { /* PG-only — no Firestore write */ };

interface CatalogDataArgs {
  initialCourses: Course[];
  initialBundles: Bundle[];
  initialTherapists: Therapist[];
  initialTestimonials: TestimonialItem[];
  isAdmin: boolean;
  authUserUid: string | undefined;
  track: Track;
  mergeContent: (data: Record<string, string>) => void;
  setLectures: React.Dispatch<React.SetStateAction<CourseLectureItem[]>>;
  setChapters: React.Dispatch<React.SetStateAction<CourseChapterItem[]>>;
  setCommunityPosts: React.Dispatch<React.SetStateAction<CommunityPostItem[]>>;
  setCommunityLibraryItems: React.Dispatch<React.SetStateAction<CommunityLibraryItem[]>>;
  setCommunityVideos: React.Dispatch<React.SetStateAction<CommunityVideoItem[]>>;
  setCommunityEvents: React.Dispatch<React.SetStateAction<CommunityEventItem[]>>;
}

/**
 * Catalog domain: courses/bundles/therapists/testimonials, plus the combined
 * public catalog+community loading effect (they were fetched together in one
 * effect pre-extraction — kept together here since splitting the fetch would
 * mean splitting `catalogLoadedRef`, which guards all of it firing exactly once).
 */
export function useCatalogData({
  initialCourses, initialBundles, initialTherapists, initialTestimonials,
  isAdmin, authUserUid, track, mergeContent,
  setLectures, setChapters,
  setCommunityPosts, setCommunityLibraryItems, setCommunityVideos, setCommunityEvents,
}: CatalogDataArgs) {
  const [courses, setCourses] = useState<Course[]>(initialCourses);
  const [bundles, setBundles] = useState<Bundle[]>(initialBundles);
  const [therapists, setTherapists] = useState<Therapist[]>(initialTherapists);
  const [testimonials, setTestimonials] = useState<TestimonialItem[]>(initialTestimonials);
  const [remoteReady, setRemoteReady] = useState(false);
  const isHydratingRef = useRef(true);
  const lastLocalConfigWriteRef = useRef(0);
  // Guards the public catalog/community load (below) so it fires its ~12 API
  // calls exactly ONCE per page load. authUser resolves asynchronously and
  // its identity can change (undefined -> null, or null -> a real uid) several
  // times before settling — without this guard, every one of those transitions
  // re-ran the entire courses/bundles/therapists/testimonials/community/
  // lectures/chapters fetch sequence from scratch (measured: 3x duplicate
  // network waterfall on every page load).
  const catalogLoadedRef = useRef(false);

  // ── Community + catalog loader (public, non-admin) ──────────────────────────
  // Admin catalog is loaded by the bootstrap above. Non-admin guests load via MySQL.
  useEffect(() => {
    isHydratingRef.current = false;
    setRemoteReady(true);

    // authUser resolves asynchronously (undefined -> null/uid), which can re-fire this
    // effect 2-3x before settling. Without this guard each firing re-ran the ENTIRE
    // catalog+community fetch sequence (~12 requests, incl. all 5000 lectures) from
    // scratch — tripling page-load network traffic. Only the first firing loads data;
    // later firings (e.g. auth churn, isAdmin resolving) are no-ops here.
    if (catalogLoadedRef.current) return;
    catalogLoadedRef.current = true;

    // Load community content for all users (deferred 300ms to let critical auth/catalog load first)
    setTimeout(() => {
      Promise.allSettled([
        mysqlCatalog.listCommunityPosts(),
        mysqlCatalog.listCommunityLibrary(),
        mysqlCatalog.listCommunityVideos(),
        mysqlCatalog.listCommunityEvents(),
      ]).then(([pRes, lRes, vRes, eRes]) => {
        if (pRes.status === 'fulfilled' && pRes.value.length > 0)
          setCommunityPosts((pRes.value as unknown as CommunityPostItem[]).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
        if (lRes.status === 'fulfilled' && lRes.value.length > 0)
          setCommunityLibraryItems(lRes.value as unknown as CommunityLibraryItem[]);
        if (vRes.status === 'fulfilled' && vRes.value.length > 0)
          setCommunityVideos(vRes.value as unknown as CommunityVideoItem[]);
        if (eRes.status === 'fulfilled' && eRes.value.length > 0)
          setCommunityEvents((eRes.value as unknown as CommunityEventItem[]).sort((a, b) => (b.eventDate || b.dateLabel || '').localeCompare(a.eventDate || a.dateLabel || '')));
      }).catch(() => {});
    }, 300);

    // Load catalog for non-admin users in 2 sequential batches to avoid overwhelming DB connection pool.
    // Batch A (immediate): catalog data needed for home/courses pages.
    // Batch B (500ms later): lectures & chapters needed for course detail pages (lighter limit).
    if (!isAdmin) {
      // Load dynamic site content from API (hero text, page texts, etc.) — merge over defaults
      mysqlCatalog.getSiteContent().then((remote) => {
        if (remote && typeof remote === 'object' && Object.keys(remote).length > 0) {
          mergeContent(remote);
        }
      }).catch(() => { /* graceful — defaults remain */ });

      (async () => {
        try {
          // ── Batch A: courses/bundles/testimonials/therapists ──────────────────
          const [cRes, bRes, thRes, testRes] = await Promise.allSettled([
            mysqlCatalog.listCourses(200),
            mysqlCatalog.listBundles(100),
            mysqlCatalog.listTherapists(100),
            mysqlCatalog.listTestimonials(),
          ]);
          if (cRes.status === 'fulfilled' && cRes.value.length > 0)
            setCourses((cRes.value as unknown as Course[]).sort((a, b) => {
              const so = ((a as any).sortOrder ?? 9999) - ((b as any).sortOrder ?? 9999);
              if (so !== 0) return so;
              return (b.createdAt || b.id || '').localeCompare(a.createdAt || a.id || '');
            }));
          if (bRes.status === 'fulfilled' && bRes.value.length > 0)
            setBundles(bRes.value as unknown as Bundle[]);
          if (thRes.status === 'fulfilled' && thRes.value.length > 0)
            setTherapists(thRes.value as unknown as Therapist[]);
          if (testRes.status === 'fulfilled' && testRes.value.length > 0)
            setTestimonials(testRes.value as unknown as TestimonialItem[]);

          // ── Batch B: lectures/chapters (deferred 500ms) ───────────────────────
          await new Promise(r => setTimeout(r, 500));
          const [lRes, chRes] = await Promise.allSettled([
            mysqlCatalog.listLectures(5000),
            mysqlCatalog.listChapters(),
          ]);
          if (lRes.status === 'fulfilled' && (lRes.value as unknown[]).length > 0)
            setLectures(lRes.value as unknown as CourseLectureItem[]);
          if (chRes.status === 'fulfilled' && (chRes.value as unknown[]).length > 0)
            setChapters(chRes.value as unknown as CourseChapterItem[]);
        } catch { /* ignore — graceful degradation */ }
      })();
    }

    // (Admin inbox loading removed — admin features live in the admin app only)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserUid, isAdmin]);

  // Auto-refresh the catalog when the visitor returns to the tab, so courses/bundles
  // added or edited in the admin show up without a manual page reload. Throttled to ~15s.
  useEffect(() => {
    if (isAdmin) return;
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - last < 15000) return;
      last = Date.now();
      Promise.allSettled([mysqlCatalog.listCourses(200), mysqlCatalog.listBundles(100)]).then(([cRes, bRes]) => {
        if (cRes.status === 'fulfilled' && (cRes.value as unknown[]).length > 0)
          setCourses((cRes.value as unknown as Course[]).sort((a, b) => {
            const so = ((a as any).sortOrder ?? 9999) - ((b as any).sortOrder ?? 9999);
            if (so !== 0) return so;
            return (b.createdAt || b.id || '').localeCompare(a.createdAt || a.id || '');
          }));
        if (bRes.status === 'fulfilled' && (bRes.value as unknown[]).length > 0)
          setBundles(bRes.value as unknown as Bundle[]);
      }).catch(() => {});
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [isAdmin]);

  const addCourse = (course: Course) => {
    lastLocalConfigWriteRef.current = Date.now();
    let resolvedCourse = course;
    setCourses((prev) => {
      if (course.courseCode) {
        resolvedCourse = course;
        return [course, ...prev];
      }
      const maxCode = prev
        .map((c) => parseInt(c.courseCode || '0', 10))
        .filter((n) => !isNaN(n) && n >= 3000);
      const nextCode = maxCode.length > 0 ? Math.max(...maxCode) + 1 : 3000;
      resolvedCourse = { ...course, courseCode: String(nextCode) };
      return [resolvedCourse, ...prev];
    });
    // Write after state update so resolvedCourse is fully set
    setTimeout(() => persistCourseToCollection(resolvedCourse), 0);
    void mysqlAdmin.saveCourse(resolvedCourse as unknown as Record<string, unknown>);
    track('create', 'course', resolvedCourse.title);
  };

  const updateCourse = (course: Course) => {
    lastLocalConfigWriteRef.current = Date.now();
    setCourses((prev) => prev.map((item) => (item.id === course.id ? course : item)));
    // Update all bundles that embed this course
    setBundles((prev) => {
      const updated = prev.map((bundle) => {
        const hasCourse = bundle.courses.some(c => c.id === course.id);
        if (!hasCourse) return bundle;
        const newBundle = { ...bundle, courses: bundle.courses.map((c) => (c.id === course.id ? course : c)) };
        persistBundleToCollection(newBundle);
        return newBundle;
      });
      return updated;
    });
    persistCourseToCollection(course);
    void mysqlAdmin.saveCourse(course as unknown as Record<string, unknown>);
    track('update', 'course', course.title);
  };

  const deleteCourse = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    setCourses((prev) => prev.filter((item) => item.id !== id));
    void mysqlAdmin.deleteCourse(id);
    // Remove course from bundles that embed it
    setBundles((prev) => {
      return prev.map((bundle) => {
        if (!bundle.courses.some(c => c.id === id)) return bundle;
        const newBundle = { ...bundle, courses: bundle.courses.filter((c) => c.id !== id) };
        persistBundleToCollection(newBundle);
        return newBundle;
      });
    });
    track('delete', 'course', id);
  };

  const addTherapist = (therapist: Therapist) => {
    lastLocalConfigWriteRef.current = Date.now();
    const nextTherapists = [therapist, ...therapists];
    setTherapists(nextTherapists);
    persistTherapistsToConfig(nextTherapists);
    void mysqlAdmin.saveTherapist(therapist as unknown as Record<string, unknown>);
    track('create', 'therapist', therapist.name);
  };

  const updateTherapist = (therapist: Therapist) => {
    lastLocalConfigWriteRef.current = Date.now();
    const old = therapists.find((item) => item.id === therapist.id);
    const nextTherapists = therapists.map((item) => (item.id === therapist.id ? therapist : item));
    if (old && old.name !== therapist.name) {
      setCourses((coursesPrev) => {
        const updated = coursesPrev.map((c) => (c.instructor === old.name ? { ...c, instructor: therapist.name } : c));
        // Persist any courses that changed instructor name to their collection documents
        updated.filter(c => c.instructor === therapist.name && coursesPrev.find(oc => oc.id === c.id)?.instructor === old.name)
          .forEach(c => persistCourseToCollection(c));
        return updated;
      });
    }
    setTherapists(nextTherapists);
    persistTherapistsToConfig(nextTherapists);
    void mysqlAdmin.saveTherapist(therapist as unknown as Record<string, unknown>);
    track('update', 'therapist', therapist.name);
  };

  const deleteTherapist = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    const target = therapists.find((item) => item.id === id);
    const nextTherapists = therapists.filter((item) => item.id !== id);
    setTherapists(nextTherapists);
    persistTherapistsToConfig(nextTherapists);
    void mysqlAdmin.deleteTherapist(id);
    if (target) {
      track('delete', 'therapist', target.name);
    }
  };

  const bundleToServerPayload = (bundle: Bundle): Record<string, unknown> => ({
    id: bundle.id,
    title: bundle.title,
    title_en: bundle.titleEn || null,
    slug: bundle.slug || null,
    short_description: bundle.shortDescription || '',
    description: bundle.description,
    thumbnail: bundle.thumbnail || '',
    video_url: bundle.videoUrl || null,
    price_egp: bundle.price?.EGP || 0,
    price_sar: bundle.price?.SAR || 0,
    price_usd: bundle.price?.USD || 0,
    orig_price_egp: bundle.originalPrice?.EGP || 0,
    orig_price_sar: bundle.originalPrice?.SAR || 0,
    orig_price_usd: bundle.originalPrice?.USD || 0,
    details_content_json: bundle.detailsContent ? JSON.stringify(bundle.detailsContent) : null,
    is_published: bundle.isPublished !== false ? 1 : 0,
    sort_order: bundle.sortOrder ?? 0,
    course_ids: bundle.courses.map((c) => c.id),
  });

  const addBundle = (bundle: Bundle) => {
    lastLocalConfigWriteRef.current = Date.now();
    setBundles((prev) => [bundle, ...prev]);
    persistBundleToCollection(bundle);
    void mysqlAdmin.saveBundle(bundleToServerPayload(bundle));
    track('create', 'bundle', bundle.title);
  };

  const updateBundle = (bundle: Bundle) => {
    lastLocalConfigWriteRef.current = Date.now();
    setBundles((prev) => prev.map((item) => (item.id === bundle.id ? bundle : item)));
    persistBundleToCollection(bundle);
    void mysqlAdmin.saveBundle(bundleToServerPayload(bundle));
    track('update', 'bundle', bundle.title);
  };

  const deleteBundle = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    setBundles((prev) => prev.filter((item) => item.id !== id));
    void mysqlAdmin.deleteBundle(id);
    track('delete', 'bundle', id);
  };

  const addTestimonial = (item: TestimonialItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = [item, ...testimonials];
    setTestimonials(next);
    persistTestimonialsToConfig(next);
    void mysqlAdmin.saveTestimonial(item as unknown as Record<string, unknown>);
    track('create', 'testimonial', item.name);
  };

  const updateTestimonial = (item: TestimonialItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = testimonials.map((row) => (row.id === item.id ? item : row));
    setTestimonials(next);
    persistTestimonialsToConfig(next);
    void mysqlAdmin.saveTestimonial(item as unknown as Record<string, unknown>);
    track('update', 'testimonial', item.name);
  };

  const deleteTestimonial = (id: number) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = testimonials.filter((row) => row.id !== id);
    setTestimonials(next);
    persistTestimonialsToConfig(next);
    void mysqlAdmin.deleteTestimonial(String(id));
    track('delete', 'testimonial', String(id));
  };

  // ── Direct-write helpers for siteData/config fields ──────────────────────────────────────────
  // Each of these writes a SINGLE field immediately on mutation, bypassing the debounce.
  // This ensures the website sees changes instantly even if the echo-loop guard skips the debounce.
  const _persistConfigField = (field: string, value: unknown) => {
    lastLocalConfigWriteRef.current = Date.now();
    void mysqlAdmin.saveSettings({ [field]: JSON.parse(JSON.stringify(value)) } as Record<string, unknown>).catch(() => {});
  };
  const persistTherapistsToConfig = (updatedTherapists: Therapist[]) => _persistConfigField('therapists', updatedTherapists);
  const persistTestimonialsToConfig = (items: TestimonialItem[]) => _persistConfigField('testimonials', items);

  const resetCatalog = (defaults: { courses: Course[]; bundles: Bundle[]; therapists: Therapist[]; testimonials: TestimonialItem[] }) => {
    setCourses(defaults.courses);
    setBundles(defaults.bundles);
    setTherapists(defaults.therapists);
    setTestimonials(defaults.testimonials);
  };

  return {
    courses, setCourses, bundles, therapists, testimonials,
    addCourse, updateCourse, deleteCourse,
    addTherapist, updateTherapist, deleteTherapist,
    addBundle, updateBundle, deleteBundle,
    addTestimonial, updateTestimonial, deleteTestimonial,
    remoteReady, isHydratingRef, resetCatalog,
  };
}
