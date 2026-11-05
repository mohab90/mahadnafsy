import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BUNDLES, COURSES, TESTIMONIALS, THERAPISTS } from '../constants';
import { AuthUser, Bundle, ConsultationItem, ContactMessage, Course, Currency, DiscountRule, JoinUsApplication, NotificationBroadcast, Therapist, LeadItem, SubscriberItem, CourseLectureItem, CourseChapterItem, TestimonialItem, CommunityComment, CommunityPostItem, CommunityLibraryItem, CommunityVideoItem, CommunityEventItem, CourseQuiz, QuizAttempt, LiveStream } from '../types';
import { mysqlForms } from '../lib/mysqlapi';
import { trackLead } from '../lib/tracking';
import { useAuth } from './AuthContext';
import { useActivityLog } from './site-data-hooks/useActivityLog';
import { useCurrency } from './site-data-hooks/useCurrency';
import { useSiteContent } from './site-data-hooks/useSiteContent';
import { useDiscounts } from './site-data-hooks/useDiscounts';
import { useNotifications } from './site-data-hooks/useNotifications';
import { useLiveStreams } from './site-data-hooks/useLiveStreams';
import { useCourseCurriculum } from './site-data-hooks/useCourseCurriculum';
import { useCommunityData } from './site-data-hooks/useCommunityData';
import { useQuizzes } from './site-data-hooks/useQuizzes';
import { useClientAccountRuntime } from './site-data-hooks/useClientAccountRuntime';
import { readVersionedCache, writeVersionedCache } from '../../shared/siteDataCache';
import { useCatalogData } from './site-data-hooks/useCatalogData';
import { defaultContent } from '../../shared/siteContentDefaults';

interface SiteDataShape {
  courses: Course[];
  bundles: Bundle[];
  therapists: Therapist[];
  testimonials: TestimonialItem[];
  subscribers: SubscriberItem[];
  isStaff: boolean;
  consultations: ConsultationItem[];
  communityPosts: CommunityPostItem[];
  communityLibraryItems: CommunityLibraryItem[];
  communityVideos: CommunityVideoItem[];
  communityEvents: CommunityEventItem[];
  /** Fetch community posts, library, videos and events — once, on the one screen that shows them. */
  loadCommunity: () => Promise<void>;
  content: Record<string, string>;
  discounts: DiscountRule[];
  notifications: NotificationBroadcast[];
  notificationReadIds: string[];
  markBroadcastNotificationRead: (id: string) => Promise<boolean>;
  markAllBroadcastNotificationsRead: () => Promise<boolean>;
  addJoinUsApplication: (item: JoinUsApplication) => Promise<void>;
  addContactMessage: (item: ContactMessage) => Promise<void>;
  addPublicLead: (item: Omit<LeadItem, 'clientCode'> & { clientCode?: string }) => Promise<void>;
  getCourseChapters: (courseId: string) => CourseChapterItem[];
  addCommunityPost: (item: CommunityPostItem) => Promise<void>;
  updateCommunityPost: (item: CommunityPostItem) => Promise<void>;
  deleteCommunityPost: (id: string) => Promise<void>;
  toggleCommunityPostLike: (id: string) => Promise<{ liked: boolean; likes: number }>;
  addCommunityPostComment: (id: string, body: string) => Promise<CommunityComment>;
  getCourseLectures: (courseId: string) => CourseLectureItem[];
  courseQuizzes: CourseQuiz[];
  quizAttempts: QuizAttempt[];
  submitQuizAttempt: (quiz: CourseQuiz, subscriberId: string, answers: number[]) => Promise<{ score: number; passed: boolean }>;
  liveStreams: LiveStream[];
  currency: Currency;
  setCurrency: (c: Currency) => void;
  authUser: AuthUser | null | undefined;
  isAdmin: boolean;
  remoteReady: boolean;
  /** The courses/bundles request failed: show a retry, not «غير موجود». */
  catalogFailed: boolean;
  retryCatalog: () => void;
  mySubscriberLoaded: boolean;
  /** Subscriber the server resolved for this account; null when signed out or
   *  when the account has no subscriber record. Screens must use this instead
   *  of matching authUser.email, which is null for WhatsApp-only clients. */
  mySubscriberId: string | null;
  refreshMySubscriber: () => void;
  reloadLectures: () => Promise<void>;
  logout: () => void;
  refreshAuth: () => void;
}

const STORAGE_KEY = 'mahad-admin-site-data-v1';
const DATA_VERSION = 4; // v4 removes CRM/HR/finance/customer data from browser persistence


// Keys whose old values must be replaced with the new default — even if Firestore has the old value.


const defaultSubscribers: SubscriberItem[] = [];

const defaultConsultations: ConsultationItem[] = [];

