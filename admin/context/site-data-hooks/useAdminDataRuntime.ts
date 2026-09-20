import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { mysqlAdmin, mysqlCatalog } from '../../lib/mysqlapi';
import type {
  ActivityLogItem, AdminAiConfig, AiAgentConfig, AutomationWorkflow, Bundle,
  ConsultationItem, ContactMessage, Course,
  CourseQuiz, DaqqiRound, DiscountRule, ExpenseItem, FacebookLeadAdsConfig,
  JoinUsApplication, LeadItem, LeadStatus, LiveStream, MessagingChannelsConfig,
  NotificationBroadcast, OrderItem, StaffMember, SubscriberItem, TestimonialItem,
  Therapist,
} from '../../types';
import { normalizeApplicants } from './normalizeApplicants';
import { normalizeOrders } from './normalizeOrders';

type Setter<T> = Dispatch<SetStateAction<T>>;
type Ref<T> = MutableRefObject<T>;
type RuntimeUser = {
  email?: string | null;
  uid?: string | null;
  isAdmin?: boolean;
  /** From /api/auth/me — see AuthUser in types.ts. */
  permissions?: string[] | '*' | null;
} | null | undefined;

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

/**
 * Newest first, decided once here rather than per screen.
 *
 * The API already answers `ORDER BY created_at DESC` on both lists, so the
 * order was usually right — but no screen asked for it. Every table downstream
 * (the archive pool, العملاء الأونلاين, الدقي) renders whatever order the array
 * happens to arrive in, so a route that paginates differently, a merge of two
 * fetches, or a filter that rebuilds the array silently reorders the page with
 * nothing to point at. Sorting where the rows enter the app makes it a property
 * of the data instead of a coincidence of the fetch.
 *
 * Rows without a date sort last: an undated row is not new, and floating it to
 * the top would put the least-known records in front of today's work.
 */
const newestFirst = <T extends { createdAt?: string | null }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => {
    const left = String(a.createdAt || '');
    const right = String(b.createdAt || '');
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return right.localeCompare(left);
  });

function normalizeLeads(rows: unknown): LeadItem[] {
  return newestFirst((rows as LeadItem[]).map(lead => ({
    ...lead,
    status: (lead.status || 'new').toLowerCase() as LeadStatus,
  })));
}

function normalizeSubscribers(rows: unknown): SubscriberItem[] {
  return newestFirst((rows as SubscriberItem[]).map(subscriber => ({
    ...subscriber,
    enrolledCourseIds: Array.isArray(subscriber.enrolledCourseIds) ? subscriber.enrolledCourseIds : [],
  })));
}

