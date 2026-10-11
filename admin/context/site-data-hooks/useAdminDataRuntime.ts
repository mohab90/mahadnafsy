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
import type { SiteList } from './siteLists';

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

/**
 * The clients already held, with `incoming` laid over them by id.
 *
 * A page that arrives is added to what is on screen; it does not replace it. The
 * background refresh used to replace the whole array with the newest 500, so a
 * branch's clients loaded for its screen vanished two minutes later and the
 * count fell back to however many of them were among the newest 500.
 */
function mergeSubscribers(current: SubscriberItem[], incoming: SubscriberItem[]): SubscriberItem[] {
  const byId = new Map<string, SubscriberItem>();
  for (const row of current) byId.set(row.id, row);
  for (const row of incoming) byId.set(row.id, row);
  return newestFirst([...byId.values()]);
}

type RuntimeUserValue = NonNullable<RuntimeUser>;

/**
 * What the signed-in account may read, as the server decides it.
 *
 * Lists the server gives to admins alone (requireAdmin, which isAdmin mirrors)
 * are skipped for anyone else: each was a certain 403 — seventeen refusals a
 * load for the Dokki manager — and a refused list set nothing, which is exactly
 * what skipping it does. The rest are opened by a permission, which
 * /api/auth/me answers before the first request.
 */
function accessOf(authUser: RuntimeUserValue) {
  const isAdmin = authUser.isAdmin === true;
  const adminOnly = <T>(load: () => Promise<T>): Promise<T> =>
    isAdmin ? load() : Promise.reject(new Error('admin only'));
  const held = authUser.permissions;
  const permitted = (permission: string): boolean =>
    isAdmin || held === '*' || (Array.isArray(held) && held.includes(permission));
  // Promise<never>, so the ternary beside each call keeps the type of the call
  // itself rather than widening to unknown.
  const refused = (permission: string): Promise<never> =>
    Promise.reject(new Error(`no ${permission}`));
  return { isAdmin, adminOnly, permitted, refused };
}