const defaultLectures: CourseLectureItem[] = COURSES.flatMap((course) =>
  course.modules.map((moduleTitle, idx) => ({
    id: `lec-${course.id}-${idx + 1}`,
    courseId: course.id,
    title: moduleTitle,
    lectureType: 'recorded' as const,
    videoUrl: `https://example.com/lecture/${course.id}/${idx + 1}`,
    duration: '45 دقيقة',
    order: idx + 1,
  }))
);

const defaultCommunityPosts: CommunityPostItem[] = [];

const defaultCommunityLibraryItems: CommunityLibraryItem[] = [];

const defaultCommunityVideos: CommunityVideoItem[] = [];

const defaultCommunityEvents: CommunityEventItem[] = [];

// NOTE: seedData is used ONLY on the very first run when no saved data exists.
// Once real data is loaded from Firestore or localStorage, seedData is never used again.
// Do NOT add real production records here — they will be overwritten on next Firestore sync.
const seedData = {
  courses: COURSES,
  bundles: BUNDLES,
  therapists: THERAPISTS,
  testimonials: TESTIMONIALS,
  subscribers: defaultSubscribers,
  consultations: defaultConsultations,
  lectures: defaultLectures,
  chapters: [] as CourseChapterItem[],
  communityPosts: defaultCommunityPosts,
  communityLibraryItems: defaultCommunityLibraryItems,
  communityVideos: defaultCommunityVideos,
  communityEvents: defaultCommunityEvents,
  loadCommunity: async () => {},
  content: defaultContent,
  discounts: [] as DiscountRule[],
  notifications: [] as NotificationBroadcast[],
};

const SiteDataContext = createContext<SiteDataShape | null>(null);

