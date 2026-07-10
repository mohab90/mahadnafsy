import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BUNDLES, COURSES, TESTIMONIALS, THERAPISTS } from '../constants';
import { AuthUser, Bundle, ConsultationItem, ContactMessage, Course, Currency, DaqqiRound, DiscountRule, ExpenseItem, JoinUsApplication, NotificationBroadcast, Therapist, LeadItem, LeadStatus, LeadType, BranchType, StaffMember, SubscriberItem, CourseLectureItem, CourseChapterItem, OrderItem, TestimonialItem, CommunityPostItem, CommunityLibraryItem, CommunityVideoItem, CommunityEventItem, ActivityLogItem, CourseAccessSetting, AutomationWorkflow, AutomationTrigger, AdminAiConfig, AiAgentConfig, MessagingChannelsConfig, MessagingChannel, InboxConversation, FacebookLeadAdsConfig, PaymentHistoryEntry, CourseQuiz, QuizAttempt, LiveStream } from '../types';
import { mysqlCatalog, mysqlAdmin, mysqlClient, mysqlForms } from '../lib/mysqlapi';
import { applyBrandTheme } from '../lib/brandTheme';
import { useAuth } from './AuthContext';
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
import { computeInitialSiteData, STORAGE_KEY, DATA_VERSION } from './siteDataInitial';
import { useCurrencyState } from './site-data-hooks/useCurrencyState';
import { useActivityLogState, nowLabel } from './site-data-hooks/useActivityLogState';
import { useClientCodeIssuance } from './site-data-hooks/useClientCodeIssuance';
import { useDiscountsState } from './site-data-hooks/useDiscountsState';
import { useNotificationsState } from './site-data-hooks/useNotificationsState';
import { useExpensesState } from './site-data-hooks/useExpensesState';
import { useLiveStreamsState } from './site-data-hooks/useLiveStreamsState';
import { useCourseQuizzesState } from './site-data-hooks/useCourseQuizzesState';
import { useDaqqiRoundsState } from './site-data-hooks/useDaqqiRoundsState';
import { useContactMessagesState } from './site-data-hooks/useContactMessagesState';
import { useCommunityState } from './site-data-hooks/useCommunityState';
import { useStaffState } from './site-data-hooks/useStaffState';
import { useAiMessagingConfigState } from './site-data-hooks/useAiMessagingConfigState';
import { useContentState } from './site-data-hooks/useContentState';
import { useCatalogState } from './site-data-hooks/useCatalogState';
import { useLecturesChaptersState } from './site-data-hooks/useLecturesChaptersState';
import { useAutomationState } from './site-data-hooks/useAutomationState';

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
  addDaqqiRound: (item: DaqqiRound) => Promise<void>;
  updateDaqqiRound: (item: DaqqiRound) => void;
  deleteDaqqiRound: (id: string) => void;
  bulkSetDaqqiRounds: (rounds: DaqqiRound[]) => void;
  joinUsApplications: JoinUsApplication[];
  addJoinUsApplication: (item: JoinUsApplication) => void;
  updateJoinUsApplication: (item: JoinUsApplication) => void;
  deleteJoinUsApplication: (id: string) => void;
  contactMessages: ContactMessage[];
  addContactMessage: (item: ContactMessage) => void;
  updateContactMessage: (item: ContactMessage) => void;
  deleteContactMessage: (id: string) => void;
  addCourse: (course: Course) => void;
  updateCourse: (course: Course) => void;
  deleteCourse: (id: string) => void;
  addTherapist: (therapist: Therapist) => void;
  updateTherapist: (therapist: Therapist) => void;
  deleteTherapist: (id: string) => void;
  addBundle: (bundle: Bundle) => void;
  updateBundle: (bundle: Bundle) => void;
  deleteBundle: (id: string) => void;
  addTestimonial: (item: TestimonialItem) => void;
  updateTestimonial: (item: TestimonialItem) => void;
  deleteTestimonial: (id: number) => void;
  addSubscriber: (item: SubscriberItem) => Promise<boolean>;
  updateSubscriber: (item: SubscriberItem) => void;
  deleteSubscriber: (id: string) => void;
  addLead: (item: LeadItem) => Promise<void>;
  addPublicLead: (item: Omit<LeadItem, 'clientCode'> & { clientCode?: string }) => Promise<void>;
  updateLead: (item: LeadItem) => void;
  markLeadsConverted: (ids: string[]) => void;
  deleteLead: (id: string) => void;
  bulkDeleteLeads: (ids: string[]) => void;
  bulkAssignClientCodes: (updatedSubs: SubscriberItem[], updatedLeads: LeadItem[]) => void;
  bulkRedistributeLeads: (mode: 'unassigned' | 'all') => Promise<number>;
  addStaffMember: (item: StaffMember) => void;
  updateStaffMember: (item: StaffMember) => void;
  deleteStaffMember: (id: string) => void;
  addConsultation: (item: ConsultationItem) => void;
  updateConsultation: (item: ConsultationItem) => void;
  deleteConsultation: (id: string) => void;
  addLecture: (item: CourseLectureItem) => void;
  updateLecture: (item: CourseLectureItem) => void;
  deleteLecture: (id: string) => void;
  addChapter: (item: CourseChapterItem) => void;
  updateChapter: (item: CourseChapterItem) => void;
  deleteChapter: (id: string) => void;
  getCourseChapters: (courseId: string) => CourseChapterItem[];
  addOrder: (item: OrderItem) => void;
  updateOrderStatus: (id: string, status: OrderItem['status']) => void;
  deleteOrder: (id: string) => void;
  addCommunityPost: (item: CommunityPostItem) => void;
  updateCommunityPost: (item: CommunityPostItem) => void;
  deleteCommunityPost: (id: string) => void;
  addCommunityLibraryItem: (item: CommunityLibraryItem) => void;
  updateCommunityLibraryItem: (item: CommunityLibraryItem) => void;
  deleteCommunityLibraryItem: (id: string) => void;
  addCommunityVideo: (item: CommunityVideoItem) => void;
  updateCommunityVideo: (item: CommunityVideoItem) => void;
  deleteCommunityVideo: (id: string) => void;
  addCommunityEvent: (item: CommunityEventItem) => void;
  updateCommunityEvent: (item: CommunityEventItem) => void;
  deleteCommunityEvent: (id: string) => void;
  getCourseLectures: (courseId: string) => CourseLectureItem[];
  setContentValue: (key: string, value: string) => void;
  mergeContent: (data: Record<string, string>) => void;
  addContentKey: (key: string, value: string) => void;
  removeContentKey: (key: string) => void;
  clearAllData: () => void;
  addDiscount: (item: DiscountRule) => void;
  updateDiscount: (item: DiscountRule) => void;
  deleteDiscount: (id: string) => void;
  addNotification: (item: NotificationBroadcast) => void;
  updateNotification: (item: NotificationBroadcast) => void;
  deleteNotification: (id: string) => void;
  courseQuizzes: CourseQuiz[];
  addCourseQuiz: (item: CourseQuiz) => void;
  updateCourseQuiz: (item: CourseQuiz) => void;
  deleteCourseQuiz: (id: string) => void;
  quizAttempts: QuizAttempt[];
  addQuizAttempt: (item: QuizAttempt) => void;
  deleteQuizAttempt: (id: string) => void;
  liveStreams: LiveStream[];
  addLiveStream: (item: LiveStream) => void;
  updateLiveStream: (item: LiveStream) => void;
  deleteLiveStream: (id: string) => void;
  addExpense: (item: ExpenseItem) => void;
  updateExpense: (item: ExpenseItem) => void;
  deleteExpense: (id: string) => void;
  automationWorkflows: AutomationWorkflow[];
  addAutomationWorkflow: (item: AutomationWorkflow) => void;
  updateAutomationWorkflow: (item: AutomationWorkflow) => void;
  deleteAutomationWorkflow: (id: string) => void;
  adminAiConfig: AdminAiConfig | null;
  setAdminAiConfig: (config: AdminAiConfig) => void;
  aiAgentConfig: AiAgentConfig | null;
  setAiAgentConfig: (config: AiAgentConfig) => void;
  messagingChannels: MessagingChannelsConfig | null;
  setMessagingChannels: (config: MessagingChannelsConfig) => void;
  inboxConversations: InboxConversation[];
  addInboxConversation: (conv: InboxConversation) => void;
  updateInboxConversation: (conv: InboxConversation) => void;
  deleteInboxConversation: (id: string) => void;
  fbLeadAdsConfig: FacebookLeadAdsConfig | null;
  setFbLeadAdsConfig: (config: FacebookLeadAdsConfig) => void;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  authUser: AuthUser | null | undefined;
  issueClientCode: () => string;
  issueClientCodeAsync: () => Promise<string>;
  isAdmin: boolean;
  remoteReady: boolean;
  mySubscriberLoaded: boolean;
  refreshMySubscriber: () => void;
  reloadLectures: () => Promise<void>;
  reloadLeads: () => Promise<void>;
  logout: () => void;
  refreshAuth: () => void;
  triggerAutomation: (trigger: AutomationTrigger, data?: Record<string, unknown>) => void;
  // Scoped data for non-admin staff (set by Dashboard after fetchSalesData)
  staffScopedSubscribers: SubscriberItem[];
  staffScopedLeads: LeadItem[];
  setStaffScopedSubscribers: (subs: SubscriberItem[]) => void;
  setStaffScopedLeads: (leads: LeadItem[]) => void;
}