function withTimeout<T>(promise: Promise<T>, ms = 7000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function useAdminDataRuntime(state: RuntimeState): {
  loadFullCrmData: () => Promise<void>;
  loadFullLeads: () => Promise<void>;
  loadFullSubscribers: () => Promise<void>;
} {
  const {
    authUser, isHydratingRef, dbContentLoadedRef, lastCRMWriteRef,
    subscribersRef, leadsRef, staffMembersRef, contentRef,
    setRemoteReady, setSubscribers, setLeads, setStaffMembers, setConsultations,
    setContent, setCourses, setBundles, setTherapists,
    setTestimonials, setCourseQuizzes, setLiveStreams, setExpenses, setActivityLogs,
    setOrders, setJoinUsApplications, setContactMessages, setDaqqiRounds,
    setAutomationWorkflows, setDiscounts, setNotifications, setAdminAiConfigLocal,
    setAiAgentConfigState, setMessagingChannelsState, setFbLeadAdsConfigState,
    reloadOrders, reloadJoinUsApplications,
  } = state;

  // Declared up here because the background poll below reads them: it must be
  // able to tell whether a full table was ever pulled, and refreshing something
  // nobody asked for is exactly what this change stops.
  const fullLeadsRef = useRef<Promise<void> | null>(null);
  const fullSubsRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!authUser?.email || (!authUser.isAdmin && !authUser.uid)) return;
    let disposed = false;
    const safetyTimer = setTimeout(() => {
      if (disposed) return;
      isHydratingRef.current = false;
      setRemoteReady(true);
    }, 8000);

    // Lists the server gives to admins alone (requireAdmin, which isAdmin
    // mirrors). For anyone else each was a certain 403 on every page load —
    // seventeen refusals a load for the Dokki manager — and a refused list set
    // nothing, which is exactly what skipping it does.
    const isAdmin = authUser.isAdmin === true;
    const adminOnly = <T>(load: () => Promise<T>): Promise<T> =>
      isAdmin ? load() : Promise.reject(new Error('admin only'));

    // The rest are opened by a permission, so the question is whether this
    // account holds it — /api/auth/me answers that before the first request.
    // An account that does holds real data here; one that does not would have
    // been refused, which is the 403-per-list this avoids.
    const held = authUser.permissions;
    const permitted = (permission: string): boolean =>
      isAdmin || held === '*' || (Array.isArray(held) && held.includes(permission));
    // Promise<never>, so the ternary beside each call keeps the type of the
    // call itself rather than widening to unknown.
    const refused = (permission: string): Promise<never> =>
      Promise.reject(new Error(`no ${permission}`));

    void (async () => {
      try {
        const [subsRes, leadsRes, staffRes, consultsRes, contentRes] = await Promise.allSettled([
          withTimeout(mysqlAdmin.listSubscribersPage(500, 0)),
          withTimeout(mysqlAdmin.listLeadsPage(500, 0)),
          withTimeout(mysqlAdmin.listAllStaff()),
          withTimeout(permitted('view_consultations') ? mysqlAdmin.listAllConsultations() : refused('view_consultations')),
          withTimeout(mysqlAdmin.getContent(isAdmin)),
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

        // The full leads+subscribers pull used to fire here, one second after
        // boot, for every account on every page load — 26,878 leads and 1,353
        // subscribers whether or not the session ever opened a screen that
        // needed them. Reception, HR, the accountant and the instructors never
        // do, and even an admin checking today's revenue does not.
        //
        // It is requested now instead, by loadFullCrmData() below, from the
        // screens that actually read the whole array. The first page of each is
        // already in hand from the bootstrap above, so a screen that only needs
        // recent rows still renders immediately.

        await new Promise(resolve => setTimeout(resolve, 300));
        if (disposed) return;
        // Lectures and chapters were pulled here too — listLectures() with no
        // argument, which is the 5000 default: every lecture of every course,
        // half a megabyte, for every account on every page load. Five screens
        // read them. Those five call ensureLectures() now; see
        // useLecturesChaptersState.
        const [coursesRes, bundlesRes, therapistsRes] = await Promise.allSettled([
          mysqlAdmin.listAllCourses(),
          permitted('view_courses') ? mysqlAdmin.listAllBundles(500) : refused('view_courses'),
          permitted('view_consultations') ? mysqlAdmin.listAllTherapists() : refused('view_consultations'),
        ]);
        if (disposed) return;
        if (coursesRes.status === 'fulfilled' && coursesRes.value.length > 0) {
          setCourses((coursesRes.value as unknown as Course[])
            .sort((a, b) => (b.createdAt || b.id || '').localeCompare(a.createdAt || a.id || '')));
        }
        if (bundlesRes.status === 'fulfilled' && bundlesRes.value.length > 0) setBundles(bundlesRes.value as unknown as Bundle[]);
        if (therapistsRes.status === 'fulfilled' && therapistsRes.value.length > 0) setTherapists(therapistsRes.value as unknown as Therapist[]);

        await new Promise(resolve => setTimeout(resolve, 300));
        if (disposed) return;
        const [testimonialsRes, quizzesRes, streamsRes, expensesRes, activityRes] = await Promise.allSettled([
          mysqlCatalog.listTestimonials(),
          permitted('view_courses') ? mysqlCatalog.listQuizzes() : refused('view_courses'),
          permitted('view_courses') ? mysqlCatalog.listLiveStreams() : refused('view_courses'),
          mysqlAdmin.listAllExpenses(),
          permitted('view_activity') ? mysqlAdmin.listActivityLogs() : refused('view_activity'),
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
          permitted('view_contacts') ? mysqlAdmin.listAllContactMessages() : refused('view_contacts'),
          mysqlAdmin.listAllDaqqiRounds(),
          adminOnly(() => mysqlAdmin.listAllAutomationWorkflows()),
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
          permitted('manage_discounts') ? mysqlAdmin.getDiscounts() : refused('manage_discounts'),
          permitted('manage_notifications') ? mysqlAdmin.getNotificationSettings() : refused('manage_notifications'),
          adminOnly(() => mysqlAdmin.getSettings()),
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
        // Refresh what the session actually has, not everything that exists.
        //
        // This poll called listAllLeads() unconditionally, so an admin sitting
        // on any screen re-downloaded all 26,878 leads every two minutes — which
        // put back, on a timer, precisely the load the screens had just stopped
        // asking for. If the full table was never pulled, the first page is what
        // is on screen and the first page is what gets refreshed.
        const leadsFetch = fullLeadsRef.current
          ? mysqlAdmin.listAllLeads()
          : mysqlAdmin.listLeadsPage(500, 0);
        const subsFetch = fullSubsRef.current
          ? mysqlAdmin.listAllSubscribers()
          : mysqlAdmin.listSubscribersPage(500, 0);
        const [leadsRes, subscribersRes, roundsRes, expensesRes] = await Promise.allSettled([
          leadsFetch,
          subsFetch,
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
    // Only poll a tab the user is actually looking at. Each tick re-downloads the
    // whole leads and subscribers tables; measured against production (18,205
    // leads) that is ~1.3 MB of leads alone per tick, 4 requests deep. A 26-minute
    // session with the tab mostly backgrounded cost 209 API calls and 14.85 MB, of
    // which /admin/leads was 51 calls and 12.5 MB — 84% of all traffic — for data
    // nobody was on screen to see. No freshness is lost: the visibilitychange
    // handler below already refreshes the moment the tab comes back.
    const pollId = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void silentRefresh();
    }, 2 * 60 * 1000);
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

  // The two tables are pulled separately because the screens want them
  // separately. The client screens read subscribers and never touch a lead; the
  // scoring and duplicate screens are the other way round. Fetching both
  // together meant every one of them paid for the other's table — opening the
  // archived-clients list downloaded 26,878 leads it does not render.
  //
  // Idempotent by ref, not by state: several screens can mount in the same tick,
  // and a state flag would let each see "not loaded yet" and start its own copy
  // of the same pull.
  //
  // The ref doubles as the signal the background poll reads, which is why a
  // failure clears it: the next request should retry rather than leave the
  // session stuck on the first page forever, and the poll should not keep
  // refreshing a full table that never arrived.
  const loadFullLeads = useCallback(async () => {
    if (fullLeadsRef.current) return fullLeadsRef.current;
    fullLeadsRef.current = (async () => {
      try {
        const rows = await mysqlAdmin.listAllLeads();
        const leads = normalizeLeads(rows);
        leadsRef.current = leads;
        setLeads(leads);
      } catch (error) {
        fullLeadsRef.current = null;
        throw error;
      }
    })();
    return fullLeadsRef.current;
  }, [leadsRef, setLeads]);

  const loadFullSubscribers = useCallback(async () => {
    if (fullSubsRef.current) return fullSubsRef.current;
    fullSubsRef.current = (async () => {
      try {
        const rows = await mysqlAdmin.listAllSubscribers();
        const subscribers = normalizeSubscribers(rows);
        subscribersRef.current = subscribers;
        setSubscribers(subscribers);
      } catch (error) {
        fullSubsRef.current = null;
        throw error;
      }
    })();
    return fullSubsRef.current;
  }, [subscribersRef, setSubscribers]);

  // Both halves, for the screens that genuinely read both. Settled rather than
  // all-or-nothing so one table failing still delivers the other.
  const loadFullCrmData = useCallback(async () => {
    await Promise.allSettled([loadFullLeads(), loadFullSubscribers()]);
  }, [loadFullLeads, loadFullSubscribers]);

  return { loadFullCrmData, loadFullLeads, loadFullSubscribers };
}
