// The dashboard's state and wiring: who is signed in and what they may open, the tab on screen and the URL it follows,
// the lists each tab loads, the badges, the overlays and the payment handlers. Dashboard.tsx draws the shell from it.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DASHBOARD_MENU_GROUPS, isTabKey, type TabKey } from '../navigation';
import { branchMatchesFilter, branchSlugToFilter } from '../branchWorkspaceFilters';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { StaffPermission, OrderItem } from '../../../types';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { useSiteData } from '../../../context/SiteDataContext';
import { useToast } from '../../../../shared/ui/Toast';
import type { PaymentDraft } from '../../../components/PaymentModal';
import { createClientPaymentDraft } from '../../../lib/clientActionDrafts';
import { currencyForBranch } from '../../../lib/branchCurrency';
import { CONTENT_HUB_TABS } from '../contentHubConfig';
import { fullCrmDataTabs, fullLeadTabs, fullSubscriberTabs } from '../dashboardTabGroups';
import { listsForTab } from '../tabSiteLists';
import type { SiteList } from '../../../context/site-data-hooks/siteLists';
import { useStaffRoleRedirects } from '../hooks/useStaffRoleRedirects';
import { CRM_CHANGED_EVENT, setStaffListsWanted } from '../../../lib/crmChanged';
import { useCurrentStaff } from '../hooks/useCurrentStaff';
import { useOrdersDerived } from '../hooks/useOrdersDerived';
import { useOverviewDerived } from '../hooks/useOverviewDerived';
import { useContentEditorDrafts } from '../hooks/useContentEditorDrafts';
import { useLeadFilters } from '../useLeadFilters';
import { useSubscriberFilters } from '../useSubscriberFilters';
import { useSubscriberModals } from '../hooks/useSubscriberModals';
import { useOrdersFinanceState } from '../hooks/useOrdersFinanceState';
import { useLeadCrmTabState } from '../hooks/useLeadCrmTabState';
import { exportOrdersCsv } from '../dashboardExports';
import { tabForUrl, urlForTab, urlToTabAlias } from '../tabUrlAliases';
import { useDashboardBadges } from '../useDashboardBadges';
import { useOnlineManagerSummary } from '../useOnlineManagerSummary';
import { useStaffOrders } from '../useStaffOrders';
import { useNotificationsBell } from '../useNotificationsBell';
import { useStaffOwnData } from '../useStaffOwnData';
import { staffClientsArePaged, staffScreenPagesFromServer, staffSkipsSiteLists } from '../staffListTabs';
import { useDashboardDerived } from '../useDashboardDerived';
import { useBranches } from '../../../hooks/useBranches';
import { branchOfRole, screenForTab, tabForScreen } from '../../../lib/physicalBranch';
import { useVisibleInterval } from '../../../../shared/useVisibleInterval';
import { TAB_PERMISSION_MAP } from '../dashboardShared';
import { realCourseIds } from '../tabs/leads/leadCourseLabel';
import { RETIRED_INTEGRATION_TABS } from '../tabs/IntegrationsTab';
import { RETIRED_SECURITY_TABS } from '../tabs/SecurityCenterTab';
import { RETIRED_ANALYTICS_TABS } from '../tabs/AnalyticsHubTab';
import { RETIRED_CAMPAIGN_TABS } from '../tabs/CampaignsTab';
import { RETIRED_SALES_TABS } from '../tabs/SalesPlanningTab';
import { useSaveFailureToasts } from './useSaveFailureToasts';
import { useAccess } from '../../../hooks/useAccess';
import { visibleMenu } from '../../../lib/access';


/** Every merged tab's base path and the keys that now redirect into it. */
const RETIRED_SECTION_TABS: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ['integrations', RETIRED_INTEGRATION_TABS],
  ['security_center', RETIRED_SECURITY_TABS],
  ['analytics_hub', RETIRED_ANALYTICS_TABS],
  ['campaigns', RETIRED_CAMPAIGN_TABS],
  ['sales_planning', RETIRED_SALES_TABS],
];

const _BUILD = '20260502';

