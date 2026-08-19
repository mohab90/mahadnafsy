import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { mysqlAdmin, mysqlCatalog } from '../../lib/mysqlapi';
import type {
  ActivityLogItem, AdminAiConfig, AiAgentConfig, AutomationWorkflow, Bundle,
  ConsultationItem, ContactMessage, Course, CourseChapterItem, CourseLectureItem,
  CourseQuiz, DaqqiRound, DiscountRule, ExpenseItem, FacebookLeadAdsConfig,
  JoinUsApplication, LeadItem, LeadStatus, LiveStream, MessagingChannelsConfig,
  NotificationBroadcast, OrderItem, StaffMember, SubscriberItem, TestimonialItem,
  Therapist,
} from '../../types';

type Setter<T> = Dispatch<SetStateAction<T>>;
type Ref<T> = MutableRefObject<T>;
type RuntimeUser = { email?: string | null; uid?: string | null; isAdmin?: boolean } | null | undefined;

interface RuntimeState {
  authUser: RuntimeUser;
  isHydratingRef: Ref<boolean>;
  dbContentLoadedRef: Ref<boolean>;
  lastCRMWriteRef: Ref<number>;
  subscribersRef: Ref<SubscriberItem[]>;
  leadsRef: Ref<LeadItem[]>;
  staffMembersRef: Ref<StaffMember[]>;
  contentRef: Ref<Record<string, string>>;
  setRemoteReady: Setter<boolean>;
  setSubscribers: Setter<SubscriberItem[]>;
  setLeads: Setter<LeadItem[]>;
  setStaffMembers: Setter<StaffMember[]>;
  setConsultations: Setter<ConsultationItem[]>;
  setContent: Setter<Record<string, string>>;
  setCourses: Setter<Course[]>;
  setBundles: Setter<Bundle[]>;
  setLectures: Setter<CourseLectureItem[]>;
  setChapters: Setter<CourseChapterItem[]>;
  setTherapists: Setter<Therapist[]>;
  setTestimonials: Setter<TestimonialItem[]>;
  setCourseQuizzes: Setter<CourseQuiz[]>;
  setLiveStreams: Setter<LiveStream[]>;
  setExpenses: Setter<ExpenseItem[]>;
  setActivityLogs: Setter<ActivityLogItem[]>;
  setOrders: Setter<OrderItem[]>;
  setJoinUsApplications: Setter<JoinUsApplication[]>;
  setContactMessages: Setter<ContactMessage[]>;
  setDaqqiRounds: Setter<DaqqiRound[]>;
  setAutomationWorkflows: Setter<AutomationWorkflow[]>;
  setDiscounts: Setter<DiscountRule[]>;
  setNotifications: Setter<NotificationBroadcast[]>;
  setAdminAiConfigLocal: Setter<AdminAiConfig | null>;
  setAiAgentConfigState: Setter<AiAgentConfig | null>;
  setMessagingChannelsState: Setter<MessagingChannelsConfig | null>;
  setFbLeadAdsConfigState: Setter<FacebookLeadAdsConfig | null>;
  reloadOrders: () => Promise<void>;
  reloadJoinUsApplications: () => Promise<void>;
}

type StaffWire = StaffMember & {
  is_active?: number | boolean | null;
  isActive?: number | boolean | null;
};

function normalizeStaffStatus(staff: StaffWire): StaffMember['status'] {
  return staff.status === 'active'
    || staff.is_active === 1 || staff.is_active === true
    || staff.isActive === 1 || staff.isActive === true
    ? 'active'
    : 'inactive';
}

function normalizeLeads(rows: unknown): LeadItem[] {
  return (rows as LeadItem[]).map(lead => ({
    ...lead,
    status: (lead.status || 'new').toLowerCase() as LeadStatus,
  }));
}

function normalizeSubscribers(rows: unknown): SubscriberItem[] {
  return (rows as SubscriberItem[]).map(subscriber => ({
    ...subscriber,
    enrolledCourseIds: Array.isArray(subscriber.enrolledCourseIds) ? subscriber.enrolledCourseIds : [],
  }));
}

