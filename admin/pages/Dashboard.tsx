import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminAuthHeaders } from '../lib/adminAuthHeaders';

import {
  AnalyticsTab,
  AutomationDashboardTab,
  BalanceSheetTab,
  BudgetTrackerTab,
  CashFlowTab,
  CoursesTab,
  DaqqiTeamTab,
  DripCampaignsTab,
  EmailCampaignsTab,
  ExpenseAnalyticsTab,
  FollowupRemindersTab,
  ForecastTab,
  HrTab,
  InstallmentPlansTab,
  IpWhitelistTab,
  LeadScoringTab,
  MyHrTab,
  NpsDashboardTab,
  NotifInboxMgmtTab,
  OnlineTeamMgmtTab,
  RecurringExpensesTab,
  RetentionTab,
  RevenueForecastTab,
  RevenueSourcesTab,
  SalesGoalsTab,
  SalesReportsTab,
  SalesTeamTab,
  SecurityDashboardTab,
  SmsCampaignsTab,
  SmsSettingsTab,
  StaffPerformanceTab,
  SubscriptionsTab,
  SystemSettingsTab,
  TasksBoardTab,
  TicketsTab,
  WaitlistTab,
  WebhooksTab,
} from './dashboard/lazyTabs';
import { AdminBootstrapLoading, StaffPermissionsLoading } from './dashboard/DashboardGuards';
import { DashboardTabContainer } from './dashboard/DashboardTabContainer';
import { DashboardNavigation } from './dashboard/DashboardNavigation';
import { DashboardPaymentOverlays } from './dashboard/DashboardPaymentOverlays';
import { DashboardStandaloneTabs } from './dashboard/DashboardStandaloneTabs';
import { DASHBOARD_MENU_GROUPS, type TabKey } from './dashboard/navigation';
import { branchMatchesFilter, branchSlugToFilter } from './dashboard/branchWorkspaceFilters';
import { aboutPageFields, homeOfferFields, policySections } from './dashboard/contentFields';
import { CrmSettingsModal } from './dashboard/tabs/CrmSettingsModal';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { SafeHtml } from '../../shared/ui/SafeHtml';
import {
  BarChart3,
  BookOpen,
  CalendarCheck2,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  FileText,
  FolderKanban,
  Home,
  LayoutDashboard,
  ListOrdered,
  Megaphone,
  Monitor,
  Plus,
  Radio,
  Save,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Video,
  Mail,
  MapPin,
  Briefcase,
  UserCog,
  CheckCircle,
  FileUp,
  Facebook,
  Instagram,
  Youtube,
  GraduationCap,
  Globe,
  Tag,
  Bell,
  Percent,
  Star,
  Zap,
  Clock,
  TrendingDown,
  PieChart,
  Wallet,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  Filter,
  Columns,
  List,
  Pin,
  MessageCircle,
  ThumbsUp,
  ChevronDown,
  Edit2,
  Pencil,
  ArrowLeftRight,
  Bot,
  Send,
  RefreshCw,
  ChevronRight,
  Layers,
  AlertCircle,
  CheckCheck,
  AtSign,
  Smartphone,
  Link2,
  Loader,
  Award,
  Hash,
  Terminal,
  Copy,
  Calendar,
  Database,
  CheckCircle2,
  XCircle,
  Moon,
  Sun,
  LogOut,
  Target,
  Headphones,
  Flame,
  Trophy,
  User,
} from 'lucide-react';
import { Bundle, ConsultationItem, Course, DaqqiRound, DaqqiRoundAttendee, DiscountRule, ExpenseItem, NotificationBroadcast, Therapist, LeadItem, LeadStatus, StaffMember, StaffPermission, AccessMode, CourseAccessSetting, PaymentHistoryEntry, PaymentRecord, PaymentItemType, SubscriberItem, BranchType, CommunicationRecord, FacebookLeadAdsConfig, ExtraCertificateRequest, ExtraCertificateType, SalesTarget, JoinUsApplication, OrderItem, InstallmentEntry, InstallmentPlan, Price } from '../types';
import { formatAvailabilitySlot, meetingProviderLabels } from '../lib/consultations';
import { mysqlAuth, mysqlAdmin, mysqlClient } from '../lib/mysqlapi';
import { useSiteData } from '../context/SiteDataContext';
import {
  ROLE_DEFAULT_PERMISSIONS as MASTER_ROLE_PERMS,
  hasPermission as masterHasPermission,
  resolvePermissions as masterResolvePermissions,
  getDefaultPermsArray,
  type RoleKey,
  type PermissionKey,
} from '../constants/permissions';
import { useToast } from '../../shared/ui/Toast';
import { useResizableCols } from '../components/useResizableCols';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import type { PaymentDraft } from '../components/PaymentModal';
import { createClientPaymentDraft } from '../lib/clientActionDrafts';
import { contentHubRouteTabs, directContentTabs, growthOpsTabs, saasOpsTabs } from './dashboard/dashboardTabGroups';
import { priceForCurrency, staffStatusFromWire, translatePayMethod, type StaffWire } from './dashboard/dashboardHelpers';
import { defaultFacebookLeadAdsConfig } from './dashboard/facebookLeadAdsDefaults';
import {
  handleCsvFileChangeFn,
  handleCsvImportFn,
  handleFbApiSyncFn,
  handleFetchFbFormsFn,
} from './dashboard/dashboardCsvFbHandlers';
import {
  handleDashInstCreateFn,
  handleLeadPaymentFn,
  handleSubPaymentFn,
  normalizeCourseAccess,
  normalizeLectureProgress,
} from './dashboard/dashboardPaymentHandlers';
import { useStaffRoleRedirects } from './dashboard/hooks/useStaffRoleRedirects';
import { useCurrentStaff } from './dashboard/hooks/useCurrentStaff';
import { useOrdersDerived } from './dashboard/hooks/useOrdersDerived';
import { useLeadsDerived } from './dashboard/hooks/useLeadsDerived';
import { useSubscribersDerived } from './dashboard/hooks/useSubscribersDerived';
import { useOverviewDerived } from './dashboard/hooks/useOverviewDerived';
import { useCommunityDrafts } from './dashboard/hooks/useCommunityDrafts';
import { useAdminAiAssistant } from './dashboard/hooks/useAdminAiAssistant';
import { useContentEditorDrafts } from './dashboard/hooks/useContentEditorDrafts';
import { useCsvFbImportState } from './dashboard/hooks/useCsvFbImportState';
import { useLeadFilters } from './dashboard/useLeadFilters';
import { useSubscriberFilters } from './dashboard/useSubscriberFilters';
import { useSubscriberModals } from './dashboard/hooks/useSubscriberModals';
import { useStaffHrState } from './dashboard/hooks/useStaffHrState';
import { useOrdersFinanceState } from './dashboard/hooks/useOrdersFinanceState';
import { exportOrdersCsv, exportSubscribersCsv as exportSubscribersCsvHelper, exportLeadsCsv as exportLeadsCsvHelper } from './dashboard/dashboardExports';
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
import { useSubscriberGrant } from './dashboard/useSubscriberGrant';
import { useStaffOwnData } from './dashboard/useStaffOwnData';
import { useDashboardDerived } from './dashboard/useDashboardDerived';
import { compressInstituteGalleryFiles } from './dashboard/dashboardGallery';

// --- Video URL obfuscation (protects YouTube IDs from plain-text storage) ---

import {
  PERMISSION_LABELS,
  ROLE_DEFAULT_PERMISSIONS,
  SUB_STATUS_CFG,
  TAB_PERMISSION_MAP,
  _normClientEmail,
  _normClientPhone,
  _normalizeAr,
  _normalizeClientDate,
  blankLead,
  blankStaffMember,
  calcCurrentLecture,
  crmInterestLabels,
  crmRoleLabels,
  crmSourceLabels,
  crmStatusColors,
  crmStatusLabels,
  formatWaPhone,
  getCurrentWeekKey,
  normBranchId,
  paymentTypeLabels,
  shortName,
  subStatusBadge,
  type CertPricingMap,
} from './dashboard/dashboardShared';

const _BUILD = '20260502';

// Shorthand for the subscriber status union
type SubStatus = SubscriberItem['status'];

