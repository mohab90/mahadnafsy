import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BUNDLES, COURSES, TESTIMONIALS, THERAPISTS } from '../constants';
import { AuthUser, Bundle, ConsultationItem, ContactMessage, Course, Currency, DaqqiRound, DiscountRule, ExpenseItem, JoinUsApplication, NotificationBroadcast, Therapist, LeadItem, LeadStatus, LeadType, BranchType, StaffMember, SubscriberItem, CourseLectureItem, CourseChapterItem, OrderItem, TestimonialItem, CommunityPostItem, CommunityLibraryItem, CommunityVideoItem, CommunityEventItem, ActivityLogItem, CourseAccessSetting, AutomationWorkflow, AutomationTrigger, AdminAiConfig, AiAgentConfig, MessagingChannelsConfig, MessagingChannel, InboxConversation, FacebookLeadAdsConfig, PaymentHistoryEntry, CourseQuiz, QuizAttempt, LiveStream } from '../types';
import { mysqlCatalog, mysqlAdmin, mysqlClient, mysqlForms } from '../lib/mysqlapi';
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
import { useActivityLogState, nowLabel } from './site-data-hooks/useActivityLogState';
import { useAiMessagingConfigState } from './site-data-hooks/useAiMessagingConfigState';
import { useCatalogState } from './site-data-hooks/useCatalogState';
import { useLecturesChaptersState } from './site-data-hooks/useLecturesChaptersState';
import { useExpensesState } from './site-data-hooks/useExpensesState';
import { useDaqqiRoundsState } from './site-data-hooks/useDaqqiRoundsState';
import { useStaffState } from './site-data-hooks/useStaffState';
import { useCrmCoreState } from './site-data-hooks/useCrmCoreState';
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
  reloadLectures: () => Promise<void>;
  reloadLeads: () => Promise<void>;
  reloadSubscribers: () => Promise<void>;
  reloadOrders: () => Promise<void>;
  logout: () => void;
  refreshAuth: () => void;
  triggerAutomation: (trigger: AutomationTrigger, data?: Record<string, unknown>) => void;
  // Scoped data for non-admin staff (set by Dashboard after fetchSalesData)
  staffScopedSubscribers: SubscriberItem[];
  staffScopedLeads: LeadItem[];
  setStaffScopedSubscribers: (subs: SubscriberItem[]) => void;
  setStaffScopedLeads: (leads: LeadItem[]) => void;
}

type StaffMemberWire = StaffMember & {
  is_active?: number | boolean | null;
  isActive?: number | boolean | null;
};

function normalizeStaffStatus(staff: StaffMemberWire): StaffMember['status'] {
  return staff.status === 'active' || staff.is_active === 1 || staff.is_active === true || staff.isActive === 1 || staff.isActive === true
    ? 'active'
    : 'inactive';
}