function normalizeOrders(rows: unknown): OrderItem[] {
  return (rows as Record<string, unknown>[]).map(row => ({
    id: row.id as string,
    subscriberId: (row.subscriberId ?? row.subscriber_id ?? undefined) as string | undefined,
    type: (row.type as string || 'course') as OrderItem['type'],
    itemId: (row.itemId ?? row.item_id ?? '') as string,
    itemTitle: (row.itemTitle ?? row.item_title ?? '') as string,
    amount: Number(row.amount) || 0,
    currency: (row.currency || 'EGP') as OrderItem['currency'],
    paymentMethod: (row.paymentMethod ?? row.payment_method ?? 'wallet') as OrderItem['paymentMethod'],
    customerName: (row.customerName ?? row.customer_name ?? '') as string,
    customerEmail: (row.customerEmail ?? row.customer_email ?? '') as string,
    status: (row.status || 'paid') as OrderItem['status'],
    createdAt: (row.createdAt ?? row.created_at ?? '') as string,
    transactionId: (row.transactionId ?? row.transaction_id) as string | undefined,
    staffId: (row.staffId ?? row.staff_id ?? undefined) as string | undefined,
    staffName: (row.staffName ?? row.staff_name ?? undefined) as string | undefined,
    linkedTransferId: (row.linkedTransferId ?? row.linked_transfer_id ?? undefined) as string | undefined,
  }));
}

function normalizeApplicants(rows: unknown): JoinUsApplication[] {
  return (rows as Record<string, unknown>[]).map(row => ({
    ...row,
    status: String(row.status || 'NEW').toLowerCase(),
    createdAt: String(row.createdAt ?? row.created_at ?? ''),
    adminNote: (row.adminNote ?? row.admin_note) as string | undefined,
    convertedApplicantId: (row.convertedApplicantId ?? row.converted_applicant_id) as string | undefined,
    contactedAt: (row.contactedAt ?? row.contacted_at) as string | undefined,
    contactedBy: (row.contactedByName ?? row.contacted_by_name ?? row.contacted_by) as string | undefined,
    interviewAt: (row.interviewAt ?? row.interview_at) as string | undefined,
    applicantStage: (row.applicantStage ?? row.applicant_stage) as JoinUsApplication['applicantStage'],
    hiredStaffId: (row.hiredStaffId ?? row.hired_staff_id) as string | undefined,
  })) as JoinUsApplication[];
}

