import { useEffect, useRef, useState } from 'react';
import type {
  Course, Bundle, Therapist, TestimonialItem,
  CourseLectureItem, CourseChapterItem,
  CommunityPostItem, CommunityLibraryItem, CommunityVideoItem, CommunityEventItem,
} from '../../types';
import { mysqlCatalog } from '../../lib/mysqlapi';

interface CatalogDataArgs {
  initialCourses: Course[];
  initialBundles: Bundle[];
  initialTherapists: Therapist[];
  initialTestimonials: TestimonialItem[];
  isAdmin: boolean;
  authUserUid: string | undefined;
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
  isAdmin, authUserUid, mergeContent,
  setLectures, setChapters,
  setCommunityPosts, setCommunityLibraryItems, setCommunityVideos, setCommunityEvents,
}: CatalogDataArgs) {
  const [courses, setCourses] = useState<Course[]>(initialCourses);
  const [bundles, setBundles] = useState<Bundle[]>(initialBundles);
  const [therapists, setTherapists] = useState<Therapist[]>(initialTherapists);
  const [testimonials, setTestimonials] = useState<TestimonialItem[]>(initialTestimonials);
  const [remoteReady, setRemoteReady] = useState(false);
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
          // Lectures/chapters are NOT loaded here — see the login-gated effect
          // below. Anonymous visitors never need the full ~530 KB lecture list.
        } catch { /* ignore — graceful degradation */ }
      })();
    }

    // (Admin inbox loading removed — admin features live in the admin app only)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserUid, isAdmin]);

  // Bulk lectures/chapters (~530 KB) are only consumed by the logged-in student
  // dashboard, which needs per-lecture progress across every enrolled course.
  // Anonymous visitors browsing the homepage/catalog never touch it, and the
  // public course page (CourseDetails) fetches its own course's lectures on
  // demand — so this loads once, only after a real user id appears, instead of
  // on every public page view. Own guard (not catalogLoadedRef) because auth
  // resolves after that guarded effect has already fired.
  const lecturesLoadedRef = useRef(false);
  useEffect(() => {
    if (isAdmin || !authUserUid || lecturesLoadedRef.current) return;
    lecturesLoadedRef.current = true;
    (async () => {
      const [lRes, chRes] = await Promise.allSettled([
        mysqlCatalog.listLectures(5000),
        mysqlCatalog.listChapters(),
      ]);
      if (lRes.status === 'fulfilled' && (lRes.value as unknown[]).length > 0)
        setLectures(lRes.value as unknown as CourseLectureItem[]);
      if (chRes.status === 'fulfilled' && (chRes.value as unknown[]).length > 0)
        setChapters(chRes.value as unknown as CourseChapterItem[]);
    })();
  }, [isAdmin, authUserUid, setLectures, setChapters]);

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

  return {
    courses, setCourses, bundles, therapists, testimonials,
    remoteReady,
  };
}
