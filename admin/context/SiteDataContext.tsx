import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BUNDLES, COURSES, TESTIMONIALS, THERAPISTS } from '../constants';
import { AuthUser, Bundle, ConsultationItem, ContactMessage, Course, Currency, DaqqiRound, DiscountRule, ExpenseItem, JoinUsApplication, NotificationBroadcast, Therapist, LeadItem, StaffMember, SubscriberItem, CourseLectureItem, CourseChapterItem, OrderItem, TestimonialItem, CommunityPostItem, CommunityLibraryItem, CommunityVideoItem, CommunityEventItem, ActivityLogItem, AutomationWorkflow, AdminAiConfig, AiAgentConfig, MessagingChannelsConfig, InboxConversation, FacebookLeadAdsConfig, CourseQuiz, QuizAttempt, LiveStream } from '../types';
import { mysqlCatalog, mysqlAdmin, mysqlClient } from '../lib/mysqlapi';
import { useAuth } from './AuthContext';
import { useDiscountsState } from './site-data-hooks/useDiscountsState';
import { useNotificationsState } from './site-data-hooks/useNotificationsState';
import { useClientCodeIssuance } from './site-data-hooks/useClientCodeIssuance';
import { useLiveStreamsState } from './site-data-hooks/useLiveStreamsState';
import { useCurrencyState } from './site-data-hooks/useCurrencyState';
import { useContactMessagesState } from './site-data-hooks/useContactMessagesState';
import { useContentState } from './site-data-hooks/useContentState';
import { useCourseQuizzesState } from './site-data-hooks/useCourseQuizzesState';
import { useCommunityState } from './site-data-hooks/useCommunityState';
import { useAutomationState } from './site-data-hooks/useAutomationState';
import { useActivityLogState } from './site-data-hooks/useActivityLogState';
import { useAiMessagingConfigState } from './site-data-hooks/useAiMessagingConfigState';
import { useCatalogState } from './site-data-hooks/useCatalogState';
import { useLecturesChaptersState } from './site-data-hooks/useLecturesChaptersState';
import { useExpensesState } from './site-data-hooks/useExpensesState';
import { useDaqqiRoundsState } from './site-data-hooks/useDaqqiRoundsState';
import { useStaffState } from './site-data-hooks/useStaffState';
import { useCrmCoreState } from './site-data-hooks/useCrmCoreState';
import { useAdminDataRuntime } from './site-data-hooks/useAdminDataRuntime';
import { readVersionedCache, writeVersionedCache } from '../../shared/siteDataCache';
import {
  defaultCommunityEvents,
  defaultCommunityLibraryItems,
  defaultCommunityPosts,
  defaultCommunityVideos,
  defaultConsultations,
  defaultContent,
  defaultLeads,
  defaultLectures,
  defaultStaffMembers,
  defaultSubscribers,
  seedData,
} from './siteDataSeed';