const _parseEnvList = (v: string | undefined) =>
  (v || '').split(',').map((s) => s.trim()).filter(Boolean);

// Keys whose old values must be replaced with the new default — even if Firestore has the old value.
const CONTENT_FORCED_UPDATES: Record<string, string> = {
  'courseDetails.price.cta': 'احجز الآن واستفد بخصم إضافي',
  'courseDetails.mobile.cta': 'احجز الآن واستفد بخصم',
  'bundleDetails.sidebar.cta': 'احجز الآن واستفد بخصم إضافي',
  'courseDetails.price.feature1': 'وصول لمدة سنة واحدة للمحتوى',
  'courseDetails.faq.a2': 'بالتأكيد! جميع المحاضرات (سواء المسجلة أو البث المباشر) تظل محفوظة في حسابك لمدة سنة واحدة ويمكنك الرجوع إليها في أي وقت.',
};

const SiteDataContext = createContext<SiteDataShape | null>(null);

export const SiteDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initial = computeInitialSiteData();

  const [subscribers, setSubscribers] = useState<SubscriberItem[]>(initial.subscribers || defaultSubscribers);
  const subscribersRef = useRef<SubscriberItem[]>(initial.subscribers || defaultSubscribers);
  subscribersRef.current = subscribers;
  const [leads, setLeads] = useState<LeadItem[]>(initial.leads || defaultLeads);
  const leadsRef = useRef<LeadItem[]>(initial.leads || defaultLeads);
  leadsRef.current = leads;
  // Scoped data for non-admin staff — set by Dashboard after fetchSalesData
  const [staffScopedSubscribers, setStaffScopedSubscribers] = useState<SubscriberItem[]>([]);
  const [staffScopedLeads, setStaffScopedLeads] = useState<LeadItem[]>([]);
  const [consultations, setConsultations] = useState<ConsultationItem[]>(initial.consultations || defaultConsultations);
  const [orders, setOrders] = useState<OrderItem[]>(initial.orders || []);
  const { currency, setCurrency } = useCurrencyState();
  const { authUser, setAuthUser, logout, refreshAuth } = useAuth();
  const { activityLogs, setActivityLogs, track } = useActivityLogState(authUser, initial.activityLogs);
  const [remoteReady, setRemoteReady] = useState(false);
  const isHydratingRef = useRef(true);
  // Timestamp of last local CRM/config mutation
  const lastCRMWriteRef = useRef(0);
  const lastLocalConfigWriteRef = useRef(0);
  // Debounce timers for MySQL persist effects
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards the auto-save effect so it never fires before DB content is loaded
  const dbContentLoadedRef = useRef(false);
  // Round-robin counter for auto-assigning new leads to sales staff
  const roundRobinIndexRef = useRef(0);
  const { issueClientCode, issueClientCodeAsync, isValidClientCodeFormat } =
    useClientCodeIssuance(initial.leads, initial.subscribers, subscribersRef, leadsRef);
  const {
    courses, setCourses, addCourse, updateCourse, deleteCourse,
    bundles, setBundles, addBundle, updateBundle, deleteBundle,
    therapists, setTherapists, addTherapist, updateTherapist, deleteTherapist,
    testimonials, setTestimonials, addTestimonial, updateTestimonial, deleteTestimonial,
  } = useCatalogState(initial.courses, initial.bundles, initial.therapists, initial.testimonials, lastLocalConfigWriteRef, track);
  const {
    lectures, setLectures, addLecture, updateLecture, deleteLecture, reloadLectures, getCourseLectures,
    chapters, setChapters, addChapter, updateChapter, deleteChapter, getCourseChapters,
  } = useLecturesChaptersState(initial.lectures || defaultLectures, initial.chapters || [], lastLocalConfigWriteRef, track);
  const { staffMembers, setStaffMembers, staffMembersRef, addStaffMember, updateStaffMember, deleteStaffMember } =
    useStaffState(initial.staffMembers || defaultStaffMembers, lastCRMWriteRef, track);
  const { content, setContent, contentRef, setContentValue, mergeContent, addContentKey, removeContentKey } =
    useContentState(initial.content, lastLocalConfigWriteRef, track);
  const { discounts, setDiscounts, addDiscount, updateDiscount, deleteDiscount } =
    useDiscountsState((initial as typeof seedData & { discounts?: DiscountRule[] }).discounts || [], lastLocalConfigWriteRef, track);
  const { notifications, setNotifications, addNotification, updateNotification, deleteNotification } =
    useNotificationsState((initial as typeof seedData & { notifications?: NotificationBroadcast[] }).notifications || [], lastLocalConfigWriteRef, track);
  const { automationWorkflows, setAutomationWorkflows, addAutomationWorkflow, updateAutomationWorkflow, deleteAutomationWorkflow, triggerAutomation } =
    useAutomationState(
      (initial as typeof seedData & { automationWorkflows?: AutomationWorkflow[] }).automationWorkflows || [],
      staffMembers, setLeads, setNotifications, track,
    );
  const {
    courseQuizzes, setCourseQuizzes, addCourseQuiz, updateCourseQuiz, deleteCourseQuiz,
    quizAttempts, setQuizAttempts, addQuizAttempt, deleteQuizAttempt,
  } = useCourseQuizzesState(
    (initial as typeof seedData & { courseQuizzes?: CourseQuiz[] }).courseQuizzes || [],
    (initial as typeof seedData & { quizAttempts?: QuizAttempt[] }).quizAttempts || [],
    track,
  );
  const { liveStreams, setLiveStreams, addLiveStream, updateLiveStream, deleteLiveStream } =
    useLiveStreamsState((initial as typeof seedData & { liveStreams?: LiveStream[] }).liveStreams || [], track);
  const { expenses, setExpenses, addExpense, updateExpense, deleteExpense } =
    useExpensesState((initial as typeof seedData & { expenses?: ExpenseItem[] }).expenses || [], lastCRMWriteRef, track);
  const { daqqiRounds, setDaqqiRounds, addDaqqiRound, updateDaqqiRound, deleteDaqqiRound, bulkSetDaqqiRounds } =
    useDaqqiRoundsState((initial as typeof seedData & { daqqiRounds?: DaqqiRound[] }).daqqiRounds || [], lastCRMWriteRef, track);
  const [joinUsApplications, setJoinUsApplications] = useState<JoinUsApplication[]>((initial as typeof seedData & { joinUsApplications?: JoinUsApplication[] }).joinUsApplications || []);
  const { contactMessages, setContactMessages, addContactMessage, updateContactMessage, deleteContactMessage } =
    useContactMessagesState((initial as typeof seedData & { contactMessages?: ContactMessage[] }).contactMessages || [], track);
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

  const reloadLeads = React.useCallback(async () => {
    try {
      const fresh = await mysqlAdmin.listAllLeads();
      if ((fresh as unknown as LeadItem[]).length > 0) {
        const normalized = (fresh as unknown as LeadItem[]).map(l => ({
          ...l,
          status: (l.status || 'new').toLowerCase() as LeadStatus,
        }));
        leadsRef.current = normalized;
        setLeads(normalized);
      }
    } catch { /* silent */ }
  }, []);

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
    const email = authUser.email.toLowerCase().trim();
    mysqlClient.getMyConsultations().then((list) => {
      if (cancelled) return;
      setConsultations((list as unknown as ConsultationItem[]).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid, isAdmin]);

  // ── Per-user quizAttempts loader (skipped in admin panel — staff/admins use admin endpoints) ──

  // ── MySQL primary bootstrap (admin only) ─────────────────────────────────────────────────────
  // Loads entities in TWO batches to avoid overwhelming MySQL (connectionLimit=5).
  // Batch 1 (critical): CRM data the admin needs immediately → shown right away.
  // Batch 2 (secondary): catalog + config data → loaded after a short delay.
  useEffect(() => {
    if (!authUser?.email) return;
    const isAdm = authUser?.isAdmin === true;
    // Load data for admin OR authenticated staff
    if (!isAdm && !authUser?.uid) return;
    // Safety timeout: show dashboard after 8s even if batch 1 hasn't completed
    const safetyTimer = setTimeout(() => {
      isHydratingRef.current = false;
      setRemoteReady(true);
    }, 8000);
    (async () => {
      try {
        // ── BATCH 1: critical CRM + content (5 concurrent, max 8s) ──────────
        const withTimeout = <T,>(p: Promise<T>, ms = 7000): Promise<T> =>
          Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
        const [subsRes, leadsRes, staffRes, consultsRes, contentRes] = await Promise.allSettled([
          withTimeout(mysqlAdmin.listAllSubscribers()),
          withTimeout(mysqlAdmin.listAllLeads()),
          withTimeout(mysqlAdmin.listAllStaff()),
          withTimeout(mysqlAdmin.listAllConsultations()),
          withTimeout(mysqlAdmin.getContent()),
        ]);

        if (subsRes.status === 'fulfilled') {
          const subs = (subsRes.value as unknown as SubscriberItem[]).map(s => ({ ...s, enrolledCourseIds: Array.isArray(s.enrolledCourseIds) ? s.enrolledCourseIds : [] }));
          if (subs.length > 0) { subscribersRef.current = subs; setSubscribers(subs); }
        }
        if (leadsRes.status === 'fulfilled' && leadsRes.value.length > 0) {
          const normalizedLeads = (leadsRes.value as unknown as LeadItem[]).map(l => ({
            ...l,
            status: (l.status || 'new').toLowerCase() as LeadStatus,
          }));
          leadsRef.current = normalizedLeads;
          setLeads(normalizedLeads);
        }
        if (staffRes.status === 'fulfilled' && staffRes.value.length > 0) {
          const normalizedStaff = (staffRes.value as unknown as StaffMember[]).map(s => ({
            ...s,
            role: (s.role || '').toLowerCase() as StaffMember['role'],
            status: (s.status === 'active' || (s as any).is_active === 1 || (s as any).isActive === 1) ? 'active' as const : 'inactive' as const,
          }));
          staffMembersRef.current = normalizedStaff;
          setStaffMembers(normalizedStaff);
        }
        if (consultsRes.status === 'fulfilled' && consultsRes.value.length > 0)
          setConsultations(consultsRes.value as unknown as ConsultationItem[]);
        if (contentRes.status === 'fulfilled' && contentRes.value && Object.keys(contentRes.value).length > 0) {
          const remoteContent = contentRes.value as Record<string, string>;
          setContent(prev => ({ ...prev, ...remoteContent }));
          contentRef.current = { ...contentRef.current, ...remoteContent };
          applyBrandTheme(contentRef.current); // apply saved brand palette/title/favicon app-wide
        }
        // Mark DB content as loaded — unblocks the auto-save effect
        dbContentLoadedRef.current = true;

        // Mark ready after batch 1 — admin sees CRM immediately
        clearTimeout(safetyTimer);
        isHydratingRef.current = false;
        setRemoteReady(true);

        // ── BATCH 2: catalog + finance (max 5 concurrent, deferred 300ms) ───
        await new Promise(r => setTimeout(r, 300));
        const [cRes, bRes, lRes, chRes, thRes] = await Promise.allSettled([
          mysqlAdmin.listAllCourses(),
          mysqlAdmin.listAllBundles(500),
          mysqlCatalog.listLectures(),
          mysqlCatalog.listChapters(),
          mysqlAdmin.listAllTherapists(),
        ]);
        if (cRes.status === 'fulfilled' && cRes.value.length > 0)
          setCourses((cRes.value as unknown as Course[]).sort((a, b) => (b.createdAt || b.id || '').localeCompare(a.createdAt || a.id || '')));
        if (bRes.status === 'fulfilled' && bRes.value.length > 0) setBundles(bRes.value as unknown as Bundle[]);
        if (lRes.status === 'fulfilled' && lRes.value.length > 0) setLectures(lRes.value as unknown as CourseLectureItem[]);
        if (chRes.status === 'fulfilled' && chRes.value.length > 0) setChapters(chRes.value as unknown as CourseChapterItem[]);
        if (thRes.status === 'fulfilled' && thRes.value.length > 0) setTherapists(thRes.value as unknown as Therapist[]);

        // ── BATCH 3: financials + settings (max 5 concurrent) ───────────────
        await new Promise(r => setTimeout(r, 300));
        const [testRes, qRes, sRes, expRes, actRes] = await Promise.allSettled([
          mysqlCatalog.listTestimonials(),
          mysqlCatalog.listQuizzes(),
          mysqlCatalog.listLiveStreams(),
          mysqlAdmin.listAllExpenses(),
          mysqlAdmin.listActivityLogs(),
        ]);
        if (testRes.status === 'fulfilled' && testRes.value.length > 0) setTestimonials(testRes.value as unknown as TestimonialItem[]);
        if (qRes.status === 'fulfilled' && qRes.value.length > 0) setCourseQuizzes(qRes.value as unknown as CourseQuiz[]);
        if (sRes.status === 'fulfilled' && sRes.value.length > 0) setLiveStreams(sRes.value as unknown as LiveStream[]);
        if (expRes.status === 'fulfilled' && expRes.value.length > 0) setExpenses(expRes.value as unknown as ExpenseItem[]);
        if (actRes.status === 'fulfilled' && actRes.value.length > 0) setActivityLogs(actRes.value as unknown as ActivityLogItem[]);

        // ── BATCH 4: secondary data ──────────────────────────────────────────
        await new Promise(r => setTimeout(r, 300));
        const [ordersRes, joinUsRes, contactRes, daqqiRes, autoRes] = await Promise.allSettled([
          mysqlAdmin.listAllOrders(),
          mysqlAdmin.listAllJoinUs(),
          mysqlAdmin.listAllContactMessages(),
          mysqlAdmin.listAllDaqqiRounds(),
          mysqlAdmin.listAllAutomationWorkflows(),
        ]);
        if (ordersRes.status === 'fulfilled' && ordersRes.value.length > 0) {
          // Normalize snake_case DB fields → camelCase OrderItem
          const normalized = (ordersRes.value as unknown as Record<string, unknown>[]).map(r => ({
            id: r.id as string,
            subscriberId: (r.subscriberId ?? r.subscriber_id ?? undefined) as string | undefined,
            type: (r.type as string || 'course') as 'course' | 'bundle' | 'consultation',
            itemId: (r.itemId ?? r.item_id ?? '') as string,
            itemTitle: (r.itemTitle ?? r.item_title ?? '') as string,
            amount: Number(r.amount) || 0,
            currency: (r.currency || 'EGP') as 'EGP' | 'SAR' | 'USD',
            paymentMethod: (r.paymentMethod ?? r.payment_method ?? 'wallet') as 'card' | 'wallet',
            customerName: (r.customerName ?? r.customer_name ?? '') as string,
            customerEmail: (r.customerEmail ?? r.customer_email ?? '') as string,
            status: (r.status || 'paid') as 'paid' | 'failed' | 'refunded' | 'pending',
            createdAt: (r.createdAt ?? r.created_at ?? '') as string,
            transactionId: (r.transactionId ?? r.transaction_id) as string | undefined,
            staffId: (r.staffId ?? r.staff_id ?? undefined) as string | undefined,
            staffName: (r.staffName ?? r.staff_name ?? undefined) as string | undefined,
            linkedTransferId: (r.linkedTransferId ?? r.linked_transfer_id ?? undefined) as string | undefined,
          }));
          setOrders(normalized as OrderItem[]);
        }
        if (joinUsRes.status === 'fulfilled' && joinUsRes.value.length > 0) setJoinUsApplications(joinUsRes.value as unknown as JoinUsApplication[]);
        if (contactRes.status === 'fulfilled' && contactRes.value.length > 0) setContactMessages(contactRes.value as unknown as ContactMessage[]);
        if (daqqiRes.status === 'fulfilled' && daqqiRes.value.length > 0) setDaqqiRounds(daqqiRes.value as unknown as DaqqiRound[]);
        if (autoRes.status === 'fulfilled' && autoRes.value.length > 0) setAutomationWorkflows(autoRes.value as unknown as AutomationWorkflow[]);

        // ── BATCH 5: settings ─────────────────────────────────────────────────
        await new Promise(r => setTimeout(r, 300));
        const [discountsRes, notifRes, settingsRes] = await Promise.allSettled([
          mysqlAdmin.getDiscounts(),
          mysqlAdmin.getNotifications(),
          mysqlAdmin.getSettings(),
        ]);
        if (discountsRes.status === 'fulfilled' && discountsRes.value.length > 0)
          setDiscounts(discountsRes.value as unknown as DiscountRule[]);
        if (notifRes.status === 'fulfilled') {
          const notifData = notifRes.value as unknown as { rows?: NotificationBroadcast[] } | NotificationBroadcast[];
          const notifArr = Array.isArray(notifData) ? notifData : ((notifData as { rows?: NotificationBroadcast[] }).rows || []);
          if (notifArr.length > 0) setNotifications(notifArr);
        }
        if (settingsRes.status === 'fulfilled' && settingsRes.value) {
          const s = settingsRes.value as Record<string, unknown>;
          if (s.adminAiConfig) setAdminAiConfigLocal(s.adminAiConfig as AdminAiConfig);
          if (s.aiAgentConfig) setAiAgentConfigState(s.aiAgentConfig as AiAgentConfig);
          if (s.messagingChannels) setMessagingChannelsState(s.messagingChannels as MessagingChannelsConfig);
          if (s.fbLeadAdsConfig) setFbLeadAdsConfigState(s.fbLeadAdsConfig as FacebookLeadAdsConfig);
        }

        // Bootstrap complete
      } catch (err) {
        console.error('[MySQL] Bootstrap failed:', err);
        clearTimeout(safetyTimer);
        isHydratingRef.current = false;
        setRemoteReady(true);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid]);

  // ── Admin background polling (leads + subscribers every 2 min) ──────────────
  // Silently refreshes CRM data so admin never works with stale state
  useEffect(() => {
    if (!authUser?.email || authUser?.isAdmin !== true) return;
    let cancelled = false;

    const silentRefresh = async () => {
      if (cancelled) return;
      // Don't overwrite fresh local CRM writes — wait at least 3 min after last write
      const msSinceWrite = Date.now() - lastCRMWriteRef.current;
      if (msSinceWrite < 180_000) return;
      try {
        const [freshLeads, freshSubs, freshRounds] = await Promise.allSettled([
          mysqlAdmin.listAllLeads(),
          mysqlAdmin.listAllSubscribers(),
          mysqlAdmin.listAllDaqqiRounds(),
        ]);
        if (cancelled) return;
        // Re-check after the async fetch — user may have made a CRM write while we were waiting
        if (Date.now() - lastCRMWriteRef.current < 180_000) return;
        if (freshLeads.status === 'fulfilled' && (freshLeads.value as unknown as LeadItem[]).length > 0) {
          const normalized = (freshLeads.value as unknown as LeadItem[]).map(l => ({
            ...l,
            status: (l.status || 'new').toLowerCase() as LeadStatus,
          }));
          leadsRef.current = normalized;
          setLeads(normalized);
        }
        if (freshSubs.status === 'fulfilled' && (freshSubs.value as unknown as SubscriberItem[]).length > 0) {
          const subs = (freshSubs.value as unknown as SubscriberItem[]).map(s => ({
            ...s,
            enrolledCourseIds: Array.isArray(s.enrolledCourseIds) ? s.enrolledCourseIds : [],
          }));
          subscribersRef.current = subs;
          setSubscribers(subs);
        }
        if (freshRounds.status === 'fulfilled' && (freshRounds.value as unknown as DaqqiRound[]).length > 0) {
          setDaqqiRounds(freshRounds.value as unknown as DaqqiRound[]);
        }
      } catch { /* silent — polling failure is non-fatal */ }
    };

    // Poll every 2 minutes
    const pollId = setInterval(() => { void silentRefresh(); }, 2 * 60 * 1000);

    // Also refresh when tab regains focus (user switches back)
    const onVisible = () => {
      if (!cancelled && document.visibilityState === 'visible') void silentRefresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid]);

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

    // Load inbox for admin
    if (isAdmin && authUser) {
      mysqlAdmin.listAllInbox().then((list) => {
        setInboxConversations((list as unknown as InboxConversation[]).sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '')));
      }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid, isAdmin]);



  // MySQL-only: subscriber data lives in MySQL.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistSubscriberToCollection = (_sub: SubscriberItem) => { /* MySQL */ };

  // MySQL-only: lead data lives in MySQL.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistLeadToCollection = (_lead: LeadItem) => { /* MySQL */ };

  // ── CRM transactional persist helpers — PG-only, no Firestore writes ──────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistConsultationToCollection = (_item: ConsultationItem) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistOrderToCollection = (_item: OrderItem) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistJoinUsToCollection = (_item: JoinUsApplication) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistPaymentHistoryToCollection = (_subscriberId: string, _entries: PaymentHistoryEntry[]) => { /* PG-only */ };

  const addSubscriber = async (item: SubscriberItem): Promise<boolean> => {
    const currentSubs = subscribersRef.current;
    const normPhone = (item.phone || '').replace(/\D/g, '');
    const normEmail = (item.email || '').toLowerCase().trim();
    const alreadyExists = currentSubs.some((s) => {
      const sp = (s.phone || '').replace(/\D/g, '');
      const se = (s.email || '').toLowerCase().trim();
      return (normPhone.length >= 7 && sp === normPhone) || (normEmail && se === normEmail);
    });
    if (alreadyExists) return false;

    let finalItem = item;
    if (!item.clientCode) {
      // No code provided — issue fresh atomic code
      finalItem = { ...item, clientCode: await issueClientCodeAsync() };
    } else {
      // Code was provided (e.g. inherited from lead) — MUST verify it is not already
      // used by another subscriber OR any lead. If taken, issue a fresh code.
      const isValidFmt = isValidClientCodeFormat(item.clientCode);
      const codeUsedBySub = currentSubs.some(s => s.id !== item.id && s.clientCode === item.clientCode);
      const codeUsedByLead = leadsRef.current.some(l => l.clientCode === item.clientCode);
      if (!isValidFmt || codeUsedBySub || codeUsedByLead) {
        finalItem = { ...item, clientCode: await issueClientCodeAsync() };
      }
    }
    const nextSubscribers = [finalItem, ...currentSubs];
    subscribersRef.current = nextSubscribers;
    lastCRMWriteRef.current = Date.now();
    setSubscribers(nextSubscribers);
    persistSubscriberToCollection(finalItem);
    // Await DB save so we can rollback if server rejects (e.g. duplicate phone already in DB)
    try {
      await mysqlAdmin.saveSubscriber(finalItem as unknown as Record<string,unknown>);
    } catch (saveErr) {
      // Rollback local state — the DB rejected the subscriber
      subscribersRef.current = currentSubs;
      lastCRMWriteRef.current = Date.now();
      setSubscribers(currentSubs);
      const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
      throw new Error(msg); // propagate real error so UI shows correct message
    }
    // Auto-delete any leads with matching phone or email
    // NOTE: payment sync to payments table is handled server-side in POST /api/admin/subscribers
    const np = (finalItem.phone || '').replace(/\D/g, '');
    const ne = (finalItem.email || '').toLowerCase().trim();
    setLeads((prev) => {
      const toRemove = prev.filter((l) => {
        const lp = (l.phone || '').replace(/\D/g, '');
        const le = (l.email || '').toLowerCase().trim();
        return (np.length >= 7 && lp === np) || (ne && le === ne);
      });
      toRemove.forEach(l => {
        void mysqlAdmin.deleteLead(l.id);
      });
      return prev.filter((l) => {
        const lp = (l.phone || '').replace(/\D/g, '');
        const le = (l.email || '').toLowerCase().trim();
        return !((np.length >= 7 && lp === np) || (ne && le === ne));
      });
    });
    if (finalItem.leadId) {
      setLeads((prev) => prev.map((l) => {
        if (l.id !== finalItem.leadId) return l;
        const updated = { ...l, status: 'converted' as LeadStatus };
        persistLeadToCollection(updated);
        void mysqlAdmin.saveLead(updated as unknown as Record<string,unknown>); // mark lead as 'converted'
        return updated;
      }));
    }
    // Sync initial enrollments handled via crm_json in saveSubscriber
    void 0;
    triggerAutomation('new_subscriber', { subscriberId: finalItem.id, name: finalItem.name });
    track('create', 'subscriber', finalItem.name);
    return true;
  };

  const updateSubscriber = (item: SubscriberItem) => {
    // Snapshot the old record BEFORE updating so we can diff.
    const oldSub = subscribersRef.current.find(r => r.id === item.id);
    // Upsert: add if not found (handles non-admin staff whose context subscribers are initially empty)
    const exists = !!oldSub;
    const nextSubscribers = exists
      ? subscribersRef.current.map((row) => (row.id === item.id ? item : row))
      : [...subscribersRef.current, item];
    subscribersRef.current = nextSubscribers;
    lastCRMWriteRef.current = Date.now();
    setSubscribers(nextSubscribers);
    persistSubscriberToCollection(item);
    // saveSubscriber sends the full crm_json to server — server auto-syncs paymentHistory → payments table
    // Pass updatedAt for OCC — server rejects with 409 if another write happened since last load
    const payload = { ...item, updatedAt: oldSub?.updatedAt ?? item.updatedAt };
    void mysqlAdmin.saveSubscriber(payload as unknown as Record<string,unknown>).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('تعارض') || msg.includes('conflict') || msg.includes('409')) {
        // OCC conflict: reload the latest version from server then re-apply non-payment changes
        void reloadLeads();
        mysqlAdmin.listAllSubscribers().then((fresh) => {
          const subs = (fresh as unknown as SubscriberItem[]).map(s => ({
            ...s,
            enrolledCourseIds: Array.isArray(s.enrolledCourseIds) ? s.enrolledCourseIds : [],
          }));
          if (subs.length > 0) { subscribersRef.current = subs; setSubscribers(subs); }
        }).catch(() => {});
        console.warn('[OCC] Subscriber conflict — reloaded fresh data from server');
      }
    });
    persistPaymentHistoryToCollection(item.id, item.paymentHistory ?? []);

    track('update', 'subscriber', item.name);
  };

  // Helpers: add to blocked set AND persist to localStorage so deletions survive page refresh
  const deleteSubscriber = (id: string) => {
    const nextSubscribers = subscribersRef.current.filter((row) => row.id !== id);
    subscribersRef.current = nextSubscribers;
    lastCRMWriteRef.current = Date.now();
    setSubscribers(nextSubscribers);
    void mysqlAdmin.deleteSubscriber(id);
    track('delete', 'subscriber', id);
  };

  const addLead = async (item: LeadItem): Promise<void> => {
    lastCRMWriteRef.current = Date.now();
    // Auto round-robin assignment if no sales person assigned yet
    let resolvedItem = item;
    if (!item.assignedSalesId) {
      const activeSales = staffMembers.filter((s) => s.role === 'sales' && s.status !== 'inactive');
      if (activeSales.length > 0) {
        const idx = roundRobinIndexRef.current % activeSales.length;
        const assigned = activeSales[idx];
        roundRobinIndexRef.current = idx + 1;
        resolvedItem = { ...item, assignedSalesId: assigned.id, assignedSalesName: assigned.name };
      }
    }
    // Assign clientCode upfront using atomic transaction so cross-session duplicates are impossible
    if (!resolvedItem.clientCode) {
      resolvedItem = { ...resolvedItem, clientCode: await issueClientCodeAsync() };
    }
    const normalizePhone = (value?: string | null) => (value || '').replace(/\D/g, '');
    const normPhone = normalizePhone(resolvedItem.phone);
    const normEmail = (resolvedItem.email || '').toLowerCase().trim();
    // Block if a subscriber already exists with same phone/email
    const isSubscriber = subscribersRef.current.some((s) => {
      const sp = normalizePhone(s.phone);
      const se = (s.email || '').toLowerCase().trim();
      return (normPhone.length >= 7 && sp === normPhone) || (normEmail && se === normEmail);
    });
    if (isSubscriber) return;
    // If lead already exists with same phone/email → merge instead of duplicate
    const existingIdx = leadsRef.current.findIndex((l) => {
      const lp = normalizePhone(l.phone);
      const le = (l.email || '').toLowerCase().trim();
      return (normPhone.length >= 7 && lp === normPhone) || (normEmail && le === normEmail);
    });
    let leadToWrite: LeadItem;
    if (existingIdx !== -1) {
      const existing = leadsRef.current[existingIdx];
      leadToWrite = {
        ...existing,
        name: resolvedItem.name || existing.name,
        interestedCourseIds: [...new Set([...(existing.interestedCourseIds || []), ...(resolvedItem.interestedCourseIds || []), resolvedItem.enrolledCourseId || ''].filter(Boolean))],
        source: resolvedItem.source || existing.source,
      };
      const nextLeads = leadsRef.current.map((l, i) => i === existingIdx ? leadToWrite : l);
      leadsRef.current = nextLeads;
      setLeads(nextLeads);
    } else {
      leadToWrite = resolvedItem;
      const nextLeads = [resolvedItem, ...leadsRef.current];
      leadsRef.current = nextLeads;
      setLeads(nextLeads);
    }
    persistLeadToCollection(leadToWrite);
    void mysqlAdmin.saveLead(resolvedItem as unknown as Record<string,unknown>);
    track('create', 'lead', resolvedItem.name);
    // Auto-create inbox conversation for messaging channels
    const src = (item.source || '').toLowerCase();
    const isMessaging = item.phone && (
      src.includes('واتساب') || src.includes('whatsapp') ||
      src.includes('ماسنجر') || src.includes('messenger') ||
      src.includes('انستجرام') || src.includes('instagram')
    );
    if (isMessaging) {
      const channel: MessagingChannel =
        src.includes('ماسنجر') || src.includes('messenger') ? 'messenger'
        : src.includes('انستجرام') || src.includes('instagram') ? 'instagram'
        : 'whatsapp';
      const newConv: InboxConversation = {
        id: `conv-lead-${Date.now()}`,
        channel,
        contactName: item.name,
        contactId: item.phone || '',
        contactAvatar: '',
        lastMessage: `ليد جديد: ${item.name}`,
        lastMessageAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        unreadCount: 1,
        status: 'open',
        assignedToStaffId: item.assignedSalesId || '',
        assignedToStaffName: item.assignedSalesName || '',
        tags: [],
        messages: [],
        linkedLeadId: item.id,
        linkedSubscriberId: '',
        createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      };
      setInboxConversations((prev) => [newConv, ...prev]);
    }
    triggerAutomation('new_lead', { leadId: item.id, name: item.name, source: item.source || '' });
  };

  // addPublicLead: for public registration forms — uses MySQL /api/registrations (no auth needed).
  const addPublicLead = async (item: Omit<LeadItem, 'clientCode'> & { clientCode?: string }): Promise<void> => {
    try {
      const { clientCode, id } = await mysqlForms.submitRegistration(item as unknown as Record<string,unknown>);
      const leadWithCode: LeadItem = { ...(item as LeadItem), id: id || (item as LeadItem).id, clientCode };
      // Update local state for instant UI feedback
      leadsRef.current = [leadWithCode, ...leadsRef.current];
      setLeads(prev => [leadWithCode, ...prev.filter(l => l.id !== leadWithCode.id)]);
      track('create', 'lead', leadWithCode.name);
    } catch {
      // Fallback: local only
      const code = item.clientCode || await issueClientCodeAsync();
      const leadWithCode: LeadItem = { ...(item as LeadItem), clientCode: code };
      await addLead(leadWithCode);
    }
  };

  const updateLead = (item: LeadItem) => {
    lastCRMWriteRef.current = Date.now();
    const nextLeads = leadsRef.current.map((row) => (row.id === item.id ? item : row));
    leadsRef.current = nextLeads;
    setLeads(nextLeads);
    persistLeadToCollection(item);
    void mysqlAdmin.saveLead(item as unknown as Record<string,unknown>);
    triggerAutomation('lead_status_changed', { leadId: item.id, name: item.name, status: item.status || '' });
    track('update', 'lead', item.name);
  };

  // Updates local state only — no API call. Use for bulk auto-convert on mount.
  const markLeadsConverted = (ids: string[]) => {
    const idSet = new Set(ids);
    const nextLeads = leadsRef.current.map((l) =>
      idSet.has(l.id) ? { ...l, status: 'converted' as const, hidden: true } : l
    );
    leadsRef.current = nextLeads;
    setLeads(nextLeads);
  };

  const deleteLead = (id: string) => {
    lastCRMWriteRef.current = Date.now();
    const nextLeads = leadsRef.current.filter((row) => row.id !== id);
    leadsRef.current = nextLeads;
    setLeads(nextLeads);
    void mysqlAdmin.deleteLead(id);
    track('delete', 'lead', id);
  };

  const bulkDeleteLeads = (ids: string[]) => {
    lastCRMWriteRef.current = Date.now();
    const idSet = new Set(ids);
    const nextLeads = leadsRef.current.filter((row) => !idSet.has(row.id));
    leadsRef.current = nextLeads;
    setLeads(nextLeads);
    ids.forEach(id => void mysqlAdmin.deleteLead(id));
    track('delete', 'lead', `bulk:${ids.length}`);
  };

  // Batch-assign client codes — write only the changed documents to their collections.
  const bulkAssignClientCodes = (updatedSubs: SubscriberItem[], updatedLeads: LeadItem[]) => {
    lastCRMWriteRef.current = Date.now();
    if (updatedSubs.length > 0) {
      const subsMap = new Map(updatedSubs.map(s => [s.id, s]));
      const nextSubs = subscribersRef.current.map(s => subsMap.get(s.id) ?? s);
      subscribersRef.current = nextSubs;
      setSubscribers(nextSubs);
      // Write to BOTH Firestore and PostgreSQL so codes survive PG bootstrap on next reload
      updatedSubs.forEach(s => {
        persistSubscriberToCollection(s);
        void mysqlAdmin.saveSubscriber(s as unknown as Record<string,unknown>);
      });
    }
    if (updatedLeads.length > 0) {
      const leadsMap = new Map(updatedLeads.map(l => [l.id, l]));
      const nextLeads = leadsRef.current.map(l => leadsMap.get(l.id) ?? l);
      leadsRef.current = nextLeads;
      setLeads(nextLeads);
      updatedLeads.forEach(l => {
        persistLeadToCollection(l);
        void mysqlAdmin.saveLead(l as unknown as Record<string,unknown>);
      });
    }
    track('update', 'clientCode', `bulk:${updatedSubs.length + updatedLeads.length}`);
  };

  const bulkRedistributeLeads = async (mode: 'unassigned' | 'all'): Promise<number> => {
    // Delegate distribution entirely to the server — avoids N parallel saveLead calls
    const result = await mysqlAdmin.distributeLeads(mode);
    const assigned = result.assigned ?? 0;
    if (assigned === 0) return 0;
    // Reload leads from server so the UI reflects the new assignments
    const freshLeads = await mysqlAdmin.listAllLeads();
    if ((freshLeads as unknown as LeadItem[]).length > 0) {
      const normalizedLeads = (freshLeads as unknown as LeadItem[]).map(l => ({
        ...l,
        status: (l.status || 'new').toLowerCase() as LeadStatus,
      }));
      leadsRef.current = normalizedLeads;
      setLeads(normalizedLeads);
    }
    track('update', 'lead', `bulkRedistribute:${assigned}`);
    return assigned;
  };

  const addConsultation = (item: ConsultationItem) => {
    lastCRMWriteRef.current = Date.now();
    // Auto-create a lead if this consultation client is not already in the system
    const normalizePhone = (value?: string | null) => (value || '').replace(/\D/g, '');
    const inPhone = normalizePhone(item.clientPhone);
    const inEmail = (item.clientEmail || '').toLowerCase().trim();
    const alreadyExists =
      subscribers.some(s =>
        (inPhone && normalizePhone(s.phone) === inPhone) ||
        (inEmail && s.email?.toLowerCase().trim() === inEmail)
      ) ||
      leads.some(l =>
        (inPhone && normalizePhone(l.phone) === inPhone) ||
        (inEmail && l.email?.toLowerCase().trim() === inEmail)
      );
    if (!alreadyExists && (item.clientPhone || item.clientEmail)) {
      // Issue the code BEFORE setState so we can await the async transaction
      void issueClientCodeAsync().then(newCode => {
        const newLead: LeadItem = {
          id: `lead-consult-${item.id}`,
          clientCode: newCode,
          name: item.clientName,
          email: item.clientEmail || '',
          phone: item.clientPhone || '',
          source: 'استشارة',
          status: 'new',
          leadType: 'consultation',
          branch: 'other',
          interestLevel: 'medium',
          assignedSalesId: '',
          assignedSalesName: '',
          communications: [],
          notes: `حجز استشارة مع ${item.therapistName}`,
          createdAt: item.createdAt || nowLabel(),
        };
        const nextLeads = [newLead, ...leadsRef.current];
        leadsRef.current = nextLeads;
        setLeads(nextLeads);
        persistLeadToCollection(newLead);
      });
    }
    setConsultations((prev) => [item, ...prev]);
    persistConsultationToCollection(item);
    void mysqlAdmin.saveConsultation(item as unknown as Record<string,unknown>);
    triggerAutomation('new_consultation', { consultationId: item.id, therapistName: item.therapistName, clientName: item.clientName });
    track('create', 'consultation', item.clientName);
  };

  const updateConsultation = (item: ConsultationItem) => {
    lastCRMWriteRef.current = Date.now();
    setConsultations((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistConsultationToCollection(item);
    void mysqlAdmin.updateConsultationStatus(item.id, item.status, item.notes, item.meetingLink);
    const consultTrigger: AutomationTrigger = item.status === 'confirmed' ? 'consultation_confirmed'
      : item.status === 'completed' ? 'consultation_completed'
      : item.status === 'cancelled' ? 'consultation_cancelled'
      : 'new_consultation';
    triggerAutomation(consultTrigger, { consultationId: item.id, therapistName: item.therapistName });
    track('update', 'consultation', item.clientName);
  };

  const deleteConsultation = (id: string) => {
    lastCRMWriteRef.current = Date.now();
    setConsultations((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteConsultation(id);
    track('delete', 'consultation', id);
  };

  const addOrder = (item: OrderItem) => {
    lastCRMWriteRef.current = Date.now();
    setOrders((prev) => [item, ...prev]);
    persistOrderToCollection(item);
    void mysqlAdmin.saveOrder(item as unknown as Record<string,unknown>);
    triggerAutomation('new_payment', { orderId: item.id, type: item.type, itemId: item.itemId, amount: String(item.amount) });
    track('create', 'order', item.itemTitle);
  };

  const updateOrderStatus = (id: string, status: OrderItem['status']) => {
    lastCRMWriteRef.current = Date.now();
    setOrders((prev) => prev.map((row) => {
      if (row.id !== id) return row;
      const updated = { ...row, status };
      persistOrderToCollection(updated);
      void mysqlAdmin.updateOrderStatus(id, status);
      return updated;
    }));
    track('update', 'order', `${id} -> ${status}`);
  };

  const deleteOrder = (id: string) => {
    lastCRMWriteRef.current = Date.now();
    setOrders((prev) => prev.filter((row) => row.id !== id));
    // Also remove from subscriber's paymentHistory if present
    setSubscribers((prev) => prev.map((sub) => {
      if (!sub.paymentHistory?.some((p) => p.id === id)) return sub;
      const updated = { ...sub, paymentHistory: sub.paymentHistory.filter((p) => p.id !== id) };
      void mysqlAdmin.saveSubscriber(updated); // persist removal
      return updated;
    }));
    void mysqlAdmin.deleteOrder(id);
    track('delete', 'order', id);
  };

  const addJoinUsApplication = (item: JoinUsApplication) => {
    setJoinUsApplications((prev) => [item, ...prev]);
    persistJoinUsToCollection(item);
    // Auto-create a lead for the applicant if not already in system
    const normalizePhone = (value?: string | null) => (value || '').replace(/\D/g, '');
    const inPhone = normalizePhone(item.phone);
    const inEmail = (item.email || '').toLowerCase().trim();
    const alreadyExists =
      subscribers.some(s =>
        (inPhone && normalizePhone(s.phone) === inPhone) ||
        (inEmail && s.email?.toLowerCase().trim() === inEmail)
      ) ||
      leads.some(l =>
        (inPhone && normalizePhone(l.phone) === inPhone) ||
        (inEmail && l.email?.toLowerCase().trim() === inEmail)
      );
    if (!alreadyExists && (item.phone || item.email)) {
      // Issue the code BEFORE setState so we can await the async transaction
      void issueClientCodeAsync().then(newCode => {
        const newLead: LeadItem = {
          id: `lead-joinus-${item.id}`,
          clientCode: newCode,
          name: item.name,
          email: item.email || '',
          phone: item.phone || '',
          source: 'طلب انضمام',
          status: 'new',
          leadType: 'general',
          branch: 'other',
          interestLevel: 'medium',
          assignedSalesId: '',
          assignedSalesName: '',
          communications: [],
          notes: `طلب انضمام${item.specialty ? ` - تخصص: ${item.specialty}` : ''}`,
          createdAt: nowLabel(),
        };
        const nextLeads = [newLead, ...leadsRef.current];
        leadsRef.current = nextLeads;
        setLeads(nextLeads);
        persistLeadToCollection(newLead);
      });
    }
    track('create', 'joinUs', item.name);
  };
  const updateJoinUsApplication = (item: JoinUsApplication) => {
    setJoinUsApplications((prev) => prev.map((x) => (x.id === item.id ? item : x)));
    persistJoinUsToCollection(item);
    track('update', 'joinUs', item.name);
  };
  const deleteJoinUsApplication = (id: string) => {
    setJoinUsApplications((prev) => prev.filter((x) => x.id !== id));
    track('delete', 'joinUs', id);
  };

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

  // ── localStorage persist (all data, fast debounce — keeps browser cache in sync always) ──────
  useEffect(() => {
    const payloadObject = {
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
      daqqiRounds,
      joinUsApplications,
      contactMessages,
      automationWorkflows,
      adminAiConfig,
      aiAgentConfig,
      messagingChannels,
      inboxConversations,
      fbLeadAdsConfig,
      courseQuizzes,
      quizAttempts,
      liveStreams,
    };

    // Strip loginPassword from leads before writing to localStorage (security)
    const safeLeadsForStorage = payloadObject.leads.map(({ loginPassword: _pw, ...rest }: LeadItem & { loginPassword?: string }) => rest);
    const safePayload = JSON.stringify({ ...payloadObject, leads: safeLeadsForStorage, _dataVersion: DATA_VERSION });

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, safePayload);
      } catch (e) {
        if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
          // localStorage is full — strip base64 images from gallery/certificate/therapist and retry
          const stripped = JSON.parse(safePayload);
          if (Array.isArray(stripped.courses)) {
            stripped.courses = stripped.courses.map((c: Record<string, unknown>) => ({
              ...c,
              galleryImages: Array.isArray(c.galleryImages)
                ? (c.galleryImages as string[]).filter((img: string) => !img.startsWith('data:'))
                : [],
              certificateTemplateUrl: typeof c.certificateTemplateUrl === 'string' && c.certificateTemplateUrl.startsWith('data:') ? '' : c.certificateTemplateUrl,
            }));
          }
          if (Array.isArray(stripped.therapists)) {
            stripped.therapists = stripped.therapists.map((t: Record<string, unknown>) => ({
              ...t,
              image: typeof t.image === 'string' && t.image.startsWith('data:') ? '' : t.image,
            }));
          }
          if (stripped.content && typeof stripped.content['institute.gallery.images'] === 'string') {
            // Keep gallery images (including compressed base64 thumbnails) — do not strip
          }
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped)); } catch { /* give up */ }
        }
      }
    }, 500);
    return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); };
  }, [courses, bundles, therapists, testimonials, subscribers, leads, staffMembers, consultations, lectures, chapters, orders, communityPosts, communityLibraryItems, communityVideos, communityEvents, content, activityLogs, discounts, notifications, expenses, daqqiRounds, joinUsApplications, contactMessages, automationWorkflows, adminAiConfig, aiAgentConfig, messagingChannels, inboxConversations, fbLeadAdsConfig, courseQuizzes, quizAttempts, liveStreams]);

  // ── Firestore CRM persist — all CRM arrays are now per-document collections ────────────────
  // consultations, orders, activityLogs, expenses, daqqiRounds, joinUsApplications,
  // contactMessages, quizAttempts each have their own persist* helper called at mutation time.
  // This effect is intentionally a no-op; retained only to avoid breaking dependency tracking.
  useEffect(() => {
    /* no-op: all CRM data now written per-doc via persist*ToCollection helpers */
  }, [remoteReady]);

  // ── MySQL Config persist — therapists, content, discounts, notifications ─────────────────
  useEffect(() => {
    if (!remoteReady || !isAdmin || isHydratingRef.current || !dbContentLoadedRef.current) return;
    if (configTimerRef.current) clearTimeout(configTimerRef.current);
    configTimerRef.current = setTimeout(() => {
      void mysqlAdmin.saveSettings({ therapists, testimonials } as Record<string, unknown>).catch(() => {});
      void mysqlAdmin.saveContent(content as Record<string, unknown>).catch(() => {});
      void mysqlAdmin.saveDiscounts(discounts as unknown[]).catch(() => {});
      void mysqlAdmin.saveNotifications(notifications as unknown[]).catch(() => {});
    }, 1500);
    return () => { if (configTimerRef.current) clearTimeout(configTimerRef.current); };
  }, [therapists, testimonials, content, discounts, notifications, remoteReady, isAdmin]);

  // ── MySQL Settings persist — AI & messaging config ─────────────────────────────────────────
  useEffect(() => {
    if (!remoteReady || !isAdmin || isHydratingRef.current) return;
    if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current);
    settingsTimerRef.current = setTimeout(() => {
      void mysqlAdmin.saveSettings({ adminAiConfig, aiAgentConfig, messagingChannels, fbLeadAdsConfig } as Record<string, unknown>).catch(() => {});
    }, 2000);
    return () => { if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current); };
  }, [adminAiConfig, aiAgentConfig, messagingChannels, fbLeadAdsConfig, remoteReady, isAdmin]);

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
    bulkDeleteLeads,
    bulkAssignClientCodes,
    bulkRedistributeLeads,
    addStaffMember,
    updateStaffMember,
    deleteStaffMember,
    addConsultation,
    updateConsultation,
    deleteConsultation,
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
    addQuizAttempt,
    deleteQuizAttempt,
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
    bulkSetDaqqiRounds,
    joinUsApplications,
    addJoinUsApplication,
    updateJoinUsApplication,
    deleteJoinUsApplication,
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
    refreshMySubscriber,
    reloadLectures,
    reloadLeads,
    logout,
    refreshAuth,
    triggerAutomation,
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


