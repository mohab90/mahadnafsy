import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { adminAuthHeaders } from '../lib/adminAuthHeaders';

import {
  CoursesTab,
} from './dashboard/lazyTabs';
import { AdminBootstrapLoading, StaffPermissionsLoading } from './dashboard/DashboardGuards';
import { DashboardTabContainer } from './dashboard/DashboardTabContainer';
import { DashboardNavigation } from './dashboard/DashboardNavigation';
import { DashboardPaymentOverlays } from './dashboard/DashboardPaymentOverlays';
import { DashboardStandaloneTabs } from './dashboard/DashboardStandaloneTabs';
import { DASHBOARD_MENU_GROUPS, type TabKey } from './dashboard/navigation';
import { branchMatchesFilter, branchSlugToFilter } from './dashboard/branchWorkspaceFilters';
import { aboutPageFields, homeOfferFields, policySections } from './dashboard/contentFields';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { StaffPermission, ExtraCertificateType, OrderItem } from '../types';
import { mysqlAdmin } from '../lib/mysqlapi';
import { useSiteData } from '../context/SiteDataContext';
import {
  hasPermission as masterHasPermission,
  resolvePermissions as masterResolvePermissions,
  type RoleKey,
  type PermissionKey,
} from '../constants/permissions';
import { useToast } from '../../shared/ui/Toast';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import type { PaymentDraft } from '../components/PaymentModal';
import { createClientPaymentDraft } from '../lib/clientActionDrafts';
import { currencyForBranch } from '../lib/branchCurrency';
import { contentHubRouteTabs, directContentTabs, growthOpsTabs, saasOpsTabs } from './dashboard/dashboardTabGroups';
import { defaultFacebookLeadAdsConfig } from './dashboard/facebookLeadAdsDefaults';
import { useStaffRoleRedirects } from './dashboard/hooks/useStaffRoleRedirects';
import { useCurrentStaff } from './dashboard/hooks/useCurrentStaff';
import { useOrdersDerived } from './dashboard/hooks/useOrdersDerived';
import { useLeadsDerived } from './dashboard/hooks/useLeadsDerived';
import { useSubscribersDerived } from './dashboard/hooks/useSubscribersDerived';
import { useOverviewDerived } from './dashboard/hooks/useOverviewDerived';
import { useCommunityDrafts } from './dashboard/hooks/useCommunityDrafts';
import { useContentEditorDrafts } from './dashboard/hooks/useContentEditorDrafts';
import { useCsvFbImportState } from './dashboard/hooks/useCsvFbImportState';
import { useLeadFilters } from './dashboard/useLeadFilters';
import { useSubscriberFilters } from './dashboard/useSubscriberFilters';
import { useSubscriberModals } from './dashboard/hooks/useSubscriberModals';
import { useStaffHrState } from './dashboard/hooks/useStaffHrState';
import { useOrdersFinanceState } from './dashboard/hooks/useOrdersFinanceState';
import { useLeadCrmTabState } from './dashboard/hooks/useLeadCrmTabState';
import { exportOrdersCsv } from './dashboard/dashboardExports';
import {
  DashboardClientTabs,
  DashboardCommunityAdminPanel,
  DashboardContentHubRoutes,
  DashboardCustomerServiceTabs,
  DashboardDirectContentRoutes,
  DashboardFinanceTabs,
  DashboardGrowthOpsTabs,
  DashboardMonitorPanel,
  DashboardOnlineManagerPanels,
  DashboardQuickBooking,
  DashboardSaasOpsTabs,
  DashboardSalesFollowupPanel,
  DashboardStaffSettingsPanel,
  DashboardStaffTabs,
  OverviewTab,
} from './dashboard/lazyDashboardComponents';
import { useDashboardBadges } from './dashboard/useDashboardBadges';
import { useNotificationsBell } from './dashboard/useNotificationsBell';
import { useStaffOwnData } from './dashboard/useStaffOwnData';
import { useDashboardDerived } from './dashboard/useDashboardDerived';
import { compressInstituteGalleryFiles } from './dashboard/dashboardGallery';

// --- Video URL obfuscation (protects YouTube IDs from plain-text storage) ---

import {
  TAB_PERMISSION_MAP,
  _normClientEmail,
  _normClientPhone,
  _normalizeAr,
  _normalizeClientDate,
  type CertPricingMap,
} from './dashboard/dashboardShared';
import { realCourseIds } from './dashboard/tabs/leads/leadCourseLabel';

const _BUILD = '20260502';