interface SiteDataShape {
  courses: Course[];
  bundles: Bundle[];
  therapists: Therapist[];
  testimonials: TestimonialItem[];
  subscribers: SubscriberItem[];
  leads: LeadItem[];
  staffMembers: StaffMember[];
  consultations: ConsultationItem[];
  lectures: CourseLectureItem[];
  chapters: CourseChapterItem[];
  orders: OrderItem[];
  communityPosts: CommunityPostItem[];
  communityLibraryItems: CommunityLibraryItem[];
  communityVideos: CommunityVideoItem[];
  communityEvents: CommunityEventItem[];
  content: Record<string, string>;
  activityLogs: ActivityLogItem[];
  discounts: DiscountRule[];
  notifications: NotificationBroadcast[];
  expenses: ExpenseItem[];
  daqqiRounds: DaqqiRound[];
  addDaqqiRound: (item: DaqqiRound) => Promise<boolean>;
  updateDaqqiRound: (item: DaqqiRound) => Promise<boolean>;
  deleteDaqqiRound: (id: string) => Promise<boolean>;
  transferDaqqiAttendee: (subscriberId: string, fromRoundId: string, toRoundId: string) => Promise<boolean>;
  bulkSetDaqqiRounds: (rounds: DaqqiRound[]) => void;
  joinUsApplications: JoinUsApplication[];
  addJoinUsApplication: (item: JoinUsApplication) => Promise<boolean>;
  updateJoinUsApplication: (item: JoinUsApplication) => Promise<boolean>;
  deleteJoinUsApplication: (id: string) => Promise<boolean>;
  reloadJoinUsApplications: () => Promise<void>;
  contactMessages: ContactMessage[];
  addContactMessage: (item: ContactMessage) => Promise<boolean>;
  updateContactMessage: (item: ContactMessage) => Promise<boolean>;
  deleteContactMessage: (id: string) => Promise<boolean>;
  addCourse: (course: Course) => Promise<boolean>;
  updateCourse: (course: Course) => Promise<boolean>;
  deleteCourse: (id: string) => Promise<boolean>;
  addTherapist: (therapist: Therapist) => Promise<boolean>;
  updateTherapist: (therapist: Therapist) => Promise<boolean>;
  deleteTherapist: (id: string) => Promise<boolean>;
  addBundle: (bundle: Bundle) => Promise<boolean>;
  updateBundle: (bundle: Bundle) => Promise<boolean>;
  deleteBundle: (id: string) => Promise<boolean>;
  addTestimonial: (item: TestimonialItem) => Promise<boolean>;
  updateTestimonial: (item: TestimonialItem) => Promise<boolean>;
  deleteTestimonial: (id: number) => Promise<boolean>;
  addSubscriber: (item: SubscriberItem) => Promise<boolean>;
  updateSubscriber: (item: SubscriberItem) => Promise<boolean>;
  deleteSubscriber: (id: string) => Promise<boolean>;
  addLead: (item: LeadItem) => Promise<void>;
  addPublicLead: (item: Omit<LeadItem, 'clientCode'> & { clientCode?: string }) => Promise<void>;
  updateLead: (item: LeadItem) => Promise<boolean>;
  markLeadsConverted: (ids: string[]) => void;
  deleteLead: (id: string) => Promise<boolean>;
  bulkAssignClientCodes: (updatedSubs: SubscriberItem[], updatedLeads: LeadItem[]) => void;
  bulkRedistributeLeads: (mode: 'unassigned' | 'all') => Promise<number>;
  addStaffMember: (item: StaffMember) => Promise<boolean>;
  updateStaffMember: (item: StaffMember) => Promise<boolean>;
  deleteStaffMember: (id: string) => Promise<boolean>;
  addLecture: (item: CourseLectureItem) => Promise<boolean>;
  updateLecture: (item: CourseLectureItem) => Promise<boolean>;
  deleteLecture: (id: string) => Promise<boolean>;
  addChapter: (item: CourseChapterItem) => Promise<boolean>;
  updateChapter: (item: CourseChapterItem) => Promise<boolean>;
  deleteChapter: (id: string) => Promise<boolean>;
  getCourseChapters: (courseId: string) => CourseChapterItem[];
  addOrder: (item: OrderItem) => Promise<boolean>;
  updateOrderStatus: (id: string, status: OrderItem['status']) => Promise<boolean>;
  deleteOrder: (id: string) => Promise<boolean>;
  addCommunityPost: (item: CommunityPostItem) => Promise<boolean>;
  updateCommunityPost: (item: CommunityPostItem) => Promise<boolean>;
  deleteCommunityPost: (id: string) => Promise<boolean>;
  addCommunityLibraryItem: (item: CommunityLibraryItem) => Promise<boolean>;
  updateCommunityLibraryItem: (item: CommunityLibraryItem) => Promise<boolean>;
  deleteCommunityLibraryItem: (id: string) => Promise<boolean>;
  addCommunityVideo: (item: CommunityVideoItem) => Promise<boolean>;
  updateCommunityVideo: (item: CommunityVideoItem) => Promise<boolean>;
  deleteCommunityVideo: (id: string) => Promise<boolean>;
  addCommunityEvent: (item: CommunityEventItem) => Promise<boolean>;
  updateCommunityEvent: (item: CommunityEventItem) => Promise<boolean>;
  deleteCommunityEvent: (id: string) => Promise<boolean>;
  getCourseLectures: (courseId: string) => CourseLectureItem[];
  setContentValue: (key: string, value: string) => Promise<boolean>;
  mergeContent: (data: Record<string, string>) => void;
  addContentKey: (key: string, value: string) => Promise<boolean>;
  removeContentKey: (key: string) => Promise<boolean>;
  clearAllData: () => void;
  addDiscount: (item: DiscountRule) => Promise<void>;
  updateDiscount: (item: DiscountRule) => Promise<void>;
  deleteDiscount: (id: string) => Promise<void>;
  addNotification: (item: NotificationBroadcast) => Promise<void>;
  updateNotification: (item: NotificationBroadcast) => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  courseQuizzes: CourseQuiz[];
  addCourseQuiz: (item: CourseQuiz) => Promise<boolean>;
  updateCourseQuiz: (item: CourseQuiz) => Promise<boolean>;
  deleteCourseQuiz: (id: string) => Promise<boolean>;
  quizAttempts: QuizAttempt[];
  liveStreams: LiveStream[];
  addLiveStream: (item: LiveStream) => Promise<boolean>;
  updateLiveStream: (item: LiveStream) => Promise<boolean>;
  deleteLiveStream: (id: string) => Promise<boolean>;
  addExpense: (item: ExpenseItem) => Promise<void>;
  updateExpense: (item: ExpenseItem) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  automationWorkflows: AutomationWorkflow[];
  addAutomationWorkflow: (item: AutomationWorkflow) => Promise<boolean>;
  updateAutomationWorkflow: (item: AutomationWorkflow) => Promise<boolean>;
  deleteAutomationWorkflow: (id: string) => Promise<boolean>;
  adminAiConfig: AdminAiConfig | null;
  setAdminAiConfig: (config: AdminAiConfig) => Promise<boolean>;
  aiAgentConfig: AiAgentConfig | null;
  setAiAgentConfig: (config: AiAgentConfig) => Promise<boolean>;
  messagingChannels: MessagingChannelsConfig | null;
  setMessagingChannels: (config: MessagingChannelsConfig) => Promise<boolean>;
  inboxConversations: InboxConversation[];
  addInboxConversation: (conv: InboxConversation) => Promise<boolean>;
  updateInboxConversation: (conv: InboxConversation) => Promise<boolean>;
  deleteInboxConversation: (id: string) => Promise<boolean>;
  fbLeadAdsConfig: FacebookLeadAdsConfig | null;
  setFbLeadAdsConfig: (config: FacebookLeadAdsConfig) => Promise<boolean>;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  authUser: AuthUser | null | undefined;
  issueClientCode: () => string;
  issueClientCodeAsync: () => Promise<string>;
  isAdmin: boolean;
  remoteReady: boolean;
  mySubscriberLoaded: boolean;
  reloadLectures: () => Promise<void>;
  reloadLeads: () => Promise<void>;
  reloadSubscribers: () => Promise<void>;
  reloadStaffMembers: () => Promise<void>;
  reloadOrders: () => Promise<void>;
  recordSubscriberPayment: (
    subscriberId: string,
    payment: Record<string, unknown>,
  ) => Promise<{ ok: boolean; id: string; status: string; approvalRequired?: boolean }>;
  logout: () => void;
  refreshAuth: () => void;
  // Scoped data for non-admin staff (set by Dashboard after fetchSalesData)
  staffScopedSubscribers: SubscriberItem[];
  staffScopedLeads: LeadItem[];
  setStaffScopedSubscribers: (subs: SubscriberItem[]) => void;
  setStaffScopedLeads: (leads: LeadItem[]) => void;
}