export const SiteDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initial = (() => {
    const cached = readVersionedCache<typeof seedData>(STORAGE_KEY, DATA_VERSION);
    if (!cached) return seedData;
    return { ...seedData, ...cached, content: { ...defaultContent, ...(cached.content || {}) } };
  })();

  const [subscribers, setSubscribers] = useState<SubscriberItem[]>(initial.subscribers || defaultSubscribers);
  const [consultations, setConsultations] = useState<ConsultationItem[]>(initial.consultations || defaultConsultations);
  const { authUser, logout, refreshAuth } = useAuth();
  const isAdmin = Boolean(authUser?.isAdmin);
  const { track } = useActivityLog(authUser, []);
  const { currency, setCurrency } = useCurrency();
  const { content, mergeContent } = useSiteContent(initial.content);
  const { discounts } = useDiscounts((initial as typeof seedData & { discounts?: DiscountRule[] }).discounts || []);
  const { notifications, readIds: notificationReadIds, markRead: markBroadcastNotificationRead, markAllRead: markAllBroadcastNotificationsRead } = useNotifications(
    (initial as typeof seedData & { notifications?: NotificationBroadcast[] }).notifications || [],
    authUser?.uid,
    isAdmin,
  );
  const { liveStreams } = useLiveStreams(
    (initial as typeof seedData & { liveStreams?: LiveStream[] }).liveStreams || [],
    authUser?.uid,
    isAdmin,
  );
  const {
    setLectures, setChapters,
    getCourseChapters, getCourseLectures, reloadLectures,
  } = useCourseCurriculum(initial.lectures || defaultLectures, initial.chapters || []);
  const {
    communityPosts, setCommunityPosts, communityLibraryItems, setCommunityLibraryItems,
    communityVideos, setCommunityVideos, communityEvents, setCommunityEvents,
    addCommunityPost, updateCommunityPost, deleteCommunityPost,
    toggleCommunityPostLike, addCommunityPostComment,
  } = useCommunityData(
    initial.communityPosts || defaultCommunityPosts,
    initial.communityLibraryItems || defaultCommunityLibraryItems,
    initial.communityVideos || defaultCommunityVideos,
    initial.communityEvents || defaultCommunityEvents,
    track,
  );
  const {
    courseQuizzes, quizAttempts, submitQuizAttempt,
  } = useQuizzes(
    (initial as typeof seedData & { courseQuizzes?: CourseQuiz[] }).courseQuizzes || [],
    (initial as typeof seedData & { quizAttempts?: QuizAttempt[] }).quizAttempts || [],
    authUser, isAdmin, subscribers, track,
  );
  const {
    courses, setCourses, bundles, therapists, testimonials,
    remoteReady, catalogFailed, retryCatalog, loadCommunity,
  } = useCatalogData({
    initialCourses: initial.courses, initialBundles: initial.bundles,
    initialTherapists: initial.therapists, initialTestimonials: initial.testimonials,
    isAdmin, authUserUid: authUser?.uid, mergeContent,
    setLectures, setChapters,
    setCommunityPosts, setCommunityLibraryItems, setCommunityVideos, setCommunityEvents,
  });
  // Debounce timers for MySQL persist effects
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Auth: restore session via httpOnly cookie — managed by AuthContext (AuthProvider above SiteDataProvider)



  const { mySubscriberLoaded, mySubscriberId, refreshMySubscriber, isStaff } = useClientAccountRuntime({
    authUser,
    isAdmin,
    setSubscribers,
    setCourses,
    setConsultations,
  });

  // addPublicLead: for public registration forms — uses MySQL /api/registrations (no auth needed).
  const addPublicLead = async (item: Omit<LeadItem, 'clientCode'> & { clientCode?: string }): Promise<void> => {
    try {
      await mysqlForms.submitRegistration(item as unknown as Record<string,unknown>);
      track('create', 'lead', item.name);
      trackLead({ source: (item as { source?: string }).source || 'registration' });
    } catch (error) {
      // Public forms must never report success for a lead that only exists in
      // browser memory. Surface the server failure to the page instead.
      throw error instanceof Error ? error : new Error('تعذر حفظ طلبك. حاول مرة أخرى.');
    }
  };


  // Updates local state only — no API call. Use for bulk auto-convert on mount.



  // Batch-assign client codes — write only the changed documents to their collections.





  // (Orders CRUD removed — orders are managed in the admin app; client checkout talks to the API directly)

  // (Expenses & Daqqi-rounds CRUD removed — admin-app-only features)

  const addJoinUsApplication = async (item: JoinUsApplication): Promise<void> => {
    await mysqlForms.submitJoinUs(item as unknown as Record<string, unknown>);
    track('create', 'joinUs', item.name);
  };

  const addContactMessage = async (item: ContactMessage): Promise<void> => {
    await mysqlForms.submitContact({
      name: item.name,
      email: item.email,
      phone: (item as ContactMessage & { phone?: string }).phone || '',
      subject: item.subject,
      message: item.message,
    } as unknown as Record<string, unknown>);
    track('create', 'contactMessage', item.name);
    trackLead({ source: 'contact', contentName: item.subject });
  };

  // ── Public catalog cache only. Customer/CRM/HR/finance data is server-owned
  // and must never be copied into localStorage where origin scripts can read it.
  useEffect(() => {
    const payloadObject = {
      courses,
      bundles,
      therapists,
      testimonials,
      communityPosts,
      communityLibraryItems,
      communityVideos,
      communityEvents,
      content,
      discounts,
      notifications,
      liveStreams,
    };
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      writeVersionedCache(STORAGE_KEY, DATA_VERSION, payloadObject);
    }, 500);
    return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); };
  }, [courses, bundles, therapists, testimonials, communityPosts, communityLibraryItems, communityVideos, communityEvents, content, discounts, notifications, liveStreams]);

  // (AI/messaging settings persist removed — admin-app-only)

  const value = useMemo<SiteDataShape>(() => ({
    courses,
    bundles,
    therapists,
    testimonials,
    subscribers,
    isStaff,
    consultations,
    communityPosts,
    communityLibraryItems,
    communityVideos,
    communityEvents,
    loadCommunity,
    content,
    discounts,
    notifications,
    notificationReadIds,
    markBroadcastNotificationRead,
    markAllBroadcastNotificationsRead,
    addPublicLead,
    getCourseChapters,
    addCommunityPost,
    updateCommunityPost,
    deleteCommunityPost,
    toggleCommunityPostLike,
    addCommunityPostComment,
    getCourseLectures,
    courseQuizzes,
    quizAttempts,
    submitQuizAttempt,
    liveStreams,
    addJoinUsApplication,
    addContactMessage,
    currency,
    setCurrency,
    authUser,
    isAdmin,
    remoteReady,
    catalogFailed,
    retryCatalog,
    mySubscriberLoaded,
    mySubscriberId,
    refreshMySubscriber,
    reloadLectures,
    logout,
    refreshAuth,
    // Keyed on the data, not on the action functions this value also carries.
    // Those are rebuilt on each provider render, so listing them — which is what
    // the rule asks for — would mint a new context value every render and
    // re-render every consumer on the public site. The two curriculum getters
    // are the exception: they are memoized on lectures/chapters, which arrive
    // last, so they must be listed or «كورساتي», the player and the progress bar
    // keep reading the empty lists from before the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [courses, bundles, therapists, testimonials, subscribers, isStaff, consultations,
    communityPosts, communityLibraryItems, communityVideos,
    communityEvents, content, discounts, notifications, notificationReadIds, courseQuizzes, quizAttempts,
    liveStreams, currency, authUser, isAdmin, isStaff, remoteReady, catalogFailed, retryCatalog,
    mySubscriberId, mySubscriberLoaded, getCourseChapters, getCourseLectures]);

  return <SiteDataContext.Provider value={value}>{children}</SiteDataContext.Provider>;
};

export const useSiteData = () => {
  const ctx = useContext(SiteDataContext);
  if (!ctx) {
    throw new Error('useSiteData must be used inside SiteDataProvider');
  }
  return ctx;
};

