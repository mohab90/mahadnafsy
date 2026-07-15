import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BUNDLES, COURSES, TESTIMONIALS, THERAPISTS } from '../constants';
import { AuthUser, Bundle, ConsultationItem, ContactMessage, Course, Currency, DaqqiRound, DiscountRule, ExpenseItem, JoinUsApplication, NotificationBroadcast, Therapist, LeadItem, LeadStatus, LeadType, BranchType, StaffMember, SubscriberItem, CourseLectureItem, CourseChapterItem, OrderItem, TestimonialItem, CommunityPostItem, CommunityLibraryItem, CommunityVideoItem, CommunityEventItem, ActivityLogItem, CourseAccessSetting, AutomationWorkflow, AutomationTrigger, AdminAiConfig, AiAgentConfig, MessagingChannelsConfig, MessagingChannel, InboxConversation, FacebookLeadAdsConfig, PaymentHistoryEntry, CourseQuiz, QuizAttempt, LiveStream } from '../types';
import { mysqlCatalog, mysqlAdmin, mysqlClient, mysqlForms } from '../lib/mysqlapi';
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
const DATA_VERSION = 3; // bumped to clear seed bundles b1/b2/b3 from localStorage cache

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

function nowLabel() {
  return new Date().toLocaleString('ar-EG', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

  const [courses, setCourses] = useState<Course[]>(initial.courses);
  const [bundles, setBundles] = useState<Bundle[]>(initial.bundles);
  const [therapists, setTherapists] = useState<Therapist[]>(initial.therapists);
  const [testimonials, setTestimonials] = useState<TestimonialItem[]>(initial.testimonials);
  const [subscribers, setSubscribers] = useState<SubscriberItem[]>(initial.subscribers || defaultSubscribers);
  const subscribersRef = useRef<SubscriberItem[]>(initial.subscribers || defaultSubscribers);
  subscribersRef.current = subscribers;
  const [leads, setLeads] = useState<LeadItem[]>(initial.leads || defaultLeads);
  const leadsRef = useRef<LeadItem[]>(initial.leads || defaultLeads);
  leadsRef.current = leads;
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>(initial.staffMembers || defaultStaffMembers);
  const staffMembersRef = useRef<StaffMember[]>(initial.staffMembers || defaultStaffMembers);
  staffMembersRef.current = staffMembers;
  // Scoped data for non-admin staff — set by Dashboard after fetchSalesData
  const [staffScopedSubscribers, setStaffScopedSubscribers] = useState<SubscriberItem[]>([]);
  const [staffScopedLeads, setStaffScopedLeads] = useState<LeadItem[]>([]);
  const [consultations, setConsultations] = useState<ConsultationItem[]>(initial.consultations || defaultConsultations);
  const [lectures, setLectures] = useState<CourseLectureItem[]>(initial.lectures || defaultLectures);
  const [chapters, setChapters] = useState<CourseChapterItem[]>(initial.chapters || []);
  const [orders, setOrders] = useState<OrderItem[]>(initial.orders || []);
  const [communityPosts, setCommunityPosts] = useState<CommunityPostItem[]>(initial.communityPosts || defaultCommunityPosts);
  const [communityLibraryItems, setCommunityLibraryItems] = useState<CommunityLibraryItem[]>(initial.communityLibraryItems || defaultCommunityLibraryItems);
  const [communityVideos, setCommunityVideos] = useState<CommunityVideoItem[]>(initial.communityVideos || defaultCommunityVideos);
  const [communityEvents, setCommunityEvents] = useState<CommunityEventItem[]>(initial.communityEvents || defaultCommunityEvents);
  const [content, setContent] = useState<Record<string, string>>(initial.content);
  const contentRef = useRef<Record<string, string>>(initial.content);
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>(initial.activityLogs);
  const [discounts, setDiscounts] = useState<DiscountRule[]>((initial as typeof seedData & { discounts?: DiscountRule[] }).discounts || []);
  const [notifications, setNotifications] = useState<NotificationBroadcast[]>((initial as typeof seedData & { notifications?: NotificationBroadcast[] }).notifications || []);
  const [courseQuizzes, setCourseQuizzes] = useState<CourseQuiz[]>((initial as typeof seedData & { courseQuizzes?: CourseQuiz[] }).courseQuizzes || []);
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>((initial as typeof seedData & { quizAttempts?: QuizAttempt[] }).quizAttempts || []);
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>((initial as typeof seedData & { liveStreams?: LiveStream[] }).liveStreams || []);
  const [expenses, setExpenses] = useState<ExpenseItem[]>((initial as typeof seedData & { expenses?: ExpenseItem[] }).expenses || []);
  const [daqqiRounds, setDaqqiRounds] = useState<DaqqiRound[]>((initial as typeof seedData & { daqqiRounds?: DaqqiRound[] }).daqqiRounds || []);
  const [joinUsApplications, setJoinUsApplications] = useState<JoinUsApplication[]>((initial as typeof seedData & { joinUsApplications?: JoinUsApplication[] }).joinUsApplications || []);
  const [contactMessages, setContactMessages] = useState<ContactMessage[]>((initial as typeof seedData & { contactMessages?: ContactMessage[] }).contactMessages || []);
  const [automationWorkflows, setAutomationWorkflows] = useState<AutomationWorkflow[]>((initial as typeof seedData & { automationWorkflows?: AutomationWorkflow[] }).automationWorkflows || []);
  const [adminAiConfig, setAdminAiConfigLocal] = useState<AdminAiConfig | null>((initial as typeof seedData & { adminAiConfig?: AdminAiConfig }).adminAiConfig || null);
  const [aiAgentConfig, setAiAgentConfigState] = useState<AiAgentConfig | null>((initial as typeof seedData & { aiAgentConfig?: AiAgentConfig }).aiAgentConfig || null);
  const [messagingChannels, setMessagingChannelsState] = useState<MessagingChannelsConfig | null>((initial as typeof seedData & { messagingChannels?: MessagingChannelsConfig }).messagingChannels || null);
  const [inboxConversations, setInboxConversations] = useState<InboxConversation[]>((initial as typeof seedData & { inboxConversations?: InboxConversation[] }).inboxConversations || []);
  const [fbLeadAdsConfig, setFbLeadAdsConfigState] = useState<FacebookLeadAdsConfig | null>((initial as typeof seedData & { fbLeadAdsConfig?: FacebookLeadAdsConfig }).fbLeadAdsConfig || null);
  const [currency, setCurrencyState] = useState<Currency>('USD');
  const { authUser, setAuthUser, logout, refreshAuth } = useAuth();
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
  // High-water mark for client codes (local fallback when MySQL unavailable)
  const isValidClientCodeFormat = (c: string | undefined): boolean =>
    !!c && /^C\d+$/.test(c) && parseInt(c.slice(1), 10) >= 10000;
  const highWaterCodeRef = useRef<number>((() => {
    const allInitial = [
      ...initial.leads.map((l: LeadItem) => l.clientCode),
      ...initial.subscribers.map((s: SubscriberItem) => s.clientCode),
    ].filter(isValidClientCodeFormat).map((c) => parseInt(c!.slice(1), 10));
    return allInitial.length > 0 ? Math.max(...allInitial) : 10000;
  })());

  // ── Client-code issuance (atomic via MySQL counter) ───────────────────────────
  const issueClientCodeAsync = async (): Promise<string> => {
    const liveNums = [
      ...subscribersRef.current.map(s => s.clientCode),
      ...leadsRef.current.map(l => l.clientCode),
    ].filter(isValidClientCodeFormat).map(c => parseInt(c!.slice(1), 10));
    const liveMax = liveNums.length > 0 ? Math.max(...liveNums) : 10000;
    const localFloor = Math.max(highWaterCodeRef.current, liveMax);
    highWaterCodeRef.current = localFloor + 1;
    try {
      const { code } = await mysqlAdmin.issueClientCode();
      const num = parseInt(code.slice(1), 10);
      if (num > highWaterCodeRef.current) highWaterCodeRef.current = num;
      return code;
    } catch {
      return `C${localFloor + 1}`;
    }
  };

  const issueClientCode = (): string => {
    const liveNums = [
      ...subscribersRef.current.map(s => s.clientCode),
      ...leadsRef.current.map(l => l.clientCode),
    ].filter(isValidClientCodeFormat).map(c => parseInt(c!.slice(1), 10));
    const liveMax = liveNums.length > 0 ? Math.max(...liveNums) : 10000;
    const next = Math.max(highWaterCodeRef.current, liveMax) + 1;
    highWaterCodeRef.current = next;
    return `C${next}`;
  };
  const track = (action: string, entity: string, label: string) => {
    const actor = authUser?.email || authUser?.uid || 'unknown';
    const actorName = authUser?.email?.split('@')[0] || actor;
    // Auto-derive section from entity
    const sectionMap: Record<string, string> = {
      course: 'إدارة الأكاديمية', lecture: 'إدارة الأكاديمية', chapter: 'إدارة الأكاديمية',
      bundle: 'إدارة الأكاديمية', quiz: 'إدارة الأكاديمية', live_stream: 'إدارة الأكاديمية',
      institute_gallery: 'إدارة الأكاديمية', testimonial: 'إدارة الأكاديمية',
      subscriber: 'إدارة العملاء', lead: 'إدارة العملاء', clientCode: 'إدارة العملاء',
      consultation: 'الاستشارات', therapist: 'المحاضرون',
      order: 'المالية', financial: 'المالية', discount: 'المالية',
      staff: 'إدارة الفريق', content: 'إعدادات الموقع',
      community_post: 'المجتمع', community_library: 'المجتمع',
      community_video: 'المجتمع', community_event: 'المجتمع',
    };
    const section = sectionMap[entity] || 'عام';
    const newLog = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      action,
      entity,
      label,
      at: nowLabel(),
      actor,
      actorName,
      section,
    };
    setActivityLogs((prev) => [newLog, ...prev]);
    persistActivityLogToCollection(newLog);
  };

  // Currency: respect localStorage override, otherwise auto-detect by country
  useEffect(() => {
    const stored = localStorage.getItem('mahad-currency') as Currency | null;
    if (stored && ['EGP', 'SAR', 'USD'].includes(stored)) {
      setCurrencyState(stored);
      return;
    }
    const countryToCurrency = (country?: string): Currency => {
      if (country === 'EG') return 'EGP';
      if (country === 'SA') return 'SAR';
      return 'USD';
    };
    const withTimeout = (url: string, ms = 4000) =>
      Promise.race([fetch(url), new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), ms))]) as Promise<Response>;

    // Primary: api.country.is
    withTimeout('https://api.country.is/')
      .then(r => r.json())
      .then((d: { country?: string }) => { setCurrencyState(countryToCurrency(d.country)); })
      .catch(() =>
        // Fallback 1: ipapi.co
        withTimeout('https://ipapi.co/json/')
          .then(r => r.json())
          .then((d: { country_code?: string }) => { setCurrencyState(countryToCurrency(d.country_code)); })
          .catch(() =>
            // Fallback 2: ipinfo.io
            withTimeout('https://ipinfo.io/json?token=')
              .then(r => r.json())
              .then((d: { country?: string }) => { setCurrencyState(countryToCurrency(d.country)); })
              .catch(() => { setCurrencyState('USD'); })
          )
      );
  }, []);

  // Auth: restore session via httpOnly cookie — managed by AuthContext (AuthProvider above SiteDataProvider)



  const setCurrency = (c: Currency) => {
    localStorage.setItem('mahad-currency', c);
    setCurrencyState(c);
  };

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

  // Reload lectures + chapters from API (called when VideoPlayer opens without lectures loaded)
  const reloadLectures = React.useCallback(async () => {
    try {
      const [lRes, chRes] = await Promise.allSettled([
        mysqlCatalog.listLectures(2000),
        mysqlCatalog.listChapters(1000),
      ]);
      if (lRes.status === 'fulfilled' && (lRes.value as unknown[]).length > 0)
        setLectures(lRes.value as unknown as CourseLectureItem[]);
      if (chRes.status === 'fulfilled' && (chRes.value as unknown[]).length > 0)
        setChapters(chRes.value as unknown as CourseChapterItem[]);
    } catch { /* silent */ }
  }, []);

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
          withTimeout(mysqlAdmin.listSubscribersPage(500, 0)),
          withTimeout(mysqlAdmin.listLeadsPage(500, 0)),
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
          const normalizedStaff = (staffRes.value as unknown as StaffMemberWire[]).map(s => ({
            ...s,
            role: (s.role || '').toLowerCase() as StaffMember['role'],
            status: normalizeStaffStatus(s),
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
        }
        // Mark DB content as loaded — unblocks the auto-save effect
        dbContentLoadedRef.current = true;

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
          if (fullLeadsRes.status === 'fulfilled' && fullLeadsRes.value.length > leadsRef.current.length) {
            const normalized = (fullLeadsRes.value as unknown as LeadItem[]).map(l => ({
              ...l,
              status: (l.status || 'new').toLowerCase() as LeadStatus,
            }));
            leadsRef.current = normalized;
            setLeads(normalized);
          }
          if (fullSubsRes.status === 'fulfilled' && fullSubsRes.value.length > subscribersRef.current.length) {
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
    void mysqlAdmin.saveCourse(resolvedCourse as unknown as Record<string,unknown>);
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
    void mysqlAdmin.saveCourse(course as unknown as Record<string,unknown>);
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
    void mysqlAdmin.saveTherapist(therapist as unknown as Record<string,unknown>);
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
    void mysqlAdmin.saveTherapist(therapist as unknown as Record<string,unknown>);
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
    is_published: 1,
    sort_order: 0,
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
    void mysqlAdmin.saveTestimonial(item as unknown as Record<string,unknown>);
    track('create', 'testimonial', item.name);
  };

  const updateTestimonial = (item: TestimonialItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = testimonials.map((row) => (row.id === item.id ? item : row));
    setTestimonials(next);
    persistTestimonialsToConfig(next);
    void mysqlAdmin.saveTestimonial(item as unknown as Record<string,unknown>);
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

  // Write the full therapists array directly to siteData/config immediately.
  // Called from every therapist mutation so changes appear on the website without waiting
  // for the debounced config persist (which can be skipped by the echo-loop guard).
  // ── Direct-write helpers for siteData/config fields ──────────────────────────────────────────
  // Each of these writes a SINGLE field immediately on mutation, bypassing the debounce.
  // This ensures the website sees changes instantly even if the echo-loop guard skips the debounce.
  const _persistConfigField = (field: string, value: unknown) => {
    lastLocalConfigWriteRef.current = Date.now();
    void mysqlAdmin.saveSettings({ [field]: JSON.parse(JSON.stringify(value)) } as Record<string,unknown>).catch(() => {});
  };
  const persistTherapistsToConfig = (updatedTherapists: Therapist[]) => _persistConfigField('therapists', updatedTherapists);
  const persistTestimonialsToConfig = (items: TestimonialItem[]) => _persistConfigField('testimonials', items);
  const persistContentToConfig = (c: Record<string, string>) => void mysqlAdmin.saveContent(c as Record<string,unknown>).catch(() => {});
  const persistDiscountsToConfig = (items: DiscountRule[]) => void mysqlAdmin.saveDiscounts(items as unknown[]).catch(() => {});
  const persistNotificationsToConfig = (items: NotificationBroadcast[]) => void mysqlAdmin.saveNotifications(items as unknown[]).catch(() => {});

  // Direct-write for settings fields
  const _persistSettingsField = (field: string, value: unknown) => {
    void mysqlAdmin.saveSettings({ [field]: JSON.parse(JSON.stringify(value)) } as Record<string,unknown>).catch(() => {});
  };

  // MySQL-only: subscriber data lives in MySQL.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistSubscriberToCollection = (_sub: SubscriberItem) => { /* MySQL */ };

  // MySQL-only: lead data lives in MySQL.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistLeadToCollection = (_lead: LeadItem) => { /* MySQL */ };

  // MySQL-only: staff data lives in MySQL.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistStaffMemberToCollection = (_member: StaffMember) => { /* MySQL */ };

  // Write a single course document to its Firestore collection.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistCourseToCollection = (_course: Course) => { /* PG-only — no Firestore write */ };

  // Write a single bundle document to its Firestore collection.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistBundleToCollection = (_bundle: Bundle) => { /* PG-only — no Firestore write */ };

  // Write a single lecture document to its Firestore collection.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistLectureToCollection = (_lecture: CourseLectureItem) => { /* PG-only — no Firestore write */ };

  // Write a single chapter document to its Firestore collection.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistChapterToCollection = (_chapter: CourseChapterItem) => { /* PG-only — no Firestore write */ };

  // ── Community & Workflow collection persist helpers ──────────────────────────────────────────
  const persistCommunityPostToCollection = (post: CommunityPostItem) => {
    void mysqlAdmin.saveCommunityPost(post as unknown as Record<string,unknown>).catch(() => {});
  };

  const persistCommunityLibraryItemToCollection = (item: CommunityLibraryItem) => {
    void mysqlAdmin.saveCommunityLibraryItem(item as unknown as Record<string,unknown>).catch(() => {});
  };

  const persistCommunityVideoToCollection = (video: CommunityVideoItem) => {
    void mysqlAdmin.saveCommunityVideo(video as unknown as Record<string,unknown>).catch(() => {});
  };

  const persistCommunityEventToCollection = (event: CommunityEventItem) => {
    void mysqlAdmin.saveCommunityEvent(event as unknown as Record<string,unknown>).catch(() => {});
  };

  const persistAutomationWorkflowToCollection = (workflow: AutomationWorkflow) => {
    void mysqlAdmin.saveAutomationWorkflow(workflow as unknown as Record<string,unknown>).catch(() => {});
  };

  const persistCourseQuizToCollection = (quiz: CourseQuiz) => {
    void mysqlAdmin.saveQuiz(quiz as unknown as Record<string,unknown>).catch(() => {});
  };

  const persistLiveStreamToCollection = (stream: LiveStream) => {
    void mysqlAdmin.saveLiveStream(stream as unknown as Record<string,unknown>).catch(() => {});
  };

  const persistInboxConversationToCollection = (conv: InboxConversation) => {
    void mysqlAdmin.saveInboxConversation(conv as unknown as Record<string,unknown>).catch(() => {});
  };

  // ── CRM transactional persist helpers — PG-only, no Firestore writes ──────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistConsultationToCollection = (_item: ConsultationItem) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistOrderToCollection = (_item: OrderItem) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistActivityLogToCollection = (_item: ActivityLogItem) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistExpenseToCollection = (_item: ExpenseItem) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistDaqqiRoundToCollection = (_item: DaqqiRound) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistJoinUsToCollection = (_item: JoinUsApplication) => { /* PG-only */ };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistContactMessageToCollection = (_item: ContactMessage) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistQuizAttemptToCollection = (_item: QuizAttempt) => { /* PG-only */ };
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

  const addStaffMember = (item: StaffMember) => {
    lastCRMWriteRef.current = Date.now();
    const nextStaff = [item, ...staffMembersRef.current];
    staffMembersRef.current = nextStaff;
    setStaffMembers(nextStaff);
    void mysqlAdmin.saveStaff(item as unknown as Record<string,unknown>).then(() => {
      persistStaffMemberToCollection(item);
    }).catch((err) => {
      console.error('[Staff] Failed to save staff to MySQL — rolling back:', err);
      const reverted = staffMembersRef.current.filter(s => s.id !== item.id);
      staffMembersRef.current = reverted;
      setStaffMembers(reverted);
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'staff', name: item.name } }));
    });
    track('create', 'staff', item.name);
  };

  const updateStaffMember = (item: StaffMember) => {
    lastCRMWriteRef.current = Date.now();
    const nextStaff = staffMembersRef.current.map((row) => (row.id === item.id ? item : row));
    staffMembersRef.current = nextStaff;
    setStaffMembers(nextStaff);
    persistStaffMemberToCollection(item);
    void mysqlAdmin.saveStaff(item as unknown as Record<string,unknown>);
    track('update', 'staff', item.name);
  };

  const deleteStaffMember = (id: string) => {
    lastCRMWriteRef.current = Date.now();
    const nextStaff = staffMembersRef.current.filter((row) => row.id !== id);
    staffMembersRef.current = nextStaff;
    setStaffMembers(nextStaff);
    void mysqlAdmin.deleteStaff(id);
    track('delete', 'staff', id);
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

  const addLecture = (item: CourseLectureItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    setLectures((prev) => [item, ...prev]);
    persistLectureToCollection(item);
    void mysqlAdmin.saveLecture(item as unknown as Record<string,unknown>);
    track('create', 'lecture', item.title);
  };

  const updateLecture = (item: CourseLectureItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    setLectures((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistLectureToCollection(item);
    void mysqlAdmin.saveLecture(item as unknown as Record<string,unknown>);
    track('update', 'lecture', item.title);
  };

  const deleteLecture = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    setLectures((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteLecture(id);
    track('delete', 'lecture', id);
  };

  const addChapter = (item: CourseChapterItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    setChapters((prev) => [...prev, item]);
    persistChapterToCollection(item);
    void mysqlAdmin.saveChapter(item as unknown as Record<string,unknown>);
    track('create', 'chapter', item.title);
  };

  const updateChapter = (item: CourseChapterItem) => {
    lastLocalConfigWriteRef.current = Date.now();
    setChapters((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistChapterToCollection(item);
    void mysqlAdmin.saveChapter(item as unknown as Record<string,unknown>);
    track('update', 'chapter', item.title);
  };

  const deleteChapter = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    setChapters((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteChapter(id);
    // Unlink lectures belonging to deleted chapter and persist updated lectures
    setLectures((prev) => {
      const updated = prev.map((row) => (row.chapterId === id ? { ...row, chapterId: undefined } : row));
      updated.filter(r => r.chapterId === undefined && prev.find(p => p.id === r.id)?.chapterId === id)
        .forEach(r => persistLectureToCollection(r));
      return updated;
    });
    track('delete', 'chapter', id);
  };

  const getCourseChapters = (courseId: string) =>
    chapters.filter((row) => row.courseId === courseId).sort((a, b) => a.order - b.order);

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

  const addCommunityPost = (item: CommunityPostItem) => {
    setCommunityPosts((prev) => [item, ...prev]);
    persistCommunityPostToCollection(item);
    track('create', 'community_post', item.title);
  };

  const updateCommunityPost = (item: CommunityPostItem) => {
    setCommunityPosts((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistCommunityPostToCollection(item);
    track('update', 'community_post', item.title);
  };

  const deleteCommunityPost = (id: string) => {
    setCommunityPosts((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteCommunityPost(id).catch(() => {});
    track('delete', 'community_post', id);
  };

  const addCommunityLibraryItem = (item: CommunityLibraryItem) => {
    setCommunityLibraryItems((prev) => [item, ...prev]);
    persistCommunityLibraryItemToCollection(item);
    track('create', 'community_library', item.title);
  };

  const updateCommunityLibraryItem = (item: CommunityLibraryItem) => {
    setCommunityLibraryItems((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistCommunityLibraryItemToCollection(item);
    track('update', 'community_library', item.title);
  };

  const deleteCommunityLibraryItem = (id: string) => {
    setCommunityLibraryItems((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteCommunityLibraryItem(id).catch(() => {});
    track('delete', 'community_library', id);
  };

  const addCommunityVideo = (item: CommunityVideoItem) => {
    setCommunityVideos((prev) => [item, ...prev]);
    persistCommunityVideoToCollection(item);
    track('create', 'community_video', item.title);
  };

  const updateCommunityVideo = (item: CommunityVideoItem) => {
    setCommunityVideos((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistCommunityVideoToCollection(item);
    track('update', 'community_video', item.title);
  };

  const deleteCommunityVideo = (id: string) => {
    setCommunityVideos((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteCommunityVideo(id).catch(() => {});
    track('delete', 'community_video', id);
  };

  const addCommunityEvent = (item: CommunityEventItem) => {
    setCommunityEvents((prev) => [item, ...prev]);
    persistCommunityEventToCollection(item);
    track('create', 'community_event', item.title);
  };

  const updateCommunityEvent = (item: CommunityEventItem) => {
    setCommunityEvents((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistCommunityEventToCollection(item);
    track('update', 'community_event', item.title);
  };

  const deleteCommunityEvent = (id: string) => {
    setCommunityEvents((prev) => prev.filter((row) => row.id !== id));
    void mysqlAdmin.deleteCommunityEvent(id).catch(() => {});
    track('delete', 'community_event', id);
  };

  const getCourseLectures = (courseId: string) => {
    const courseChapters = chapters.filter((c) => c.courseId === courseId);
    return lectures
      .filter((row) => row.courseId === courseId)
      .sort((a, b) => {
        // Sort by chapter order first, then by lecture order within the chapter.
        // This ensures limited-access slicing (first N videos) is always from the
        // beginning of the course, not interleaved across chapters.
        const chA = courseChapters.find((c) => c.id === a.chapterId)?.order ?? Infinity;
        const chB = courseChapters.find((c) => c.id === b.chapterId)?.order ?? Infinity;
        if (chA !== chB) return chA - chB;
        return a.order - b.order;
      });
  };

  const mergeContent = (incoming: Record<string, string>) => {
    contentRef.current = { ...contentRef.current, ...incoming };
    setContent(contentRef.current);
  };

  const setContentValue = (key: string, value: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    // Use contentRef (not the stale `content` state) so that calling setContentValue
    // multiple times in the same event handler accumulates all keys correctly instead
    // of each call overwriting the previous one with the same stale base.
    contentRef.current = { ...contentRef.current, [key]: value };
    const next = contentRef.current;
    setContent(next);
    persistContentToConfig(next);
    track('update', 'content', key);
  };

  const addContentKey = (key: string, value: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    contentRef.current = { ...contentRef.current, [key]: value };
    const next = contentRef.current;
    setContent(next);
    persistContentToConfig(next);
    track('create', 'content', key);
  };

  const removeContentKey = (key: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = { ...contentRef.current };
    delete next[key];
    contentRef.current = next;
    setContent(next);
    persistContentToConfig(next);
    track('delete', 'content', key);
  };

  const addDiscount = (item: DiscountRule) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = [item, ...discounts];
    setDiscounts(next);
    persistDiscountsToConfig(next);
    track('create', 'discount', item.label || `${item.discountPercent}%`);
  };

  const updateDiscount = (item: DiscountRule) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = discounts.map((d) => (d.id === item.id ? item : d));
    setDiscounts(next);
    persistDiscountsToConfig(next);
    track('update', 'discount', item.label || `${item.discountPercent}%`);
  };

  const deleteDiscount = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = discounts.filter((d) => d.id !== id);
    setDiscounts(next);
    persistDiscountsToConfig(next);
    track('delete', 'discount', id);
  };

  const addNotification = (item: NotificationBroadcast) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = [item, ...notifications];
    setNotifications(next);
    persistNotificationsToConfig(next);
    track('create', 'notification', item.title);
  };

  const updateNotification = (item: NotificationBroadcast) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = notifications.map((n) => (n.id === item.id ? item : n));
    setNotifications(next);
    persistNotificationsToConfig(next);
    track('update', 'notification', item.title);
  };

  const deleteNotification = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = notifications.filter((n) => n.id !== id);
    setNotifications(next);
    persistNotificationsToConfig(next);
    track('delete', 'notification', id);
  };

  const addCourseQuiz = (item: CourseQuiz) => {
    setCourseQuizzes((prev) => [item, ...prev.filter((q) => q.courseId !== item.courseId)]);
    persistCourseQuizToCollection(item);
    track('create', 'courseQuiz', item.title);
  };

  const updateCourseQuiz = (item: CourseQuiz) => {
    setCourseQuizzes((prev) => prev.map((q) => (q.id === item.id ? item : q)));
    persistCourseQuizToCollection(item);
    track('update', 'courseQuiz', item.title);
  };

  const deleteCourseQuiz = (id: string) => {
    setCourseQuizzes((prev) => prev.filter((q) => q.id !== id));
    void mysqlAdmin.deleteQuiz(id).catch(() => {});
    track('delete', 'courseQuiz', id);
  };

  const addQuizAttempt = (item: QuizAttempt) => {
    setQuizAttempts((prev) => [item, ...prev]);
    persistQuizAttemptToCollection(item);
    track('create', 'quizAttempt', `${item.subscriberId} score ${item.score}%`);
  };

  const deleteQuizAttempt = (id: string) => {
    setQuizAttempts((prev) => prev.filter((a) => a.id !== id));
    track('delete', 'quizAttempt', id);
  };

  const addLiveStream = (item: LiveStream) => {
    setLiveStreams((prev) => [item, ...prev]);
    persistLiveStreamToCollection(item);
    track('create', 'liveStream', item.title);
  };

  const updateLiveStream = (item: LiveStream) => {
    setLiveStreams((prev) => prev.map((s) => (s.id === item.id ? item : s)));
    persistLiveStreamToCollection(item);
    track('update', 'liveStream', item.title);
  };

  const deleteLiveStream = (id: string) => {
    setLiveStreams((prev) => prev.filter((s) => s.id !== id));
    void mysqlAdmin.deleteLiveStream(id).catch(() => {});
    track('delete', 'liveStream', id);
  };

  const addExpense = (item: ExpenseItem) => {
    lastCRMWriteRef.current = Date.now();
    setExpenses((prev) => [item, ...prev]);
    persistExpenseToCollection(item);
    void mysqlAdmin.saveExpense(item as unknown as Record<string,unknown>);
    track('create', 'expense', item.description);
  };

  const addDaqqiRound = async (item: DaqqiRound): Promise<void> => {
    lastCRMWriteRef.current = Date.now();
    setDaqqiRounds((prev) => [item, ...prev]);
    persistDaqqiRoundToCollection(item);
    try {
      await mysqlAdmin.saveDaqqiRound(item as unknown as Record<string,unknown>);
    } catch (err) {
      // Roll back optimistic add if save fails
      setDaqqiRounds((prev) => prev.filter((r) => r.id !== item.id));
      throw err;
    }
    track('create', 'daqqiRound', item.courseId);
  };

  const updateDaqqiRound = (item: DaqqiRound) => {
    lastCRMWriteRef.current = Date.now();
    setDaqqiRounds((prev) => prev.map((r) => (r.id === item.id ? item : r)));
    persistDaqqiRoundToCollection(item);
    void mysqlAdmin.saveDaqqiRound(item as unknown as Record<string,unknown>);
    track('update', 'daqqiRound', item.courseId);
  };

  const deleteDaqqiRound = (id: string) => {
    lastCRMWriteRef.current = Date.now();
    setDaqqiRounds((prev) => prev.filter((r) => r.id !== id));
    void mysqlAdmin.deleteDaqqiRound(id);
    track('delete', 'daqqiRound', id);
  };

  // Bulk-load daqqi rounds without triggering DB saves (for non-admin staff initial load)
  const bulkSetDaqqiRounds = (rounds: DaqqiRound[]) => {
    setDaqqiRounds(prev => {
      if (prev.length > 0) {
        // Merge: DB rounds take priority; preserve any locally-added rounds not yet in DB
        const dbIds = new Set(rounds.map(r => r.id));
        const localOnly = prev.filter(r => !dbIds.has(r.id));
        return [...rounds, ...localOnly];
      }
      return rounds;
    });
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

  const addContactMessage = (item: ContactMessage) => {
    setContactMessages((prev) => [item, ...prev]);
    persistContactMessageToCollection(item);
    track('create', 'contactMessage', item.name);
  };
  const updateContactMessage = (item: ContactMessage) => {
    setContactMessages((prev) => prev.map((x) => (x.id === item.id ? item : x)));
    persistContactMessageToCollection(item);
    track('update', 'contactMessage', item.name);
  };
  const deleteContactMessage = (id: string) => {
    setContactMessages((prev) => prev.filter((x) => x.id !== id));
    track('delete', 'contactMessage', id);
  };

  const addAutomationWorkflow = (item: AutomationWorkflow) => {
    setAutomationWorkflows((prev) => [item, ...prev]);
    persistAutomationWorkflowToCollection(item);
    track('create', 'automation', item.name);
  };
  const updateAutomationWorkflow = (item: AutomationWorkflow) => {
    setAutomationWorkflows((prev) => prev.map((x) => (x.id === item.id ? item : x)));
    persistAutomationWorkflowToCollection(item);
    track('update', 'automation', item.name);
  };
  const deleteAutomationWorkflow = (id: string) => {
    setAutomationWorkflows((prev) => prev.filter((x) => x.id !== id));
    void mysqlAdmin.deleteAutomationWorkflow(id).catch(() => {});
    track('delete', 'automation', id);
  };

  const setAdminAiConfig = (config: AdminAiConfig) => {
    setAdminAiConfigLocal(config);
    _persistSettingsField('adminAiConfig', config);
    track('update', 'admin_ai', config.model);
  };

  const setAiAgentConfig = (config: AiAgentConfig) => {
    setAiAgentConfigState(config);
    _persistSettingsField('aiAgentConfig', config);
    track('update', 'ai_agent', config.name);
  };

  const setMessagingChannels = (config: MessagingChannelsConfig) => {
    setMessagingChannelsState(config);
    _persistSettingsField('messagingChannels', config);
    track('update', 'messaging_channels', 'channels config');
  };

  const setFbLeadAdsConfig = (config: FacebookLeadAdsConfig) => {
    setFbLeadAdsConfigState(config);
    _persistSettingsField('fbLeadAdsConfig', config);
    track('update', 'fb_lead_ads', 'Facebook Lead Ads config');
  };
  const addInboxConversation = (conv: InboxConversation) => {
    setInboxConversations((prev) => [conv, ...prev]);
    persistInboxConversationToCollection(conv);
    track('create', 'inbox_conversation', conv.contactName);
  };
  const updateInboxConversation = (conv: InboxConversation) => {
    setInboxConversations((prev) => prev.map((c) => (c.id === conv.id ? conv : c)));
    persistInboxConversationToCollection(conv);
    track('update', 'inbox_conversation', conv.contactName);
  };
  const deleteInboxConversation = (id: string) => {
    setInboxConversations((prev) => prev.filter((c) => c.id !== id));
    void mysqlAdmin.deleteInboxConversation(id).catch(() => {});
    track('delete', 'inbox_conversation', id);
  };

  const updateExpense = (item: ExpenseItem) => {
    lastCRMWriteRef.current = Date.now();
    setExpenses((prev) => prev.map((e) => (e.id === item.id ? item : e)));
    persistExpenseToCollection(item);
    void mysqlAdmin.updateExpense(item as unknown as Record<string,unknown>);
    track('update', 'expense', item.description);
  };

  const deleteExpense = (id: string) => {
    lastCRMWriteRef.current = Date.now();
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    void mysqlAdmin.deleteExpense(id);
    track('delete', 'expense', id);
  };

  const triggerAutomation = (trigger: AutomationTrigger, data: Record<string, unknown> = {}) => {
    const enabledWorkflows = automationWorkflows.filter((w) => w.enabled && w.trigger === trigger);
    for (const workflow of enabledWorkflows) {
      if (workflow.conditions && workflow.conditions.length > 0) {
        const allMatch = workflow.conditions.every((cond) => {
          const fieldValue = String(data[cond.field] ?? '');
          switch (cond.operator) {
            case 'equals': return fieldValue === cond.value;
            case 'contains': return fieldValue.includes(cond.value);
            case 'greater_than': return Number(fieldValue) > Number(cond.value);
            case 'less_than': return Number(fieldValue) < Number(cond.value);
            case 'is_empty': return !fieldValue;
            case 'is_not_empty': return !!fieldValue;
            default: return true;
          }
        });
        if (!allMatch) continue;
      }
      const cfg = workflow.actionConfig || {};
      switch (workflow.action) {
        case 'notify_admin':
          setNotifications((prev) => [{
            id: `notif-auto-${Date.now()}`,
            title: cfg.title || workflow.name,
            body: cfg.message || `تم تفعيل الأتمتة: ${workflow.name}`,
            type: 'info',
            createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
            active: true,
          }, ...prev]);
          break;
        case 'update_lead_status': {
          const leadId = String(data.leadId ?? '');
          if (leadId && cfg.status) {
            setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, status: cfg.status as LeadStatus } : l));
          }
          break;
        }
        case 'add_note': {
          const leadId = String(data.leadId ?? '');
          if (leadId && cfg.message) {
            setLeads((prev) => prev.map((l) => l.id === leadId
              ? { ...l, notes: l.notes ? `${l.notes}\n[أتمتة] ${cfg.message}` : `[أتمتة] ${cfg.message}` }
              : l));
          }
          break;
        }
        case 'add_followup_reminder': {
          const leadId = String(data.leadId ?? '');
          if (leadId && cfg.days) {
            const d = new Date();
            d.setDate(d.getDate() + Number(cfg.days));
            const dateStr = d.toISOString().slice(0, 10);
            setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, nextFollowUpDate: dateStr } : l));
          }
          break;
        }
        case 'assign_staff': {
          const leadId = String(data.leadId ?? '');
          if (leadId && cfg.staffId) {
            const staff = staffMembers.find((s) => s.id === cfg.staffId);
            setLeads((prev) => prev.map((l) => l.id === leadId
              ? { ...l, assignedSalesId: cfg.staffId, assignedSalesName: staff?.name || cfg.staffId }
              : l));
          }
          break;
        }
        default:
          // External API actions (WhatsApp, Email, etc.) — require backend, log only
          track('automation', 'workflow', `${workflow.name} → ${workflow.action}`);
      }
      setAutomationWorkflows((prev) => prev.map((w) => w.id === workflow.id
        ? { ...w, lastTriggeredAt: new Date().toISOString().slice(0, 16).replace('T', ' '), triggerCount: (w.triggerCount || 0) + 1 }
        : w));
    }
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