const STORAGE_KEY = 'mahad-admin-site-data-v1';
const DATA_VERSION = 4; // v4 removes all CRM/HR/finance/PII from browser persistence

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
  const initial = (() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return seedData;
      }
      const parsed = JSON.parse(raw);
      // Reject stale Firebase-era cache — force fresh MySQL fetch
      if (parsed._dataVersion !== DATA_VERSION) {
        localStorage.removeItem(STORAGE_KEY);
        return seedData;
      }
      // Migrate old-format source strings to structured fields
      const migratedLeads: LeadItem[] = (parsed.leads || seedData.leads).map((lead: LeadItem) => {
        if (!lead.source) return lead;
        // Old format: "طلب كورس - {courseTitle} - {branch}"
        if (lead.source.startsWith('طلب كورس - ')) {
          const withoutPrefix = lead.source.replace('طلب كورس - ', '');
          const lastDash = withoutPrefix.lastIndexOf(' - ');
          const courseTitle = lastDash > 0 ? withoutPrefix.slice(0, lastDash) : withoutPrefix;
          const branchRaw = lastDash > 0 ? withoutPrefix.slice(lastDash + 3) : '';
          const matchedCourse = COURSES.find((c) => c.title === courseTitle);
          return {
            ...lead,
            source: 'تسجيل اهتمام',
            leadType: 'course' as const,
            enrolledCourseId: matchedCourse?.id || lead.enrolledCourseId || '',
            branch: (branchRaw as LeadItem['branch']) || lead.branch,
          };
        }
        // Old format: "عرض الرئيسية - {branch}"
        if (lead.source.startsWith('عرض الرئيسية - ')) {
          const branchRaw = lead.source.replace('عرض الرئيسية - ', '');
          return { ...lead, source: 'عرض 24 ساعة', branch: (branchRaw as LeadItem['branch']) || lead.branch };
        }
        // Old format: "تسجيل حساب - ..."
        if (lead.source.startsWith('تسجيل حساب - ')) {
          return { ...lead, source: 'تسجيل دخول' };
        }
        return lead;
      });
      // Security migration: strip loginPassword from all leads
      const sanitizedLeads = migratedLeads.map(({ loginPassword: _pw, ...rest }: LeadItem & { loginPassword?: string }) => rest as LeadItem);
      const filteredLeads = sanitizedLeads;
      const allSubs: SubscriberItem[] = parsed.subscribers || seedData.subscribers;
      const filteredSubs = allSubs;
      // ── clientCode: do NOT assign codes locally from localStorage.
      // Codes are assigned server-side atomically. We pass data through unchanged;
      // the "تخصيص كود" button in Dashboard triggers the server to assign missing codes.
      const codedSubs = filteredSubs;
      const codedLeads = filteredLeads;
      return {
        ...seedData,
        ...parsed,
        leads: codedLeads,
        subscribers: codedSubs,
        content: { ...defaultContent, ...(parsed.content || {}) },
      };
    } catch {
      return seedData;
    }
  })();

  const subscribersRef = useRef<SubscriberItem[]>(initial.subscribers || defaultSubscribers);
  const leadsRef = useRef<LeadItem[]>(initial.leads || defaultLeads);
  const { currency, setCurrency } = useCurrencyState();
  const { authUser, setAuthUser, logout, refreshAuth } = useAuth();
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
  // Shared safe-mutation helper: fire an optimistic-update API call, and on
  // failure (403 permission denied, 404 deleted elsewhere, network drop) undo
  // the optimistic local change and surface the existing 'site-persist-error'
  // toast (consumed in Dashboard.tsx) — instead of leaving the UI showing a
  // change that the server actually rejected.
  const persistOrRevert = useCallback((apiCall: Promise<unknown>, revert: () => void, detail: { field: string; name?: string }) => {
    void apiCall.catch((err: unknown) => {
      console.error(`[${detail.field}] Failed to persist — rolling back:`, err);
      revert();
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail }));
    });
  }, []);
  const { courses, setCourses, addCourse, updateCourse, deleteCourse, bundles, setBundles, addBundle, updateBundle, deleteBundle, therapists, setTherapists, addTherapist, updateTherapist, deleteTherapist, testimonials, setTestimonials, addTestimonial, updateTestimonial, deleteTestimonial } =
    useCatalogState(initial.courses, initial.bundles, initial.therapists, initial.testimonials, lastLocalConfigWriteRef, persistOrRevert, track);
  const {
    lectures, setLectures, addLecture, updateLecture, deleteLecture, reloadLectures, getCourseLectures,
    chapters, setChapters, addChapter, updateChapter, deleteChapter, getCourseChapters,
  } = useLecturesChaptersState(initial.lectures || defaultLectures, initial.chapters || [], lastLocalConfigWriteRef, persistOrRevert, track);
  const { expenses, setExpenses, addExpense, updateExpense, deleteExpense } =
    useExpensesState((initial as typeof seedData & { expenses?: ExpenseItem[] }).expenses || [], lastCRMWriteRef, persistOrRevert, track);
  const { daqqiRounds, setDaqqiRounds, addDaqqiRound, updateDaqqiRound, deleteDaqqiRound, bulkSetDaqqiRounds } =
    useDaqqiRoundsState((initial as typeof seedData & { daqqiRounds?: DaqqiRound[] }).daqqiRounds || [], lastCRMWriteRef, persistOrRevert, track);
  const { staffMembers, setStaffMembers, staffMembersRef, addStaffMember, updateStaffMember, deleteStaffMember } =
    useStaffState(initial.staffMembers || defaultStaffMembers, lastCRMWriteRef, persistOrRevert, track);
  // Debounce timers for MySQL persist effects
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards the auto-save effect so it never fires before DB content is loaded
  const dbContentLoadedRef = useRef(false);
  // High-water mark for client codes (local fallback when MySQL unavailable)
  const { issueClientCode, issueClientCodeAsync, isValidClientCodeFormat } =
    useClientCodeIssuance(initial.leads, initial.subscribers, subscribersRef, leadsRef);
  // triggerAutomation (from useAutomationState below) needs this hook's setLeads as
  // an input, while this hook's own CRUD functions need triggerAutomation — resolved
  // via this ref, which the provider points at the real triggerAutomation once
  // useAutomationState has run (same "forward ref" shape as subscribersRef/leadsRef above).
  const triggerAutomationRef = useRef<(trigger: AutomationTrigger, data?: Record<string, unknown>) => void>(() => {});
  const {
    subscribers, setSubscribers,
    staffScopedSubscribers, setStaffScopedSubscribers,
    staffScopedLeads, setStaffScopedLeads,
    leads, setLeads,
    consultations, setConsultations,
    orders, setOrders,
    joinUsApplications, setJoinUsApplications,
    addSubscriber, updateSubscriber, deleteSubscriber,
    addLead, addPublicLead, updateLead, markLeadsConverted, deleteLead, bulkDeleteLeads, bulkAssignClientCodes, bulkRedistributeLeads,
    addConsultation, updateConsultation, deleteConsultation,
    addOrder, updateOrderStatus, deleteOrder,
    addJoinUsApplication, updateJoinUsApplication, deleteJoinUsApplication,
    reloadLeads, reloadSubscribers, reloadOrders,
  } = useCrmCoreState(
    initial.subscribers || defaultSubscribers,
    initial.leads || defaultLeads,
    initial.consultations || defaultConsultations,
    initial.orders || [],
    (initial as typeof seedData & { joinUsApplications?: JoinUsApplication[] }).joinUsApplications || [],
    subscribersRef, leadsRef, lastCRMWriteRef, persistOrRevert, track,
    staffMembers, issueClientCodeAsync, isValidClientCodeFormat, setInboxConversations, triggerAutomationRef,
  );
  const { discounts, setDiscounts, addDiscount, updateDiscount, deleteDiscount } =
    useDiscountsState((initial as typeof seedData & { discounts?: DiscountRule[] }).discounts || [], lastLocalConfigWriteRef, track);
  const { notifications, setNotifications, addNotification, updateNotification, deleteNotification } =
    useNotificationsState((initial as typeof seedData & { notifications?: NotificationBroadcast[] }).notifications || [], lastLocalConfigWriteRef, track);
  const { liveStreams, setLiveStreams, addLiveStream, updateLiveStream, deleteLiveStream } =
    useLiveStreamsState((initial as typeof seedData & { liveStreams?: LiveStream[] }).liveStreams || [], persistOrRevert, track);
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
    quizAttempts, setQuizAttempts, addQuizAttempt, deleteQuizAttempt,
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
  // setLeads/staffMembers are threaded in as parameters (leads lives in useCrmCoreState,
  // called above — see the triggerAutomationRef comment there for how the reverse
  // dependency, useCrmCoreState's CRUD functions needing triggerAutomation, is resolved).
  const { automationWorkflows, setAutomationWorkflows, addAutomationWorkflow, updateAutomationWorkflow, deleteAutomationWorkflow, triggerAutomation } =
    useAutomationState(
      (initial as typeof seedData & { automationWorkflows?: AutomationWorkflow[] }).automationWorkflows || [],
      staffMembers, setLeads, setNotifications, track,
    );
  triggerAutomationRef.current = triggerAutomation;

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
          withTimeout(mysqlAdmin.listSubscribersPage(500, 0)),
          withTimeout(mysqlAdmin.listLeadsPage(500, 0)),
          withTimeout(mysqlAdmin.listAllStaff()),
          withTimeout(mysqlAdmin.listAllConsultations()),
          withTimeout(mysqlAdmin.getContent()),
        ]);

        if (subsRes.status === 'fulfilled') {
          const subs = (subsRes.value as unknown as SubscriberItem[]).map(s => ({ ...s, enrolledCourseIds: Array.isArray(s.enrolledCourseIds) ? s.enrolledCourseIds : [] }));
          subscribersRef.current = subs;
          setSubscribers(subs);
        }
        if (leadsRes.status === 'fulfilled') {
          const normalizedLeads = (leadsRes.value as unknown as LeadItem[]).map(l => ({
            ...l,
            status: (l.status || 'new').toLowerCase() as LeadStatus,
          }));
          leadsRef.current = normalizedLeads;
          setLeads(normalizedLeads);
        }
        if (staffRes.status === 'fulfilled') {
          const normalizedStaff = (staffRes.value as unknown as StaffMemberWire[]).map(s => ({
            ...s,
            role: (s.role || '').toLowerCase() as StaffMember['role'],
            status: normalizeStaffStatus(s),
          }));
          staffMembersRef.current = normalizedStaff;
          setStaffMembers(normalizedStaff);
        }
        if (consultsRes.status === 'fulfilled')
          setConsultations(consultsRes.value as unknown as ConsultationItem[]);
        if (contentRes.status === 'fulfilled' && contentRes.value && Object.keys(contentRes.value).length > 0) {
          const remoteContent = contentRes.value as Record<string, string>;
          setContent(prev => ({ ...prev, ...remoteContent }));
          contentRef.current = { ...contentRef.current, ...remoteContent };
          // Only a successful, non-empty server snapshot may enable autosave.
          dbContentLoadedRef.current = true;
        }

        // Mark ready after batch 1 — admin sees CRM immediately
        clearTimeout(safetyTimer);
        isHydratingRef.current = false;
        setRemoteReady(true);

        // Fill the full CRM archive after first paint. Latest records become usable fast,
        // while deep filters/reports still receive the complete dataset in the background.
        void (async () => {
          await new Promise(r => setTimeout(r, 1000));
          const [fullLeadsRes, fullSubsRes] = await Promise.allSettled([
            mysqlAdmin.listAllLeads(),
            mysqlAdmin.listAllSubscribers(),
          ]);
          if (fullLeadsRes.status === 'fulfilled') {
            const normalized = (fullLeadsRes.value as unknown as LeadItem[]).map(l => ({
              ...l,
              status: (l.status || 'new').toLowerCase() as LeadStatus,
            }));
            leadsRef.current = normalized;
            setLeads(normalized);
          }
          if (fullSubsRes.status === 'fulfilled') {
            const subs = (fullSubsRes.value as unknown as SubscriberItem[]).map(s => ({
              ...s,
              enrolledCourseIds: Array.isArray(s.enrolledCourseIds) ? s.enrolledCourseIds : [],
            }));
            subscribersRef.current = subs;
            setSubscribers(subs);
          }
        })();

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
        // Keep writes blocked: rendering stale defaults is safer than overwriting
        // the server after a failed hydration.
        isHydratingRef.current = true;
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
        const [freshLeads, freshSubs, freshRounds, freshExpenses] = await Promise.allSettled([
          mysqlAdmin.listAllLeads(),
          mysqlAdmin.listAllSubscribers(),
          mysqlAdmin.listAllDaqqiRounds(),
          mysqlAdmin.listAllExpenses(),
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
        if (freshExpenses.status === 'fulfilled' && (freshExpenses.value as unknown as ExpenseItem[]).length > 0) {
          setExpenses(freshExpenses.value as unknown as ExpenseItem[]);
        }
        // Orders reuse reloadOrders() (already normalizes snake_case→camelCase) so
        // the Financial Overview tab doesn't lag behind Cockpit/Reconciliation,
        // which already read live from the DB on every render (PAY-15).
        void reloadOrders();
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
    const safePayload = JSON.stringify({ ...payloadObject, _dataVersion: DATA_VERSION });

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
    if (!remoteReady || !isAdmin || isHydratingRef.current || !dbContentLoadedRef.current) return;
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
    reloadLectures,
    reloadLeads,
    reloadSubscribers,
    reloadOrders,
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