const STORAGE_KEY = 'mahad-admin-site-data-v1';
const DATA_VERSION = 4; // v4 removes all CRM/HR/finance/PII from browser persistence


// Keys whose old values must be replaced with the new default — even if Firestore has the old value.

const SiteDataContext = createContext<SiteDataShape | null>(null);

export const SiteDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initial = (() => {
    const cached = readVersionedCache<typeof seedData>(STORAGE_KEY, DATA_VERSION);
    if (!cached) return seedData;
    return { ...seedData, ...cached, content: { ...defaultContent, ...(cached.content || {}) } };
  })();

  const subscribersRef = useRef<SubscriberItem[]>(initial.subscribers || defaultSubscribers);
  const leadsRef = useRef<LeadItem[]>(initial.leads || defaultLeads);
  const { currency, setCurrency } = useCurrencyState();
  const { authUser, logout, refreshAuth } = useAuth();
  const { activityLogs, setActivityLogs, track } = useActivityLogState(authUser, initial.activityLogs);
  const {
    adminAiConfig, setAdminAiConfigLocal, setAdminAiConfig,
    aiAgentConfig, setAiAgentConfigState, setAiAgentConfig,
    messagingChannels, setMessagingChannelsState, setMessagingChannels,
    fbLeadAdsConfig, setFbLeadAdsConfigState, setFbLeadAdsConfig,
    inboxConversations, setInboxConversations, addInboxConversation, updateInboxConversation, deleteInboxConversation,
  } = useAiMessagingConfigState(
    (initial as typeof seedData & { adminAiConfig?: AdminAiConfig }).adminAiConfig || null,
    (initial as typeof seedData & { aiAgentConfig?: AiAgentConfig }).aiAgentConfig || null,
    (initial as typeof seedData & { messagingChannels?: MessagingChannelsConfig }).messagingChannels || null,
    (initial as typeof seedData & { fbLeadAdsConfig?: FacebookLeadAdsConfig }).fbLeadAdsConfig || null,
    (initial as typeof seedData & { inboxConversations?: InboxConversation[] }).inboxConversations || [],
    track,
  );
  const [remoteReady, setRemoteReady] = useState(false);
  const isHydratingRef = useRef(true);
  // Timestamp of last local CRM/config mutation
  const lastCRMWriteRef = useRef(0);
  const lastLocalConfigWriteRef = useRef(0);
  const { courses, setCourses, addCourse, updateCourse, deleteCourse, bundles, setBundles, addBundle, updateBundle, deleteBundle, therapists, setTherapists, addTherapist, updateTherapist, deleteTherapist, testimonials, setTestimonials, addTestimonial, updateTestimonial, deleteTestimonial } =
    useCatalogState(initial.courses, initial.bundles, initial.therapists, initial.testimonials, lastLocalConfigWriteRef, track);
  const {
    lectures, setLectures, addLecture, updateLecture, deleteLecture, reloadLectures, getCourseLectures,
    chapters, setChapters, addChapter, updateChapter, deleteChapter, getCourseChapters,
  } = useLecturesChaptersState(initial.lectures || defaultLectures, initial.chapters || [], lastLocalConfigWriteRef, track);
  const { expenses, setExpenses, addExpense, updateExpense, deleteExpense } =
    useExpensesState((initial as typeof seedData & { expenses?: ExpenseItem[] }).expenses || [], lastCRMWriteRef, track);
  const { daqqiRounds, setDaqqiRounds, addDaqqiRound, updateDaqqiRound, deleteDaqqiRound, transferDaqqiAttendee, bulkSetDaqqiRounds } =
    useDaqqiRoundsState((initial as typeof seedData & { daqqiRounds?: DaqqiRound[] }).daqqiRounds || [], lastCRMWriteRef, track);
  const { staffMembers, setStaffMembers, staffMembersRef, reloadStaffMembers, addStaffMember, updateStaffMember, deleteStaffMember } =
    useStaffState(initial.staffMembers || defaultStaffMembers, lastCRMWriteRef, track);
  // Debounce timers for MySQL persist effects
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards the auto-save effect so it never fires before DB content is loaded
  const dbContentLoadedRef = useRef(false);
  // High-water mark for client codes (local fallback when MySQL unavailable)
  const { issueClientCode, issueClientCodeAsync, isValidClientCodeFormat } =
    useClientCodeIssuance(initial.leads, initial.subscribers, subscribersRef, leadsRef);
  const {
    subscribers, setSubscribers,
    staffScopedSubscribers, setStaffScopedSubscribers,
    staffScopedLeads, setStaffScopedLeads,
    leads, setLeads,
    consultations, setConsultations,
    orders, setOrders,
    joinUsApplications, setJoinUsApplications,
    addSubscriber, updateSubscriber, deleteSubscriber,
    addLead, addPublicLead, updateLead, markLeadsConverted, deleteLead, bulkAssignClientCodes, bulkRedistributeLeads,
    addOrder, updateOrderStatus, deleteOrder,
    addJoinUsApplication, updateJoinUsApplication, deleteJoinUsApplication, reloadJoinUsApplications,
    reloadLeads, reloadSubscribers, reloadOrders, recordSubscriberPayment,
  } = useCrmCoreState(
    initial.subscribers || defaultSubscribers,
    initial.leads || defaultLeads,
    initial.consultations || defaultConsultations,
    initial.orders || [],
    (initial as typeof seedData & { joinUsApplications?: JoinUsApplication[] }).joinUsApplications || [],
    subscribersRef, leadsRef, lastCRMWriteRef, track,
    issueClientCodeAsync, isValidClientCodeFormat,
  );
  const { discounts, setDiscounts, addDiscount, updateDiscount, deleteDiscount } =
    useDiscountsState((initial as typeof seedData & { discounts?: DiscountRule[] }).discounts || [], lastLocalConfigWriteRef, track);
  const { notifications, setNotifications, addNotification, updateNotification, deleteNotification } =
    useNotificationsState((initial as typeof seedData & { notifications?: NotificationBroadcast[] }).notifications || [], lastLocalConfigWriteRef, track);
  const { liveStreams, setLiveStreams, addLiveStream, updateLiveStream, deleteLiveStream } =
    useLiveStreamsState((initial as typeof seedData & { liveStreams?: LiveStream[] }).liveStreams || [], track);
  // Reconciled during ARC-03/04 resurrection: the previously-inline version of this
  // domain had regressed back to a no-op persist function and a delete that never
  // called the backend (both were genuinely fixed once before, in the commit that
  // originally extracted this hook, then silently lost when that extraction was
  // reverted) — restoring the hook restores the fix too.
  const { contactMessages, setContactMessages, addContactMessage, updateContactMessage, deleteContactMessage } =
    useContactMessagesState((initial as typeof seedData & { contactMessages?: ContactMessage[] }).contactMessages || [], track);
  // Reconciled: restores live brand-theme preview-on-save (applyBrandTheme for
  // BRAND_KEYS) that was silently lost in the same revert as above.
  const { content, setContent, contentRef, setContentValue, mergeContent, addContentKey, removeContentKey } =
    useContentState(initial.content, lastLocalConfigWriteRef, track);
  const {
    courseQuizzes, setCourseQuizzes, addCourseQuiz, updateCourseQuiz, deleteCourseQuiz,
    quizAttempts, setQuizAttempts,
  } = useCourseQuizzesState(
    (initial as typeof seedData & { courseQuizzes?: CourseQuiz[] }).courseQuizzes || [],
    (initial as typeof seedData & { quizAttempts?: QuizAttempt[] }).quizAttempts || [],
    track,
  );
  const {
    communityPosts, setCommunityPosts, addCommunityPost, updateCommunityPost, deleteCommunityPost,
    communityLibraryItems, setCommunityLibraryItems, addCommunityLibraryItem, updateCommunityLibraryItem, deleteCommunityLibraryItem,
    communityVideos, setCommunityVideos, addCommunityVideo, updateCommunityVideo, deleteCommunityVideo,
    communityEvents, setCommunityEvents, addCommunityEvent, updateCommunityEvent, deleteCommunityEvent,
  } = useCommunityState(
    initial.communityPosts || defaultCommunityPosts,
    initial.communityLibraryItems || defaultCommunityLibraryItems,
    initial.communityVideos || defaultCommunityVideos,
    initial.communityEvents || defaultCommunityEvents,
    track,
  );
  const { automationWorkflows, setAutomationWorkflows, addAutomationWorkflow, updateAutomationWorkflow, deleteAutomationWorkflow } =
    useAutomationState(
      (initial as typeof seedData & { automationWorkflows?: AutomationWorkflow[] }).automationWorkflows || [],
      track,
    );

  // Auth: restore session via httpOnly cookie — managed by AuthContext (AuthProvider above SiteDataProvider)

  const isAdmin = Boolean(authUser?.isAdmin);



  // ── Per-user subscriber loaded flag ─────────────────────────────────────────────────────────
  const [mySubscriberLoaded, setMySubscriberLoaded] = useState(false);

  // ── Per-user subscriber loader (for non-admin/staff clients) ─────────────────────────────────
  // extracting authUser email into a ref so the refresh closure doesn't need authUser in deps
  const _subEmailRef = React.useRef<string | null>(null);
  useEffect(() => { _subEmailRef.current = authUser?.email ?? null; }, [authUser?.email]);

  const _applySubscriberData = React.useCallback((mySub: unknown) => {
    const raw = mySub as unknown as SubscriberItem & { enrolledCoursesData?: Course[] };
    const typedSub = { ...raw, enrolledCourseIds: Array.isArray(raw.enrolledCourseIds) ? raw.enrolledCourseIds : [] };
    setSubscribers(prev => {
      const idx = prev.findIndex(s => s.id === typedSub.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...typedSub };
        return next;
      }
      const norm = (_subEmailRef.current || '').toLowerCase().trim();
      return [typedSub, ...prev.filter(s => s.email?.toLowerCase().trim() !== norm)];
    });
    // Merge enrolled course objects (may include unpublished courses not returned by /api/courses)
    if (Array.isArray(raw.enrolledCoursesData) && raw.enrolledCoursesData.length > 0) {
      setCourses(prev => {
        const existingIds = new Set(prev.map(c => c.id));
        const newCourses = (raw.enrolledCoursesData as Course[]).filter(c => !existingIds.has(c.id));
        return newCourses.length > 0 ? [...prev, ...newCourses] : prev;
      });
    }
    setMySubscriberLoaded(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Silent refresh (no loading spinner) — used for polling & visibility change
  const refreshMySubscriber = React.useCallback(() => {
    if (!_subEmailRef.current) return;
    mysqlClient.getMySubscriber().then((mySub) => {
      if (mySub) _applySubscriberData(mySub);
    }).catch(() => {/* silent */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_applySubscriberData]);

  useEffect(() => {
    if (!authUser || isAdmin) return;
    setMySubscriberLoaded(false);
    let cancelled = false;
    let attempts = 0;
    const load = () => {
      attempts++;
      mysqlClient.getMySubscriber().then((mySub) => {
        if (cancelled) return;
        if (mySub) {
          _applySubscriberData(mySub);
        } else if (attempts < 3) {
          // Server may be auto-creating the subscriber record — retry after 2s
          setTimeout(() => { if (!cancelled) load(); }, 2000);
        } else {
          setMySubscriberLoaded(true);
        }
      }).catch(() => {
        if (!cancelled && attempts < 3) {
          // Network/auth error — retry after 3s
          setTimeout(() => { if (!cancelled) load(); }, 3000);
        } else {
          setMySubscriberLoaded(true);
        }
      });
    };
    load();

    // Poll every 5 minutes so newly-granted courses appear without re-login
    const pollId = setInterval(() => { if (!cancelled) refreshMySubscriber(); }, 5 * 60 * 1000);

    // Refresh when the browser tab regains focus
    const onVisible = () => { if (!cancelled && document.visibilityState === 'visible') refreshMySubscriber(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid, isAdmin]);

  // ── Per-user consultations loader ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authUser?.email || isAdmin) return;
    let cancelled = false;
    mysqlClient.getMyConsultations().then((list) => {
      if (cancelled) return;
      setConsultations((list as unknown as ConsultationItem[]).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid, isAdmin]);

  useAdminDataRuntime({
    authUser, isHydratingRef, dbContentLoadedRef, lastCRMWriteRef,
    subscribersRef, leadsRef, staffMembersRef, contentRef,
    setRemoteReady, setSubscribers, setLeads, setStaffMembers, setConsultations,
    setContent, setCourses, setBundles, setLectures, setChapters, setTherapists,
    setTestimonials, setCourseQuizzes, setLiveStreams, setExpenses, setActivityLogs,
    setOrders, setJoinUsApplications, setContactMessages, setDaqqiRounds,
    setAutomationWorkflows, setDiscounts, setNotifications, setAdminAiConfigLocal,
    setAiAgentConfigState, setMessagingChannelsState, setFbLeadAdsConfigState,
    reloadOrders, reloadJoinUsApplications,
  });
  // ── Community + catalog loader (public, non-admin) ──────────────────────────
  // Admin catalog is loaded by the bootstrap above. Non-admin guests load via MySQL.
  useEffect(() => {
    isHydratingRef.current = false;
    setRemoteReady(true);

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
            setCourses((cRes.value as unknown as Course[]).sort((a, b) =>
              (b.createdAt || b.id || '').localeCompare(a.createdAt || a.id || '')));
          if (bRes.status === 'fulfilled' && bRes.value.length > 0)
            setBundles(bRes.value as unknown as Bundle[]);
          if (thRes.status === 'fulfilled' && thRes.value.length > 0)
            setTherapists(thRes.value as unknown as Therapist[]);
          if (testRes.status === 'fulfilled' && testRes.value.length > 0)
            setTestimonials(testRes.value as unknown as TestimonialItem[]);

          // ── Batch B: lectures/chapters (deferred 500ms) ───────────────────────
          await new Promise(r => setTimeout(r, 500));
          const [lRes, chRes] = await Promise.allSettled([
            mysqlCatalog.listLectures(2000),
            mysqlCatalog.listChapters(),
          ]);
          if (lRes.status === 'fulfilled' && (lRes.value as unknown[]).length > 0)
            setLectures(lRes.value as unknown as CourseLectureItem[]);
          if (chRes.status === 'fulfilled' && (chRes.value as unknown[]).length > 0)
            setChapters(chRes.value as unknown as CourseChapterItem[]);
        } catch { /* ignore — graceful degradation */ }
      })();
    }

    // Load inbox for admin
    if (isAdmin && authUser) {
      mysqlAdmin.listAllInbox().then((list) => {
        setInboxConversations((list as unknown as InboxConversation[]).sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '')));
      }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid, isAdmin]);



  const clearAllData = () => {
    setCourses(COURSES);
    setBundles(BUNDLES);
    setTherapists(THERAPISTS);
    setTestimonials(TESTIMONIALS);
    setSubscribers(defaultSubscribers);
    setLeads(defaultLeads);
    setStaffMembers(defaultStaffMembers);
    setConsultations(defaultConsultations);
    setLectures(defaultLectures);
    setChapters([]);
    setOrders([]);
    setExpenses([]);
    setCommunityPosts(defaultCommunityPosts);
    setCommunityLibraryItems(defaultCommunityLibraryItems);
    setCommunityVideos(defaultCommunityVideos);
    setCommunityEvents(defaultCommunityEvents);
    setContent(defaultContent);
    contentRef.current = defaultContent;
    setActivityLogs([]);
    setDiscounts([]);
    setNotifications([]);
    setDaqqiRounds([]);
    setJoinUsApplications([]);
    setContactMessages([]);
    setAutomationWorkflows([]);
    setAiAgentConfigState(null);
    setMessagingChannelsState(null);
    setInboxConversations([]);
    setFbLeadAdsConfigState(null);
    setCourseQuizzes([]);
    setQuizAttempts([]);
    setLiveStreams([]);
    // Clear all persisted state
    track('reset', 'system', 'restore defaults');
  };

  // ── Public catalog cache only. CRM/HR/finance/customer data must never be
  // written to localStorage because any script running in the origin can read it.
  useEffect(() => {
    const payloadObject = {
      courses,
      bundles,
      therapists,
      testimonials,
      lectures,
      chapters,
      communityPosts,
      communityLibraryItems,
      communityVideos,
      communityEvents,
      content,
      discounts,
      notifications,
      courseQuizzes,
      liveStreams,
    };
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      writeVersionedCache(STORAGE_KEY, DATA_VERSION, payloadObject);
    }, 500);
    return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); };
  }, [courses, bundles, therapists, testimonials, subscribers, leads, staffMembers, consultations, lectures, chapters, orders, communityPosts, communityLibraryItems, communityVideos, communityEvents, content, activityLogs, discounts, notifications, expenses, daqqiRounds, joinUsApplications, contactMessages, automationWorkflows, adminAiConfig, aiAgentConfig, messagingChannels, inboxConversations, fbLeadAdsConfig, courseQuizzes, quizAttempts, liveStreams]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo<SiteDataShape>(() => ({
    courses,
    bundles,
    therapists,
    testimonials,
    subscribers,
    leads,
    staffMembers,
    consultations,
    lectures,
    chapters,
    orders,
    communityPosts,
    communityLibraryItems,
    communityVideos,
    communityEvents,
    content,
    activityLogs,
    discounts,
    notifications,
    expenses,
    addCourse,
    updateCourse,
    deleteCourse,
    addTherapist,
    updateTherapist,
    deleteTherapist,
    addBundle,
    updateBundle,
    deleteBundle,
    addTestimonial,
    updateTestimonial,
    deleteTestimonial,
    addSubscriber,
    updateSubscriber,
    deleteSubscriber,
    addLead,
    addPublicLead,
    updateLead,
    markLeadsConverted,
    deleteLead,
    bulkAssignClientCodes,
    bulkRedistributeLeads,
    addStaffMember,
    updateStaffMember,
    deleteStaffMember,
    addLecture,
    updateLecture,
    deleteLecture,
    addChapter,
    updateChapter,
    deleteChapter,
    getCourseChapters,
    addOrder,
    updateOrderStatus,
    deleteOrder,
    addCommunityPost,
    updateCommunityPost,
    deleteCommunityPost,
    addCommunityLibraryItem,
    updateCommunityLibraryItem,
    deleteCommunityLibraryItem,
    addCommunityVideo,
    updateCommunityVideo,
    deleteCommunityVideo,
    addCommunityEvent,
    updateCommunityEvent,
    deleteCommunityEvent,
    getCourseLectures,
    setContentValue,
    mergeContent,
    addContentKey,
    removeContentKey,
    clearAllData,
    issueClientCode,
    issueClientCodeAsync,
    addDiscount,
    updateDiscount,
    deleteDiscount,
    addNotification,
    updateNotification,
    deleteNotification,
    courseQuizzes,
    addCourseQuiz,
    updateCourseQuiz,
    deleteCourseQuiz,
    quizAttempts,
    liveStreams,
    addLiveStream,
    updateLiveStream,
    deleteLiveStream,
    addExpense,
    updateExpense,
    deleteExpense,
    daqqiRounds,
    addDaqqiRound,
    updateDaqqiRound,
    deleteDaqqiRound,
    transferDaqqiAttendee,
    bulkSetDaqqiRounds,
    joinUsApplications,
    addJoinUsApplication,
    updateJoinUsApplication,
    deleteJoinUsApplication,
    reloadJoinUsApplications,
    contactMessages,
    addContactMessage,
    updateContactMessage,
    deleteContactMessage,
    automationWorkflows,
    addAutomationWorkflow,
    updateAutomationWorkflow,
    deleteAutomationWorkflow,
    adminAiConfig,
    setAdminAiConfig,
    aiAgentConfig,
    setAiAgentConfig,
    messagingChannels,
    setMessagingChannels,
    inboxConversations,
    addInboxConversation,
    updateInboxConversation,
    deleteInboxConversation,
    fbLeadAdsConfig,
    setFbLeadAdsConfig,
    currency,
    setCurrency,
    authUser,
    isAdmin,
    remoteReady,
    mySubscriberLoaded,
    reloadLectures,
    reloadLeads,
    reloadSubscribers,
    reloadStaffMembers,
    reloadOrders,
    recordSubscriberPayment,
    logout,
    refreshAuth,
    staffScopedSubscribers,
    staffScopedLeads,
    setStaffScopedSubscribers,
    setStaffScopedLeads,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [courses, bundles, therapists, testimonials, subscribers, leads, staffMembers, consultations,
    lectures, chapters, orders, communityPosts, communityLibraryItems, communityVideos,
    communityEvents, content, activityLogs, discounts, notifications, expenses, daqqiRounds,
    joinUsApplications, contactMessages, automationWorkflows, adminAiConfig, aiAgentConfig,
    messagingChannels, inboxConversations, fbLeadAdsConfig, courseQuizzes, quizAttempts,
    liveStreams, currency, authUser, isAdmin, remoteReady,
    staffScopedSubscribers, staffScopedLeads]);

  return <SiteDataContext.Provider value={value}>{children}</SiteDataContext.Provider>;
};

export const useSiteData = () => {
  const ctx = useContext(SiteDataContext);
  if (!ctx) {
    throw new Error('useSiteData must be used inside SiteDataProvider');
  }
  return ctx;
};