export function useAdminDataRuntime(state: RuntimeState): {
  loadFullCrmData: () => Promise<void>;
  loadFullLeads: () => Promise<void>;
  loadFullSubscribers: () => Promise<void>;
  loadBranchSubscribers: (branch: string) => Promise<void>;
  ensureSiteLists: (lists: readonly SiteList[]) => Promise<void>;
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
  // Each on-demand list, once asked for: the request in flight or answered.
  // The poll reads it the same way — a list no screen asked for is not polled.
  const listLoadsRef = useRef(new Map<SiteList, Promise<void>>());

  useEffect(() => {
    if (!authUser?.email || (!authUser.isAdmin && !authUser.uid)) return;
    let disposed = false;
    // A new identity starts with nothing asked for.
    listLoadsRef.current = new Map();
    const safetyTimer = setTimeout(() => {
      if (disposed) return;
      isHydratingRef.current = false;
      setRemoteReady(true);
    }, 8000);

    const { isAdmin, permitted, refused } = accessOf(authUser);

    void (async () => {
      try {
        // What every screen leans on, and nothing more. The 500 newest clients,
        // leads and orders came here too — 1.47 MB of the 1.56 MB a sign-in
        // pulled — for a landing screen that counts them from the database.
        // They are on-demand lists now (siteLists.ts, ensureSiteLists below).
        const [staffRes, consultsRes, contentRes] = await Promise.allSettled([
          withTimeout(permitted('view_staff') ? mysqlAdmin.listAllStaff() : refused('view_staff')),
          withTimeout(permitted('view_consultations') ? mysqlAdmin.listAllConsultations() : refused('view_consultations')),
          withTimeout(mysqlAdmin.getContent(isAdmin)),
        ]);
        if (disposed) return;

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

        // The second wave starts now; the dashboard paints from the first.
        //
        // There were four `await new Promise(resolve => setTimeout(resolve,
        // 300))` between the waves once — 1.2 seconds of deliberate waiting on
        // every admin page load. Nothing said why, and the server they appeared
        // to be pacing answers in 3–15ms.
        if (disposed) return;
        // Lectures and chapters were pulled here too — listLectures() with no
        // argument, which is the 5000 default: every lecture of every course,
        // half a megabyte, for every account on every page load. Five screens
        // read them. Those five call ensureLectures() now; see
        // useLecturesChaptersState.
        const [coursesRes, bundlesRes, therapistsRes, notificationsRes] = await Promise.allSettled([
          permitted('view_courses') ? mysqlAdmin.listAllCourses() : refused('view_courses'),
          permitted('view_courses') ? mysqlAdmin.listAllBundles(500) : refused('view_courses'),
          permitted('view_consultations') ? mysqlAdmin.listAllTherapists() : refused('view_consultations'),
          // The menu's «صندوق الإشعارات» badge counts these, on every screen.
          permitted('manage_notifications') ? mysqlAdmin.getNotificationSettings() : refused('manage_notifications'),
        ]);
        if (disposed) return;
        if (coursesRes.status === 'fulfilled' && coursesRes.value.length > 0) {
          setCourses((coursesRes.value as unknown as Course[])
            .sort((a, b) => (b.createdAt || b.id || '').localeCompare(a.createdAt || a.id || '')));
        }
        if (bundlesRes.status === 'fulfilled' && bundlesRes.value.length > 0) setBundles(bundlesRes.value as unknown as Bundle[]);
        if (therapistsRes.status === 'fulfilled' && therapistsRes.value.length > 0) setTherapists(therapistsRes.value as unknown as Therapist[]);
        if (notificationsRes.status === 'fulfilled') {
          const data = notificationsRes.value as unknown as { rows?: NotificationBroadcast[] } | NotificationBroadcast[];
          const notifications = Array.isArray(data) ? data : (data.rows || []);
          if (notifications.length > 0) setNotifications(notifications);
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

  // One on-demand list, fetched and put in place. Keyed on authUser so the
  // permissions it asks with are the signed-in account's own; the screens call
  // it through ensureSiteLists, which holds each list to one request.
  const fetchList = useCallback(async (list: SiteList): Promise<void> => {
    if (!authUser?.email) throw new Error('signed out');
    const { permitted, adminOnly, refused } = accessOf(authUser);
    switch (list) {
      case 'subscribers': {
        // The whole table, once a screen pulled it, is newer than any page of it.
        if (fullSubsRef.current) return fullSubsRef.current;
        const rows = await (permitted('view_subscribers') ? mysqlAdmin.listSubscribersPage(500, 0) : refused('view_subscribers'));
        if (fullSubsRef.current) return;
        // Laid over what is held: a branch screen may have loaded its own clients first.
        const subscribers = mergeSubscribers(subscribersRef.current, normalizeSubscribers(rows));
        subscribersRef.current = subscribers;
        setSubscribers(subscribers);
        return;
      }
      case 'leads': {
        if (fullLeadsRef.current) return fullLeadsRef.current;
        const rows = await (permitted('view_leads') ? mysqlAdmin.listLeadsPage(500, 0) : refused('view_leads'));
        if (fullLeadsRef.current) return;
        const leads = normalizeLeads(rows);
        leadsRef.current = leads;
        setLeads(leads);
        return;
      }
      case 'orders': {
        const rows = await (permitted('view_orders') ? mysqlAdmin.listAllOrders() : refused('view_orders'));
        if (rows.length > 0) setOrders(normalizeOrders(rows));
        return;
      }
      case 'expenses': {
        // Set even when empty: an emptied ledger has to read as empty.
        const rows = await (permitted('view_financial') ? mysqlAdmin.listAllExpenses() : refused('view_financial'));
        setExpenses(rows as unknown as ExpenseItem[]);
        return;
      }
      case 'activityLogs': {
        const rows = await (permitted('view_activity') ? mysqlAdmin.listActivityLogs() : refused('view_activity'));
        if (rows.length > 0) setActivityLogs(rows as unknown as ActivityLogItem[]);
        return;
      }
      case 'testimonials': {
        const rows = await mysqlCatalog.listTestimonials();
        if (rows.length > 0) setTestimonials(rows as unknown as TestimonialItem[]);
        return;
      }
      case 'courseQuizzes': {
        const rows = await (permitted('view_courses') ? mysqlCatalog.listQuizzes() : refused('view_courses'));
        if (rows.length > 0) setCourseQuizzes(rows as unknown as CourseQuiz[]);
        return;
      }
      case 'liveStreams': {
        const rows = await (permitted('view_courses') ? mysqlCatalog.listLiveStreams() : refused('view_courses'));
        if (rows.length > 0) setLiveStreams(rows as unknown as LiveStream[]);
        return;
      }
      case 'joinUsApplications': {
        const rows = await (permitted('view_join_us') ? mysqlAdmin.listAllJoinUs() : refused('view_join_us'));
        setJoinUsApplications(normalizeApplicants(rows));
        return;
      }
      case 'contactMessages': {
        const rows = await (permitted('view_contacts') ? mysqlAdmin.listAllContactMessages() : refused('view_contacts'));
        if (rows.length > 0) setContactMessages(rows as unknown as ContactMessage[]);
        return;
      }
      case 'daqqiRounds': {
        const rows = await (permitted('manage_daqqi') ? mysqlAdmin.listAllDaqqiRounds() : refused('manage_daqqi'));
        if (rows.length > 0) setDaqqiRounds(rows as unknown as DaqqiRound[]);
        return;
      }
      case 'automationWorkflows': {
        const rows = await adminOnly(() => mysqlAdmin.listAllAutomationWorkflows());
        if (rows.length > 0) setAutomationWorkflows(rows as unknown as AutomationWorkflow[]);
        return;
      }
      case 'discounts': {
        const rows = await (permitted('manage_discounts') ? mysqlAdmin.getDiscounts() : refused('manage_discounts'));
        if (rows.length > 0) setDiscounts(rows as unknown as DiscountRule[]);
        return;
      }
      case 'settings': {
        const settings = await adminOnly(() => mysqlAdmin.getSettings()) as Record<string, unknown> | null;
        if (!settings) return;
        if (settings.adminAiConfig) setAdminAiConfigLocal(settings.adminAiConfig as AdminAiConfig);
        if (settings.aiAgentConfig) setAiAgentConfigState(settings.aiAgentConfig as AiAgentConfig);
        if (settings.messagingChannels) setMessagingChannelsState(settings.messagingChannels as MessagingChannelsConfig);
        if (settings.fbLeadAdsConfig) setFbLeadAdsConfigState(settings.fbLeadAdsConfig as FacebookLeadAdsConfig);
        return;
      }
    }
  // The setters and refs are stable; the account is what changes the answer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);

  // The lists a screen reads, each loaded once per sign-in however many screens
  // ask in the same tick. Settled, not all-or-nothing: one list failing still
  // delivers the rest. A failure (or a refusal) is forgotten, so the next screen
  // that asks tries again instead of the session keeping an empty list.
  const ensureSiteLists = useCallback((lists: readonly SiteList[]): Promise<void> => {
    const runs = lists.map(list => {
      const existing = listLoadsRef.current.get(list);
      if (existing) return existing;
      const run = fetchList(list).catch((error: unknown) => {
        if (listLoadsRef.current.get(list) === run) listLoadsRef.current.delete(list);
        throw error;
      });
      listLoadsRef.current.set(list, run);
      return run;
    });
    return Promise.allSettled(runs).then(() => undefined);
  }, [fetchList]);

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
        // is on screen and the first page is what gets refreshed — and a list no
        // screen has asked for (siteLists.ts) is not refreshed at all.
        const asked = (list: SiteList) => listLoadsRef.current.has(list);
        const nothing = Promise.resolve(null);
        const leadsFetch = fullLeadsRef.current
          ? mysqlAdmin.listAllLeads()
          : asked('leads') ? mysqlAdmin.listLeadsPage(500, 0) : nothing;
        const subsFetch = fullSubsRef.current
          ? mysqlAdmin.listAllSubscribers()
          : asked('subscribers') ? mysqlAdmin.listSubscribersPage(500, 0) : nothing;
        const [leadsRes, subscribersRes, roundsRes, expensesRes] = await Promise.allSettled([
          leadsFetch,
          subsFetch,
          // This poll runs for admins only (see the guard at the top of the
          // effect), so there is nothing to ask about here.
          asked('daqqiRounds') ? mysqlAdmin.listAllDaqqiRounds() : nothing,
          asked('expenses') ? mysqlAdmin.listAllExpenses() : nothing,
        ]);
        if (cancelled || Date.now() - lastCRMWriteRef.current < 180_000) return;
        if (leadsRes.status === 'fulfilled' && leadsRes.value && (leadsRes.value as unknown[]).length > 0) {
          const leads = normalizeLeads(leadsRes.value);
          leadsRef.current = leads;
          setLeads(leads);
        }
        if (subscribersRes.status === 'fulfilled' && subscribersRes.value && (subscribersRes.value as unknown[]).length > 0) {
          const fresh = normalizeSubscribers(subscribersRes.value);
          // The whole table, when it was pulled, is replaced by the whole table.
          // A page is laid over what is held — see mergeSubscribers.
          const subscribers = fullSubsRef.current ? fresh : mergeSubscribers(subscribersRef.current, fresh);
          subscribersRef.current = subscribers;
          setSubscribers(subscribers);
        }
        if (roundsRes.status === 'fulfilled' && roundsRes.value && (roundsRes.value as unknown[]).length > 0) setDaqqiRounds(roundsRes.value as unknown as DaqqiRound[]);
        if (expensesRes.status === 'fulfilled' && expensesRes.value) setExpenses(expensesRes.value as unknown as ExpenseItem[]);
        if (asked('orders')) void reloadOrders();
        if (asked('joinUsApplications')) void reloadJoinUsApplications();
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
  // Same boundary as the bootstrap above: setters, refs and the reload helpers
  // are stable, and this installs a poll plus a visibility listener. Keying on
  // anything finer would tear them down and re-install them on every refresh.
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

  // One branch's clients, for the screens about that branch.
  //
  // «عدد عملاء الدقي بيظهر 140 وهما أكتر»: those screens read the bootstrap page —
  // the 500 newest clients of ALL branches — and counted their branch's out of it.
  // The full table was the only other way, and it is the slow one (every client of
  // every branch, with payments, enrolments, certificates and plans, pulled in
  // 5,000-row pages). This asks the database for the branch only, 300 at a time:
  // the first page lands almost at once and the table opens on it, the rest fills
  // in behind. The real total comes from /count in the same moment, so the number
  // is right before the last page is.
  const branchLoadsRef = useRef(new Map<string, Promise<void>>());
  const loadBranchSubscribers = useCallback((branch: string): Promise<void> => {
    const existing = branchLoadsRef.current.get(branch);
    if (existing) return existing;
    const run = (async () => {
      try {
        await mysqlAdmin.streamSubscribers({ branch }, page => {
          const rows = normalizeSubscribers(page);
          const merged = mergeSubscribers(subscribersRef.current, rows);
          subscribersRef.current = merged;
          setSubscribers(merged);
        });
      } catch (error) {
        // Forgotten on failure, so the next visit tries again instead of keeping
        // a rejected promise for the rest of the session.
        branchLoadsRef.current.delete(branch);
        throw error;
      }
    })();
    branchLoadsRef.current.set(branch, run);
    return run;
  }, [subscribersRef, setSubscribers]);

  // Both halves, for the screens that genuinely read both. Settled rather than
  // all-or-nothing so one table failing still delivers the other.
  const loadFullCrmData = useCallback(async () => {
    await Promise.allSettled([loadFullLeads(), loadFullSubscribers()]);
  }, [loadFullLeads, loadFullSubscribers]);

  return { loadFullCrmData, loadFullLeads, loadFullSubscribers, loadBranchSubscribers, ensureSiteLists };
}