function withTimeout<T>(promise: Promise<T>, ms = 7000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function useAdminDataRuntime(state: RuntimeState): void {
  const {
    authUser, isHydratingRef, dbContentLoadedRef, lastCRMWriteRef,
    subscribersRef, leadsRef, staffMembersRef, contentRef,
    setRemoteReady, setSubscribers, setLeads, setStaffMembers, setConsultations,
    setContent, setCourses, setBundles, setLectures, setChapters, setTherapists,
    setTestimonials, setCourseQuizzes, setLiveStreams, setExpenses, setActivityLogs,
    setOrders, setJoinUsApplications, setContactMessages, setDaqqiRounds,
    setAutomationWorkflows, setDiscounts, setNotifications, setAdminAiConfigLocal,
    setAiAgentConfigState, setMessagingChannelsState, setFbLeadAdsConfigState,
    reloadOrders, reloadJoinUsApplications,
  } = state;

  useEffect(() => {
    if (!authUser?.email || (!authUser.isAdmin && !authUser.uid)) return;
    let disposed = false;
    const safetyTimer = setTimeout(() => {
      if (disposed) return;
      isHydratingRef.current = false;
      setRemoteReady(true);
    }, 8000);

    void (async () => {
      try {
        const [subsRes, leadsRes, staffRes, consultsRes, contentRes] = await Promise.allSettled([
          withTimeout(mysqlAdmin.listSubscribersPage(500, 0)),
          withTimeout(mysqlAdmin.listLeadsPage(500, 0)),
          withTimeout(mysqlAdmin.listAllStaff()),
          withTimeout(mysqlAdmin.listAllConsultations()),
          withTimeout(mysqlAdmin.getContent()),
        ]);
        if (disposed) return;

        if (subsRes.status === 'fulfilled') {
          const subscribers = normalizeSubscribers(subsRes.value);
          subscribersRef.current = subscribers;
          setSubscribers(subscribers);
        }
        if (leadsRes.status === 'fulfilled') {
          const leads = normalizeLeads(leadsRes.value);
          leadsRef.current = leads;
          setLeads(leads);
        }
        if (staffRes.status === 'fulfilled') {
          const staff = (staffRes.value as unknown as StaffWire[]).map(member => ({
            ...member,
            role: (member.role || '').toLowerCase() as StaffMember['role'],
            status: normalizeStaffStatus(member),
          }));
          staffMembersRef.current = staff;
          setStaffMembers(staff);
        }
        if (consultsRes.status === 'fulfilled') setConsultations(consultsRes.value as unknown as ConsultationItem[]);
        if (contentRes.status === 'fulfilled' && contentRes.value && Object.keys(contentRes.value).length > 0) {
          const remoteContent = contentRes.value as Record<string, string>;
          setContent(previous => ({ ...previous, ...remoteContent }));
          contentRef.current = { ...contentRef.current, ...remoteContent };
          dbContentLoadedRef.current = true;
        }

        clearTimeout(safetyTimer);
        isHydratingRef.current = false;
        setRemoteReady(true);

        void (async () => {
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (disposed) return;
          const [fullLeadsRes, fullSubsRes] = await Promise.allSettled([
            mysqlAdmin.listAllLeads(),
            mysqlAdmin.listAllSubscribers(),
          ]);
          if (disposed) return;
          if (fullLeadsRes.status === 'fulfilled') {
            const leads = normalizeLeads(fullLeadsRes.value);
            leadsRef.current = leads;
            setLeads(leads);
          }
          if (fullSubsRes.status === 'fulfilled') {
            const subscribers = normalizeSubscribers(fullSubsRes.value);
            subscribersRef.current = subscribers;
            setSubscribers(subscribers);
          }
        })();

        await new Promise(resolve => setTimeout(resolve, 300));
        if (disposed) return;
        const [coursesRes, bundlesRes, lecturesRes, chaptersRes, therapistsRes] = await Promise.allSettled([
          mysqlAdmin.listAllCourses(),
          mysqlAdmin.listAllBundles(500),
          mysqlCatalog.listLectures(),
          mysqlCatalog.listChapters(),
          mysqlAdmin.listAllTherapists(),
        ]);
        if (disposed) return;
        if (coursesRes.status === 'fulfilled' && coursesRes.value.length > 0) {
          setCourses((coursesRes.value as unknown as Course[])
            .sort((a, b) => (b.createdAt || b.id || '').localeCompare(a.createdAt || a.id || '')));
        }
        if (bundlesRes.status === 'fulfilled' && bundlesRes.value.length > 0) setBundles(bundlesRes.value as unknown as Bundle[]);
        if (lecturesRes.status === 'fulfilled' && lecturesRes.value.length > 0) setLectures(lecturesRes.value as unknown as CourseLectureItem[]);
        if (chaptersRes.status === 'fulfilled' && chaptersRes.value.length > 0) setChapters(chaptersRes.value as unknown as CourseChapterItem[]);
        if (therapistsRes.status === 'fulfilled' && therapistsRes.value.length > 0) setTherapists(therapistsRes.value as unknown as Therapist[]);

        await new Promise(resolve => setTimeout(resolve, 300));
        if (disposed) return;
        const [testimonialsRes, quizzesRes, streamsRes, expensesRes, activityRes] = await Promise.allSettled([
          mysqlCatalog.listTestimonials(),
          mysqlCatalog.listQuizzes(),
          mysqlCatalog.listLiveStreams(),
          mysqlAdmin.listAllExpenses(),
          mysqlAdmin.listActivityLogs(),
        ]);
        if (disposed) return;
        if (testimonialsRes.status === 'fulfilled' && testimonialsRes.value.length > 0) setTestimonials(testimonialsRes.value as unknown as TestimonialItem[]);
        if (quizzesRes.status === 'fulfilled' && quizzesRes.value.length > 0) setCourseQuizzes(quizzesRes.value as unknown as CourseQuiz[]);
        if (streamsRes.status === 'fulfilled' && streamsRes.value.length > 0) setLiveStreams(streamsRes.value as unknown as LiveStream[]);
        if (expensesRes.status === 'fulfilled') setExpenses(expensesRes.value as unknown as ExpenseItem[]);
        if (activityRes.status === 'fulfilled' && activityRes.value.length > 0) setActivityLogs(activityRes.value as unknown as ActivityLogItem[]);

        await new Promise(resolve => setTimeout(resolve, 300));
        if (disposed) return;
        const [ordersRes, applicantsRes, contactsRes, roundsRes, automationsRes] = await Promise.allSettled([
          mysqlAdmin.listAllOrders(),
          mysqlAdmin.listAllJoinUs(),
          mysqlAdmin.listAllContactMessages(),
          mysqlAdmin.listAllDaqqiRounds(),
          mysqlAdmin.listAllAutomationWorkflows(),
        ]);
        if (disposed) return;
        if (ordersRes.status === 'fulfilled' && ordersRes.value.length > 0) setOrders(normalizeOrders(ordersRes.value));
        if (applicantsRes.status === 'fulfilled') setJoinUsApplications(normalizeApplicants(applicantsRes.value));
        if (contactsRes.status === 'fulfilled' && contactsRes.value.length > 0) setContactMessages(contactsRes.value as unknown as ContactMessage[]);
        if (roundsRes.status === 'fulfilled' && roundsRes.value.length > 0) setDaqqiRounds(roundsRes.value as unknown as DaqqiRound[]);
        if (automationsRes.status === 'fulfilled' && automationsRes.value.length > 0) setAutomationWorkflows(automationsRes.value as unknown as AutomationWorkflow[]);

        await new Promise(resolve => setTimeout(resolve, 300));
        if (disposed) return;
        const [discountsRes, notificationsRes, settingsRes] = await Promise.allSettled([
          mysqlAdmin.getDiscounts(),
          mysqlAdmin.getNotificationSettings(),
          mysqlAdmin.getSettings(),
        ]);
        if (disposed) return;
        if (discountsRes.status === 'fulfilled' && discountsRes.value.length > 0) setDiscounts(discountsRes.value as unknown as DiscountRule[]);
        if (notificationsRes.status === 'fulfilled') {
          const data = notificationsRes.value as unknown as { rows?: NotificationBroadcast[] } | NotificationBroadcast[];
          const notifications = Array.isArray(data) ? data : (data.rows || []);
          if (notifications.length > 0) setNotifications(notifications);
        }
        if (settingsRes.status === 'fulfilled' && settingsRes.value) {
          const settings = settingsRes.value as Record<string, unknown>;
          if (settings.adminAiConfig) setAdminAiConfigLocal(settings.adminAiConfig as AdminAiConfig);
          if (settings.aiAgentConfig) setAiAgentConfigState(settings.aiAgentConfig as AiAgentConfig);
          if (settings.messagingChannels) setMessagingChannelsState(settings.messagingChannels as MessagingChannelsConfig);
          if (settings.fbLeadAdsConfig) setFbLeadAdsConfigState(settings.fbLeadAdsConfig as FacebookLeadAdsConfig);
        }
      } catch (error) {
        if (disposed) return;
        console.error('[MySQL] Bootstrap failed:', error);
        clearTimeout(safetyTimer);
        isHydratingRef.current = true;
        setRemoteReady(true);
      }
    })();

    return () => {
      disposed = true;
      clearTimeout(safetyTimer);
    };
  // State setters and refs are stable; auth identity is the lifecycle boundary.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid]);

  useEffect(() => {
    if (!authUser?.email || authUser.isAdmin !== true) return;
    let cancelled = false;
    // Separate from lastCRMWriteRef (which only guards "was there a recent
    // edit"): without this, every tab alt-out-and-back fires 'visibilitychange'
    // with no spacing of its own, so a user who checks WhatsApp a few times an
    // hour was re-fetching the entire leads+subscribers dataset (13k+ rows,
    // several MB) on every return — the repeated full-table re-renders this
    // caused were reported as the admin panel "feeling stuck" switching tabs.
    let lastRefreshAt = 0;
    const silentRefresh = async () => {
      if (cancelled || Date.now() - lastCRMWriteRef.current < 180_000) return;
      if (cancelled || Date.now() - lastRefreshAt < 90_000) return;
      lastRefreshAt = Date.now();
      try {
        const [leadsRes, subscribersRes, roundsRes, expensesRes] = await Promise.allSettled([
          mysqlAdmin.listAllLeads(),
          mysqlAdmin.listAllSubscribers(),
          mysqlAdmin.listAllDaqqiRounds(),
          mysqlAdmin.listAllExpenses(),
        ]);
        if (cancelled || Date.now() - lastCRMWriteRef.current < 180_000) return;
        if (leadsRes.status === 'fulfilled' && (leadsRes.value as unknown[]).length > 0) {
          const leads = normalizeLeads(leadsRes.value);
          leadsRef.current = leads;
          setLeads(leads);
        }
        if (subscribersRes.status === 'fulfilled' && (subscribersRes.value as unknown[]).length > 0) {
          const subscribers = normalizeSubscribers(subscribersRes.value);
          subscribersRef.current = subscribers;
          setSubscribers(subscribers);
        }
        if (roundsRes.status === 'fulfilled' && (roundsRes.value as unknown[]).length > 0) setDaqqiRounds(roundsRes.value as unknown as DaqqiRound[]);
        if (expensesRes.status === 'fulfilled') setExpenses(expensesRes.value as unknown as ExpenseItem[]);
        void reloadOrders();
        void reloadJoinUsApplications();
      } catch {
        // Polling is best-effort; the last confirmed server state remains visible.
      }
    };
    const pollId = setInterval(() => void silentRefresh(), 2 * 60 * 1000);
    const onVisible = () => {
      if (!cancelled && document.visibilityState === 'visible') void silentRefresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  // Same boundary as the bootstrap above: setters, refs and the reload helpers
  // are stable, and this installs a poll plus a visibility listener. Keying on
  // anything finer would tear them down and re-install them on every refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid]);
}