const Dashboard: React.FC = () => {
  void _BUILD;
  const {
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
    isAdmin,
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
    updateLead,
    markLeadsConverted,
    deleteLead,
    bulkDeleteLeads,
    bulkAssignClientCodes,
    bulkRedistributeLeads,
    issueClientCodeAsync,
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
    deleteOrder,
    addOrder,
    getCourseLectures,
    setContentValue,
    mergeContent,
    addContentKey,
    removeContentKey,
    clearAllData,
    addDiscount,
    updateDiscount,
    deleteDiscount,
    addNotification,
    updateNotification,
    deleteNotification,
    expenses,
    addExpense,
    updateExpense,
    deleteExpense,
    joinUsApplications,
    updateJoinUsApplication,
    deleteJoinUsApplication,
    contactMessages,
    updateContactMessage,
    deleteContactMessage,
    adminAiConfig,
    setAdminAiConfig,
    aiAgentConfig,
    setAiAgentConfig,
    messagingChannels,
    setMessagingChannels,
    fbLeadAdsConfig,
    setFbLeadAdsConfig,
    authUser,
    remoteReady,
    addDaqqiRound,
    updateDaqqiRound,
    setStaffScopedSubscribers,
    setStaffScopedLeads,
  } = useSiteData();
  const [searchParams] = useSearchParams();
  const branchQueryFilter = branchSlugToFilter(searchParams.get('branch'));

  const { inboxUnreadCount, instituteBranches, branchLabelMap } = useDashboardDerived(content, notifications);

  // -- Pre-memoized ask_ai computations (must be inside Dashboard after useSiteData) ----------------------
  const _aiToEGP = (amt: number, cur: string) => cur === 'EGP' ? amt : cur === 'SAR' ? amt * 13 : amt * 50;
  const _aiAllManual = React.useMemo(() =>
    subscribers.flatMap(s =>
      (s.paymentHistory || []).map(p => ({
        ...p,
        subName: s.name,
        subPhone: s.phone,
        branchCode: s.branch || 'other',
        branchLabel: branchLabelMap[s.branch || ''] || s.branch || '—',
        assignedSalesName: s.assignedSalesName || '—',
      }))
    ),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [subscribers, branchLabelMap]);

  const _aiStaffPerf = React.useMemo(() => {
    const salesStaffAI = staffMembers.filter(s => s.role === 'sales');
    return salesStaffAI.map(s => {
      const sl = leads.filter(l => l.assignedSalesName === s.name || l.assignedSalesId === s.id);
      const assignedSubs = subscribers.filter(sub => sub.assignedSalesId === s.id);
      const now2 = new Date(); const tM2 = now2.getMonth(), tY2 = now2.getFullYear();
      const todayStr = now2.toISOString().slice(0, 10);
      const yesterdayStr = new Date(now2.getTime() - 86_400_000).toISOString().slice(0, 10);
      const isT = (d: string) => !!d && new Date(d).toDateString() === now2.toDateString();
      const isYest = (d: string) => !!d && d.slice(0, 10) === yesterdayStr;
      const isW = (d: string) => { if (!d) return false; const st = new Date(now2); st.setDate(now2.getDate() - now2.getDay()); st.setHours(0, 0, 0, 0); return new Date(d) >= st; };
      const isTM = (d: string) => { if (!d) return false; const x = new Date(d); return x.getMonth() === tM2 && x.getFullYear() === tY2; };
      const allPayments = assignedSubs.flatMap(sub => (sub.paymentHistory || []).map(p => ({ ...p, subName: sub.name, subId: sub.id, subCode: sub.clientCode })));
      const toRevEGP = (payments: typeof allPayments) => Math.round(payments.reduce((sum, p) => sum + _aiToEGP(p.amount, p.currency), 0));
      const revTotal = toRevEGP(allPayments);
      const revToday = toRevEGP(allPayments.filter(p => isT(p.at || '')));
      const revYest  = toRevEGP(allPayments.filter(p => isYest(p.at || '')));
      const revWeek  = toRevEGP(allPayments.filter(p => isW(p.at || '')));
      const revMonth = toRevEGP(allPayments.filter(p => isTM(p.at || '')));
      // Communications across all this rep's leads
      const allComms = sl.flatMap(l => (l.communications || []).map(c => ({ ...c, leadName: l.name, leadId: l.id, leadPhone: l.phone || '' })));
      allComms.sort((a, b) => b.date.localeCompare(a.date));
      const callsToday = allComms.filter(c => c.date === todayStr).length;
      const callsYest  = allComms.filter(c => c.date === yesterdayStr).length;
      const callsWeek  = allComms.filter(c => isW(c.date)).length;
      const callsMonth = allComms.filter(c => isTM(c.date)).length;
      const cr = s.commissionRate || 0;
      return {
        id: s.id, name: s.name, role: s.role, commissionRate: cr,
        total: sl.length, today: sl.filter(l => isT(l.createdAt || '')).length,
        yesterday: sl.filter(l => isYest(l.createdAt || '')).length,
        week: sl.filter(l => isW(l.createdAt || '')).length, month: sl.filter(l => isTM(l.createdAt || '')).length,
        contacted: sl.filter(l => l.status === 'contacted').length,
        converted: sl.filter(l => l.status === 'converted').length,
        convertedMonth: sl.filter(l => l.status === 'converted' && isTM(l.createdAt || '')).length,
        lost: sl.filter(l => l.status === 'lost').length,
        pending: sl.filter(l => l.status === 'new').length,
        noAnswer: sl.filter(l => l.status === 'no_answer').length,
        notInterested: sl.filter(l => l.status === 'not_interested').length,
        interested: sl.filter(l => l.status === 'interested').length,
        revTotal, revToday, revYest, revWeek, revMonth,
        commission: cr ? Math.round(revTotal * cr / 100) : 0,
        commissionMonth: cr ? Math.round(revMonth * cr / 100) : 0,
        callsToday, callsYest, callsWeek, callsMonth,
        allComms, bookings: allPayments,
        leads: sl,
        subs: assignedSubs,
      };
    });
  }, [staffMembers, leads, subscribers]);

  const _aiBranchStats = React.useMemo(() => {
    const now = new Date(); const tM = now.getMonth(), tY = now.getFullYear();
    const isToday = (d: string) => !!d && new Date(d).toDateString() === now.toDateString();
    const isThisMonth = (d: string) => { if (!d) return false; const x = new Date(d); return x.getMonth() === tM && x.getFullYear() === tY; };
    const toEGP = _aiToEGP;
    const branchCodes = [...new Set(subscribers.map(s => s.branch || 'other'))] as string[];
    return branchCodes.map(code => {
      const bSubs = subscribers.filter(s => (s.branch || 'other') === code);
      const bPayments = _aiAllManual.filter(p => p.branchCode === code);
      return {
        code, label: branchLabelMap[code] || code, subs: bSubs.length,
        todayNew: bSubs.filter(s => isToday(s.createdAt || '')).length,
        todayRev: Math.round(bPayments.filter(p => isToday(p.at || '')).reduce((s, p) => s + toEGP(p.amount, p.currency), 0)),
        monthRev: Math.round(bPayments.filter(p => isThisMonth(p.at || '')).reduce((s, p) => s + toEGP(p.amount, p.currency), 0)),
        allRev: Math.round(bPayments.reduce((s, p) => s + toEGP(p.amount, p.currency), 0)),
      };
    }).sort((a, b) => b.subs - a.subs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribers, _aiAllManual]);

  const toast = useToast();
  const notify = (type: 'success' | 'error' | 'info', text: string) => toast.show(text, type);
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
    subscriberSubTab, setSubscriberSubTab,
    subscriberCourseFilter, setSubscriberCourseFilter,
    subscriberSearch, setSubscriberSearch,
    subscriberSalesFilter, setSubscriberSalesFilter,
    subscriberCsFilter, setSubscriberCsFilter,
    subscriberInstFilter, setSubscriberInstFilter,
    subscriberRemainingFilter, setSubscriberRemainingFilter,
    subscriberCertFilter, setSubscriberCertFilter,
    subscriberPayFilter, setSubscriberPayFilter,
    subscriberPage, setSubscriberPage,
  } = useSubscriberFilters();
  // Reception Daqqi role — daqqi clients tab state
  const [daqqiSubSearch, setDaqqiSubSearch] = useState('');
  const [daqqiAccDateFrom, setDaqqiAccDateFrom] = useState('');
  const [daqqiAccDateTo, setDaqqiAccDateTo] = useState('');
  const daqqiCreateRoundRef = React.useRef<(() => void) | null>(null);
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
    showAdvanceForm, setShowAdvanceForm,
    advanceDraft, setAdvanceDraft,
    submittingAdvance, setSubmittingAdvance,
    showMyLeaveFormProfile, setShowMyLeaveFormProfile,
    myLeaveFormProfile, setMyLeaveFormProfile,
    submittingMyLeaveProfile, setSubmittingMyLeaveProfile,
    staffSearch, setStaffSearch,
    staffRoleFilter, setStaffRoleFilter,
    editingStaffId, setEditingStaffId,
    staffDraft, setStaffDraft,
    staffPassword, setStaffPassword,
    staffShowPassword, setStaffShowPassword,
    staffProfileModalId, setStaffProfileModalId,
  } = useStaffHrState();
  const [subCsDistributing, setSubCsDistributing] = useState(false);
  // Daqqi old-data distribution
  const [daqqiOldDistribPlan, setDaqqiOldDistribPlan] = useState<{staffId:string;count:string}[]>([{staffId:'',count:''}]);
  const [daqqiOldDistributing, setDaqqiOldDistributing] = useState(false);
  const {
    grantSubscriberId, setGrantSubscriberId,
    grantEnrolledCourseIds, setGrantEnrolledCourseIds,
    grantCourseAccess, setGrantCourseAccess,
    grantPaymentAmount, setGrantPaymentAmount,
    grantPaymentCurrency, setGrantPaymentCurrency,
    grantPaymentNote, setGrantPaymentNote,
  } = useSubscriberGrant();

  // Refund requests section state (shared with refund_requests tab)
  const {
    editingSubscriberId, setEditingSubscriberId,
    refundActionSaving, setRefundActionSaving,
    subPayRow, setSubPayRow,
    subPayDraft, setSubPayDraft,
    certActionSub, setCertActionSub,
    certActionDraft, setCertActionDraft,
    subInstRow, setSubInstRow,
    subInstDraft, setSubInstDraft,
    subContactRow, setSubContactRow,
    subContactDraft, setSubContactDraft,
    subscriberDraft, setSubscriberDraft,
    newSubscriberPassword, setNewSubscriberPassword,
    subWaRow, setSubWaRow,
  } = useSubscriberModals();

  const [editingLeadId, setEditingLeadId] = useState('');
  const [salesNotifOpen, setSalesNotifOpen] = useState(false);
  const [onlineMgrFollowupOpen, setOnlineMgrFollowupOpen] = useState(false);
  const [onlineMgrNewEventsOpen, setOnlineMgrNewEventsOpen] = useState(false);
  const [leadDraft, setLeadDraft] = useState<LeadItem>(blankLead());
  const [convertLeadModal, setConvertLeadModal] = useState<{ lead: LeadItem | null; courseId: string; accessMode: AccessMode }>({ lead: null, courseId: '', accessMode: 'full' });
  const bulkUploadRef = React.useRef<HTMLInputElement>(null);

  // -- Global Quick Booking FAB ---------------------------------------------
  const [quickBookOpen, setQuickBookOpen] = useState(false);
  const [quickBookSearch, setQuickBookSearch] = useState('');

  // -- Lead payment modal (unified — same design as subscriber payment modal) -
  const [leadPayRow, setLeadPayRow] = useState<LeadItem | null>(null);
  const [leadPayDraft, setLeadPayDraft] = useState<PaymentDraft>(createClientPaymentDraft());
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
    leadsSearch, setLeadsSearch,
    leadsStatusFilter, setLeadsStatusFilter,
    leadsFollowupFilter, setLeadsFollowupFilter,
    leadsBranchFilter, setLeadsBranchFilter,
    leadsSalesFilter, setLeadsSalesFilter,
    leadsCourseFilter, setLeadsCourseFilter,
  } = useLeadFilters();
  const navigate = useNavigate();
  const { tab: urlTab, param: urlParam } = useParams<{ tab: string; param?: string }>();
  const [activeTabState, setActiveTabState] = useState<TabKey>((urlTab as TabKey) || 'overview');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['main', 'clients']));
  const [showSaveSegment, setShowSaveSegment] = useState(false);
  const toggleGroup = (key: string) => setOpenGroups(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
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
  } = useNotificationsBell(isAdmin);

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
  // Sync sales targets from content (Firebase-persisted) when content loads
  useEffect(() => {
    if (!content['crm.salesTargets']) return;
    try {
      const parsed = JSON.parse(content['crm.salesTargets']) as SalesTarget[];
      setLeadsSalesTargets(parsed);
    } catch { /* keep local state */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content['crm.salesTargets']]);

  const setActiveTab = useCallback((tab: TabKey) => {
    setActiveTabState(tab);
    navigate(`/dashboard/${tab}`);
  }, [navigate]);
  const activeTab = activeTabState;

  const [editingConsultationId, setEditingConsultationId] = useState('');
  const [consultationDraft, setConsultationDraft] = useState<ConsultationItem>({
    id: '',
    clientName: '',
    clientEmail: '',
    clientPhone: '',
    therapistId: '',
    therapistName: '',
    sessionType: 'individual' as 'individual' | 'couple' | 'family',
    sessionDate: '',
    slotId: '',
    slotLabel: '',
    timezone: 'Africa/Cairo',
    status: 'pending' as 'pending' | 'confirmed' | 'completed' | 'cancelled',
    notes: '',
    amount: 0,
    currency: 'EGP',
    sessionDurationMinutes: 50,
    meetingProvider: 'google_meet',
    meetingLink: '',
    createdAt: '',
  });

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
    reviewedOrders, setReviewedOrders,
    showAddTransfer, setShowAddTransfer,
    linkTransferModal, setLinkTransferModal,
    linkOrderModal, setLinkOrderModal,
    transferForm, setTransferForm,
  } = useOrdersFinanceState();

  // Discount management state

  // Notification state moved to NotificationsAdminTab.tsx

  // Quiz + LiveStream state moved to their own tab components

  const [clientDbSearch, setClientDbSearch] = useState('');
  const [clientDbTypeFilter, setClientDbTypeFilter] = useState<'all' | 'subscriber' | 'lead' | 'consultation'>('all');
  const [clientDbCourseFilter, setClientDbCourseFilter] = useState('');
  const [clientDbSalesFilter, setClientDbSalesFilter] = useState('');
  const [clientDbCollectionFilter, setClientDbCollectionFilter] = useState('');
  const [clientDbBranchFilter, setClientDbBranchFilter] = useState('');
  const [clientDbSort, setClientDbSort] = useState('date_desc');
  const [crmContactRow, setCrmContactRow] = useState<LeadItem | null>(null);
  const [crmContactDraft, setCrmContactDraft] = useState<{ type: CommunicationRecord['type']; date: string; notes: string; outcome: string; nextFollowUp: string; newStatus: LeadStatus | ''; }>({ type: 'whatsapp', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '', newStatus: '' });

  // Auto-dedup on first load (silent — keeps oldest lead when duplicates found)
  const _dedupedRef = React.useRef(false);
  React.useEffect(() => {
    if (_dedupedRef.current || leads.length === 0) return;
    _dedupedRef.current = true;
    const sorted = [...leads].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const seenP = new Set<string>(); const seenE = new Set<string>();
    const toDelete: string[] = [];
    sorted.forEach(l => {
      const lp = (l.phone || '').replace(/\D/g, '');
      const le = (l.email || '').toLowerCase().trim();
      const pk = lp.length >= 7 ? lp : null;
      const ek = le && !le.endsWith('@lead.local') ? le : null;
      if ((pk && seenP.has(pk)) || (ek && seenE.has(ek))) {
        toDelete.push(l.id);
      } else {
        if (pk) seenP.add(pk);
        if (ek) seenE.add(ek);
      }
    });
    if (toDelete.length > 0) bulkDeleteLeads(toDelete);
  }, [leads.length > 0]);

  // Auto-convert leads that match subscriber phone/email (silent, once per mount)
  // Guard prevents re-runs that would burst 100+ saveLead calls and exhaust the rate limit.
  const _autoConvertRef = React.useRef(false);
  React.useEffect(() => {
    if (_autoConvertRef.current || leads.length === 0 || subscribers.length === 0) return;
    _autoConvertRef.current = true;
    const subPhones = new Set(subscribers.map(s => (s.phone || '').replace(/\D/g, '')).filter(p => p.length >= 7));
    const subEmails = new Set(subscribers.map(s => (s.email || '').toLowerCase().trim()).filter(e => e && !e.endsWith('@lead.local')));
    const toConvert: typeof leads = [];
    leads.forEach(l => {
      if (l.status === 'converted' && l.hidden) return;
      const lp = (l.phone || '').replace(/\D/g, '');
      const le = (l.email || '').toLowerCase().trim();
      const isSubscriber = (lp.length >= 7 && subPhones.has(lp)) || (le && !le.endsWith('@lead.local') && subEmails.has(le));
      if (isSubscriber) toConvert.push({ ...l, status: 'converted', hidden: true });
    });
    // Update local state only — no API calls. The DB already has the correct status
    // (set when the subscriber was added). Calling saveLead here would flood the rate limiter.
    if (toConvert.length > 0) markLeadsConverted(toConvert.map(l => l.id));
  }, [subscribers.length]);

  // Resizable columns (widths in px, persisted per table in localStorage)
  const subsCol    = useResizableCols('online_clients',  { name: 140, courses: 180, value: 80, paid: 80, remaining: 80, certs: 120, inst: 110, status: 80, manager: 110, contact: 130, actions: 120 });
  const staffCol   = useResizableCols('staff',        { name: 160, email: 200, phone: 140, role: 120, perms: 200, status: 80, actions: 110 });

  // Activity log filters moved to ActivityTab.tsx

  // Leads view mode: table or kanban

  // -- Saved Segments --------------------------------------------------------
  type LeadSegment = { id: string; name: string; search: string; statuses: string[]; branch: string; sales: string; course: string; followup: string };
  const [savedSegments, setSavedSegments] = useState<LeadSegment[]>(() => {
    try { return JSON.parse(localStorage.getItem('crm.savedSegments') || '[]'); } catch { return []; }
  });
  const [segmentNameInput, setSegmentNameInput] = useState('');
  const saveCurrentSegment = () => {
    if (!segmentNameInput.trim()) return;
    const seg: LeadSegment = { id: `seg-${Date.now()}`, name: segmentNameInput.trim(), search: leadsSearch, statuses: leadsStatusFilter, branch: leadsBranchFilter, sales: leadsSalesFilter, course: leadsCourseFilter, followup: leadsFollowupFilter };
    const next = [...savedSegments, seg];
    setSavedSegments(next);
    localStorage.setItem('crm.savedSegments', JSON.stringify(next));
    setSegmentNameInput('');
    setShowSaveSegment(false);
  };
  const applySegment = (seg: LeadSegment) => {
    setLeadsSearch(seg.search);
    setLeadsStatusFilter(seg.statuses);
    setLeadsBranchFilter(seg.branch as typeof leadsBranchFilter);
    setLeadsSalesFilter(seg.sales);
    setLeadsCourseFilter(seg.course);
    setLeadsFollowupFilter(seg.followup as typeof leadsFollowupFilter);
  };
  const deleteSegment = (id: string) => {
    const next = savedSegments.filter(s => s.id !== id);
    setSavedSegments(next);
    localStorage.setItem('crm.savedSegments', JSON.stringify(next));
  };

  // -- WhatsApp Templates ----------------------------------------------------
  type WaTemplate = { id: string; name: string; body: string };
  const [waTemplates, setWaTemplates] = useState<WaTemplate[]>(() => {
    try { return JSON.parse(localStorage.getItem('crm.waTemplates') || '[]'); } catch { return []; }
  });
  const [waTemplateEditId, setWaTemplateEditId] = useState('');
  const [waTemplateDraft, setWaTemplateDraft] = useState({ name: '', body: '' });
  const applyWaTemplate = (template: string, lead: typeof leads[0]) => {
    const courseIds = [...(lead.interestedCourseIds || []), ...(lead.enrolledCourseId ? [lead.enrolledCourseId] : [])];
    const courseName = courseIds.map(id => id.startsWith('bundle:') ? bundles.find(b => b.id === id.replace('bundle:', ''))?.title : (courses.find(c => c.id === id)?.title || bundles.find(b => b.id === id)?.title)).filter(Boolean)[0] || '';
    const branchObj = instituteBranches.find(b => normBranchId(b.id) === normBranchId(lead.branch));
    return template
      .replace(/\{\{name\}\}/g, lead.name || '')
      .replace(/\{\{phone\}\}/g, lead.phone || '')
      .replace(/\{\{branch\}\}/g, branchObj?.label || lead.branch || '')
      .replace(/\{\{course\}\}/g, courseName)
      .replace(/\{\{sales\}\}/g, lead.assignedSalesName || '');
  };
  const saveWaTemplate = () => {
    if (!waTemplateDraft.name.trim() || !waTemplateDraft.body.trim()) return;
    let next: WaTemplate[];
    if (waTemplateEditId) {
      next = waTemplates.map(t => t.id === waTemplateEditId ? { ...t, ...waTemplateDraft } : t);
    } else {
      next = [...waTemplates, { id: `tpl-${Date.now()}`, ...waTemplateDraft }];
    }
    setWaTemplates(next);
    localStorage.setItem('crm.waTemplates', JSON.stringify(next));
    setWaTemplateDraft({ name: '', body: '' });
    setWaTemplateEditId('');
  };
  const deleteWaTemplate = (id: string) => {
    const next = waTemplates.filter(t => t.id !== id);
    setWaTemplates(next);
    localStorage.setItem('crm.waTemplates', JSON.stringify(next));
  };
  const [leadsSalesTargets, setLeadsSalesTargets] = useState<SalesTarget[]>(() => {
    try {
      // Try content first (Firebase-persisted), fallback to localStorage for migration
      const fromContent = (window as unknown as Record<string, unknown>)['__crm_targets__'];
      if (fromContent) return fromContent as SalesTarget[];
      return JSON.parse(localStorage.getItem('crm.salesTargets') || '[]');
    } catch { return []; }
  });
  // Tag input (keyed by lead id being edited)

  // Community sub-tab
  const [communityAdminTab, setCommunityAdminTab] = useState<'pending' | 'posts' | 'library' | 'videos' | 'events' | 'comments'>('pending');

  // Join Us tab state moved to JoinUsAdminTab.tsx
  // Contacts tab state moved to ContactsTab.tsx

  // -- Automation tab state moved to AutomationTab.tsx ---------------------

  const { adminAiDraft, setAdminAiDraft, aiDevMessages, setAiDevMessages, aiDevChatEndRef } = useAdminAiAssistant(adminAiConfig);

  const menuGroups = DASHBOARD_MENU_GROUPS;

  // -------------------------------------------------------------------------

  // Content-field definitions extracted to ./dashboard/contentFields.ts (Dashboard decomposition, stage 1)

  const filteredContent = Object.entries(content).filter(([key, value]) => `${key} ${value}`.toLowerCase().includes(searchText.toLowerCase()));
  const imageLibrary = useMemo(
    () => Array.from(new Set([
      ...courses.flatMap((c) => [c.thumbnail, ...(c.galleryImages || [])]),
      ...therapists.map((t) => t.image),
      ...testimonials.map((t) => t.image),
    ].filter((item): item is string => Boolean(item)))),
    [courses, therapists, testimonials]
  );
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
      fetch(`/api/admin/hr/employees/${currentStaff.id}`, { credentials: 'include', headers: adminAuthHeaders() }).then(r => r.json()).catch(() => null),
      fetch(`/api/admin/hr/advances?staff_id=${currentStaff.id}`, { credentials: 'include', headers: adminAuthHeaders() }).then(r => r.json()).catch(() => []),
    ]).then(([hrData, advances]) => {
      if (hrData && !hrData.error) setMyHrData(hrData);
      if (Array.isArray(advances)) setMyAdvances(advances);
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
    salesOwnLeads, setSalesOwnLeads,
    salesOwnSubscribers, setSalesOwnSubscribers,
    salesOwnOrders, setSalesOwnOrders,
    salesOwnDaqqiRounds, setSalesOwnDaqqiRounds,
    onlineTeamMembers, setOnlineTeamMembers,
    salesDataLoading, setSalesDataLoading,
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
        const branchId = normBranchId(sub.branch);
        const currency = branchId === 'ONLINE_ABROAD' ? 'SAR' : 'EGP';
        const defaultBookingType = (sub.enrolledCourseIds || []).length > 0 ? 'installment' : 'new_booking';
        setSubPayDraft(createClientPaymentDraft({ currency, courseId: '' }));
        setSubPayDraft(prev => ({ ...prev, bookingType: defaultBookingType as 'new_booking'|'installment' }));
      }
    } else {
      const lead = (usesStaffScopedData ? salesOwnLeads : leads).find(l => l.id === clientId);
      if (lead) {
        const defaultCourseId = lead.interestedCourseIds?.[0] || lead.enrolledCourseId || '';
        setLeadPayRow(lead);
        setLeadPayDraft(createClientPaymentDraft({
          courseId: defaultCourseId,
          currency: (['ONLINE_SAUDI', 'ONLINE_ABROAD'].includes(normBranchId(lead.branch))) ? 'SAR' : 'EGP',
          branch: lead.branch || '',
          email: lead.email || '',
        }));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usesStaffScopedData, salesOwnSubscribers, subscribers, salesOwnLeads, leads]);

  // -- Migration: process leftover clientStatus==='leads' subscribers --
  // Clients with courses ? restore to active; clients without ? move to real leads
  const leadsTabMigrationDone = React.useRef(false);
  React.useEffect(() => {
    const allSubs = usesStaffScopedData ? salesOwnSubscribers : subscribers;
    const stale = allSubs.filter(s => s.clientStatus === 'leads');
    if (stale.length === 0 || leadsTabMigrationDone.current) return;
    leadsTabMigrationDone.current = true;
    (async () => {
      for (const sub of stale) {
        const hasCourses = (sub.enrolledCourseIds || []).length > 0;
        if (hasCourses) {
          // Return to active online clients
          const { clientStatus: _clientStatus, ...updated } = sub;
          updateSubscriber(updated);
          setSalesOwnSubscribers(prev => prev.map(s => s.id === sub.id ? updated : s));
          try { await mysqlAdmin.saveSubscriber(updated as unknown as Record<string,unknown>); } catch {}
        } else {
          // Move to real leads
          const lead: LeadItem = {
            id: `lead-mig-${sub.id}-${Date.now()}`,
            name: sub.name || '',
            email: sub.email || '',
            phone: sub.phone || '',
            source: 'محول من أونلاين',
            status: 'new' as LeadStatus,
            leadType: 'course',
            enrolledCourseId: '',
            branch: sub.branch || 'other',
            interestLevel: 'medium',
            assignedSalesId: sub.assignedCsId || '',
            assignedSalesName: '',
            communications: [],
            notes: sub.notes || '',
            createdAt: sub.createdAt || new Date().toISOString().slice(0,10),
          };
          try { await addLead(lead); } catch {}
          deleteSubscriber(sub.id);
          setSalesOwnSubscribers(prev => prev.filter(s => s.id !== sub.id));
        }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribers, salesOwnSubscribers]);

  useEffect(() => {
    void fetchSalesData();
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
  const grantSubscriber = grantSubscriberId ? subscribers.find((row) => row.id === grantSubscriberId) : undefined;
  const selectedConsultationTherapist = consultationDraft.therapistId
    ? therapists.find((row) => row.id === consultationDraft.therapistId)
    : therapists.find((row) => row.name === consultationDraft.therapistName);
  const { filteredOrders, ordersStats } = useOrdersDerived(
    branchFilteredEffectiveOrders, orderSearch, orderStatusFilter, orderTypeFilter, orderMethodFilter, orderStaffFilter, orderDateFrom, orderDateTo,
  );

  const handleConfirmOrder = (row: OrderItem) => {
    // Only admin (or manager) can confirm. Staff cannot confirm their own payment.
    if (!isAdmin && currentStaff?.role !== 'manager') {
      notify('error', 'تأكيد المدفوعات للإدارة فقط.');
      return;
    }
    if (!isAdmin && row.staffId && row.staffId === currentStaff?.id) {
      notify('error', 'فشل حفظ البيانات. تحقق من الاتصال بالإنترنت وأعد المحاولة.');
      return;
    }
    updateOrderStatus(row.id, 'paid');
  };
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
  const clientRawData = useMemo(() => {
    const getCompleteBundles = (cIds: string[]) =>
      bundles.filter(b => b.courses.length > 0 && b.courses.every(co => cIds.includes(co.id)));
    const getDisplayNames = (cIds: string[]) => {
      // Resolve any raw bundle: prefix IDs first
      const resolvedIds = cIds.flatMap(id => {
        if (id.startsWith('bundle:')) {
          const bId = id.replace('bundle:', '');
          const bObj = bundles.find(b => b.id === bId);
          return bObj ? bObj.courses.map(co => co.id) : [];
        }
        return [id];
      });
      const uniqueIds = [...new Set(resolvedIds)];
      const completeBundles = getCompleteBundles(uniqueIds);
      const hiddenCourseIds = new Set(completeBundles.flatMap(b => b.courses.map(co => co.id)));
      const visibleCourseNames = uniqueIds.filter(id => !hiddenCourseIds.has(id)).map(id => courses.find(co => co.id === id)?.title).filter(Boolean) as string[];
      // Also detect bundles referenced directly by ID (not via course expansion)
      const directBundleNames = cIds.filter(id => id.startsWith('bundle:')).map(id => {
        const bId = id.replace('bundle:', '');
        return bundles.find(b => b.id === bId)?.title || null;
      }).filter(Boolean) as string[];
      const allBundleNames = [...new Set([...completeBundles.map(b => b.title), ...directBundleNames])];
      return { courseNames: visibleCourseNames.join('? '), bundleNames: allBundleNames.join('? ') };
    };
    const rawSubs = effectiveSubs.map(s => {
      const cIds: string[] = s.enrolledCourseIds || [];
      const { courseNames: cNames, bundleNames: bNames } = getDisplayNames(cIds);
      // Normalize branch key to uppercase for consistent filtering
      const nb = normBranchId(s.branch);
      const displayBranch = nb || 'OTHER';
      return {
        id: s.id, clientCode: s.clientCode || '', name: s.name, phone: s.phone, email: s.email,
        type: 'subscriber' as const, status: 'مشترك', branch: displayBranch,
        createdAt: _normalizeClientDate(s.createdAt), enrolledCount: cIds.length,
        totalPaid: Math.round((s.paymentHistory || []).reduce((sum: number, p: { currency: string; amount: number }) =>
          sum + (p.currency === 'EGP' ? p.amount : p.currency === 'SAR' ? p.amount * 13 : p.amount * 50), 0)),
        assignedSalesName: s.assignedSalesName || '',
        assignedCsName: s.assignedCsName || '',
        courseIds: cIds, courseNames: cNames, bundleNames: bNames,
      };
    });
    const rawLeads = effectiveLeads.map(l => {
      const cIds: string[] = [...new Set([l.enrolledCourseId, ...(l.interestedCourseIds || [])].filter(Boolean) as string[])];
      const { courseNames: cNames, bundleNames: bNames } = getDisplayNames(cIds);
      // Normalize branch key to uppercase for consistent filtering
      const displayBranch = normBranchId(l.branch) || 'OTHER';
      return {
        id: l.id, clientCode: l.clientCode || '', name: l.name, phone: l.phone, email: l.email,
        type: 'lead' as const, status: l.status || 'new', branch: displayBranch,
        createdAt: _normalizeClientDate(l.createdAt), enrolledCount: 0, totalPaid: 0,
        assignedSalesName: l.assignedSalesName || '',
        assignedCsName: '',
        courseIds: cIds, courseNames: cNames, bundleNames: bNames,
      };
    });
    const subPhones = new Set(rawSubs.map(s => _normClientPhone(s.phone)).filter(p => p.length >= 7));
    const subEmails = new Set(rawSubs.map(s => _normClientEmail(s.email)).filter(e => e && !e.endsWith('@lead.local')));
    const dupLeadIds = new Set(rawLeads.filter(l => {
      const lp = _normClientPhone(l.phone);
      const le = _normClientEmail(l.email);
      return (lp.length >= 7 && subPhones.has(lp)) || (le && !le.endsWith('@lead.local') && subEmails.has(le));
    }).map(l => l.id));
    const seenLeadPhones = new Map<string, string>();
    const dupLeadPhoneIds = new Set<string>();
    rawLeads.forEach(l => {
      const lp = _normClientPhone(l.phone);
      if (lp.length >= 7) {
        if (seenLeadPhones.has(lp)) dupLeadPhoneIds.add(l.id);
        else seenLeadPhones.set(lp, l.id);
      }
    });
    const allDupIds = new Set([...dupLeadIds, ...dupLeadPhoneIds]);
    const allClients = [...rawSubs, ...rawLeads.filter(l => !allDupIds.has(l.id))];
    const isValidCC = (c: string) => !!c && /^C\d+$/.test(c) && parseInt(c.slice(1), 10) >= 10000;
    return {
      allClients,
      dupCount: allDupIds.size,
      salesOptions: [...new Set(allClients.map(c => c.assignedSalesName).filter(Boolean))] as string[],
      collectionOptions: [...new Set(allClients.map(c => c.assignedCsName).filter(Boolean))] as string[],
      courseOptions: courses.filter(co => allClients.some(c => c.courseIds.includes(co.id))),
      bundleOptions: bundles.filter(b => b.courses.length > 0 && allClients.some(c => b.courses.every(co => c.courseIds.includes(co.id)))),
      noCodeCount: allClients.filter(c => !isValidCC(c.clientCode)).length,
    };
  }, [effectiveSubs, effectiveLeads, courses, bundles]);

  // -- Client DB filtered+sorted list (only recomputes when filter state changes) -
  const clientFiltered = useMemo(() => {
    const { allClients } = clientRawData;
    const q = clientDbSearch.trim().toLowerCase();
    // Normalised digits for phone matching (strip country codes / spaces / dashes)
    const qDigits = q.replace(/\D/g, '');

    // For consultation tab: build a set of phones/emails that have a consultation
    const consultPhoneSet = clientDbTypeFilter === 'consultation'
      ? new Set(consultations.map(c => _normClientPhone(c.clientPhone || '')).filter(p => p.length >= 7))
      : null;
    const consultEmailSet = clientDbTypeFilter === 'consultation'
      ? new Set(consultations.map(c => (c.clientEmail || '').toLowerCase()).filter(Boolean))
      : null;

    return allClients.filter(c => {
      if (clientDbTypeFilter === 'subscriber' && c.type !== 'subscriber') return false;
      if (clientDbTypeFilter === 'lead' && c.type !== 'lead') return false;
      if (clientDbTypeFilter === 'consultation') {
        // Show only clients who have at least one consultation by phone or email
        const cp = _normClientPhone(c.phone);
        const ce = (c.email || '').toLowerCase();
        const hasConsult = (cp.length >= 7 && consultPhoneSet!.has(cp)) || (ce && consultEmailSet!.has(ce));
        if (!hasConsult) return false;
      }
      if (clientDbBranchFilter && normBranchId(c.branch) !== normBranchId(clientDbBranchFilter)) return false;
      if (clientDbSalesFilter && c.assignedSalesName !== clientDbSalesFilter) return false;
      if (clientDbCollectionFilter && c.assignedCsName !== clientDbCollectionFilter) return false;
      if (clientDbCourseFilter) {
        const isBundleId = bundles.some(b => b.id === clientDbCourseFilter);
        if (isBundleId) {
          const bnd = bundles.find(b => b.id === clientDbCourseFilter);
          if (!bnd || !bnd.courses.every(co => c.courseIds.includes(co.id))) return false;
        } else {
          if (!c.courseIds.includes(clientDbCourseFilter)) return false;
        }
      }
      if (!q) return true;
      // Phone: match digits anywhere in the stored phone (handles different prefixes)
      const phoneDigits = _normClientPhone(c.phone);
      const phoneMatch = qDigits.length >= 4
        ? phoneDigits.includes(qDigits) || qDigits.includes(phoneDigits.slice(-8))
        : (c.phone || '').includes(q);
      return c.name.toLowerCase().includes(q) || phoneMatch
        || (c.email || '').toLowerCase().includes(q)
        || (c.clientCode || '').toLowerCase().includes(q)
        || c.courseNames.toLowerCase().includes(q)
        || c.bundleNames.toLowerCase().includes(q);
    }).sort((a, b) => {
      if (clientDbSort === 'name_asc') return a.name.localeCompare(b.name, 'ar');
      if (clientDbSort === 'name_desc') return b.name.localeCompare(a.name, 'ar');
      if (clientDbSort === 'amount_desc') return b.totalPaid - a.totalPaid;
      if (clientDbSort === 'amount_asc') return a.totalPaid - b.totalPaid;
      if (clientDbSort === 'date_asc') return a.createdAt.localeCompare(b.createdAt);
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [clientRawData, clientDbSearch, clientDbTypeFilter, clientDbBranchFilter, clientDbSalesFilter, clientDbCollectionFilter, clientDbCourseFilter, clientDbSort, bundles, consultations]);

  const { overviewStats } = useOverviewDerived(orders, subscribers, leads, courses, staffMembers, consultations, content);

  const exportFilteredOrdersCsv = () => exportOrdersCsv(filteredOrders);
  const exportSubscribersCsv = () => exportSubscribersCsvHelper(subscribers, bundles, courses, branchLabelMap);
  const exportLeadsCsv = () => exportLeadsCsvHelper(leads);

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

  const startEditSubscriber = (row: typeof subscribers[number]) => {
    setEditingSubscriberId(row.id);
    setSubscriberDraft({
      ...row,
      enrolledCourseIds: [...row.enrolledCourseIds],
      courseAccess: normalizeCourseAccess(row.enrolledCourseIds, row.courseAccess || {}),
      lectureProgress: normalizeLectureProgress(row.enrolledCourseIds, row.lectureProgress || {}),
      paymentHistory: [...(row.paymentHistory || [])],
    });
    setActiveTab('online_clients');
  };

  const saveSubscriber = async () => {
    if (!subscriberDraft.name) return;
    const normalizedAccess = normalizeCourseAccess(subscriberDraft.enrolledCourseIds, subscriberDraft.courseAccess);
    const normalizedProgress = normalizeLectureProgress(subscriberDraft.enrolledCourseIds, subscriberDraft.lectureProgress || {});
    const payload = {
      ...subscriberDraft,
      courseAccess: normalizedAccess,
      lectureProgress: normalizedProgress,
      id: subscriberDraft.id || `s-${Date.now()}`,
      createdAt: subscriberDraft.createdAt || new Date().toISOString().slice(0, 16).replace('T', ' '),
    };
    if (editingSubscriberId) {
      updateSubscriber(payload);
    } else {
      let added: boolean;
      try {
        added = await addSubscriber(payload);
      } catch (addErr) {
        const msg = addErr instanceof Error ? addErr.message : String(addErr);
        const isDupe = msg.includes('مسجل') || msg.includes('duplicate') || msg.includes('Duplicate') || msg.includes('ER_DUP');
        notify('error', isDupe
          ? 'يوجد مشترك بنفس رقم الهاتف أو البريد الإلكتروني. تحقق من البيانات أو ابحث عنه في القائمة.'
          : `تعذر حفظ المشترك: ${msg}`);
        return;
      }
      if (!added) {
      notify('error', 'فشل حفظ البيانات. تحقق من الاتصال بالإنترنت وأعد المحاولة.');
        return;
      }
      // Create MySQL login account if email + password were supplied
      if (subscriberDraft.email.trim() && newSubscriberPassword.trim().length >= 6) {
        try {
          await mysqlAuth.register({ email: subscriberDraft.email.trim(), password: newSubscriberPassword.trim(), name: subscriberDraft.name || '' });
          notify('success', `تم إنشاء حساب دخول للعميل: ${subscriberDraft.email}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'خطأ';
          if (msg.toLowerCase().includes('exist') || msg.includes('مسجّل')) {
            notify('success', `العميل مسجّل بالفعل بهذا البريد`);
          } else {
            notify('error', `تم حفظ بيانات المشترك لكن فشل إنشاء حساب الدخول: ${msg}`);
          }
        }
      }
    }
    setEditingSubscriberId('');
    setNewSubscriberPassword('');
    setSubscriberDraft({ id: '', name: '', email: '', phone: '', enrolledCourseIds: [], courseAccess: {}, lectureProgress: {}, paymentHistory: [], status: 'active', createdAt: '' });
  };

  const openSubscriberGrantPanel = (row: typeof subscribers[number]) => {
    const enrolled = [...row.enrolledCourseIds];
    setGrantSubscriberId(row.id);
    setGrantEnrolledCourseIds(enrolled);
    setGrantCourseAccess(normalizeCourseAccess(enrolled, row.courseAccess || {}));
    setGrantPaymentAmount('');
    setGrantPaymentCurrency('EGP');
    setGrantPaymentNote('منح صلاحية مشاهدة');
  };

  const saveSubscriberGrant = () => {
    if (!grantSubscriber) return;
    const normalizedAccess = normalizeCourseAccess(grantEnrolledCourseIds, grantCourseAccess);
    const normalizedProgress = normalizeLectureProgress(grantEnrolledCourseIds, grantSubscriber.lectureProgress || {});
    const amountValue = Math.max(0, Number(grantPaymentAmount) || 0);
    const nextPaymentHistory = [...(grantSubscriber.paymentHistory || [])];
    if (amountValue > 0) {
      nextPaymentHistory.push({
        id: `pay-${Date.now()}`,
        amount: amountValue,
        currency: grantPaymentCurrency,
        note: grantPaymentNote || 'منح صلاحية مشاهدة',
        at: new Date().toISOString().slice(0, 16).replace('T', ' '),
      });
    }

    updateSubscriber({
      ...grantSubscriber,
      enrolledCourseIds: grantEnrolledCourseIds,
      courseAccess: normalizedAccess,
      lectureProgress: normalizedProgress,
      paymentHistory: nextPaymentHistory,
    });
    setGrantSubscriberId('');
    notify('success', 'تم حفظ المنح وصلاحيات المشاهدة بنجاح.');
  };

  const handleSubPayment = (draft: PaymentDraft) => {
    handleSubPaymentFn(draft, {
      subPayRow,
      subscribers,
      bundles,
      courses,
      content,
      updateSubscriber,
      notify,
      currentStaff,
      isAdmin,
    });
  };

  const openLeadBook = (row: LeadItem) => {
    setLeadPayRow(row);
    const defaultCourseId = row.interestedCourseIds?.[0] || row.enrolledCourseId || '';
    setLeadPayDraft(createClientPaymentDraft({
      courseId: defaultCourseId,
      currency: (['ONLINE_SAUDI', 'ONLINE_ABROAD'].includes(normBranchId(row.branch))) ? 'SAR' : 'EGP',
      branch: row.branch || '',
      email: row.email || '',
    }));
  };

  const handleLeadPayment = async (draft: PaymentDraft) => {
    await handleLeadPaymentFn(draft, {
      leadPayRow,
      leads,
      subscribers,
      bundles,
      courses,
      content,
      updateSubscriber,
      updateLead,
      addSubscriber,
      issueClientCodeAsync,
      branchLabelMap,
      notify,
      isAdmin,
      isSalesOnly,
      isDaqqiManager,
      isReceptionDaqqi,
      fetchSalesData,
      setActiveTab,
    });
  };

  const handleSaveCrmContact = () => {
    if (!crmContactRow || !crmContactDraft.notes.trim()) return;
    const freshLead = leads.find(l => l.id === crmContactRow.id) || crmContactRow;
    const rec: CommunicationRecord = { id: `comm-${Date.now()}`, type: crmContactDraft.type, date: crmContactDraft.date.replace('T', ' '), notes: crmContactDraft.notes, outcome: crmContactDraft.outcome || undefined, nextFollowUp: crmContactDraft.nextFollowUp || undefined };
    const updatedComms = [...(freshLead.communications || []), rec];
    const newStatus: LeadStatus = (crmContactDraft.newStatus as LeadStatus) || (freshLead.status === 'new' ? 'contacted' : freshLead.status);
    updateLead({ ...freshLead, communications: updatedComms, status: newStatus, lastFollowUp: rec.date, lastContactNote: crmContactDraft.notes, nextFollowUpDate: crmContactDraft.nextFollowUp || freshLead.nextFollowUpDate });
    setCrmContactRow(null);
    setCrmContactDraft({ type: 'whatsapp', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '', newStatus: '' });
    notify('success', 'تم تسجيل التواصل بنجاح.');
  };

  const handleSubContact = () => {
    if (!subContactRow || !subContactDraft.notes.trim()) return;
    const freshSub = (usesStaffScopedData
      ? salesOwnSubscribers.find(s => s.id === subContactRow.id)
      : subscribers.find(s => s.id === subContactRow.id)) || subContactRow;
    const rec: CommunicationRecord = {
      id: `comm-${Date.now()}`,
      type: subContactDraft.type,
      date: subContactDraft.date.replace('T', ' '),
      notes: subContactDraft.notes,
      outcome: subContactDraft.outcome || undefined,
      nextFollowUp: subContactDraft.nextFollowUp || undefined,
    };
    const updatedSub = {
      ...freshSub,
      communications: [...(freshSub.communications || []), rec],
      nextFollowUpDate: subContactDraft.nextFollowUp || freshSub.nextFollowUpDate,
      lastFollowUp: rec.date,
    };
    updateSubscriber(updatedSub);
    // For non-admin staff (collection/sales): also update local salesOwnSubscribers so table reflects the change
    if (usesStaffScopedData) {
      setSalesOwnSubscribers(prev => prev.map(s => s.id === updatedSub.id ? updatedSub : s));
    }
    setSubContactRow(null);
    setSubContactDraft({ type: 'call', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '' });
    notify('success', 'تم تسجيل التواصل بنجاح.');
  };

  const handleAddExtraCert = () => {
    if (!certActionSub || !certActionDraft.courseId || !certActionDraft.type) return;
    const freshSub = subscribers.find(s => s.id === certActionSub.id) || certActionSub;
    const reqId = `ecr-${Date.now()}`;
    const newReq: ExtraCertificateRequest = {
      id: reqId,
      type: certActionDraft.type as ExtraCertificateType,
      courseId: certActionDraft.courseId,
      status: certActionDraft.certPaid ? 'priced' : 'pending',
      requestedAt: new Date().toLocaleString('ar-EG', { hour12: false }),
      price: certActionDraft.certExpected ? Number(certActionDraft.certExpected) : undefined,
      paidAmount: certActionDraft.certPaid ? Number(certActionDraft.certPaid) : undefined,
      currency: 'EGP',
    };
    let updated = { ...freshSub, extraCertificateRequests: [...(freshSub.extraCertificateRequests || []), newReq] };
    // If a paid amount was entered, also create a payment history entry so it appears in payments tab
    if (certActionDraft.certPaid && Number(certActionDraft.certPaid) > 0) {
      const payEntry: PaymentHistoryEntry = {
        id: `cert-pay-${Date.now()}`,
        amount: Number(certActionDraft.certPaid),
        currency: 'EGP',
        paymentType: 'certificate',
        isInstallment: false,
        courseId: certActionDraft.courseId || undefined,
        note: `شهادة: ${certActionDraft.type} — طلب #${reqId}`,
        at: new Date().toISOString().slice(0, 10),
        staffId: currentStaff?.id || undefined,
        staffName: currentStaff?.name || undefined,
        status: isAdmin ? 'paid' : 'pending',
      };
      updated = { ...updated, paymentHistory: [...(freshSub.paymentHistory || []), payEntry] };
    }
    updateSubscriber(updated);
    setCertActionSub(null);
    setCertActionDraft({ courseId: '', type: '', certExpected: '', certPaid: '' });
    notify('success', 'تم إضافة طلب الشهادة بنجاح.');
  };

  // -- Quick installment plan creator from Dashboard table ------------------
  const handleDashInstCreate = () => {
    handleDashInstCreateFn({
      subInstRow,
      setSubInstRow,
      subInstDraft,
      setSubInstDraft,
      bundles,
      courses,
      updateSubscriber,
      notify,
    });
  };

  const saveLeadDraft = async () => {
    if (!leadDraft.name || !leadDraft.email) return;
    if (!leadDraft.branch) { notify('error', 'الفرع مطلوب — اختر الفرع أولاً'); return; }

    // Auto-assign to least-loaded sales rep for new leads (round-robin)
    let assignedSalesId = leadDraft.assignedSalesId || '';
    let assignedSalesName = leadDraft.assignedSalesName || '';
    if (!editingLeadId && !assignedSalesId) {
      // Sales-only users always assign to themselves so the lead appears in their own list
      if (isSalesOnly && currentStaff) {
        assignedSalesId = currentStaff.id;
        assignedSalesName = currentStaff.name;
      } else if (salesStaff.length > 0) {
        const counts = leads.reduce((acc: Record<string, number>, l) => {
          if (l.assignedSalesId) acc[l.assignedSalesId] = (acc[l.assignedSalesId] || 0) + 1;
          return acc;
        }, {});
        const sorted = [...salesStaff].sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0));
        assignedSalesId = sorted[0].id;
        assignedSalesName = sorted[0].name;
      }
    }

    const payload = {
      ...leadDraft,
      id: leadDraft.id || `l-${Date.now()}`,
      assignedSalesId,
      assignedSalesName,
      createdAt: leadDraft.createdAt || new Date().toLocaleString('ar-EG', {
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };
    if (editingLeadId) updateLead(payload); else await addLead(payload);
    setEditingLeadId('');
    setLeadDraft(blankLead());
    // For sales users: refresh salesOwnLeads so new lead appears immediately in عملائي المحتملين
    if (!editingLeadId && isSalesOnly) void fetchSalesData();
  };

  const convertLeadToSubscriber = async () => {
    const { lead, courseId, accessMode } = convertLeadModal;
    if (!lead || !courseId) return;
    // Check for existing subscriber to avoid duplicates
    const existingSub = subscribers.find((s) =>
      (lead.phone && lead.phone.length > 5 && s.phone === lead.phone) ||
      (lead.email && lead.email.length > 3 && s.email === lead.email)
    );
    if (existingSub) {
      const newCourseIds = (existingSub.enrolledCourseIds || []).includes(courseId)
        ? (existingSub.enrolledCourseIds || [])
        : [...(existingSub.enrolledCourseIds || []), courseId];
      updateSubscriber({
        ...existingSub,
        enrolledCourseIds: newCourseIds,
        courseAccess: { ...(existingSub.courseAccess ?? {}), [courseId]: { mode: accessMode } },
        paymentHistory: [...(existingSub.paymentHistory ?? []), ...(lead.paymentRecords ?? []).map((p) => ({ id: p.id, amount: p.amount, currency: p.currency, note: [p.note, p.paymentMethod, p.transactionId].filter(Boolean).join(' | ') || undefined, paymentType: p.paymentType, courseId: p.courseId || undefined, isInstallment: false, at: p.date }))],
        leadId: existingSub.leadId || lead.id,
      });
    } else {
      void addSubscriber({
        id: `sub-${Date.now()}`,
        leadId: lead.id,
        clientCode: lead.clientCode || await issueClientCodeAsync(),
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        enrolledCourseIds: [courseId],
        courseAccess: { [courseId]: { mode: accessMode } },
        branch: lead.branch,
        status: 'active',
        paymentHistory: (lead.paymentRecords ?? []).map((p) => ({ id: p.id, amount: p.amount, currency: p.currency, note: [p.note, p.paymentMethod, p.transactionId].filter(Boolean).join(' | ') || undefined, paymentType: p.paymentType, courseId: p.courseId || undefined, isInstallment: false, at: p.date })),
        createdAt: new Date().toLocaleString('ar-EG', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      });
    }
    updateLead({ ...lead, status: 'converted' });
    setConvertLeadModal({ lead: null, courseId: '', accessMode: 'full' });
  };
  const handleBulkFbUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').filter(Boolean);
      if (lines.length < 2) { setBulkUploadNotice('الملف فارغ أو غير صحيح.'); return; }
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
      const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('full_name'));
      const phoneIdx = headers.findIndex(h => h.includes('phone'));
      const emailIdx = headers.findIndex(h => h.includes('email'));
      let added = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
        const name = nameIdx >= 0 ? cols[nameIdx] : '';
        const phone = phoneIdx >= 0 ? cols[phoneIdx] : '';
        const email = emailIdx >= 0 ? cols[emailIdx] : '';
        if (!name && !phone && !email) continue;
        // Dedup: skip if phone or email already exists in leads
        const isDup = leads.some(l =>
          (phone && l.phone === phone) ||
          (email && email.length > 3 && l.email.toLowerCase() === email.toLowerCase())
        );
        if (isDup) continue;
        addLead({
          id: `fb-${Date.now()}-${i}`,
          name: name || 'عميل فيسبوك',
          email: email || '',
          phone: phone || '',
          source: 'عميل فيسبوك',
          status: 'new',
          leadType: 'course',
          enrolledCourseId: '',
          branch: 'other',
          interestLevel: 'medium',
          assignedSalesId: '',
          assignedSalesName: '',
          communications: [],
          notes: '',
          createdAt: new Date().toLocaleString('ar-EG', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        });
        added++;
      }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  // -- General CSV/Facebook lead handlers ------------------------------------
  const handleCsvFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleCsvFileChangeFn(event, {
      notify,
      setCsvHeaders,
      setCsvRows,
      setCsvMapping,
      setCsvImportOpen,
    });
  };

  const handleCsvImport = () => {
    handleCsvImportFn({
      csvRows,
      csvMapping,
      leads,
      addLead,
      notify,
      setCsvImporting,
      setCsvImportOpen,
      setCsvRows,
      setCsvHeaders,
      setCsvMapping,
      dateLocale: 'ar-EG',
      tagSeparator: /[,?|]/,
    });
  };

  const handleFetchFbForms = async () => {
    await handleFetchFbFormsFn({
      fbDraft,
      setFbSyncNotice,
      setFbFormsLoading,
      setFbAvailableForms,
    });
  };

  const handleFbApiSync = async () => {
    await handleFbApiSyncFn({
      fbDraft,
      leads,
      addLead,
      staffMembers,
      fbLeadAdsConfig,
      setFbLeadAdsConfig,
      setFbDraft,
      setFbSyncLoading,
      setFbSyncNotice,
      dateLocale: 'ar-EG',
    });
  };

  const handleSaveFbConfig = () => {
    setFbLeadAdsConfig({ ...fbDraft, updatedAt: new Date().toISOString() });
  };

  const startEditLead = (row: LeadItem) => {
    setEditingLeadId(row.id);
    setLeadDraft({ ...row });
  };

  const saveStaffMember = async () => {
    if (!staffDraft.name || !staffDraft.email) { notify('error', 'الاسم والبريد الإلكتروني مطلوبان.'); return; }
    let accountCreated = false;
    try {
      if (!editingStaffId && staffPassword.trim()) {
        // Use dedicated staff-account endpoint — creates both users + staff records atomically
        await mysqlAdmin.createStaffAccount({
          email: staffDraft.email.trim(),
          password: staffPassword.trim(),
          name: staffDraft.name.trim(),
          phone: staffDraft.phone || '',
          role: staffDraft.role || 'other',
          staffId: staffDraft.id || undefined,
        });
        accountCreated = true;
      } else if (editingStaffId && staffPassword.trim()) {
        // Update password for existing staff
        await mysqlAdmin.createStaffAccount({
          email: staffDraft.email.trim(),
          password: staffPassword.trim(),
          name: staffDraft.name.trim(),
          phone: staffDraft.phone || '',
          role: staffDraft.role || 'other',
          staffId: staffDraft.id,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'خطأ';
      if (msg.toLowerCase().includes('exist') || msg.includes('مسجّل')) {
        accountCreated = true; // already has an account
      } else {
        notify('info', `تنبيه: فشل إنشاء حساب الدخول: ${msg}. تم حفظ الموظف بدون حساب دخول.`);
      }
    }
    const payload: StaffMember = {
      ...staffDraft,
      id: staffDraft.id || `staff-${Date.now()}`,
      joinedAt: staffDraft.joinedAt || new Date().toISOString().slice(0, 10),
    };
    if (editingStaffId) updateStaffMember(payload); else addStaffMember(payload);
    setEditingStaffId('');
    setStaffDraft(blankStaffMember());
    setStaffPassword('');
    setStaffShowPassword(false);
    notify('success', editingStaffId ? 'تم تحديث بيانات الموظف.' : accountCreated ? 'تم إضافة الموظف وإنشاء حسابه بنجاح.' : 'تم إضافة الموظف.');
  };

  const sendPasswordReset = async (email: string) => {
    if (!email) { notify('error', 'البريد الإلكتروني مطلوب.'); return; }
    try {
      const tmpPw = Math.random().toString(36).slice(-8);
      await mysqlAuth.resetPassword(email, tmpPw);
      notify('success', `تم تعيين كلمة مرور مؤقتة: ${tmpPw} — يرجى تسليمها للموظف`);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'فشل تعيين كلمة المرور');
    }
  };

  const startEditStaffMember = (row: StaffMember) => {
    setEditingStaffId(row.id);
    setStaffDraft({ ...row });
  };

  const startEditConsultation = (row: typeof consultations[number]) => {
    const linkedTherapist = therapists.find((item) => item.id === row.therapistId || item.name === row.therapistName);
    setEditingConsultationId(row.id);
    setConsultationDraft({
      ...row,
      therapistId: row.therapistId || linkedTherapist?.id || '',
      therapistName: row.therapistName || linkedTherapist?.name || '',
      clientEmail: row.clientEmail || '',
      clientPhone: row.clientPhone || '',
      slotId: row.slotId || '',
      slotLabel: row.slotLabel || '',
      timezone: row.timezone || 'Africa/Cairo',
      amount: row.amount || linkedTherapist?.consultationSettings?.sessionPrice.EGP || 0,
      currency: row.currency || 'EGP',
      sessionDurationMinutes: row.sessionDurationMinutes || linkedTherapist?.consultationSettings?.sessionDurationMinutes || 50,
      meetingProvider: row.meetingProvider || linkedTherapist?.consultationSettings?.meetingProvider || 'google_meet',
      meetingLink: row.meetingLink || '',
      createdAt: row.createdAt || '',
    });
    setActiveTab('consultations');
  };

  const saveConsultation = () => {
    if (!consultationDraft.clientName || !consultationDraft.therapistId || !consultationDraft.sessionDate) {
      notify('error', 'أدخل اسم العميل والمحاضر وموعد الجلسة قبل الحفظ.');
      return;
    }
    const therapist = therapists.find((row) => row.id === consultationDraft.therapistId);
    const selectedSlot = therapist?.consultationSettings?.availableSlots.find((slot) => slot.id === consultationDraft.slotId);
    const payload: ConsultationItem = {
      ...consultationDraft,
      id: consultationDraft.id || `co-${Date.now()}`,
      therapistName: therapist?.name || consultationDraft.therapistName,
      slotLabel: selectedSlot ? formatAvailabilitySlot(selectedSlot) : consultationDraft.slotLabel,
      timezone: selectedSlot?.timezone || consultationDraft.timezone || 'Africa/Cairo',
      createdAt: consultationDraft.createdAt || new Date().toISOString().slice(0, 16).replace('T', ' '),
    };
    if (editingConsultationId) updateConsultation(payload); else addConsultation(payload);
    setEditingConsultationId('');
    setConsultationDraft({
      id: '',
      clientName: '',
      clientEmail: '',
      clientPhone: '',
      therapistId: '',
      therapistName: '',
      sessionType: 'individual',
      sessionDate: '',
      slotId: '',
      slotLabel: '',
      timezone: 'Africa/Cairo',
      status: 'pending',
      notes: '',
      amount: 0,
      currency: 'EGP',
      sessionDurationMinutes: 50,
      meetingProvider: 'google_meet',
      meetingLink: '',
      createdAt: '',
    });
  };

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
                  updateSubscriber={updateSubscriber}
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
                    addLead,
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
                    setSubInstRow,
                    setSubInstDraft,
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
                    updateSubscriber,
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
            {activeTab === 'staff_settings' && (isSalesOnly || isCollectionRole || isReceptionDaqqi) && currentStaff && (
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