export function useDashboardModel() {
  void _BUILD;
  const {
    courses,
    bundles,
    therapists,
    subscribers,
    leads,
    leadStats,
    loadFullCrmData,
    loadFullLeads,
    loadFullSubscribers,
    ensureSiteLists,
    daqqiRounds: siteDaqqiRounds,
    bulkSetDaqqiRounds,
    staffMembers,
    consultations,
    orders,
    communityPosts,
    communityLibraryItems,
    communityVideos,
    communityEvents,
    content,
    notifications,
    isAdmin,
    addSubscriber,
    updateSubscriber,
    deleteSubscriber,
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
    updateOrderStatus,
    reloadOrders,
    reloadLeads,
    reloadSubscribers,
    recordSubscriberPayment,
    deleteOrder,
    setContentValue,
    setContentValues,
    mergeContent,
    addContentKey,
    removeContentKey,
    authUser,
    remoteReady,
    currentStaff,
    staffSelf,
    staffSelfLoading,
  } = useSiteData();
  // What this account may open and do — one rule over the server's permission table (lib/access.ts).
  const access = useAccess();
  const [searchParams] = useSearchParams();
  const branchQueryFilter = branchSlugToFilter(searchParams.get('branch'));

  const branchesFromTable = useBranches();
  const { inboxUnreadCount, instituteBranches, branchLabelMap } = useDashboardDerived(content, notifications, branchesFromTable);

  // -- Pre-memoized ask_ai computations (must be inside Dashboard after useSiteData) ----------------------

  // notify must be a stable reference: it used to be recreated on every
  // Dashboard render, and every tab's `useEffect(..., [notify])` fetch-once
  // hook saw that as a changed dependency and re-fired. Normally invisible
  // (a successful fetch just calls setState, doesn't touch notify again),
  // but a tab whose initial fetch fails calls notify('error', ...) inside
  // the same effect — which re-renders Dashboard, mints a new notify, and
  // re-fires the effect. Confirmed live: OtpSettingsTab's OTP-config fetch
  // was failing, and the resulting tight loop hammered
  // /api/admin/sys-config?section=otp_provider dozens of times a second
  // until the rate limiter started 429-ing it too — staff could not reliably
  // open أو save واتساب/OTP channel settings. toast.show is already stable
  // (useCallback([]) in shared/ui/Toast.tsx); notify only needed to stop
  // being rebuilt on top of it.
  const { show: toastShow } = useToast();
  // 'warning' is included because the toast renders it (its own icon and colour
  // in shared/ui/Toast.tsx) and several tab components declare their notify prop
  // with it. Leaving it out here made this callback unassignable to those props:
  // a handler that accepts fewer kinds than the caller may pass is not a
  // substitute for one that accepts them all.
  const notify = useCallback(
    (type: 'success' | 'error' | 'info' | 'warning', text: string) => toastShow(text, type),
    [toastShow]
  );

  // A save the server refused is a toast, with its reason (useSaveFailureToasts.ts).
  useSaveFailureToasts(notify);



  const {
    searchText, setSearchText,
    newContentKey, setNewContentKey,
    newContentValue, setNewContentValue,
    contentEdits, setContentEdits,
    policyDrafts, setPolicyDrafts,
    instituteGalleryUrlInput, setInstituteGalleryUrlInput,
    instituteGalleryUploadRef,
  } = useContentEditorDrafts(content);

  const [lectureCourseId, setLectureCourseId] = useState('');

  const {
    subscriberCourseFilter, setSubscriberCourseFilter,
  } = useSubscriberFilters();
  // Reception Daqqi role — daqqi clients tab state
  const [daqqiSubSearch, setDaqqiSubSearch] = useState('');
  const [daqqiAccDateFrom, setDaqqiAccDateFrom] = useState('');
  const [daqqiAccDateTo, setDaqqiAccDateTo] = useState('');
  const [subCsDistributing, setSubCsDistributing] = useState(false);
  // Daqqi old-data distribution
  const [daqqiOldDistribPlan, setDaqqiOldDistribPlan] = useState<{staffId:string;count:string}[]>([{staffId:'',count:''}]);
  const [daqqiOldDistributing, setDaqqiOldDistributing] = useState(false);
  // Refund requests section state (shared with refund_requests tab)
  const {
    
    refundActionSaving, setRefundActionSaving,
    subPayRow, setSubPayRow,
    subPayDraft, setSubPayDraft,
    
    
    
    
  } = useSubscriberModals();

  const {
    
    salesNotifOpen, setSalesNotifOpen,
    onlineMgrFollowupOpen, setOnlineMgrFollowupOpen,
    onlineMgrNewEventsOpen, setOnlineMgrNewEventsOpen,
    
    
    quickBookOpen, setQuickBookOpen,
    quickBookSearch, setQuickBookSearch,
    leadPayRow, setLeadPayRow,
    leadPayDraft, setLeadPayDraft,
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    leadsSalesTargets,
  } = useLeadCrmTabState(access.can('view_leads'));

  const {
    setLeadsFollowupFilter,
  } = useLeadFilters();
  const navigate = useNavigate();
  const { tab: urlTab, param: urlParam } = useParams<{ tab: string; param?: string }>();
  // Through tabForUrl, as the URL effect below does: /dashboard/my_clients is
  // online_clients. Taken raw, the first render after the panel mounts on that
  // address had no such screen — it drew nothing for a frame, and the lists a
  // screen loads (tabSiteLists.ts) were all fetched for a key that names none.
  const [activeTabState, setActiveTabState] = useState<TabKey>(urlTab ? tabForUrl(urlTab) : 'overview');
  const [pendingProofsCount, setPendingProofsCount] = useState(0);
  const [onlineMgrAcademyOpen, setOnlineMgrAcademyOpen] = useState(false);
  // -- Horizontal dropdown nav state --
  const [activeDropdownGroup, setActiveDropdownGroup] = useState<string|null>(null);
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null);

  // -- In-app Notifications Bell --------------------------------------------
  const {
    notifRows, setNotifRows,
    notifUnread, setNotifUnread,
    notifOpen, setNotifOpen,
    notifRef, notifError, refreshNotifs,
  } = useNotificationsBell(Boolean(authUser));

  // «عملاء متصلون الآن»: fed by the customers' heartbeat (/api/me/heartbeat). It
  // was declared and never filled, so the panel always said nobody was online.
  const [onlineUsers, setOnlineUsers] = useState<{ uid: string; email?: string; displayName?: string; lastActiveAt: string }[]>([]);
  const [kpiModal, setKpiModal] = useState<{ title: string; rows: { label: string; sub?: string }[] } | null>(null);
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!urlTab) return;
    // Retired routes keep working.
    //
    // "subscribers" was renamed to "online_clients"; the seven integration
    // screens became sections of one, so each of their keys now opens that
    // screen with its own section selected. Anyone holding a bookmark, or a
    // link written into a handover document, still lands where they meant to.
    for (const [base, map] of RETIRED_SECTION_TABS) {
      const section = map[urlTab as string];
      if (section) { navigate(`/dashboard/${base}/${section}`, { replace: true }); return; }
    }
    // توقعات الإيرادات and توقعات المبيعات were one-line re-exports of the same
    // CrmForecastWorkspace — one screen listed twice. It lives under sales now.
    if (urlTab === 'revenue_forecast') {
      navigate('/dashboard/sales_planning/forecast', { replace: true }); return;
    }
    // The financial hub already contained these; the menu was repeating it.
    if (['balance_sheet', 'cash_flow', 'budget_tracker', 'recurring_expenses'].includes(String(urlTab))) {
      navigate(`/dashboard/financial_reports/${urlTab}`, { replace: true }); return;
    }
    const resolved = tabForUrl(urlTab);
    // A key that is no screen lands on the overview instead of nothing at all.
    //
    // /dashboard/staff — a name the panel has never had, the staff list lives
    // under الموارد البشرية — drew the chrome and an empty page: no screen, no
    // message, nothing to click. Every mistyped or retired link did. The map
    // below is the registry of real screens (permission-matrix-scan keeps it
    // complete), so anything outside it is not a screen.
    if (!Object.prototype.hasOwnProperty.call(TAB_PERMISSION_MAP, resolved)) {
      navigate('/dashboard/overview', { replace: true });
      return;
    }
    if (urlToTabAlias(urlTab) !== urlTab) { navigate(`/dashboard/${urlForTab(resolved)}`, { replace: true }); return; }
    if (resolved !== activeTabState) setActiveTabState(resolved as TabKey);
    // Keyed on the URL alone, deliberately. This effect exists to follow the
    // address bar; activeTabState is what it *sets*, and `navigate` is stable
    // for the life of the router. Listing either would re-run a URL handler on
    // a state change it just made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTab]);

  // Fetch pending payment proofs count once on mount (for sidebar badge)
  useEffect(() => {
    if (!isAdmin) return;
    mysqlAdmin.listPaymentProofs('PENDING').then(rows => {
      setPendingProofsCount(Array.isArray(rows) ? rows.length : 0);
    }).catch(() => {});
  }, [isAdmin]);
  const setRouteTab = useCallback((tab: TabKey) => {
    setActiveTabState(tab);
    navigate(`/dashboard/${urlForTab(tab)}`);
  }, [navigate]);
  // «فرع التجمع زي بتاع الدقي بالظبط»: a tagamoa_* tab shows the daqqi_* screen
  // for the Tagamoa branch (lib/physicalBranch.tsx). The screens see the Dokki
  // name; a link they open stays in the branch being shown.
  const { screen: activeScreen, branch: physicalBranch } = screenForTab(activeTabState);
  const ownBranchRole = branchOfRole(currentStaff?.role);
  const setActiveTab = useCallback(
    (tab: TabKey) => setRouteTab(tabForScreen(tab, physicalBranch) as TabKey),
    [setRouteTab, physicalBranch],
  );

  // For the panels that type their navigation callback as `(tab: string)`
  // because they build the name from data. setActiveTab cannot be handed to them
  // directly — it takes only TabKey — and forcing it through with a cast would
  // let an unknown name blank the dashboard. Unknown names are refused loudly
  // here instead, so a wrong one is a console message rather than an empty page.
  const navigateToTab = useCallback((tab: string) => {
    if (isTabKey(tab)) { setActiveTab(tab); return; }
    console.warn(`[dashboard] refused navigation to unknown tab: ${tab}`);
  }, [setActiveTab]);
  // A branch manager's HR is their branch's: «الموارد البشرية» from any link or
  // address opens it, not the institute's HR they are refused.
  const branchHrOnly = ['daqqi_manager', 'tagamoa_manager'].includes(String(currentStaff?.role || '').toLowerCase());
  const activeTab = (branchHrOnly && ['hr', 'hr_analytics'].includes(activeScreen) ? 'branch_hr' : activeScreen) as TabKey;
  useVisibleInterval(() => {
    mysqlAdmin.getOnlineUsers().then(rows => {
      setOnlineUsers((rows as { uid: string; name?: string; email?: string; lastActiveAt: string }[])
        .map(u => ({ uid: u.uid, email: u.email, displayName: u.name, lastActiveAt: u.lastActiveAt })));
    }).catch(() => { /* presence store down: the panel keeps its last answer */ });
  }, 60000, isAdmin && activeTab === 'overview');


  const {
    orderSearch, setOrderSearch,
    orderStatusFilter, setOrderStatusFilter,
    orderTypeFilter, setOrderTypeFilter,
    orderMethodFilter, setOrderMethodFilter,
    orderDateFrom, setOrderDateFrom,
    orderDateTo, setOrderDateTo,
    orderReviewTab, setOrderReviewTab,
    orderStaffFilter, setOrderStaffFilter,
    omOrdReviewTab, setOmOrdReviewTab,
    
    showAddTransfer, setShowAddTransfer,
    linkTransferModal, setLinkTransferModal,
    linkOrderModal, setLinkOrderModal,
  } = useOrdersFinanceState();

  // Discount management state

  // Notification state moved to NotificationsAdminTab.tsx

  // Quiz + LiveStream state moved to their own tab components

  // Resizable columns (widths in px, persisted per table in localStorage)
  // Activity log filters moved to ActivityTab.tsx

  // Leads view mode: table or kanban

  // -- Saved Segments --------------------------------------------------------
  // -- WhatsApp Templates ----------------------------------------------------
  // Tag input (keyed by lead id being edited)

  // Community sub-tab
  const [communityAdminTab, setCommunityAdminTab] = useState<'pending' | 'posts' | 'library' | 'videos' | 'events' | 'comments'>('pending');

  // Join Us tab state moved to JoinUsAdminTab.tsx
  // Contacts tab state moved to ContactsTab.tsx

  // -- Automation tab state moved to AutomationTab.tsx ---------------------

  const menuGroups = DASHBOARD_MENU_GROUPS;

  // -------------------------------------------------------------------------

  // Content-field definitions extracted to ./dashboard/contentFields.ts (Dashboard decomposition, stage 1)

  const filteredContent = Object.entries(content).filter(([key, value]) => `${key} ${value}`.toLowerCase().includes(searchText.toLowerCase()));

  const {
    isSalesOnly,
    isCollectionRole,
    isReceptionDaqqi,
    isSupport,
    isDaqqiManager,
    isOnlineManager,
    isSalesCollectionManager,
  } = useCurrentStaff({ currentStaff });
  useStaffRoleRedirects({ isAdmin, currentStaff, urlTab, setActiveTabState });

  // -- URL: when staff_settings tab is active, reflect username in URL ------
  useEffect(() => {
    if (activeTab === 'staff_settings' && currentStaff) {
      const username = (currentStaff.email || '').split('@')[0] || String(currentStaff.id);
      if (urlParam !== username) navigate(`/dashboard/staff_settings/${username}`, { replace: true });
    }
    // urlParam is read but not listed on purpose: this effect writes the URL, so
    // depending on it would re-enter on the navigation it just performed.
    // currentStaff is keyed by id for the usual reason — the object is replaced
    // on every context refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentStaff?.id]);

  // Any non-admin staff member needs their own scoped data (not in SiteDataContext)
  // Server handles scoping via DATA_SCOPE — no need to enumerate roles here
  const isNonAdminStaff = !isAdmin && !!staffSelf;
  const usesStaffScopedData = isNonAdminStaff || isOnlineManager;
  // A write on a screen that pages from the server reloads no list (lib/crmChanged.ts).
  useEffect(() => {
    setStaffListsWanted(!isNonAdminStaff || !staffScreenPagesFromServer(activeTab));
    return () => setStaffListsWanted(true);
  }, [isNonAdminStaff, activeTab]);

  // -- Own-data for non-admin staff: the Dokki rounds, the team and the content (no lists of clients or leads) ----
  const {
    salesOwnDaqqiRounds, setSalesOwnDaqqiRounds,
    onlineTeamMembers, 
    salesDataLoading, 
    fetchSalesData, fetchSalesDataIfStale,
  } = useStaffOwnData({
    isAdmin,
    isOnlineManager,
    staffSelf,
    currentStaff,
    setStaffScopedRounds: bulkSetDaqqiRounds,
    mergeContent,
  });
  // The bell's count, for every employee: one COUNT from the server, in the session's own scope, where it used
  // to be the leads loaded on every screen (the 500 newest for an admin, all of them for an employee) to count
  // their follow-ups. Refreshed every two minutes and after a write anywhere (crmChanged).
  // Only for a role that may see leads: the count is refused (403) to the others.
  const countsOwnFollowups = !!currentStaff && access.can('view_leads');
  const [dueFollowups, setDueFollowups] = useState<number | null>(null);
  const refreshDueFollowups = useCallback(() => {
    mysqlAdmin.getDueFollowups().then(res => setDueFollowups(Number(res?.due) || 0)).catch(() => { /* keep the last count */ });
  }, []);
  useVisibleInterval(refreshDueFollowups, 2 * 60 * 1000, countsOwnFollowups);
  useEffect(() => {
    if (!countsOwnFollowups) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = () => { clearTimeout(timer); timer = setTimeout(refreshDueFollowups, 300); };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => { clearTimeout(timer); window.removeEventListener(CRM_CHANGED_EVENT, onChanged); };
  }, [countsOwnFollowups, refreshDueFollowups]);
  // The online manager's badges and panels: the server counts and lists them (useOnlineManagerSummary).
  const onlineManagerSummary = useOnlineManagerSummary(isOnlineManager);
  const {
    staffNotifBadge,
    onlineMgrFollowupBadge,
    onlineMgrNewEventsBadge,
  } = useDashboardBadges({
    currentStaff,
    isOnlineManager,
    dueFollowups,
    onlineManagerSummary,
  });

  // -- ClientDbTab booking callback — opens subPayRow or leadPayRow modal. The row it books was drawn from the
  // loaded clients and leads (the first page, as for the administration), so it is found there. ----
  const handleClientDbBook = useCallback((clientId: string, type: 'subscriber' | 'lead') => {
    if (type === 'subscriber') {
      const sub = subscribers.find(s => s.id === clientId);
      if (sub) {
        setSubPayRow(sub);
        const currency = currencyForBranch(sub.branch);
        const defaultBookingType = (sub.enrolledCourseIds || []).length > 0 ? 'installment' : 'new_booking';
        setSubPayDraft(createClientPaymentDraft({ currency, courseId: '' }));
        setSubPayDraft(prev => ({ ...prev, bookingType: defaultBookingType as 'new_booking'|'installment' }));
      }
    } else {
      const lead = leads.find(l => l.id === clientId);
      if (lead) {
        // realCourseIds() drops imported free-text course names (`raw:` entries),
        // which are display-only and would otherwise be pre-filled as a courseId.
        const defaultCourseId = realCourseIds(lead.interestedCourseIds)[0] || lead.enrolledCourseId || '';
        setLeadPayRow(lead);
        setLeadPayDraft(createClientPaymentDraft({
          courseId: defaultCourseId,
          currency: currencyForBranch(lead.branch),
          branch: lead.branch || '',
          email: lead.email || '',
        }));
      }
    }
    // The four omitted values are the payment-modal setters this callback
    // exists to call. They come from a custom state hook rather than a useState
    // the rule can see, so it cannot tell they are stable; listing them would
    // rebuild this callback on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribers, leads]);

  useEffect(() => {
    void fetchSalesData();
  }, [fetchSalesData]);

  // Background refresh of what an employee's panel holds (the Dokki rounds, the team, the content) every two minutes
  // and on return to the tab; fetchSalesData no-ops for real admins.
  useEffect(() => {
    let cancelled = false;
    // Both are passive: they ask only when the last refresh is older than the timer.
    const pollId = setInterval(() => { if (document.visibilityState !== 'visible') return; if (!cancelled) void fetchSalesDataIfStale(110 * 1000); }, 2 * 60 * 1000);
    const onVisible = () => {
      if (!cancelled && document.visibilityState === 'visible') void fetchSalesDataIfStale(2 * 60 * 1000);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchSalesData, fetchSalesDataIfStale]);

  // Effective arrays: for non-admin roles use own-data; for admin use context
  const effectiveSubs = subscribers;
  // An employee who keeps the accounts (customer service) reads the 500 newest payments of their clients from the server;
  // the online manager has his own desk (usePaymentsDesk).
  const staffOrders = useStaffOrders(usesStaffScopedData && activeTab === 'orders' && !isOnlineManager, courses, bundles);
  const effectiveOrders = usesStaffScopedData ? staffOrders : orders;
  const branchFilteredEffectiveOrders = useMemo(() => branchQueryFilter
    ? effectiveOrders.filter((row) => {
      const orderPhone = String((row as { customerPhone?: string }).customerPhone || '');
      const matchedSub = effectiveSubs.find((sub) =>
        (row.customerEmail && sub.email && row.customerEmail.toLowerCase() === sub.email.toLowerCase())
        || (orderPhone && sub.phone && orderPhone.replace(/\D/g, '').slice(-9) === sub.phone.replace(/\D/g, '').slice(-9))
      );
      return matchedSub ? branchMatchesFilter(matchedSub.branch, branchQueryFilter) : branchQueryFilter === 'ONLINE_EGYPT';
    })
    : effectiveOrders,
    [branchQueryFilter, effectiveOrders, effectiveSubs]
  );

  const { filteredOrders, ordersStats } = useOrdersDerived(
    branchFilteredEffectiveOrders, orderSearch, orderStatusFilter, orderTypeFilter, orderMethodFilter, orderStaffFilter, orderDateFrom, orderDateTo,
  );

  // -- Permission helpers -------------------------------------------------
  // One rule for the gate, the menu and the role bars (lib/access.ts), over the permissions the server resolved for
  // this account (/api/auth/me): the menu used to ask the browser's copy of the role defaults by itself.
  const { can: accessCan } = access;
  const hasPermission = React.useCallback((perm: StaffPermission): boolean => accessCan(perm), [accessCan]);
  const canOpenTab = access.canOpenTab;

  // Map each tab key to the minimum required permission (defined at module level)

  // The Tagamoa section shows once the branch is on (الإعدادات ← الفروع), and a
  // branch's own staff see their branch's section only.
  // A Tagamoa employee's bar lists the Dokki screens' names; they open at Tagamoa.
  const staffNavTab = useCallback(
    (tab: TabKey) => setRouteTab((ownBranchRole === 'TAGAMOA' ? tabForScreen(tab, 'TAGAMOA') : tab) as TabKey),
    [setRouteTab, ownBranchRole],
  );
  const tagamoaOn = branchesFromTable.some(branch => String(branch.id).toUpperCase() === 'TAGAMOA');
  const ownBranch = branchOfRole(currentStaff?.role);
  const visibleMenuGroups = React.useMemo(() => {
    const groups = menuGroups.filter(group => {
      if (group.key === 'tagamoa') return tagamoaOn && ownBranch !== 'DAQQI';
      if (group.key === 'daqqi') return ownBranch !== 'TAGAMOA';
      return true;
    });
    // Only what the viewer may open, by the gate's own rule (lib/access.ts visibleMenu).
    return visibleMenu(groups, access.viewer);
  }, [menuGroups, access.viewer, tagamoaOn, ownBranch]);

  // ----------------------------------------------------------------------

  // normalizeAr defined at module level


  // -- Client DB base data: raw mapping + dedup (expensive, only changes when data changes) -

  // -- Client DB filtered+sorted list (only recomputes when filter state changes) -
  const clientsArePaged = staffClientsArePaged(activeTab);
  useEffect(() => {
    if (fullCrmDataTabs.has(activeTab)) void loadFullCrmData();
    else if (fullLeadTabs.has(activeTab)) void loadFullLeads();
    // «عملائي» for an employee reads a page at a time from the server: no full list, in the context or out of it.
    else if (fullSubscriberTabs.has(activeTab) && !clientsArePaged) void loadFullSubscribers();
    // Then the lists the screen reads that no longer come with the panel —
    // every one of them for a screen nobody has listed yet (tabSiteLists.ts).
    // After the full loads above, so a list a full load is bringing waits for it.
    // An employee's version of a screen that pages from the server does not read the lists the administration's does.
    const skipped = usesStaffScopedData ? staffSkipsSiteLists(activeTab) : [];
    void ensureSiteLists(skipped.length ? listsForTab(activeTab).filter(list => !skipped.includes(list)) : listsForTab(activeTab));
  }, [activeTab, clientsArePaged, usesStaffScopedData, loadFullCrmData, loadFullLeads, loadFullSubscribers, ensureSiteLists]);

  // Drawn over every screen, so they ask for their own lists: the follow-up
  // drawer lists the loaded leads' follow-ups (its bell counts on the server —
  // dueFollowups above), «حجز / دفعة» matches the loaded people before the
  // database search, the online manager's panels read the clients.
  const overlayLists = useMemo<SiteList[]>(() => [
    ...(salesNotifOpen ? ['leads' as const] : []),
    ...(quickBookOpen ? ['leads' as const, 'subscribers' as const] : []),
  ], [salesNotifOpen, quickBookOpen]);
  useEffect(() => {
    if (overlayLists.length) void ensureSiteLists(overlayLists);
  }, [overlayLists, ensureSiteLists]);

  // The books' own revenue (the browser's sum only sees the newest 500 orders and
  // payments). Refreshed on a slow timer while the tab is in view; a failure
  // leaves the browser's figure on screen, as before.
  const [booksRevenue, setBooksRevenue] = useState<{ totalEgp: number; monthEgp: number; todayEgp: number; payments?: number } | null>(null);
  const refreshBooksRevenue = useCallback(() => {
    if (!authUser) return;
    mysqlAdmin.getOverviewRevenue().then(setBooksRevenue).catch(() => { /* keep the local figure */ });
  }, [authUser]);
  useVisibleInterval(refreshBooksRevenue, 5 * 60 * 1000);

  const { overviewStats } = useOverviewDerived(orders, subscribers, leads, courses, staffMembers, consultations, content, leadStats, booksRevenue);

  const exportFilteredOrdersCsv = (rows: OrderItem[]) => exportOrdersCsv(rows);




  // -- Content Hub sub-tab ---------------------------------------------------
  // 'content_hub' itself means no page is open: the hub shows its grid of pages.
  const [contentHubSubTab, setContentHubSubTabState] = useState<TabKey>('content_hub');
  // Same shape as navigateToTab: the content-hub panels choose their sub-tab
  // from data, so the name arrives as a string and is checked before it lands.
  // Checked against the hub's own pages, not the sidebar: isTabKey knows only
  // menu keys, and none of these is one — so every page but the default was
  // refused, and «الشروط والسياسات», «عن المعهد», the footer and the ten page
  // editors did nothing when clicked.
  const setContentHubSubTab = useCallback((tab: string) => {
    const page = CONTENT_HUB_TABS.find(t => t.key === tab);
    if (page) { setContentHubSubTabState(page.key); return; }
    if (isTabKey(tab)) { setContentHubSubTabState(tab); return; }
    console.warn(`[dashboard] refused content-hub sub-tab: ${tab}`);
  }, []);
  // /dashboard/content_hub/<page> opens that page's editor — the settings hub
  // links each part of the site straight to its editor — and /dashboard/content_hub
  // alone is the grid of pages, so the sidebar entry and «كل الصفحات» land there.
  useEffect(() => {
    if (urlTab === 'content_hub' && urlParam && CONTENT_HUB_TABS.some(t => t.key === urlParam)) setContentHubSubTab(urlParam);
    else if (urlTab === 'content_hub' && !urlParam) setContentHubSubTab('content_hub');
  }, [urlTab, urlParam, setContentHubSubTab]);

  // -- Staff Profile Modal ----------------------------------------------------

  // -- Cert Requests filter state --------------------------------------------



  const handleSubPayment = async (draft: PaymentDraft) => {
    const { handleSubPaymentFn } = await import('../dashboardPaymentHandlers');
    await handleSubPaymentFn(draft, {
      subPayRow,
      subscribers,
      bundles,
      courses,
      content,
      recordSubscriberPayment,
      reloadSubscribers,
      notify,
      currentStaff,
    });
  };

  const handleLeadPayment = async (draft: PaymentDraft) => {
    const { handleLeadPaymentFn } = await import('../dashboardPaymentHandlers');
    await handleLeadPaymentFn(draft, {
      leadPayRow,
      bundles,
      courses,
      branchLabelMap,
      recordSubscriberPayment,
      reloadLeads,
      reloadSubscribers,
      notify,
      currentStaff,
      isAdmin,
      isSalesOnly,
      isDaqqiManager,
      isReceptionDaqqi,
      fetchSalesData,
      setActiveTab,
    });
  };

  return {
    courses, bundles, therapists, subscribers, leads, siteDaqqiRounds, staffMembers, consultations, communityPosts,
    communityLibraryItems, communityVideos, communityEvents, content, isAdmin, addSubscriber, updateSubscriber,
    deleteSubscriber, addCommunityPost, updateCommunityPost, deleteCommunityPost, addCommunityLibraryItem,
    updateCommunityLibraryItem, deleteCommunityLibraryItem, addCommunityVideo, updateCommunityVideo,
    deleteCommunityVideo, addCommunityEvent, updateCommunityEvent, deleteCommunityEvent, updateOrderStatus,
    reloadOrders, reloadLeads, reloadSubscribers, deleteOrder, setContentValue, setContentValues, addContentKey,
    removeContentKey, authUser, remoteReady, currentStaff, staffSelf, staffSelfLoading, searchText, setSearchText,
    newContentKey, setNewContentKey, newContentValue, setNewContentValue, contentEdits, setContentEdits,
    policyDrafts, setPolicyDrafts, instituteGalleryUrlInput, setInstituteGalleryUrlInput, instituteGalleryUploadRef,
    subscriberCourseFilter, setSubscriberCourseFilter, refundActionSaving, setRefundActionSaving, subPayRow,
    setSubPayRow, subPayDraft, setSubPayDraft, salesNotifOpen, setSalesNotifOpen, onlineMgrFollowupOpen,
    setOnlineMgrFollowupOpen, onlineMgrNewEventsOpen, setOnlineMgrNewEventsOpen, quickBookOpen, setQuickBookOpen,
    quickBookSearch, setQuickBookSearch, leadPayRow, setLeadPayRow, leadPayDraft, setLeadPayDraft, leadsSalesTargets,
    setLeadsFollowupFilter, notifRows, setNotifRows, notifUnread, setNotifUnread, notifOpen, setNotifOpen, notifRef,
    notifError, refreshNotifs, orderSearch, setOrderSearch, orderStatusFilter, setOrderStatusFilter, orderTypeFilter,
    setOrderTypeFilter, orderMethodFilter, setOrderMethodFilter, orderDateFrom, setOrderDateFrom, orderDateTo,
    setOrderDateTo, orderReviewTab, setOrderReviewTab, orderStaffFilter, setOrderStaffFilter, omOrdReviewTab,
    setOmOrdReviewTab, showAddTransfer, setShowAddTransfer, linkTransferModal, setLinkTransferModal, linkOrderModal,
    setLinkOrderModal, isSalesOnly, isCollectionRole, isReceptionDaqqi, isSupport, isDaqqiManager, isOnlineManager,
    isSalesCollectionManager, salesOwnDaqqiRounds, setSalesOwnDaqqiRounds, onlineTeamMembers, salesDataLoading,
    fetchSalesData, staffNotifBadge, onlineMgrFollowupBadge, onlineMgrNewEventsBadge, branchQueryFilter,
    inboxUnreadCount, instituteBranches, notify, lectureCourseId, setLectureCourseId, daqqiSubSearch,
    setDaqqiSubSearch, daqqiAccDateFrom, setDaqqiAccDateFrom, daqqiAccDateTo, setDaqqiAccDateTo, subCsDistributing,
    setSubCsDistributing, daqqiOldDistribPlan, setDaqqiOldDistribPlan, daqqiOldDistributing, setDaqqiOldDistributing,
    navigate, activeTabState, setActiveTabState, pendingProofsCount, onlineMgrAcademyOpen, setOnlineMgrAcademyOpen,
    activeDropdownGroup, setActiveDropdownGroup, dropdownRect, setDropdownRect, onlineUsers, kpiModal, setKpiModal,
    physicalBranch, setActiveTab, navigateToTab, activeTab, communityAdminTab, setCommunityAdminTab, filteredContent,
    isNonAdminStaff, onlineManagerSummary, handleClientDbBook, effectiveOrders, filteredOrders, ordersStats,
    hasPermission, canOpenTab, staffNavTab, ownBranch, visibleMenuGroups, overviewStats,
    exportFilteredOrdersCsv, contentHubSubTab, setContentHubSubTab, handleSubPayment, handleLeadPayment,
  };
}