const Dashboard: React.FC = () => {
  void _BUILD;
  const {
    courses,
    bundles,
    therapists,
    subscribers,
    leads,
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
    addOrder,
    setContentValue,
    mergeContent,
    addContentKey,
    removeContentKey,
    fbLeadAdsConfig,
    authUser,
    remoteReady,
    setStaffScopedSubscribers,
    setStaffScopedLeads,
  } = useSiteData();
  const [searchParams] = useSearchParams();
  const branchQueryFilter = branchSlugToFilter(searchParams.get('branch'));

  const { inboxUnreadCount, instituteBranches, branchLabelMap } = useDashboardDerived(content, notifications);

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
  const notify = useCallback((type: 'success' | 'error' | 'info', text: string) => toastShow(text, type), [toastShow]);
  useRealtimeEvents<{ action?: string; entity?: string; actor?: string }>(
    'admin:mutation',
    (event) => {
      const actionLabel = event.action === 'create' ? 'إضافة'
        : event.action === 'update' ? 'تحديث'
          : event.action === 'delete' ? 'حذف'
            : event.action || 'تغيير';
      notify('info', `${actionLabel} ${event.entity || 'بيانات'}${event.actor ? ` بواسطة ${event.actor}` : ''}`);
    },
    Boolean(import.meta.env.VITE_WS_URL),
  );
  useRealtimeEvents<{ section?: string; actor?: string }>(
    'system-config:updated',
    (event) => {
      notify('info', `تم تحديث إعدادات ${event.section || 'النظام'}${event.actor ? ` بواسطة ${event.actor}` : ''}`);
    },
    Boolean(import.meta.env.VITE_WS_URL),
  );

  // Show a persistent error toast whenever a MySQL save fails in SiteDataContext
  useEffect(() => {
    const handler = () => {
      notify('error', 'فشل حفظ البيانات. تحقق من الاتصال بالإنترنت وأعد المحاولة.');
    };
    window.addEventListener('site-persist-error', handler);
    return () => window.removeEventListener('site-persist-error', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  const {
    searchText, setSearchText,
    newContentKey, setNewContentKey,
    newContentValue, setNewContentValue,
    contentEdits, setContentEdits,
    policyDrafts, setPolicyDrafts,
    offerSelectedCourseId, setOfferSelectedCourseId,
    instituteGalleryUrlInput, setInstituteGalleryUrlInput,
    instituteGalleryUploadRef,
  } = useContentEditorDrafts(content);

  const [lectureCourseId, setLectureCourseId] = useState('');

  const {
    subscriberSubTab, 
    subscriberCourseFilter, setSubscriberCourseFilter,
    subscriberSearch, 
    subscriberSalesFilter, 
    subscriberCsFilter, 
    subscriberInstFilter, 
    subscriberRemainingFilter, 
    subscriberCertFilter, 
    subscriberPayFilter, 
    setSubscriberPage,
  } = useSubscriberFilters();
  // Reception Daqqi role — daqqi clients tab state
  const [daqqiSubSearch, setDaqqiSubSearch] = useState('');
  const [daqqiAccDateFrom, setDaqqiAccDateFrom] = useState('');
  const [daqqiAccDateTo, setDaqqiAccDateTo] = useState('');
  const {
    staffWaTemplates, setStaffWaTemplates,
    staffWaTemplateEdit, setStaffWaTemplateEdit,
    staffContactTags, setStaffContactTags,
    staffNewTagInput, setStaffNewTagInput,
    staffSettingsDraft, setStaffSettingsDraft,
    staffSettingsSaving, setStaffSettingsSaving,
    myHrData, setMyHrData,
    loadingMyHr, setLoadingMyHr,
    myAdvances, setMyAdvances,
    myDisciplinary, setMyDisciplinary,
    showAdvanceForm, setShowAdvanceForm,
    advanceDraft, setAdvanceDraft,
    submittingAdvance, setSubmittingAdvance,
    showMyLeaveFormProfile, setShowMyLeaveFormProfile,
    myLeaveFormProfile, setMyLeaveFormProfile,
    submittingMyLeaveProfile, setSubmittingMyLeaveProfile,
    staffSearch, 
    staffRoleFilter, 
    
    
    
    
    setStaffProfileModalId,
  } = useStaffHrState();
  const [subCsDistributing, setSubCsDistributing] = useState(false);
  // Daqqi old-data distribution
  const [daqqiOldDistribPlan, setDaqqiOldDistribPlan] = useState<{staffId:string;count:string}[]>([{staffId:'',count:''}]);
  const [daqqiOldDistributing, setDaqqiOldDistributing] = useState(false);
  // Refund requests section state (shared with refund_requests tab)
  const {
    
    refundActionSaving, setRefundActionSaving,
    subPayRow, setSubPayRow,
    subPayDraft, setSubPayDraft,
    
    
    setSubContactRow,
    setSubContactDraft,
    
    
    setSubWaRow,
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
  } = useLeadCrmTabState();

  const {
    fbDraft, setFbDraft,
    bulkUploadNotice, setBulkUploadNotice,
    csvImportOpen, setCsvImportOpen,
    csvHeaders, setCsvHeaders,
    csvImporting, setCsvImporting,
    fbSyncLoading, setFbSyncLoading,
    fbSyncNotice, setFbSyncNotice,
    fbFormsLoading, setFbFormsLoading,
    fbAvailableForms, setFbAvailableForms,
    csvRows, setCsvRows,
    csvMapping, setCsvMapping,
  } = useCsvFbImportState(fbLeadAdsConfig, defaultFacebookLeadAdsConfig);

  const {
    leadsSearch, 
    leadsStatusFilter, 
    leadsFollowupFilter, setLeadsFollowupFilter,
    leadsBranchFilter, 
    leadsSalesFilter, 
    leadsCourseFilter,
  } = useLeadFilters();
  const navigate = useNavigate();
  const { tab: urlTab, param: urlParam } = useParams<{ tab: string; param?: string }>();
  const [activeTabState, setActiveTabState] = useState<TabKey>((urlTab as TabKey) || 'overview');
  const [pendingProofsCount, setPendingProofsCount] = useState(0);
  const [onlineMgrAcademyOpen, setOnlineMgrAcademyOpen] = useState(false);
  const [monitorPanel, setMonitorPanel] = useState<boolean>(false);
  // -- Horizontal dropdown nav state --
  const [activeDropdownGroup, setActiveDropdownGroup] = useState<string|null>(null);
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null);

  // -- In-app Notifications Bell --------------------------------------------
  const {
    notifRows, setNotifRows,
    notifUnread, setNotifUnread,
    notifOpen, setNotifOpen,
    notifRef,
  } = useNotificationsBell(Boolean(authUser));

  const [onlineUsers] = useState<{ uid: string; email?: string; displayName?: string; lastActiveAt: string }[]>([]);
  const [kpiModal, setKpiModal] = useState<{ title: string; rows: { label: string; sub?: string }[] } | null>(null);
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!urlTab) return;
    // Redirect legacy "subscribers" URL ? "online_clients"
    const resolved = urlTab === 'subscribers' ? 'online_clients' : urlTab;
    if (resolved !== urlTab) { navigate(`/dashboard/online_clients`, { replace: true }); return; }
    if (resolved !== activeTabState) setActiveTabState(resolved as TabKey);
  }, [urlTab]);

  // Fetch pending payment proofs count once on mount (for sidebar badge)
  useEffect(() => {
    if (!isAdmin) return;
    mysqlAdmin.listPaymentProofs('PENDING').then(rows => {
      setPendingProofsCount(Array.isArray(rows) ? rows.length : 0);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);
  const setActiveTab = useCallback((tab: TabKey) => {
    setActiveTabState(tab);
    navigate(`/dashboard/${tab}`);
  }, [navigate]);
  const activeTab = activeTabState;

  const {
    communityPostDraft, setCommunityPostDraft,
    isCommunityPostFormOpen, setIsCommunityPostFormOpen,
    communityLibraryDraft, setCommunityLibraryDraft,
    isCommunityLibraryFormOpen, setIsCommunityLibraryFormOpen,
    communityVideoDraft, setCommunityVideoDraft,
    isCommunityVideoFormOpen, setIsCommunityVideoFormOpen,
    communityEventDraft, setCommunityEventDraft,
    isCommunityEventFormOpen, setIsCommunityEventFormOpen,
    editingCommunityPostId, setEditingCommunityPostId,
    editingCommunityLibraryId, setEditingCommunityLibraryId,
    editingCommunityVideoId, setEditingCommunityVideoId,
    editingCommunityEventId, setEditingCommunityEventId,
  } = useCommunityDrafts();

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
    transferForm, setTransferForm,
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
  const instituteGalleryImages = useMemo(() => {
    const raw = content['institute.gallery.images'] || '[]';
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
    } catch {
      return [];
    }
  }, [content]);

  const {
    staffSelf,
    staffSelfLoading,
    currentStaff,
    isSalesOnly,
    isCollectionRole,
    isReceptionDaqqi,
    isDaqqiManager,
    isOnlineManager,
    isSalesCollectionManager,
  } = useCurrentStaff({ isAdmin, authUser, staffMembers });
  useStaffRoleRedirects({ isAdmin, currentStaff, urlTab, setActiveTabState });

  // -- URL: when staff_settings tab is active, reflect username in URL ------
  useEffect(() => {
    if (activeTab === 'staff_settings' && currentStaff) {
      const username = (currentStaff.email || '').split('@')[0] || String(currentStaff.id);
      if (urlParam !== username) navigate(`/dashboard/staff_settings/${username}`, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentStaff?.id]);

  // -- Fetch HR self-service data when profile tab is active -----------------
  useEffect(() => {
    if (activeTab !== 'staff_settings' || !currentStaff) return;
    setLoadingMyHr(true);
    Promise.all([
      fetch('/api/staff/me/hr', { credentials: 'include', headers: adminAuthHeaders() }).then(r => r.json()).catch(() => null),
      fetch('/api/staff/me/advances', { credentials: 'include', headers: adminAuthHeaders() }).then(r => r.json()).catch(() => []),
      fetch('/api/staff/me/disciplinary', { credentials: 'include', headers: adminAuthHeaders() }).then(r => r.json()).catch(() => []),
    ]).then(([hrData, advances, disciplinary]) => {
      if (hrData && !hrData.error) setMyHrData(hrData);
      if (Array.isArray(advances)) setMyAdvances(advances);
      if (Array.isArray(disciplinary)) setMyDisciplinary(disciplinary);
    }).finally(() => setLoadingMyHr(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentStaff?.id]);

  // Any non-admin staff member needs their own scoped data (not in SiteDataContext)
  // Server handles scoping via DATA_SCOPE — no need to enumerate roles here
  const isNonAdminStaff = !isAdmin && !!staffSelf;
  const usesStaffScopedData = isNonAdminStaff || isOnlineManager;

  // -- Own-data subscriptions for non-admin staff -----------------------------
  // SiteDataContext only loads CRM data for admins. Non-admin staff (sales, collection)
  // query MySQL directly.
  const {
    salesOwnLeads, 
    salesOwnSubscribers, setSalesOwnSubscribers,
    salesOwnOrders, 
    salesOwnDaqqiRounds, setSalesOwnDaqqiRounds,
    onlineTeamMembers, 
    salesDataLoading, 
    fetchSalesData,
  } = useStaffOwnData({
    isAdmin,
    isOnlineManager,
    staffSelf,
    currentStaff,
    bundles,
    courses,
    setStaffScopedSubscribers,
    setStaffScopedLeads,
    mergeContent,
  });
  const {
    staffNotifBadge,
    onlineMgrFollowupBadge,
    onlineMgrNewEventsBadge,
  } = useDashboardBadges({
    currentStaff,
    isNonAdminStaff: usesStaffScopedData,
    isOnlineManager,
    leads,
    salesOwnLeads,
    subscribers,
    salesOwnSubscribers,
  });

  // -- ClientDbTab booking callback — opens subPayRow or leadPayRow modal ----
  const handleClientDbBook = useCallback((clientId: string, type: 'subscriber' | 'lead') => {
    if (type === 'subscriber') {
      const sub = (usesStaffScopedData ? salesOwnSubscribers : subscribers).find(s => s.id === clientId);
      if (sub) {
        setSubPayRow(sub);
        const currency = currencyForBranch(sub.branch);
        const defaultBookingType = (sub.enrolledCourseIds || []).length > 0 ? 'installment' : 'new_booking';
        setSubPayDraft(createClientPaymentDraft({ currency, courseId: '' }));
        setSubPayDraft(prev => ({ ...prev, bookingType: defaultBookingType as 'new_booking'|'installment' }));
      }
    } else {
      const lead = (usesStaffScopedData ? salesOwnLeads : leads).find(l => l.id === clientId);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usesStaffScopedData, salesOwnSubscribers, subscribers, salesOwnLeads, leads]);

  useEffect(() => {
    void fetchSalesData();
  }, [fetchSalesData]);

  // Background polling for non-admin staff (sales/collection/daqqi/online-manager) —
  // fetchSalesData no-ops for real admins internally, so this mirrors the admin-only
  // polling in SiteDataContext.tsx (leads/subscribers every 2 min + on tab-focus) for
  // the roles that context effect explicitly skips (CRM-04). Without this, a sales
  // rep's dashboard only ever reflects data as of page load / their last manual action.
  useEffect(() => {
    let cancelled = false;
    const pollId = setInterval(() => { if (!cancelled) void fetchSalesData(); }, 2 * 60 * 1000);
    const onVisible = () => {
      if (!cancelled && document.visibilityState === 'visible') void fetchSalesData();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchSalesData]);

  // Effective arrays: for non-admin roles use own-data; for admin use context
  const effectiveLeads = usesStaffScopedData ? salesOwnLeads : leads;
  const effectiveSubs = usesStaffScopedData ? salesOwnSubscribers : subscribers;
  const effectiveOrders = usesStaffScopedData ? salesOwnOrders : orders;
  const branchFilteredEffectiveSubs = useMemo(() => branchQueryFilter
    ? effectiveSubs.filter((row) => branchMatchesFilter(row.branch, branchQueryFilter))
    : effectiveSubs,
    [branchQueryFilter, effectiveSubs]
  );
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

  const { filteredSubscribers, enabledConsultationTherapists, subscriberPaidTotalsMap, getSubscriberPaidTotals } = useSubscribersDerived(
    branchFilteredEffectiveSubs, effectiveSubs, effectiveLeads, effectiveOrders, therapists, bundles,
    isSalesOnly, isAdmin, isDaqqiManager, isReceptionDaqqi, currentStaff,
    subscriberSubTab, subscriberSearch, subscriberCourseFilter, subscriberSalesFilter, subscriberCsFilter,
    subscriberInstFilter, subscriberRemainingFilter, subscriberCertFilter, subscriberPayFilter, setSubscriberPage,
  );
  const { filteredOrders, ordersStats } = useOrdersDerived(
    branchFilteredEffectiveOrders, orderSearch, orderStatusFilter, orderTypeFilter, orderMethodFilter, orderStaffFilter, orderDateFrom, orderDateTo,
  );

  // -- Permission helpers -------------------------------------------------
  // Uses master resolvePermissions — single source of truth from admin/constants/permissions.ts
  const hasPermission = React.useCallback((perm: StaffPermission): boolean => {
    if (isAdmin) return true;
    if (!currentStaff) return false;
    return masterHasPermission(
      { role: currentStaff.role as RoleKey, permissions: currentStaff.permissions as PermissionKey[] | undefined },
      perm as PermissionKey,
    );
  }, [isAdmin, currentStaff]);

  // Map each tab key to the minimum required permission (defined at module level)

  const visibleMenuGroups = React.useMemo(() => {
    if (isAdmin) return menuGroups;
    // Build effective permissions via master resolvePermissions (admin/constants/permissions.ts)
    const resolvedPerms = currentStaff
      ? masterResolvePermissions({ role: currentStaff.role as RoleKey, permissions: currentStaff.permissions as PermissionKey[] | undefined })
      : ['view_dashboard'];
    const hasPerm = (p: StaffPermission) => {
      if (resolvedPerms === '*') return true;
      return (resolvedPerms as string[]).includes(p);
    };
    return menuGroups.map(group => ({
      ...group,
      items: group.items.filter(item => {
        const required = TAB_PERMISSION_MAP[item.key];
        // Unmapped tabs are hidden for non-admin staff (fail-secure default).
        return !!required && hasPerm(required);
      }),
    })).filter(group => group.items.length > 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuGroups, isAdmin, currentStaff]);

  // ----------------------------------------------------------------------

  // normalizeAr defined at module level

  const { filteredCourseLeads, filteredConsultLeads, leadsStats, filteredStaffList, salesStaff, csStaff } = useLeadsDerived(
    effectiveLeads, isSalesOnly, leadsSearch, leadsStatusFilter, leadsFollowupFilter, leadsBranchFilter, leadsSalesFilter, leadsCourseFilter, bundles,
    staffMembers, staffSearch, staffRoleFilter,
  );

  // -- Client DB base data: raw mapping + dedup (expensive, only changes when data changes) -

  // -- Client DB filtered+sorted list (only recomputes when filter state changes) -
  const { overviewStats } = useOverviewDerived(orders, subscribers, leads, courses, staffMembers, consultations, content);

  const exportFilteredOrdersCsv = (rows: OrderItem[]) => exportOrdersCsv(rows);

  const saveInstituteGalleryImages = (images: string[]) => {
    setContentValue('institute.gallery.images', JSON.stringify(images, null, 2));
  };

  const certPricingMap = useMemo<CertPricingMap>(() => {
    try {
      const parsed = JSON.parse(content['extra_cert_pricing'] || '{}');
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch { return {}; }
  }, [content]);

  const saveCertPricingMap = (map: CertPricingMap) => {
    setContentValue('extra_cert_pricing', JSON.stringify(map));
  };

  // -- Content Hub sub-tab ---------------------------------------------------
  const [contentHubSubTab, setContentHubSubTab] = useState<TabKey>('home_offer');

  // -- Staff Profile Modal ----------------------------------------------------

  // -- Cert Requests filter state --------------------------------------------
  const [certSearch, setCertSearch] = useState('');
  const [certTypeFilter, setCertTypeFilter] = useState('all');
  const [certStatusFilter, setCertStatusFilter] = useState('all');

  const handleInstituteGalleryUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      // Compress to max 600px wide, 65% quality — keeps each image ~15-30KB in base64
      const uploaded = await compressInstituteGalleryFiles(files);
      saveInstituteGalleryImages(Array.from(new Set([...instituteGalleryImages, ...uploaded])));
      notify('success', 'تم رفع صور المعرض بنجاح.');
    } catch {
      notify('error', 'حدث خطأ أثناء رفع صور المعهد.');
    }
  };


  const handleSubPayment = async (draft: PaymentDraft) => {
    const { handleSubPaymentFn } = await import('./dashboard/dashboardPaymentHandlers');
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
    const { handleLeadPaymentFn } = await import('./dashboard/dashboardPaymentHandlers');
    await handleLeadPaymentFn(draft, {
      leadPayRow,
      leads,
      subscribers,
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

  // -- Quick installment plan creator from Dashboard table ------------------
  // -- General CSV/Facebook lead handlers ------------------------------------
  // Show loading spinner while fetching staff permissions to avoid flash of AccessDenied
  if (!isAdmin && authUser && staffSelfLoading) {
    return <StaffPermissionsLoading />;
  }

  // Show loading overlay while admin CRM bootstrap (Batch 1) is in progress
  if (isAdmin && !remoteReady) {
    return <AdminBootstrapLoading />;
  }

  return (
    <>
    <div className="min-h-screen bg-gradient-to-br from-gray-100 via-white to-primary-50/30 py-6 md:py-8">
      <div className="container mx-auto px-4">
        <DashboardNavigation
          isSalesOnly={isSalesOnly}
          isCollectionRole={isCollectionRole}
          isReceptionDaqqi={isReceptionDaqqi}
          isOnlineManager={isOnlineManager}
          isDaqqiManager={isDaqqiManager}
          isSalesCollectionManager={isSalesCollectionManager}
          isAdmin={isAdmin}
          visibleMenuGroups={visibleMenuGroups}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          activeDropdownGroup={activeDropdownGroup}
          setActiveDropdownGroup={setActiveDropdownGroup}
          dropdownRect={dropdownRect}
          setDropdownRect={setDropdownRect}
          leads={leads}
          subscribers={subscribers}
          monitorPanel={monitorPanel}
          setMonitorPanel={setMonitorPanel}
          notifRef={notifRef}
          notifOpen={notifOpen}
          setNotifOpen={setNotifOpen}
          notifRows={notifRows}
          setNotifRows={setNotifRows}
          notifUnread={notifUnread}
          setNotifUnread={setNotifUnread}
          pendingProofsCount={pendingProofsCount}
          inboxUnreadCount={inboxUnreadCount}
          currentStaff={currentStaff}
          salesDataLoading={salesDataLoading}
          staffNotifBadge={staffNotifBadge}
          setSalesNotifOpen={setSalesNotifOpen}
          onlineMgrAcademyOpen={onlineMgrAcademyOpen}
          setOnlineMgrAcademyOpen={setOnlineMgrAcademyOpen}
          setOnlineMgrFollowupOpen={setOnlineMgrFollowupOpen}
          onlineMgrFollowupBadge={onlineMgrFollowupBadge}
          setOnlineMgrNewEventsOpen={setOnlineMgrNewEventsOpen}
          onlineMgrNewEventsBadge={onlineMgrNewEventsBadge}
        />

        <div className="grid grid-cols-1 gap-6 items-start">
          <section className="space-y-6 min-w-0 overflow-hidden">
            <DashboardTabContainer
              activeTab={activeTab}
              isAdmin={isAdmin}
              hasPermission={hasPermission}
            >

            {activeTab === 'overview' && (
              <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>}>
                <OverviewTab
                  overviewStats={overviewStats}
                  isSalesOnly={isSalesOnly}
                  currentStaff={currentStaff ?? null}
                  salesOwnLeads={salesOwnLeads ?? []}
                  salesOwnSubscribers={salesOwnSubscribers}
                  salesOwnOrders={salesOwnOrders}
                  subscribers={subscribers}
                  courses={courses}
                  staffMembers={staffMembers}
                  leads={leads}
                  consultations={consultations}
                  therapists={therapists}
                  communityPosts={communityPosts}
                  content={content}
                  isAdmin={isAdmin}
                  isOnlineManager={isOnlineManager}
                  isCollectionRole={isCollectionRole}
                  isReceptionDaqqi={isReceptionDaqqi}
                  onlineTeamMembers={onlineTeamMembers}
                  onlineUsers={onlineUsers}
                  kpiModal={kpiModal}
                  setKpiModal={setKpiModal}
                  notify={notify}
                  setActiveTab={setActiveTab}
                  navigate={navigate}
                />
              </Suspense>
            )}

            <DashboardStandaloneTabs
              activeTab={activeTab}
              isSalesOnly={isSalesOnly}
              notify={notify}
            />
            {directContentTabs.has(activeTab) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>}>
                <DashboardDirectContentRoutes
                  activeTab={activeTab}
                  contentHubSubTab={contentHubSubTab}
                  content={content}
                  policyDrafts={policyDrafts}
                  setPolicyDrafts={setPolicyDrafts}
                  setContentValue={setContentValue}
                  notify={notify}
                  contentEdits={contentEdits}
                  setContentEdits={setContentEdits}
                  newContentKey={newContentKey}
                  setNewContentKey={setNewContentKey}
                  newContentValue={newContentValue}
                  setNewContentValue={setNewContentValue}
                  addContentKey={addContentKey}
                  searchText={searchText}
                  setSearchText={setSearchText}
                  filteredContent={filteredContent}
                  removeContentKey={removeContentKey}
                  courses={courses}
                  offerSelectedCourseId={offerSelectedCourseId}
                  setOfferSelectedCourseId={setOfferSelectedCourseId}
                  instituteGalleryUploadRef={instituteGalleryUploadRef}
                  handleInstituteGalleryUpload={handleInstituteGalleryUpload}
                  instituteGalleryUrlInput={instituteGalleryUrlInput}
                  setInstituteGalleryUrlInput={setInstituteGalleryUrlInput}
                  instituteGalleryImages={instituteGalleryImages}
                  saveInstituteGalleryImages={saveInstituteGalleryImages}
                  instituteBranches={instituteBranches}
                  certPricingMap={certPricingMap}
                  saveCertPricingMap={saveCertPricingMap}
                  subscribers={subscribers}
                  reloadSubscribers={reloadSubscribers}
                  certSearch={certSearch}
                  setCertSearch={setCertSearch}
                  certTypeFilter={certTypeFilter as ExtraCertificateType | 'all'}
                  setCertTypeFilter={setCertTypeFilter as React.Dispatch<React.SetStateAction<ExtraCertificateType | 'all'>>}
                  certStatusFilter={certStatusFilter}
                  setCertStatusFilter={setCertStatusFilter}
                />
              </Suspense>
            )}

            {(['courses','lectures','instructors','bundles','testimonials','discounts'].includes(activeTab)) && (
              <Suspense fallback={<div className="text-center py-8 text-gray-400">جاري التحميل...</div>}>
                <CoursesTab
                  notify={notify}
                  activeTab={activeTab}
                  setActiveTab={(tab) => setActiveTab(tab as TabKey)}
                  lectureCourseId={lectureCourseId}
                  setLectureCourseId={setLectureCourseId}
                  subscriberCourseFilter={subscriberCourseFilter}
                  setSubscriberCourseFilter={setSubscriberCourseFilter}
                  instituteGalleryImages={instituteGalleryImages}
                  policyDrafts={policyDrafts}
                  setPolicyDrafts={setPolicyDrafts}
                />
              </Suspense>
            )}

            {(activeTab === 'online_clients' || activeTab === 'daqqi_clients') && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" /></div>}>
                <DashboardClientTabs
                  activeTab={activeTab}
                  canViewDaqqiClients={isDaqqiManager || isReceptionDaqqi || isAdmin}
                  onlineClientsProps={{
                    activeTab,
                    subscribers,
                    salesOwnSubscribers,
                    setSalesOwnSubscribers,
                    courses,
                    bundles,
                    staffMembers,
                    content,
                    salesOwnDaqqiRounds: salesOwnDaqqiRounds ?? [],
                    setSalesOwnDaqqiRounds,
                    salesOwnLeads: salesOwnLeads ?? [],
                    updateSubscriber,
                    addSubscriber,
                    reloadSubscribers,
                    reloadLeads,
                    deleteSubscriber,
                    notify,
                    isDaqqiManager,
                    isReceptionDaqqi,
                    isAdmin,
                    isOnlineManager,
                    isNonAdminStaff,
                    currentStaff: currentStaff ?? null,
                    staffSelf,
                    onlineTeamMembers,
                    subCsDistributing,
                    setSubCsDistributing,
                    daqqiOldDistribPlan,
                    setDaqqiOldDistribPlan,
                    daqqiOldDistributing,
                    setDaqqiOldDistributing,
                    setSubPayRow,
                    setSubPayDraft,
                    setSubContactRow,
                    setSubContactDraft,
                    setSubWaRow,
                    branchFilter: branchQueryFilter,
                  }}
                />
              </Suspense>
            )}

            {(['refund_requests', 'contacts', 'join_us'] as TabKey[]).includes(activeTab) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" /></div>}>
                <DashboardCustomerServiceTabs
                  activeTab={activeTab}
                  isCollectionRole={isCollectionRole}
                  isOnlineManager={isOnlineManager}
                  isAdmin={isAdmin}
                  subscribers={subscribers}
                  salesOwnSubscribers={salesOwnSubscribers}
                  setSalesOwnSubscribers={setSalesOwnSubscribers}
                  courses={courses}
                  bundles={bundles}
                  updateSubscriber={updateSubscriber}
                  notify={notify}
                  refundActionSaving={refundActionSaving}
                  setRefundActionSaving={setRefundActionSaving}
                />
              </Suspense>
            )}

            {(['orders', 'financial', 'client'] as TabKey[]).includes(activeTab) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" /></div>}>
                <DashboardFinanceTabs
                  activeTab={activeTab}
                  notify={notify}
                  branchFilter={branchQueryFilter || undefined}
                  onClientBook={handleClientDbBook}
                  ordersProps={{
                    isOnlineManager,
                    isDaqqiManager,
                    isAdmin,
                    canManageFinancial: hasPermission('manage_financial'),
                    notify,
                    courses,
                    bundles,
                    salesOwnSubscribers,
                    daqqiSubSearch,
                    setDaqqiSubSearch,
                    daqqiAccDateFrom,
                    setDaqqiAccDateFrom,
                    daqqiAccDateTo,
                    setDaqqiAccDateTo,
                    omOrdReviewTab,
                    setOmOrdReviewTab,
                    effectiveOrders,
                    filteredOrders,
                    ordersStats,
                    orderSearch,
                    setOrderSearch,
                    orderStatusFilter,
                    setOrderStatusFilter,
                    orderTypeFilter,
                    setOrderTypeFilter,
                    orderMethodFilter,
                    setOrderMethodFilter,
                    orderDateFrom,
                    setOrderDateFrom,
                    orderDateTo,
                    setOrderDateTo,
                    orderStaffFilter,
                    setOrderStaffFilter,
                    orderReviewTab,
                    setOrderReviewTab,
                    showAddTransfer,
                    setShowAddTransfer,
                    linkTransferModal,
                    setLinkTransferModal,
                    linkOrderModal,
                    setLinkOrderModal,
                    transferForm,
                    setTransferForm,
                    currentStaff,
                    authUser: authUser ?? null,
                    content,
                    updateOrderStatus,
                    reloadOrders,
                    reloadSubscribers,
                    addOrder,
                    deleteOrder,
                    exportFilteredOrdersCsv,
                  }}
                />
              </Suspense>
            )}

            {/* -------------------------------------------------------------------
                NOTIFICATIONS TAB — إشعارات المشتركين (broadcast)
            ------------------------------------------------------------------- */}

            {(onlineMgrFollowupOpen || onlineMgrNewEventsOpen) && (
              <Suspense fallback={null}>
                <DashboardOnlineManagerPanels
                  followupOpen={onlineMgrFollowupOpen}
                  newEventsOpen={onlineMgrNewEventsOpen}
                  isNonAdminStaff={isNonAdminStaff}
                  subscribers={subscribers}
                  salesOwnSubscribers={salesOwnSubscribers}
                  setFollowupOpen={setOnlineMgrFollowupOpen}
                  setNewEventsOpen={setOnlineMgrNewEventsOpen}
                  setActiveTab={setActiveTab}
                />
              </Suspense>
            )}
            {salesNotifOpen && (
              <Suspense fallback={null}>
                <DashboardSalesFollowupPanel
                  open={salesNotifOpen}
                  isAdmin={isAdmin}
                  isNonAdminStaff={isNonAdminStaff}
                  isSalesOnly={isSalesOnly}
                  currentStaff={currentStaff}
                  leads={leads}
                  salesOwnLeads={salesOwnLeads}
                  setOpen={setSalesNotifOpen}
                  setActiveTab={setActiveTab}
                  setLeadsFollowupFilter={setLeadsFollowupFilter}
                />
              </Suspense>
            )}
            {activeTab === 'community' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>}>
                <DashboardCommunityAdminPanel
                  activeTab={activeTab}
                  communityAdminTab={communityAdminTab}
                  setCommunityAdminTab={setCommunityAdminTab}
                  communityPosts={communityPosts}
                  communityLibraryItems={communityLibraryItems}
                  communityVideos={communityVideos}
                  communityEvents={communityEvents}
                  updateCommunityPost={updateCommunityPost}
                  deleteCommunityPost={deleteCommunityPost}
                  addCommunityPost={addCommunityPost}
                  communityPostDraft={communityPostDraft}
                  setCommunityPostDraft={setCommunityPostDraft}
                  isCommunityPostFormOpen={isCommunityPostFormOpen}
                  setIsCommunityPostFormOpen={setIsCommunityPostFormOpen}
                  editingCommunityPostId={editingCommunityPostId}
                  setEditingCommunityPostId={setEditingCommunityPostId}
                  communityLibraryDraft={communityLibraryDraft}
                  setCommunityLibraryDraft={setCommunityLibraryDraft}
                  isCommunityLibraryFormOpen={isCommunityLibraryFormOpen}
                  setIsCommunityLibraryFormOpen={setIsCommunityLibraryFormOpen}
                  editingCommunityLibraryId={editingCommunityLibraryId}
                  setEditingCommunityLibraryId={setEditingCommunityLibraryId}
                  addCommunityLibraryItem={addCommunityLibraryItem}
                  updateCommunityLibraryItem={updateCommunityLibraryItem}
                  deleteCommunityLibraryItem={deleteCommunityLibraryItem}
                  communityVideoDraft={communityVideoDraft}
                  setCommunityVideoDraft={setCommunityVideoDraft}
                  isCommunityVideoFormOpen={isCommunityVideoFormOpen}
                  setIsCommunityVideoFormOpen={setIsCommunityVideoFormOpen}
                  editingCommunityVideoId={editingCommunityVideoId}
                  setEditingCommunityVideoId={setEditingCommunityVideoId}
                  addCommunityVideo={addCommunityVideo}
                  updateCommunityVideo={updateCommunityVideo}
                  deleteCommunityVideo={deleteCommunityVideo}
                  communityEventDraft={communityEventDraft}
                  setCommunityEventDraft={setCommunityEventDraft}
                  isCommunityEventFormOpen={isCommunityEventFormOpen}
                  setIsCommunityEventFormOpen={setIsCommunityEventFormOpen}
                  editingCommunityEventId={editingCommunityEventId}
                  setEditingCommunityEventId={setEditingCommunityEventId}
                  addCommunityEvent={addCommunityEvent}
                  updateCommunityEvent={updateCommunityEvent}
                  deleteCommunityEvent={deleteCommunityEvent}
                />
              </Suspense>
            )}

            {saasOpsTabs.has(activeTab) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" /></div>}>
                <DashboardSaasOpsTabs
                  activeTab={activeTab}
                  notify={notify}
                  isAdmin={isAdmin}
                  hasPermission={hasPermission}
                  setActiveTab={setActiveTab}
                />
              </Suspense>
            )}

            {growthOpsTabs.has(activeTab) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" /></div>}>
                <DashboardGrowthOpsTabs
                  activeTab={activeTab}
                  notify={notify}
                  staffSelf={staffSelf}
                  salesOwnLeads={salesOwnLeads}
                  salesOwnSubscribers={salesOwnSubscribers}
                  salesDataLoading={salesDataLoading}
                  fetchSalesData={fetchSalesData}
                  setActiveTab={setActiveTab}
                  branchFilter={branchQueryFilter}
                  isNonAdminStaff={isNonAdminStaff}
                  salesOwnDaqqiRounds={salesOwnDaqqiRounds}
                  isReceptionDaqqi={isReceptionDaqqi}
                  canDeleteSubscriber={hasPermission('delete_subscribers')}
                  leadsSalesTargets={leadsSalesTargets}
                  setStaffProfileModalId={setStaffProfileModalId}
                />
              </Suspense>
            )}

            {contentHubRouteTabs.has(activeTab) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>}>
                <DashboardContentHubRoutes
                  activeTab={activeTab}
                  contentHubSubTab={contentHubSubTab}
                  setContentHubSubTab={setContentHubSubTab}
                  setActiveTab={setActiveTab}
                  content={content}
                  policyDrafts={policyDrafts}
                  setPolicyDrafts={setPolicyDrafts}
                  setContentValue={setContentValue}
                  notify={notify}
                  instituteBranches={instituteBranches}
                  homeOfferFields={homeOfferFields}
                  aboutPageFields={aboutPageFields}
                  policySections={policySections}
                  contentEdits={contentEdits}
                  setContentEdits={setContentEdits}
                  newContentKey={newContentKey}
                  setNewContentKey={setNewContentKey}
                  newContentValue={newContentValue}
                  setNewContentValue={setNewContentValue}
                  addContentKey={addContentKey}
                  searchText={searchText}
                  setSearchText={setSearchText}
                  filteredContent={filteredContent}
                  removeContentKey={removeContentKey}
                />
              </Suspense>
            )}

            {/* ---- LIVE STREAMS TAB ---- */}
            {activeTab === 'staff_settings' && currentStaff && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>}>
                <DashboardStaffSettingsPanel
                  currentStaff={currentStaff}
                  salesOwnSubscribers={salesOwnSubscribers}
                  staffSettingsDraft={staffSettingsDraft}
                  setStaffSettingsDraft={setStaffSettingsDraft}
                  staffSettingsSaving={staffSettingsSaving}
                  setStaffSettingsSaving={setStaffSettingsSaving}
                  notify={notify}
                  loadingMyHr={loadingMyHr}
                  myHrData={myHrData}
                  setMyHrData={setMyHrData}
                  showMyLeaveFormProfile={showMyLeaveFormProfile}
                  setShowMyLeaveFormProfile={setShowMyLeaveFormProfile}
                  myLeaveFormProfile={myLeaveFormProfile}
                  setMyLeaveFormProfile={setMyLeaveFormProfile}
                  submittingMyLeaveProfile={submittingMyLeaveProfile}
                  setSubmittingMyLeaveProfile={setSubmittingMyLeaveProfile}
                  showAdvanceForm={showAdvanceForm}
                  setShowAdvanceForm={setShowAdvanceForm}
                  advanceDraft={advanceDraft}
                  setAdvanceDraft={setAdvanceDraft}
                  submittingAdvance={submittingAdvance}
                  setSubmittingAdvance={setSubmittingAdvance}
                  myAdvances={myAdvances}
                  setMyAdvances={setMyAdvances}
                  myDisciplinary={myDisciplinary}
                  setMyDisciplinary={setMyDisciplinary}
                  staffWaTemplateEdit={staffWaTemplateEdit}
                  setStaffWaTemplateEdit={setStaffWaTemplateEdit}
                  staffWaTemplates={staffWaTemplates}
                  setStaffWaTemplates={setStaffWaTemplates}
                  staffContactTags={staffContactTags}
                  setStaffContactTags={setStaffContactTags}
                  staffNewTagInput={staffNewTagInput}
                  setStaffNewTagInput={setStaffNewTagInput}
                />
              </Suspense>
            )}

            {activeTab === 'staff_home' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" /></div>}>
                <DashboardStaffTabs
                  activeTab={activeTab}
                  currentStaff={currentStaff ?? null}
                  leads={usesStaffScopedData ? salesOwnLeads : leads}
                  subscribers={usesStaffScopedData ? salesOwnSubscribers : subscribers}
                  notify={notify}
                  onNavigate={setActiveTabState}
                />
              </Suspense>
            )}

            </DashboardTabContainer>
          </section>
        </div>
      </div>

      <Suspense fallback={null}>
        <DashboardQuickBooking
          open={quickBookOpen}
          search={quickBookSearch}
          leads={leads}
          subscribers={subscribers}
          setOpen={setQuickBookOpen}
          setSearch={setQuickBookSearch}
          setLeadPayRow={setLeadPayRow}
          setLeadPayDraft={setLeadPayDraft}
          setSubPayRow={setSubPayRow}
          setSubPayDraft={setSubPayDraft}
          navigate={navigate}
        />
      </Suspense>

    </div>
    <Suspense fallback={null}>
      <DashboardMonitorPanel
        open={monitorPanel}
        leads={leads}
        subscribers={subscribers}
        setOpen={setMonitorPanel}
      />
    </Suspense>
    <DashboardPaymentOverlays
      lead={leadPayRow}
      leadDraft={leadPayDraft}
      setLeadDraft={setLeadPayDraft}
      submitLeadPayment={handleLeadPayment}
      closeLeadPayment={() => setLeadPayRow(null)}
      subscriber={subPayRow}
      subscriberDraft={subPayDraft}
      setSubscriberDraft={setSubPayDraft}
      submitSubscriberPayment={handleSubPayment}
      closeSubscriberPayment={() => setSubPayRow(null)}
      branchOptions={instituteBranches.map(b => ({ id: b.id, label: b.label }))}
      instituteName={content['institute.name'] || 'مهاد نفسي'}
      requireSubscriberApproval={isReceptionDaqqi}
    />
    </>
  );
};

export default Dashboard;
