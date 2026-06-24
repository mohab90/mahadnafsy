import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ActivityTab,
  AdminAiSettingsTab,
  AnalyticsTab,
  AskAITab,
  AutomationDashboardTab,
  AutomationTab,
  BalanceSheetTab,
  BudgetTrackerTab,
  CashFlowTab,
  ClientDbTab,
  CohortAnalysisTab,
  KpiDashboardTab,
  ConsultationCalendarTab,
  ContactsTab,
  CoursesTab,
  DaqqiAttendanceTab,
  DaqqiScheduleTab,
  DaqqiTeamTab,
  DripCampaignsTab,
  EmailCampaignsTab,
  ExpenseAnalyticsTab,
  FinancialTab,
  FollowupRemindersTab,
  ForecastTab,
  HrTab,
  InstallmentPlansTab,
  IpWhitelistTab,
  JoinUsAdminTab,
  LeadScoringTab,
  LeadsTab,
  LiveStreamsTab,
  MarketingHubTab,
  MessagingAgentTab,
  MyHrTab,
  NpsDashboardTab,
  NotifInboxMgmtTab,
  NotificationsAdminTab,
  OnlineTeamMgmtTab,
  OnlineTeamTab,
  PgMigrateTab,
  QuizzesTab,
  RecurringExpensesTab,
  RetentionTab,
  RevenueForecastTab,
  RevenueSourcesTab,
  SalesGoalsTab,
  SalesHubTab,
  SalesReportsTab,
  SalesTeamTab,
  SecurityDashboardTab,
  ServerMonitorTab,
  SmsCampaignsTab,
  SmsSettingsTab,
  StaffHomeTab,
  StaffPerformanceTab,
  SubscriptionsTab,
  SystemSettingsTab,
  TasksBoardTab,
  TicketsTab,
  SupportInboxTab,
  WaitlistTab,
  WebhooksTab,
} from './dashboard/lazyTabs';
import OnlineClientsTab from './dashboard/tabs/OnlineClientsTab';
import OverviewTab from './dashboard/tabs/OverviewTab';
import CertRequestsTab from './dashboard/tabs/CertRequestsTab';
import CommunityAdminTab from './dashboard/tabs/CommunityAdminTab';
import StaffSettingsTab from './dashboard/tabs/StaffSettingsTab';
const ContentHubTab = React.lazy(() => import('./dashboard/tabs/ContentHubTab'));
import RefundRequestsTab from './dashboard/tabs/RefundRequestsTab';
const OrdersTab = React.lazy(() => import('./dashboard/tabs/OrdersTab'));
import { DASHBOARD_MENU_GROUPS, type TabKey } from './dashboard/navigation';
import { filterMenuByFeatures, parseFeatures } from './dashboard/featureFlags';
import DashboardRoleNavbar from './dashboard/DashboardRoleNavbar';
import QuickBookModal from './dashboard/QuickBookModal';
const FinancialReportsHub = React.lazy(() => import('./dashboard/FinancialReportsHub'));
const HrHub = React.lazy(() => import('./dashboard/HrHub'));
const AnalyticsHub = React.lazy(() => import('./dashboard/AnalyticsHub'));
const BranchWorkspaceHub = React.lazy(() => import('./dashboard/BranchWorkspaceHub'));
// Lazy: loaded only when their open-state becomes true (defers ~550 lines from the initial chunk)
const SalesFollowupPanel = React.lazy(() => import('./dashboard/SalesFollowupPanel'));
const DashboardMonitorPanel = React.lazy(() => import('./dashboard/DashboardMonitorPanel'));
const OnlineManagerPanels = React.lazy(() => import('./dashboard/OnlineManagerPanels'));
import { handleSubPaymentFn, handleLeadPaymentFn, handleDashInstCreateFn, normalizeCourseAccess } from './dashboard/dashboardPaymentHandlers';
import { handleCsvFileChangeFn, handleCsvImportFn, handleFetchFbFormsFn, handleFbApiSyncFn } from './dashboard/dashboardCsvFbHandlers';
import { useDashboardBadges } from './dashboard/useDashboardBadges';
import { useStaffOwnData } from './dashboard/useStaffOwnData';
import { useNotificationsBell } from './dashboard/useNotificationsBell';
import { useRoleDefaultTab } from './dashboard/useRoleDefaultTab';
import { useDashboardDerived } from './dashboard/useDashboardDerived';
import { useNavigate, useParams } from 'react-router-dom';
import { SafeHtml } from '../components/SafeHtml';
import {
  Activity,
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
  Image,
  LayoutDashboard,
  ListOrdered,
  Megaphone,
  MessageSquareText,
  Monitor,
  Plus,
  Radio,
  Save,
  Search,
  Shield,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  X,
  Video,
  Phone,
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
  TrendingUp,
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
  CalendarDays,
  ExternalLink,
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
  Settings2,
  Link2,
  Loader,
  UserSearch,
  Award,
  Hash,
  Terminal,
  Copy,
  RotateCcw,
  Sparkles,
  Calendar,
  Database,
  CheckCircle2,
  XCircle,
  Moon,
  Sun,
  LogOut,
  AlarmClock,
  Banknote,
  Target,
  Headphones,
  Flame,
  Trophy,
  User,
} from 'lucide-react';
import { Bundle, ConsultationItem, Course, DaqqiRound, DaqqiRoundAttendee, DiscountRule, ExpenseItem, NotificationBroadcast, Therapist, LeadItem, LeadStatus, StaffMember, StaffPermission, AccessMode, CourseAccessSetting, PaymentHistoryEntry, PaymentRecord, PaymentItemType, SubscriberItem, BranchType, CommunicationRecord, FacebookLeadAdsConfig, ExtraCertificateRequest, ExtraCertificateType, SalesTarget, JoinUsApplication, OrderItem, InstallmentEntry, InstallmentPlan } from '../types';
import { formatAvailabilitySlot, meetingProviderLabels } from '../lib/consultations';
import { mysqlAuth, mysqlAdmin, mysqlClient } from '../lib/mysqlapi';
import { exportOrdersCsv } from './dashboard/dashboardExports';
import { defaultFbDraft, normalizeLectureProgress } from './dashboard/dashboardHelpers';
import { useSiteData } from '../context/SiteDataContext';
import {
  ROLE_DEFAULT_PERMISSIONS as MASTER_ROLE_PERMS,
  hasPermission as masterHasPermission,
  resolvePermissions as masterResolvePermissions,
  getDefaultPermsArray,
  setRoleOverrides,
  type RoleKey,
  type PermissionKey,
} from '../constants/permissions';
import { TabErrorBoundary } from '../components/TabErrorBoundary';
import { useToast } from '../components/Toast';
import { useResizableCols } from '../components/useResizableCols';
import PaymentModal, { PaymentDraft, blankPaymentDraft } from '../components/PaymentModal';

// --- Video URL obfuscation (protects YouTube IDs from plain-text storage) ---

import {
  CertPricingTab,
  LEAD_STATUS_CFG,
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

// Branch entries stored in content['institute.branches'] as a JSON array
type BranchEntry = { id: string; label: string };
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

  // Pure derived values (inbox count + branch list/labels) — extracted to ./dashboard/useDashboardDerived
  const { inboxUnreadCount, instituteBranches, branchLabelMap } = useDashboardDerived(content, notifications);
  const toast = useToast();
  const notify = (type: 'success' | 'error' | 'info', text: string) => toast.show(text, type);

  // Show a persistent error toast whenever a MySQL save fails in SiteDataContext
  useEffect(() => {
    const handler = () => {
      notify('error', 'فشل حفظ البيانات — تحقق من الاتصال بالإنترنت وأعد المحاولة');
    };
    window.addEventListener('site-persist-error', handler);
    return () => window.removeEventListener('site-persist-error', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  const [policyDrafts, setPolicyDrafts] = useState<Record<string, string>>({});

  const [lectureCourseId, setLectureCourseId] = useState('');

  const [editingSubscriberId, setEditingSubscriberId] = useState('');
  const [subscriberSubTab, setSubscriberSubTab] = useState<'local' | 'abroad' | 'all' | 'online25'>('all');
  // Reception Daqqi role — daqqi clients tab state
  const daqqiCreateRoundRef = React.useRef<(() => void) | null>(null);
  // CS / Daqqi-old distribution UI state now lives inside OnlineClientsTab.
  const [subscriberCourseFilter, setSubscriberCourseFilter] = useState('');
  const [subscriberSearch, setSubscriberSearch] = useState('');
  const [subscriberSalesFilter, setSubscriberSalesFilter] = useState('all');
  const [subscriberCsFilter, setSubscriberCsFilter] = useState('all');
  const [subscriberInstFilter, setSubscriberInstFilter] = useState(''); // '' | 'overdue' | 'soon'
  const [subscriberRemainingFilter, setSubscriberRemainingFilter] = useState(''); // '' | '1000' | '2000' | '3000' | '5000' | '8000'
  const [subscriberCertFilter, setSubscriberCertFilter] = useState(''); // '' | 'has' | 'pending' | 'issued'
  const [subscriberPayFilter, setSubscriberPayFilter] = useState(''); // '' | 'pending'
  const [subscriberPage, setSubscriberPage] = useState(1);
  const [isSubscriberFormOpen, setIsSubscriberFormOpen] = useState(false);
  const [grantSubscriberId, setGrantSubscriberId] = useState('');
  const [grantEnrolledCourseIds, setGrantEnrolledCourseIds] = useState<string[]>([]);
  const [grantCourseAccess, setGrantCourseAccess] = useState<Record<string, CourseAccessSetting>>({});
  const [grantPaymentAmount, setGrantPaymentAmount] = useState('');
  const [grantPaymentCurrency, setGrantPaymentCurrency] = useState<'EGP' | 'SAR' | 'USD'>('EGP');
  const [grantPaymentNote, setGrantPaymentNote] = useState('منح صلاحية مشاهدة');

  // Subscriber payment modal (separate from grant)
  const [subPayRow, setSubPayRow] = useState<SubscriberItem | null>(null);
  const [subPayDraft, setSubPayDraft] = useState<PaymentDraft>(blankPaymentDraft());

  // Per-course pay detail popup
  // Extra certificate request action
  const [certActionSub, setCertActionSub] = useState<SubscriberItem | null>(null);
  const [certActionDraft, setCertActionDraft] = useState<{ courseId: string; type: ExtraCertificateType | ''; certExpected: string; certPaid: string }>({ courseId: '', type: '', certExpected: '', certPaid: '' });

  // Quick installment plan popup (from Dashboard table)
  const [subInstRow, setSubInstRow] = useState<SubscriberItem | null>(null);
  const [subInstDraft, setSubInstDraft] = useState({
    courseId: '', currency: 'EGP' as 'EGP'|'SAR'|'USD',
    amountPerInst: '', numInstallments: '3',
    inputMode: 'count' as 'count'|'amount',
    startDate: new Date().toISOString().slice(0, 10),
    intervalDays: '30', notes: '', overrideExpected: '',
  });
  // WhatsApp templates for subscribers
  const [subWaRow, setSubWaRow] = useState<SubscriberItem | null>(null);

  // Subscriber quick-contact modal
  const [subContactRow, setSubContactRow] = useState<SubscriberItem | null>(null);
  const [subContactDraft, setSubContactDraft] = useState<{
    type: CommunicationRecord['type'];
    date: string;
    notes: string;
    outcome: string;
    nextFollowUp: string;
  }>({
    type: 'call',
    date: new Date().toISOString().slice(0, 16),
    notes: '',
    outcome: '',
    nextFollowUp: '',
  });
  const [subscriberDraft, setSubscriberDraft] = useState({
    id: '',
    name: '',
    email: '',
    phone: '',
    enrolledCourseIds: [] as string[],
    courseAccess: {} as Record<string, CourseAccessSetting>,
    lectureProgress: {} as Record<string, number>,
    paymentHistory: [] as PaymentHistoryEntry[],
    status: 'active_new' as SubStatus,
    createdAt: '',
  });
  const [newSubscriberPassword, setNewSubscriberPassword] = useState('');

  const [editingLeadId, setEditingLeadId] = useState('');
  const [isLeadFormOpen, setIsLeadFormOpen] = useState(false);
  const [migratingBranches, setMigratingBranches] = useState(false);
  const [salesNotifOpen, setSalesNotifOpen] = useState(false);
  const [onlineMgrFollowupOpen, setOnlineMgrFollowupOpen] = useState(false);
  const [onlineMgrNewEventsOpen, setOnlineMgrNewEventsOpen] = useState(false);
  const [leadDraft, setLeadDraft] = useState<LeadItem>(blankLead());
  const [convertLeadModal, setConvertLeadModal] = useState<{ lead: LeadItem | null; courseId: string; accessMode: AccessMode }>({ lead: null, courseId: '', accessMode: 'full' });
  const [bulkUploadNotice, setBulkUploadNotice] = useState('');
  const bulkUploadRef = React.useRef<HTMLInputElement>(null);

  // ── Global Quick Booking FAB ─────────────────────────────────────────────
  const [quickBookOpen, setQuickBookOpen] = useState(false);
  const [quickBookSearch, setQuickBookSearch] = useState('');

  // ── Lead payment modal (unified — same design as subscriber payment modal) ─
  const [leadPayRow, setLeadPayRow] = useState<LeadItem | null>(null);
  const [leadPayDraft, setLeadPayDraft] = useState<PaymentDraft>(blankPaymentDraft());
  const [fbDraft, setFbDraft] = useState<FacebookLeadAdsConfig>(() => fbLeadAdsConfig || defaultFbDraft());
  const [fbIntegOpen, setFbIntegOpen] = useState(false);
  const [fbSyncLoading, setFbSyncLoading] = useState(false);
  const [fbSyncNotice, setFbSyncNotice] = useState('');
  const [fbFormsLoading, setFbFormsLoading] = useState(false);
  const [fbAvailableForms, setFbAvailableForms] = useState<{id: string; name: string; status: string}[]>([]);

  const [leadsSearch, setLeadsSearch] = useState('');
  const [leadsStatusFilter, setLeadsStatusFilter] = useState<string[]>([]); // empty = hide converted+hidden
  const [leadsFollowupFilter, setLeadsFollowupFilter] = useState<'all' | 'today' | 'overdue'>('all');
  const [leadsBranchFilter, setLeadsBranchFilter] = useState<'all' | string>('all');
  const [leadsSalesFilter, setLeadsSalesFilter] = useState<string>('all');
  const [leadsCourseFilter, setLeadsCourseFilter] = useState<string>('all');
  const [staffSearch, setStaffSearch] = useState('');
  const [staffRoleFilter, setStaffRoleFilter] = useState<'all' | 'instructor' | 'trainer' | 'expert' | 'sales' | 'manager' | 'admin' | 'support' | 'reception_daqqi' | 'daqqi_manager' | 'collection' | 'accountant' | 'consultant' | 'other'>('all');

  const [editingStaffId, setEditingStaffId] = useState('');
  const [isStaffFormOpen, setIsStaffFormOpen] = useState(false);
  const [staffDraft, setStaffDraft] = useState<StaffMember>(blankStaffMember());
  const [staffPassword, setStaffPassword] = useState('');
  const [staffShowPassword, setStaffShowPassword] = useState(false);
  const [staffAuthLoading, setStaffAuthLoading] = useState(false);
  const navigate = useNavigate();
  const { tab: urlTab, param: urlParam } = useParams<{ tab: string; param?: string }>();
  const [activeTabState, setActiveTabState] = useState<TabKey>((urlTab as TabKey) || 'overview');
  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem('dashboard-dark') === '1');
  const toggleDarkMode = () => setDarkMode(v => { const n = !v; localStorage.setItem('dashboard-dark', n ? '1' : '0'); return n; });
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['main', 'clients']));
  const toggleGroup = (key: string) => setOpenGroups(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const [pendingProofsCount, setPendingProofsCount] = useState(0);
  const [onlineMgrAcademyOpen, setOnlineMgrAcademyOpen] = useState(false);
  const [monitorPanel, setMonitorPanel] = useState<boolean>(false);
  // ── Horizontal dropdown nav state ──
  const [activeDropdownGroup, setActiveDropdownGroup] = useState<string|null>(null);
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null);

  // ── In-app Notifications Bell — extracted to ./dashboard/useNotificationsBell ──
  const { notifRows, setNotifRows, notifUnread, setNotifUnread, notifOpen, setNotifOpen, notifRef } = useNotificationsBell(isAdmin);

  const [onlineUsers] = useState<{ uid: string; email?: string; displayName?: string; lastActiveAt: string }[]>([]);
  // kpiModal now lives inside OverviewTab.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!urlTab) return;
    // Redirect legacy "subscribers" URL → "online_clients"
    const resolved = urlTab === 'subscribers' ? 'online_clients' : urlTab;
    if (resolved !== urlTab) { navigate(`/dashboard/online_clients`, { replace: true }); return; }
    if (resolved !== activeTabState) setActiveTabState(resolved as TabKey);
  }, [urlTab]);

  // Fetch pending payment proofs count once on mount (for sidebar badge)
  useEffect(() => {
    if (!isAdmin) return;
    Promise.resolve().then(() => {
      mysqlAdmin.listPaymentProofs('PENDING').then(rows => {
        setPendingProofsCount(Array.isArray(rows) ? rows.length : 0);
      }).catch(() => {});
    });
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
  const [isConsultationFormOpen, setIsConsultationFormOpen] = useState(false);
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


  // Orders filters/review-tab state now lives inside OrdersTab (lifted out of this hub).
  const [reviewedOrders, setReviewedOrders] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('reviewedOrders') || '[]')); } catch { return new Set(); }
  });

  // Add/Link-transfer modals + transferForm now live inside OrdersTab.

  // Discount management state

  // Notification state moved to NotificationsAdminTab.tsx

  // Quiz + LiveStream state moved to their own tab components


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

  const [leadsSalesTargets, setLeadsSalesTargets] = useState<SalesTarget[]>(() => {
    try {
      // Try content first (Firebase-persisted), fallback to localStorage for migration
      const fromContent = (window as unknown as Record<string, unknown>)['__crm_targets__'];
      if (fromContent) return fromContent as SalesTarget[];
      return JSON.parse(localStorage.getItem('crm.salesTargets') || '[]');
    } catch { return []; }
  });
  // CSV general import state
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});
  const [csvImporting, setCsvImporting] = useState(false);
  // Tag input (keyed by lead id being edited)



  // Join Us tab state moved to JoinUsAdminTab.tsx
  // Contacts tab state moved to ContactsTab.tsx

  // ── Automation tab state moved to AutomationTab.tsx ─────────────────────

  // ── Admin AI Assistant settings (separate from customer agent) ───────────
  const [adminAiDraft, setAdminAiDraft] = useState<{
    provider: string; apiKey: string; model: string; temperature: number; maxTokens: number; systemPrompt: string;
  }>(() => {
    const DEPRECATED_MODELS = ['gemini-2.0-flash'];
    try {
      const raw = localStorage.getItem('mahad-admin-ai-config');
      if (raw) {
        const saved = JSON.parse(raw) as { provider: string; apiKey: string; model: string; temperature: number; maxTokens: number; systemPrompt?: string };
        // Auto-fix deprecated model names
        if (saved.provider === 'gemini' && DEPRECATED_MODELS.includes(saved.model)) {
          saved.model = 'gemini-2.0-flash-lite';
          localStorage.setItem('mahad-admin-ai-config', JSON.stringify(saved));
        }
        return { ...saved, systemPrompt: saved.systemPrompt || '' };
      }
    } catch {}
    return { provider: 'gemini', apiKey: '', model: 'gemini-2.0-flash-lite', temperature: 0.7, maxTokens: 1500, systemPrompt: '' };
  });

  // ── Z.AI Dev Assistant ────────────────────────────────────────────────
  const [zaiDraft, setZaiDraft] = useState<{
    apiKey: string; model: string; baseUrl: string; systemPrompt: string; autoContext: boolean;
  }>(() => {
    try {
      const raw = localStorage.getItem('mahad-zai-config');
      if (raw) {
        const saved = JSON.parse(raw) as { apiKey: string; model: string; baseUrl: string; systemPrompt: string; autoContext: boolean };
        // Migrate old model names (z1-mini, z1, z1-reasoning-mini, z1-reasoning)
        const oldModels = ['z1-mini', 'z1', 'z1-reasoning-mini', 'z1-reasoning'];
        if (oldModels.includes(saved.model)) saved.model = 'GLM-4.7';
        // Migrate old base URL
        if (!saved.baseUrl || saved.baseUrl.includes('api.z.ai')) saved.baseUrl = 'https://open.bigmodel.cn/api/paas/v4';
        return saved;
      }
    } catch {}
    return { apiKey: '', model: 'GLM-4.7', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', systemPrompt: '', autoContext: false };
  });
  const [aiDevMessages, setAiDevMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem('mahad-ai-dev-messages') || '[]') as { role: 'user' | 'assistant'; text: string }[]; } catch { return []; }
  });
  const aiDevChatEndRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { localStorage.setItem('mahad-ai-dev-messages', JSON.stringify(aiDevMessages.slice(-80))); } catch { /* quota exceeded — trim further */ try { localStorage.setItem('mahad-ai-dev-messages', JSON.stringify(aiDevMessages.slice(-30))); } catch { /* silent */ } }
  }, [aiDevMessages]);

  // Sync adminAiDraft once from MySQL when adminAiConfig loads (cross-device)
  const adminAiSyncedRef = React.useRef(false);
  React.useEffect(() => {
    if (adminAiConfig && !adminAiSyncedRef.current) {
      adminAiSyncedRef.current = true;
      setAdminAiDraft({
        provider: adminAiConfig.provider || 'gemini',
        apiKey: adminAiConfig.apiKey || '',
        model: adminAiConfig.model || 'gemini-2.0-flash-lite',
        temperature: adminAiConfig.temperature ?? 0.7,
        maxTokens: adminAiConfig.maxTokens ?? 1500,
        systemPrompt: adminAiConfig.systemPrompt || '',
      });
    }
  }, [adminAiConfig]);


  // SaaS feature flags — hide disabled modules from the menu (Settings stays visible).
  // Apply RBAC role overrides from settings BEFORE the permission-based filter resolves below.
  useMemo(() => {
    try { setRoleOverrides(content['rbac.roleOverrides'] ? JSON.parse(content['rbac.roleOverrides']) : null); }
    catch { setRoleOverrides(null); }
  }, [content]);
  const menuGroups = useMemo(() => filterMenuByFeatures(DASHBOARD_MENU_GROUPS, parseFeatures(content)), [content]);

  // ─────────────────────────────────────────────────────────────────────────

  // Content-field definitions extracted to ./dashboard/contentFields.ts (Dashboard decomposition, stage 1)

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

  // For non-admin staff: load own staff record from MySQL
  const [staffSelf, setStaffSelf] = useState<import('../types').StaffMember | null>(null);
  // Start as true so non-admin staff see a spinner immediately (no flash of admin tabs before permissions load)
  const [staffSelfLoading, setStaffSelfLoading] = useState(true);
  useEffect(() => {
    if (isAdmin || !authUser?.email) return;
    setStaffSelfLoading(true);
    Promise.resolve().then(() => {
      (mysqlClient.getStaffSelf() as Promise<unknown>).then((record) => {
        if (record) {
          const s = record as import('../types').StaffMember;
          setStaffSelf({ ...s, role: (s.role || '').toLowerCase() as import('../types').StaffMember['role'], status: (s.status === 'active' || (s as any).is_active === 1) ? 'active' as const : 'inactive' as const });
        }
      }).catch(() => {/* not a staff member or not logged in */})
        .finally(() => setStaffSelfLoading(false));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, authUser?.uid]);

  // Detect if the current logged-in user is a staff member (for role-based filtering)
  const currentStaff = useMemo(() => {
    if (!authUser) return null;
    return staffMembers.find((s) => s.email.toLowerCase() === (authUser.email ?? '').toLowerCase())
      ?? staffSelf ?? null;
  }, [staffMembers, staffSelf, authUser]);
  const isSalesOnly = currentStaff?.role === 'sales';
  // Collection staff sees all subscribers but no leads — still needs own data fetch
  const isCollectionRole = (currentStaff?.role||'').toLowerCase() === 'collection';
  const isReceptionDaqqi = currentStaff?.role === 'reception_daqqi';
  const isDaqqiManager = currentStaff?.role === 'daqqi_manager';
  const isOnlineManager = (currentStaff?.role as string) === 'online_manager';
  const isSalesCollectionManager = (currentStaff?.role as string) === 'sales_collection_manager';
  // Default landing tab per role (no-op once urlTab is set) — extracted to ./dashboard/useRoleDefaultTab
  useRoleDefaultTab({ isAdmin, currentStaff, urlTab, setActiveTabState, isReceptionDaqqi, isDaqqiManager, isOnlineManager, isSalesCollectionManager });

  // ── URL: when staff_settings tab is active, reflect username in URL ──────
  useEffect(() => {
    if (activeTab === 'staff_settings' && currentStaff) {
      const username = (currentStaff.email || '').split('@')[0] || String(currentStaff.id);
      if (urlParam !== username) navigate(`/dashboard/staff_settings/${username}`, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentStaff?.id]);


  // Any non-admin staff member needs their own scoped data (not in SiteDataContext)
  // Server handles scoping via DATA_SCOPE — no need to enumerate roles here
  const isNonAdminStaff = !isAdmin && !!staffSelf;

  // ── Own-data subscriptions for non-admin staff ─────────────────────────────
  // SiteDataContext only loads CRM data for admins. Non-admin staff (sales, collection)
  // query MySQL directly.
  // Own-data subscriptions for non-admin staff — extracted to ./dashboard/useStaffOwnData.
  // The useEffect that RUNS fetchSalesData stays below at its original position, so
  // effect-execution order (vs. the migration effect) is unchanged.
  const {
    salesOwnLeads, setSalesOwnLeads,
    salesOwnSubscribers, setSalesOwnSubscribers,
    salesOwnOrders, setSalesOwnOrders,
    salesOwnDaqqiRounds, setSalesOwnDaqqiRounds,
    onlineTeamMembers, setOnlineTeamMembers,
    salesDataLoading, setSalesDataLoading,
    fetchSalesData,
  } = useStaffOwnData({
    isAdmin, isOnlineManager, staffSelf, currentStaff, bundles, courses,
    setStaffScopedSubscribers, setStaffScopedLeads, mergeContent,
  });
  // Nav notification-badge counts — extracted verbatim to ./dashboard/useDashboardBadges
  // (pure derived reads; called here so the internal useMemo order is unchanged).
  const { staffNotifBadge, onlineMgrFollowupBadge, onlineMgrNewEventsBadge } = useDashboardBadges({
    currentStaff, isNonAdminStaff, isOnlineManager, leads, salesOwnLeads, subscribers, salesOwnSubscribers,
  });

  // ── ClientDbTab booking callback — opens subPayRow or leadPayRow modal ────
  const handleClientDbBook = useCallback((clientId: string, type: 'subscriber' | 'lead') => {
    if (type === 'subscriber') {
      const sub = (isNonAdminStaff ? salesOwnSubscribers : subscribers).find(s => s.id === clientId);
      if (sub) {
        setSubPayRow(sub);
        const branchId = normBranchId(sub.branch);
        const currency = branchId === 'ONLINE_ABROAD' ? 'SAR' : 'EGP';
        const defaultBookingType = (sub.enrolledCourseIds || []).length > 0 ? 'installment' : 'new_booking';
        setSubPayDraft(blankPaymentDraft({ currency, courseId: '' }));
        setSubPayDraft(prev => ({ ...prev, bookingType: defaultBookingType as 'new_booking'|'installment' }));
      }
    } else {
      const lead = (isNonAdminStaff ? salesOwnLeads : leads).find(l => l.id === clientId);
      if (lead) {
        const defaultCourseId = lead.interestedCourseIds?.[0] || lead.enrolledCourseId || '';
        setLeadPayRow(lead);
        setLeadPayDraft(blankPaymentDraft({
          courseId: defaultCourseId,
          currency: (['ONLINE_SAUDI', 'ONLINE_ABROAD'].includes(normBranchId(lead.branch))) ? 'SAR' : 'EGP',
          branch: lead.branch || '',
          email: lead.email || '',
        }));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNonAdminStaff, salesOwnSubscribers, subscribers, salesOwnLeads, leads]);

  // ── Migration: process leftover clientStatus==='leads' subscribers ──
  // Clients with courses → restore to active; clients without → move to real leads
  const leadsTabMigrationDone = React.useRef(false);
  React.useEffect(() => {
    const allSubs = isAdmin ? subscribers : salesOwnSubscribers;
    const stale = allSubs.filter(s => s.clientStatus === 'leads');
    if (stale.length === 0 || leadsTabMigrationDone.current) return;
    leadsTabMigrationDone.current = true;
    (async () => {
      for (const sub of stale) {
        const hasCourses = (sub.enrolledCourseIds || []).length > 0;
        if (hasCourses) {
          // Return to active online clients
          const updated = { ...sub, clientStatus: undefined as any };
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
            branch: (sub.branch || 'other') as any,
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

  // fetchSalesData now lives in useStaffOwnData (above). The effect that runs it
  // stays here so its execution order relative to the migration effect is unchanged.
  useEffect(() => {
    void fetchSalesData();
  }, [fetchSalesData]);

  // Effective arrays: for non-admin roles use own-data; for admin use context
  const effectiveLeads = isNonAdminStaff ? salesOwnLeads : leads;
  const effectiveSubs = isNonAdminStaff ? salesOwnSubscribers : subscribers;
  const effectiveOrders = isNonAdminStaff ? salesOwnOrders : orders;

  const filteredSubscribers = useMemo(() => {
    setSubscriberPage(1);
    return effectiveSubs.filter((row) => {
      if (!isSalesOnly && !isAdmin && !isDaqqiManager && !isReceptionDaqqi && normBranchId(row.branch) === 'DAQQI') return false;
      // Sales staff see only subscribers linked to their own leads
      if (isSalesOnly && currentStaff) {
        const myLeadIds = new Set(effectiveLeads.map(l => l.id));
        const myEmails = new Set(effectiveLeads.map(l => l.email).filter(Boolean));
        const linked = (row.leadId && myLeadIds.has(row.leadId)) || myEmails.has(row.email);
        if (!linked) return false;
      }
      const isAbroad = normBranchId(row.branch) === 'ONLINE_SAUDI' || normBranchId(row.branch) === 'ONLINE_ABROAD';
      if (subscriberSubTab === 'local' && isAbroad) return false;
      if (subscriberSubTab === 'abroad' && !isAbroad) return false;
      const sl = subscriberSearch.toLowerCase();
      const searchDigits = subscriberSearch.replace(/\D/g, '');
      const phoneDigitMatch = searchDigits.length >= 4
        ? (row.phone || '').replace(/\D/g, '').includes(searchDigits)
        : false;
      const ms = !subscriberSearch
        || row.name.toLowerCase().includes(sl)
        || phoneDigitMatch
        || (row.phone || '').includes(subscriberSearch)
        || (row.email || '').toLowerCase().includes(sl);
      const courseMatch = !subscriberCourseFilter || (() => {
        const cids = row.enrolledCourseIds || [];
        if (subscriberCourseFilter.startsWith('bundle:')) {
          const bndId = subscriberCourseFilter.slice(7);
          const bnd = bundles.find(b => b.id === bndId);
          if (!bnd) return false;
          return bnd.courses.every(co => cids.includes(co.id));
        }
        return cids.includes(subscriberCourseFilter);
      })();
      const salesMatch = isSalesOnly || subscriberSalesFilter === 'all' || (() => {
        if (row.assignedSalesId === subscriberSalesFilter) return true;
        if (!row.leadId) return false;
        const lnkLead = effectiveLeads.find(l => l.id === row.leadId);
        return lnkLead?.assignedSalesId === subscriberSalesFilter;
      })();
      // CS / collection filter
      const csMatch = subscriberCsFilter === 'all' || row.assignedCsId === subscriberCsFilter;
      // Installment due filter
      const todayStr2 = new Date().toISOString().slice(0, 10);
      const soon3Str = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      const instMatch = !subscriberInstFilter || (() => {
        const plans = row.installmentPlans || [];
        const unpaid = plans.flatMap(p => (p.entries || []).filter(e => !e.paidAt));
        if (subscriberInstFilter === 'overdue') return unpaid.some(e => e.dueDate < todayStr2);
        if (subscriberInstFilter === 'soon') return unpaid.some(e => e.dueDate >= todayStr2 && e.dueDate <= soon3Str);
        return true;
      })();
      // Remaining amount filter
      const remainingMatch = !subscriberRemainingFilter || (() => {
        const hist = row.paymentHistory || [];
        const totalExpected = hist.filter(p => !p.isInstallment && p.courseExpected).reduce((s, p) => s + (p.courseExpected || 0), 0);
        const totalPaid = hist.filter(p => !p.isInstallment && p.currency === 'EGP').reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const remaining = Math.max(0, totalExpected - totalPaid);
        return remaining >= Number(subscriberRemainingFilter);
      })();
      // Cert filter
      const certMatch = !subscriberCertFilter || (() => {
        const reqs = row.extraCertificateRequests || [];
        const certs = row.certificates || [];
        if (subscriberCertFilter === 'has') return reqs.length > 0 || certs.length > 0;
        if (subscriberCertFilter === 'pending') return reqs.some(r => r.status === 'pending' || r.status === 'priced');
        if (subscriberCertFilter === 'issued') return reqs.some(r => r.status === 'issued') || certs.length > 0;
        return true;
      })();
      // Payment filter
      const payMatch = !subscriberPayFilter || (() => {
        if (subscriberPayFilter === 'pending') return (row.paymentHistory || []).some(p => p.status === 'pending');
        return true;
      })();
      return ms && courseMatch && salesMatch && csMatch && instMatch && remainingMatch && certMatch && payMatch;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSubs, effectiveLeads, subscriberSearch, subscriberCourseFilter, subscriberSubTab, subscriberSalesFilter, isSalesOnly, currentStaff, bundles, subscriberCsFilter, subscriberInstFilter, subscriberRemainingFilter, subscriberCertFilter, subscriberPayFilter]);
  const enabledConsultationTherapists = useMemo(
    () => therapists.filter((row) => row.consultationSettings?.enabled),
    [therapists]
  );
  const grantSubscriber = grantSubscriberId ? subscribers.find((row) => row.id === grantSubscriberId) : undefined;
  const selectedConsultationTherapist = consultationDraft.therapistId
    ? therapists.find((row) => row.id === consultationDraft.therapistId)
    : therapists.find((row) => row.name === consultationDraft.therapistName);


  const handleConfirmOrder = (row: OrderItem) => {
    // Only admin (or manager) can confirm. Staff cannot confirm their own payment.
    if (!isAdmin && currentStaff?.role !== 'manager') {
      notify('error', 'تأكيد المدفوعات للإدارة فقط.');
      return;
    }
    if (!isAdmin && row.staffId && row.staffId === currentStaff?.id) {
      notify('error', 'لا يمكنك تأكيد دفعة قمت بتسجيلها أنت.');
      return;
    }
    updateOrderStatus(row.id, 'paid');
  };
  const ordersStats = useMemo(() => {
    const paidOrders = orders.filter((row) => row.status === 'paid');
    const revenueEGP = paidOrders.filter((r) => r.currency === 'EGP').reduce((a, r) => a + r.amount, 0);
    const revenueSAR = paidOrders.filter((r) => r.currency === 'SAR').reduce((a, r) => a + r.amount, 0);
    const revenueUSD = paidOrders.filter((r) => r.currency === 'USD').reduce((a, r) => a + r.amount, 0);
    return {
      total: orders.length,
      paid: paidOrders.length,
      failed: orders.filter((row) => row.status === 'failed').length,
      refunded: orders.filter((row) => row.status === 'refunded').length,
      revenueEGP,
      revenueSAR,
      revenueUSD,
    };
  }, [orders]);

  // ── Permission helpers ─────────────────────────────────────────────────
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

  const AccessDenied: React.FC = () => (
    <div className="bg-white border border-red-200 rounded-2xl p-12 text-center">
      <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <Shield size={28} className="text-red-500" />
      </div>
      <h3 className="text-lg font-bold text-gray-900 mb-2">غير مصرح بالوصول</h3>
      <p className="text-gray-500 text-sm">ليس لديك صلاحية الوصول لهذا القسم. تواصل مع المدير لطلب الصلاحية.</p>
    </div>
  );
  // ──────────────────────────────────────────────────────────────────────

  // normalizeAr defined at module level

  // Helper: does an online25 lead have meaningful course data in notes?
  const _online25HasCourse = (l: LeadItem) => {
    if (l.source !== 'أونلاين 2025') return false;
    const m = (l.notes || '').match(/الكورس[:\s]+([^\n|]+)/);
    const hasCourse = m && m[1].trim().length > 0;
    const hasPrice = /القيمة[:\s]+[\d.]+/.test(l.notes || '');
    return hasCourse || hasPrice;
  };

  const filteredCourseLeads = useMemo(() => {
    // Sales staff see ALL their assigned leads regardless of leadType or converted status
    const base = isSalesOnly
      ? effectiveLeads
      : effectiveLeads
          // Exclude online25 clients that already have course data (they live in the online25 tab)
          .filter((l) => !_online25HasCourse(l))
          .filter((l) => l.leadType === 'course' || l.leadType === 'general' || !l.leadType);
    const filterStatuses = leadsStatusFilter.filter(s => s !== '__hidden__');
    const showHidden = leadsStatusFilter.includes('__hidden__');
    const result = base.filter((l) => {
      const sl = _normalizeAr(leadsSearch);
      const normPhone = leadsSearch.replace(/\D/g, '');
      const ms = !leadsSearch
        || _normalizeAr(l.name).includes(sl)
        || (normPhone && (l.phone || '').replace(/\D/g, '').includes(normPhone))
        || (l.phone || '').includes(leadsSearch)
        || _normalizeAr(l.email).includes(sl)
        || (l.clientCode || '').includes(leadsSearch);
      const courseMatch = leadsCourseFilter === 'all' || (() => {
        if (leadsCourseFilter.startsWith('bundle:')) {
          const bid = leadsCourseFilter.slice(7);
          const bndCourseIds = bundles.find(b => b.id === bid)?.courses.map((c: { id: string }) => c.id) || [];
          return (l.interestedCourseIds || (l.enrolledCourseId ? [l.enrolledCourseId] : [])).some(id => bndCourseIds.includes(id));
        }
        return (l.interestedCourseIds || [l.enrolledCourseId]).filter(Boolean).includes(leadsCourseFilter);
      })();
      const fToday = new Date().toISOString().slice(0, 10);
      const matchFollowup = leadsFollowupFilter === 'all'
        ? true
        : leadsFollowupFilter === 'today'
          ? l.nextFollowUpDate === fToday
          : !!(l.nextFollowUpDate && l.nextFollowUpDate < fToday && !['converted', 'lost'].includes(l.status));
      // Status/hidden filter logic
      let statusMatch: boolean;
      if (isSalesOnly) {
        statusMatch = filterStatuses.length === 0 ? true : (showHidden ? l.hidden === true : false) || filterStatuses.includes(l.status);
      } else if (leadsStatusFilter.length === 0) {
        // Default: hide converted + hidden
        statusMatch = !l.hidden && l.status !== 'converted';
      } else if (showHidden && filterStatuses.length === 0) {
        statusMatch = l.hidden === true;
      } else if (showHidden) {
        statusMatch = l.hidden === true || (!l.hidden && filterStatuses.includes(l.status));
      } else {
        statusMatch = !l.hidden && filterStatuses.includes(l.status);
      }
      return ms && statusMatch
        && (leadsBranchFilter === 'all' || normBranchId(l.branch) === normBranchId(leadsBranchFilter))
        && (leadsSalesFilter === 'all' || l.assignedSalesId === leadsSalesFilter)
        && courseMatch && matchFollowup;
    });
    // Newest first
    return result.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [effectiveLeads, isSalesOnly, leadsSearch, leadsStatusFilter, leadsFollowupFilter, leadsBranchFilter, leadsSalesFilter, leadsCourseFilter, bundles]);

  const filteredConsultLeads = useMemo(() => {
    const base = effectiveLeads.filter((l) => l.leadType === 'consultation');
    const result = base.filter((l) => {
      const sl = _normalizeAr(leadsSearch);
      const normPhone = leadsSearch.replace(/\D/g, '');
      const ms = !leadsSearch
        || _normalizeAr(l.name).includes(sl)
        || (normPhone && (l.phone || '').replace(/\D/g, '').includes(normPhone))
        || (l.phone || '').includes(leadsSearch)
        || _normalizeAr(l.email).includes(sl)
        || (l.clientCode || '').includes(leadsSearch);
      const filterStatuses2 = leadsStatusFilter.filter(s => s !== '__hidden__');
      const showHidden2 = leadsStatusFilter.includes('__hidden__');
      let statusMatch2: boolean;
      if (leadsStatusFilter.length === 0) {
        statusMatch2 = !l.hidden && l.status !== 'converted';
      } else if (showHidden2 && filterStatuses2.length === 0) {
        statusMatch2 = l.hidden === true;
      } else if (showHidden2) {
        statusMatch2 = l.hidden === true || (!l.hidden && filterStatuses2.includes(l.status));
      } else {
        statusMatch2 = !l.hidden && filterStatuses2.includes(l.status);
      }
      return ms && statusMatch2
        && (leadsBranchFilter === 'all' || normBranchId(l.branch) === normBranchId(leadsBranchFilter))
        && (leadsSalesFilter === 'all' || l.assignedSalesId === leadsSalesFilter);
    });
    // Newest first
    return result.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [effectiveLeads, leadsSearch, leadsStatusFilter, leadsBranchFilter, leadsSalesFilter]);

  const filteredStaffList = useMemo(() =>
    staffMembers.filter((s) => {
      const sl = staffSearch.toLowerCase();
      const ms = !staffSearch || s.name.toLowerCase().includes(sl) || (s.email || '').toLowerCase().includes(sl) || (s.phone || '').includes(staffSearch);
      return ms && (staffRoleFilter === 'all' || s.role === staffRoleFilter);
    }),
  [staffMembers, staffSearch, staffRoleFilter]);

  const leadsStats = useMemo(() => {
    const base = effectiveLeads;
    const total = base.length;
    const newC = base.filter((l) => l.status === 'new').length;
    const contacted = base.filter((l) => l.status === 'interested' || l.status === 'contacted').length;
    const converted = base.filter((l) => l.status === 'converted').length;
    return { total, newC, contacted, converted, rate: total > 0 ? Math.round((converted / total) * 100) : 0, courseCount: base.filter((l) => l.leadType === 'course').length };
  }, [effectiveLeads]);

  const salesStaff = useMemo(() => staffMembers.filter((s) => s.role === 'sales'), [staffMembers]);
  const csStaff = useMemo(() => staffMembers.filter((s) => { const r = (s.role||'').toLowerCase(); return r === 'support' || r === 'collection'; }), [staffMembers]);

  // ── Pre-computed maps for subscriber paid totals (avoid O(n×m) in render) ─
  const subscriberPaidTotalsMap = useMemo(() => {
    const map = new Map<string, { EGP: number; SAR: number; USD: number }>();
    effectiveSubs.forEach(sub => {
      const totals = { EGP: 0, SAR: 0, USD: 0 };
      (sub.paymentHistory || []).forEach(p => { totals[p.currency] = (totals[p.currency] || 0) + (Number(p.amount) || 0); });
      const normalizedName = sub.name.trim().toLowerCase();
      effectiveOrders.forEach(order => {
        if (order.status !== 'paid') return;
        if (order.customerName.trim().toLowerCase() !== normalizedName) return;
        totals[order.currency] = (totals[order.currency] || 0) + (Number(order.amount) || 0);
      });
      map.set(sub.id, totals);
    });
    return map;
  }, [effectiveSubs, effectiveOrders]);

  // ── Overview stats (expensive O(n×m), only recomputes when data changes) ─
  const getSubscriberPaidTotals = (row: typeof subscribers[number]) => {
    const precomputed = subscriberPaidTotalsMap.get(row.id);
    if (precomputed) return precomputed;
    // Fallback: compute directly from paymentHistory (for sales staff whose subs aren't in context)
    const totals: { EGP: number; SAR: number; USD: number } = { EGP: 0, SAR: 0, USD: 0 };
    ((row as SubscriberItem).paymentHistory || []).forEach(p => {
      const cur = (p.currency || 'EGP') as 'EGP' | 'SAR' | 'USD';
      totals[cur] = (totals[cur] || 0) + (Number(p.amount) || 0);
    });
    return totals;
  };

  // CSV export helpers extracted to ./dashboard/dashboardExports.ts (exportOrdersCsv/exportSubscribersCsv/exportLeadsCsv)


  const certPricingMap = useMemo<CertPricingMap>(() => {
    try {
      const parsed = JSON.parse(content['extra_cert_pricing'] || '{}');
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch { return {}; }
  }, [content]);

  const saveCertPricingMap = (map: CertPricingMap) => {
    setContentValue('extra_cert_pricing', JSON.stringify(map));
  };

  // ── Staff Profile Modal ────────────────────────────────────────────────────
  const [staffProfileModalId, setStaffProfileModalId] = useState<string | null>(null);

  // Cert Requests filters now live inside CertRequestsTab.

  const startEditSubscriber = (row: typeof subscribers[number]) => {
    setEditingSubscriberId(row.id);
    setIsSubscriberFormOpen(true);
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
        notify('error', 'يوجد مشترك بنفس رقم الهاتف أو البريد الإلكتروني. تحقق من البيانات أو ابحث عنه في القائمة.');
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
    setIsSubscriberFormOpen(false);
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
    handleSubPaymentFn(draft, { subPayRow, subscribers, bundles, courses, content, updateSubscriber, notify, currentStaff, isAdmin });
  };
  const openLeadBook = (row: LeadItem) => {
    setLeadPayRow(row);
    const defaultCourseId = row.interestedCourseIds?.[0] || row.enrolledCourseId || '';
    setLeadPayDraft(blankPaymentDraft({
      courseId: defaultCourseId,
      currency: (['ONLINE_SAUDI', 'ONLINE_ABROAD'].includes(normBranchId(row.branch))) ? 'SAR' : 'EGP',
      branch: row.branch || '',
      email: row.email || '',
    }));
  };

  const handleLeadPayment = async (draft: PaymentDraft) => {
    await handleLeadPaymentFn(draft, { leadPayRow, leads, subscribers, bundles, courses, content, updateSubscriber, updateLead, addSubscriber, issueClientCodeAsync, branchLabelMap, notify, isAdmin, isSalesOnly, isDaqqiManager, isReceptionDaqqi, fetchSalesData, setActiveTab });
  };
  const handleSubContact = () => {
    if (!subContactRow || !subContactDraft.notes.trim()) return;
    const freshSub = (isNonAdminStaff
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
    if (isNonAdminStaff) {
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
      requestedAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false }),
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

  // ── Quick installment plan creator from Dashboard table ──────────────────
  const handleDashInstCreate = () => {
    handleDashInstCreateFn({ subInstRow, setSubInstRow, subInstDraft, setSubInstDraft, bundles, courses, updateSubscriber, notify });
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
      createdAt: leadDraft.createdAt || new Date().toLocaleString('ar-EG-u-nu-latn', {
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
    setIsLeadFormOpen(false);
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
        createdAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
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
          createdAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        });
        added++;
      }
      setBulkUploadNotice(`تم إضافة ${added} عميل من فيسبوك.`);
      setTimeout(() => setBulkUploadNotice(''), 4000);
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  // ── General CSV Import ────────────────────────────────────────────────────
  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleCsvFileChangeFn(e, { notify, setCsvHeaders, setCsvRows, setCsvMapping, setCsvImportOpen });
  };
  const handleCsvImport = () => {
    handleCsvImportFn({ csvRows, csvMapping, leads, addLead, notify, setCsvImporting, setCsvImportOpen, setCsvRows, setCsvHeaders, setCsvMapping });
  };
  // ── Facebook Lead Ads: Fetch available forms from Graph API ───────────────
  const handleFetchFbForms = async () => {
    await handleFetchFbFormsFn({ fbDraft, setFbSyncNotice, setFbFormsLoading, setFbAvailableForms });
  };
  // ── Facebook Lead Ads: Sync leads from Graph API ──────────────────────────
  const handleFbApiSync = async () => {
    await handleFbApiSyncFn({ fbDraft, leads, addLead, staffMembers, fbLeadAdsConfig, setFbLeadAdsConfig, setFbDraft, setFbSyncLoading, setFbSyncNotice });
  };
  const handleSaveFbConfig = () => {
    setFbLeadAdsConfig({ ...fbDraft, updatedAt: new Date().toISOString() });
    setFbSyncNotice('✅ تم حفظ الإعدادات.');
    setTimeout(() => setFbSyncNotice(''), 3000);
  };

  const startEditLead = (row: LeadItem) => {
    setEditingLeadId(row.id);
    setLeadDraft({ ...row });
    setIsLeadFormOpen(true);
  };

  const saveStaffMember = async () => {
    if (!staffDraft.name || !staffDraft.email) { notify('error', 'الاسم والبريد الإلكتروني مطلوبان.'); return; }
    setStaffAuthLoading(true);
    let accountCreated = false;
    try {
      // mysqlAdmin: static import (top of file)
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
    setIsStaffFormOpen(false);
    setStaffDraft(blankStaffMember());
    setStaffPassword('');
    setStaffShowPassword(false);
    setStaffAuthLoading(false);
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
    setIsStaffFormOpen(true);
  };

  const startEditConsultation = (row: typeof consultations[number]) => {
    const linkedTherapist = therapists.find((item) => item.id === row.therapistId || item.name === row.therapistName);
    setEditingConsultationId(row.id);
    setIsConsultationFormOpen(true);
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
    setIsConsultationFormOpen(false);
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
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-100 via-white to-primary-50/30 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 text-sm">جارٍ تحميل صلاحياتك...</p>
        </div>
      </div>
    );
  }

  // Show loading overlay while admin CRM bootstrap (Batch 1) is in progress
  if (isAdmin && !remoteReady) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-100 via-white to-primary-50/30 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-14 h-14 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto" />
          <p className="text-gray-800 font-bold text-lg">جارٍ تحميل لوحة التحكم...</p>
          <p className="text-gray-400 text-sm">جارٍ تحميل بيانات CRM والمشتركين</p>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className={`min-h-screen bg-gradient-to-br from-gray-100 via-white to-primary-50/30 py-6 md:py-8${darkMode ? ' dark-dash' : ''}`}>
      <div className="container mx-auto px-4">
        {/* ── Main nav bar ── */}
        {!isSalesOnly && !isCollectionRole && !isReceptionDaqqi && !isOnlineManager && (
          <div className="relative mb-4" dir="rtl">
            {/* Single bar */}
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-2xl px-3 py-2 shadow-sm">
              {/* Brand */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-7 h-7 rounded-xl bg-primary-600 text-white grid place-items-center flex-shrink-0">
                  <Shield size={14} />
                </div>
                <div>
                  <h2 className="font-extrabold text-gray-900 text-xs leading-tight">لوحة الإدارة</h2>
                  <button onClick={() => setActiveTab('server_monitor')} className="text-[9px] flex items-center gap-0.5 hover:underline cursor-pointer" title="مراقبة السيرفر">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-emerald-600 font-bold">متصل</span>
                  </button>
                </div>
              </div>

              <div className="w-px h-5 bg-gray-200 flex-shrink-0 mx-0.5" />

              {/* Group nav buttons — scrollable */}
              <div className="flex items-center gap-0.5 overflow-x-auto flex-1 min-w-0">
                {visibleMenuGroups.map((group) => {
                  const GroupIcon = group.icon;
                  const hasActive = group.items.some(i => i.key === activeTab);
                  const isOpen = activeDropdownGroup === group.key;
                  return (
                    <button
                      key={group.key}
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                        if (isOpen) { setActiveDropdownGroup(null); setDropdownRect(null); }
                        else { setActiveDropdownGroup(group.key); setDropdownRect(r); }
                      }}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex-shrink-0 ${
                        hasActive || isOpen
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                    >
                      <GroupIcon size={13} />
                      <span>{group.label}</span>
                      <ChevronDown size={11} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                  );
                })}
              </div>

              <div className="w-px h-5 bg-gray-200 flex-shrink-0 mx-0.5" />

              {/* Monitor button — unified (sales + collection + daqqi) */}
              {(() => {
                const td = new Date().toISOString().slice(0,10);
                const salesBadge = leads.filter(l => !l.hidden && l.nextFollowUpDate && l.nextFollowUpDate <= td && !['converted','lost'].includes(l.status||'')).length;
                const collBadge = subscribers.filter(s => (s.installmentPlans||[]).some(p=>(p.entries||[]).some(e=>!e.paidAt&&e.dueDate<td))).length;
                const totalBadge = salesBadge + collBadge;
                return (
                  <button
                    onClick={() => setMonitorPanel(p => !p)}
                    title="لوحة المتابعة — سيلز · تحصيل · دقي"
                    className={`relative w-8 h-8 rounded-xl grid place-items-center transition flex-shrink-0 ${monitorPanel ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-violet-500 hover:bg-violet-50'}`}
                  >
                    <Activity size={14} />
                    {totalBadge > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold grid place-items-center leading-none">{totalBadge > 9 ? '9+' : totalBadge}</span>
                    )}
                  </button>
                );
              })()}

              {/* Controls */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={toggleDarkMode} title={darkMode ? 'وضع النهار' : 'الوضع الليلي'}
                  className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 grid place-items-center transition">
                  {darkMode ? <Sun size={14} /> : <Moon size={14} />}
                </button>
                <div className="relative flex-shrink-0" ref={notifRef}>
                  <button
                    onClick={() => {
                      setNotifOpen(o => !o);
                      if (!notifOpen && notifUnread > 0) {
                        Promise.resolve().then(() => {
                          mysqlAdmin.markAllNotificationsRead().catch(() => {});
                          setNotifUnread(0);
                          setNotifRows(rows => rows.map(r => ({ ...r, read_at: r.read_at ?? new Date().toISOString() })));
                        });
                      }
                    }}
                    className="relative w-8 h-8 rounded-xl bg-gray-100 hover:bg-primary-50 hover:text-primary-600 text-gray-500 grid place-items-center transition"
                    title="الإشعارات"
                  >
                    <Bell size={15} />
                    {notifUnread > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold grid place-items-center leading-none">{notifUnread > 9 ? '9+' : notifUnread}</span>
                    )}
                  </button>
                  {notifOpen && (
                    <div className="absolute top-10 left-0 z-[200] w-80 bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden" dir="rtl">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                        <span className="font-bold text-gray-800 text-sm">الإشعارات</span>
                        <button onClick={() => setNotifOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                      </div>
                      <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                        {notifRows.length === 0 ? (
                          <div className="text-center py-8 text-gray-400 text-sm">لا توجد إشعارات</div>
                        ) : notifRows.slice(0, 20).map(n => (
                          <div key={n.id} className={`px-4 py-3 hover:bg-gray-50 transition ${!n.read_at ? 'bg-blue-50' : ''}`}>
                            <div className="font-semibold text-gray-800 text-sm">{n.title}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{n.message}</div>
                            <div className="text-[10px] text-gray-400 mt-1">{new Date(n.created_at).toLocaleString('ar-EG-u-nu-latn')}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {/* Profile menu — personal account + job profile */}
                <details className="relative group">
                  <summary className="list-none [&::-webkit-details-marker]:hidden w-8 h-8 rounded-xl bg-gray-100 hover:bg-primary-50 hover:text-primary-600 text-gray-500 grid place-items-center transition cursor-pointer" title="حسابي">
                    <User size={15} />
                  </summary>
                  <div className="absolute top-10 left-0 z-[200] w-48 bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden" dir="rtl">
                    <button onClick={(e) => { setActiveTab('staff_home'); (e.currentTarget.closest('details') as HTMLDetailsElement)?.removeAttribute('open'); }}
                      className="w-full text-right px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                      <LayoutDashboard size={14} /> حسابي الشخصي
                    </button>
                    <button onClick={(e) => { setActiveTab('my_hr'); (e.currentTarget.closest('details') as HTMLDetailsElement)?.removeAttribute('open'); }}
                      className="w-full text-right px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 border-t border-gray-50">
                      <Briefcase size={14} /> ملفي الوظيفي
                    </button>
                  </div>
                </details>
                <button onClick={() => { mysqlAuth.logout(); navigate('/auth'); }}
                  className="w-8 h-8 rounded-xl bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 grid place-items-center transition"
                  title="تسجيل الخروج">
                  <LogOut size={14} />
                </button>
              </div>
            </div>

            {/* Dropdown panel — fixed below the clicked button */}
            {activeDropdownGroup && dropdownRect && (() => {
              const group = visibleMenuGroups.find(g => g.key === activeDropdownGroup);
              if (!group) return null;
              const GroupIcon = group.icon;
              return (
                <>
                  <div className="fixed inset-0 z-[9998]" onClick={() => { setActiveDropdownGroup(null); setDropdownRect(null); }} />
                  <div
                    className="fixed z-[9999] bg-white border border-gray-200 rounded-2xl shadow-2xl p-1.5 min-w-[220px]"
                    style={{ top: dropdownRect.bottom + 4, right: window.innerWidth - dropdownRect.right }}
                  >
                    <div className="px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-gray-400 border-b border-gray-100 mb-1 flex items-center gap-2">
                      <GroupIcon size={12} className={group.color} />
                      {group.label}
                    </div>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.key;
                      return (
                        <button
                          key={`${item.key}-${group.key}`}
                          onClick={() => { setActiveTab(item.key as TabKey); setActiveDropdownGroup(null); }}
                          aria-current={isActive ? 'page' : undefined}
                          aria-label={item.label}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-semibold transition text-right ${
                            isActive ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-primary-50 hover:text-primary-700'
                          }`}
                        >
                          <Icon size={14} className="flex-shrink-0" />
                          <span className="truncate flex-1">{item.label}</span>
                          {item.key === 'financial' && pendingProofsCount > 0 && (
                            <span className="bg-amber-500 text-white text-[10px] font-extrabold rounded-full px-1.5 leading-[18px] min-w-[18px] text-center flex-shrink-0">
                              {pendingProofsCount}
                            </span>
                          )}
                          {item.key === 'notif_inbox' && inboxUnreadCount > 0 && (
                            <span className="bg-red-500 text-white text-[10px] font-extrabold rounded-full px-1.5 leading-[18px] min-w-[18px] text-center flex-shrink-0">
                              {inboxUnreadCount > 9 ? '9+' : inboxUnreadCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 items-start">
          <section className="space-y-6 min-w-0 overflow-hidden">
            <DashboardRoleNavbar
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              isSalesOnly={isSalesOnly}
              isCollectionRole={isCollectionRole}
              isReceptionDaqqi={isReceptionDaqqi}
              isDaqqiManager={isDaqqiManager}
              isSalesCollectionManager={isSalesCollectionManager}
              isOnlineManager={isOnlineManager}
              isAdmin={isAdmin}
              currentStaff={currentStaff}
              salesDataLoading={salesDataLoading}
              staffNotifBadge={staffNotifBadge}
              onlineMgrFollowupBadge={onlineMgrFollowupBadge}
              onlineMgrNewEventsBadge={onlineMgrNewEventsBadge}
              setSalesNotifOpen={setSalesNotifOpen}
              setOnlineMgrFollowupOpen={setOnlineMgrFollowupOpen}
              setOnlineMgrNewEventsOpen={setOnlineMgrNewEventsOpen}
              onlineMgrAcademyOpen={onlineMgrAcademyOpen}
              setOnlineMgrAcademyOpen={setOnlineMgrAcademyOpen}
            />

            {(() => {
              const __tabPerm = TAB_PERMISSION_MAP[activeTab];
              // Block if tab has a required permission and staff lacks it.
              // Also block unmapped tabs for non-admins (fail-secure default).
              if (!isAdmin && (!__tabPerm || !hasPermission(__tabPerm))) return <AccessDenied />;
              return (
              <TabErrorBoundary key={activeTab} tabName={activeTab}><>

            {activeTab === 'overview' && (
              <OverviewTab
                orders={orders}
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
                isSalesOnly={isSalesOnly}
                onlineTeamMembers={onlineTeamMembers}
                onlineUsers={onlineUsers}
                notify={notify}
                setActiveTab={(tab: string) => setActiveTab(tab as TabKey)}
                navigate={navigate}
              />
            )}


            {(activeTab === 'content_hub' || activeTab === 'content' || activeTab === 'policies' ||
              activeTab === 'about_page' || activeTab === 'home_offer' || activeTab === 'footer_settings' ||
              activeTab === 'institute_gallery' ||
              ['page_courses','page_bundles','page_consultations','page_instructors','page_contact','page_joinus','page_community'].includes(activeTab)) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <ContentHubTab
                    activeTab={activeTab}
                    notify={notify}
                    policyDrafts={policyDrafts}
                    setPolicyDrafts={setPolicyDrafts}
                    instituteGalleryImages={instituteGalleryImages}
                    instituteBranches={instituteBranches}
                  />
                </TabErrorBoundary>
              </Suspense>
            )}

            {activeTab === 'cert_pricing' && (
              <CertPricingTab certPricingMap={certPricingMap} saveCertPricingMap={saveCertPricingMap} notify={notify} />
            )}

            {activeTab === 'cert_requests' && (
              <CertRequestsTab
                notify={notify}
                courses={courses}
                subscribers={subscribers}
                updateSubscriber={updateSubscriber}
              />
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

            {(activeTab === 'online_clients' || (activeTab === 'daqqi_clients' && (isDaqqiManager || isReceptionDaqqi || isAdmin))) && (
              <OnlineClientsTab
                activeTab={activeTab}
                subscribers={subscribers}
                salesOwnSubscribers={salesOwnSubscribers}
                setSalesOwnSubscribers={setSalesOwnSubscribers}
                courses={courses}
                bundles={bundles}
                staffMembers={staffMembers}
                content={content}
                salesOwnDaqqiRounds={salesOwnDaqqiRounds ?? []}
                setSalesOwnDaqqiRounds={setSalesOwnDaqqiRounds}
                salesOwnLeads={salesOwnLeads ?? []}
                updateSubscriber={updateSubscriber}
                addSubscriber={addSubscriber}
                addLead={addLead}
                deleteSubscriber={deleteSubscriber}
                notify={notify}
                isDaqqiManager={isDaqqiManager}
                isReceptionDaqqi={isReceptionDaqqi}
                isAdmin={isAdmin}
                isOnlineManager={isOnlineManager}
                isNonAdminStaff={isNonAdminStaff}
                currentStaff={currentStaff ?? null}
                staffSelf={staffSelf}
                onlineTeamMembers={onlineTeamMembers}
                setSubPayRow={setSubPayRow}
                setSubPayDraft={setSubPayDraft}
                setSubContactRow={setSubContactRow}
                setSubContactDraft={setSubContactDraft}
                setSubInstRow={setSubInstRow}
                setSubInstDraft={setSubInstDraft}
                setSubWaRow={setSubWaRow}
              />
            )}

            {activeTab === 'refund_requests' && (isCollectionRole || isOnlineManager || isAdmin) && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <RefundRequestsTab
                    notify={notify}
                    salesOwnSubscribers={salesOwnSubscribers}
                    setSalesOwnSubscribers={setSalesOwnSubscribers}
                  />
                </TabErrorBoundary>
              </Suspense>
            )}

            {activeTab === 'orders' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}>
              <TabErrorBoundary>
              <OrdersTab
                isOnlineManager={isOnlineManager}
                isDaqqiManager={isDaqqiManager}
                isAdmin={isAdmin}
                notify={notify}
                courses={courses}
                bundles={bundles}
                salesOwnSubscribers={salesOwnSubscribers}
                updateSubscriber={updateSubscriber}
                effectiveOrders={effectiveOrders}
                ordersStats={ordersStats}
                currentStaff={currentStaff}
                authUser={authUser ?? null}
                content={content}
                updateOrderStatus={updateOrderStatus}
                addOrder={addOrder}
                deleteOrder={deleteOrder}
              />
              </TabErrorBoundary>
              </Suspense>
            )}


            {activeTab === 'financial' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <FinancialTab notify={notify} onNavigateTab={(tab) => setActiveTab(tab as TabKey)} />
              </Suspense>
            )}
            {activeTab === 'daqqi_accounting' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary><FinancialTab notify={notify} branchFilter="daqqi" onNavigateTab={(tab) => setActiveTab(tab as TabKey)} /></TabErrorBoundary>
              </Suspense>
            )}
            {activeTab === 'financial_reports' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary><FinancialReportsHub notify={notify} /></TabErrorBoundary>
              </Suspense>
            )}
            {activeTab === 'hr_hub' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary><HrHub notify={notify} /></TabErrorBoundary>
              </Suspense>
            )}
            {activeTab === 'analytics_hub' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary><AnalyticsHub notify={notify} /></TabErrorBoundary>
              </Suspense>
            )}
            {activeTab === 'branch_workspace' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary><BranchWorkspaceHub notify={notify} onNavigateTab={(tab) => setActiveTab(tab as TabKey)} /></TabErrorBoundary>
              </Suspense>
            )}

            {activeTab === 'contacts' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <ContactsTab />
              </Suspense>
            )}

            {activeTab === 'consultations' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"/></div>}><TabErrorBoundary><ConsultationCalendarTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'client' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"/></div>}><TabErrorBoundary><ClientDbTab notify={notify} onBook={handleClientDbBook} /></TabErrorBoundary></Suspense>)}

            {/* ═══════════════════════════════════════════════════════════════════
                NOTIFICATIONS TAB — إشعارات المشتركين (broadcast)
            ═══════════════════════════════════════════════════════════════════ */}

            {(onlineMgrFollowupOpen || onlineMgrNewEventsOpen) && (
              <Suspense fallback={null}>
                <OnlineManagerPanels
                  onlineMgrFollowupOpen={onlineMgrFollowupOpen}
                  setOnlineMgrFollowupOpen={setOnlineMgrFollowupOpen}
                  onlineMgrNewEventsOpen={onlineMgrNewEventsOpen}
                  setOnlineMgrNewEventsOpen={setOnlineMgrNewEventsOpen}
                  isNonAdminStaff={isNonAdminStaff}
                  salesOwnSubscribers={salesOwnSubscribers}
                  setActiveTab={setActiveTab}
                />
              </Suspense>
            )}

            {salesNotifOpen && (
              <Suspense fallback={null}>
                <SalesFollowupPanel
                  salesNotifOpen={salesNotifOpen}
                  setSalesNotifOpen={setSalesNotifOpen}
                  isNonAdminStaff={isNonAdminStaff}
                  isAdmin={isAdmin}
                  isSalesOnly={isSalesOnly}
                  currentStaff={currentStaff}
                  salesOwnLeads={salesOwnLeads}
                  setLeadsFollowupFilter={(f: string) => setLeadsFollowupFilter(f as 'all' | 'today' | 'overdue')}
                  setActiveTab={setActiveTab}
                />
              </Suspense>
            )}

            {activeTab === 'notifications' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <NotificationsAdminTab />
              </Suspense>
            )}

            {/* ═══ COMMUNITY TAB ═══ */}
            {activeTab === 'community' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary tabName="المجتمع">
                  <CommunityAdminTab notify={notify} />
                </TabErrorBoundary>
              </Suspense>
            )}

            {/* ═══ JOIN US TAB ═══ */}
            {activeTab === 'join_us' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <JoinUsAdminTab />
              </Suspense>
            )}

            {activeTab === 'activity' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" /></div>}>
                <ActivityTab isSalesOnly={isSalesOnly} />
              </Suspense>
            )}

            {/* ═══════════════════════════════════════════════════════════════════
                ASK AI TAB — اسأل AI عن أي شيء في السيستم
            ═══════════════════════════════════════════════════════════════════ */}
            {activeTab === 'ask_ai' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <AskAITab notify={notify} />
              </Suspense>
            )}

            {/* ══════════════════════════════════════════════════════════════
                AUTOMATION TAB — Workflow Builder (extracted to AutomationTab.tsx)
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'automation' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <AutomationTab notify={notify} setActiveTab={(tab) => setActiveTab(tab as TabKey)} />
              </Suspense>
            )}
            {/* ══════════════════════════════════════════════════════════════
                MESSAGING AGENT TAB — Channel Configuration
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'messaging_agent' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <MessagingAgentTab notify={notify} />
              </Suspense>
            )}

            {/* ══════════════════════════════════════════════════════════════
                ADMIN AI SETTINGS TAB
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'admin_ai_settings' && (
              <Suspense fallback={<div className="text-center py-8 text-gray-400">جاري التحميل...</div>}>
                <AdminAiSettingsTab notify={notify} />
              </Suspense>
            )}

            {/* ══════════════════════════════════════════════════════════════
                POSTGRESQL MIGRATION TAB
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'pg_migrate' && (isAdmin || hasPermission('manage_staff')) && (
              <Suspense fallback={<div className="p-8 text-center text-gray-400">جاري التحميل...</div>}>
                <PgMigrateTab />
              </Suspense>
            )}

            {/* ══════════════════════════════════════════════════════════════
                SERVER MONITOR TAB
            ══════════════════════════════════════════════════════════════ */}
            {activeTab === 'server_monitor' && isAdmin && (
              <Suspense fallback={<div className="p-8 text-center text-gray-400">جاري التحميل...</div>}>
                <TabErrorBoundary>
                  <ServerMonitorTab notify={notify} />
                </TabErrorBoundary>
              </Suspense>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                LEADS TAB — العملاء المحتملون
            ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'leads' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <LeadsTab
                    notify={notify}
                    staffSelf={staffSelf}
                    salesOwnLeads={salesOwnLeads}
                    salesOwnSubscribers={salesOwnSubscribers}
                    salesDataLoading={salesDataLoading}
                    fetchSalesData={fetchSalesData}
                    setActiveTab={(tab: string) => setActiveTab(tab as TabKey)}
                  />
                </TabErrorBoundary>
              </Suspense>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                DAQQI SCHEDULE TAB — جدول الدقي
            ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'daqqi_attendance' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <DaqqiAttendanceTab notify={(msg: string, t?: 'success' | 'error') => notify(t === 'error' ? 'error' : 'success', msg)} />
                </TabErrorBoundary>
              </Suspense>
            )}

            {activeTab === 'daqqi_schedule' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <DaqqiScheduleTab
                    notify={notify}
                    subscribersOverride={isNonAdminStaff ? salesOwnSubscribers : undefined}
                    roundsOverride={isNonAdminStaff && salesOwnDaqqiRounds ? salesOwnDaqqiRounds : undefined}
                    hideCreateRound={isReceptionDaqqi}
                    requirePaymentApproval={isReceptionDaqqi}
                  />
                </TabErrorBoundary>
              </Suspense>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                SALES HUB — مركز المبيعات الموحد
            ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'sales_hub' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <SalesHubTab
                    notify={notify}
                    salesTargets={leadsSalesTargets}
                    onOpenStaffProfile={(staffId) => {
                      setStaffProfileModalId(staffId);
                    }}
                  />
                </TabErrorBoundary>
              </Suspense>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                MARKETING HUB — مركز التسويق
            ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'marketing_hub' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <MarketingHubTab notify={notify} />
                </TabErrorBoundary>
              </Suspense>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                ONLINE HUB — مركز الأونلاين والتحصيل
            ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'online_hub' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <OnlineTeamTab notify={notify} />
                </TabErrorBoundary>
              </Suspense>
            )}

            {/* ════ QUIZZES TAB ════ */}
            {activeTab === 'quizzes' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <QuizzesTab notify={notify} />
              </Suspense>
            )}

            {/* ════ LIVE STREAMS TAB ════ */}
            {activeTab === 'staff_settings' && (isSalesOnly || isCollectionRole || isReceptionDaqqi) && currentStaff && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <TabErrorBoundary>
                  <StaffSettingsTab notify={notify} currentStaff={currentStaff} salesOwnSubscribers={salesOwnSubscribers} />
                </TabErrorBoundary>
              </Suspense>
            )}

            {activeTab === 'live_streams' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <LiveStreamsTab notify={notify} />
              </Suspense>
            )}

            {activeTab === 'staff_applications' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><JoinUsAdminTab /></TabErrorBoundary></Suspense>)}
            {activeTab === 'lecturer_applications' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><JoinUsAdminTab /></TabErrorBoundary></Suspense>)}
            {/* saas_settings + rbac_settings consolidated into the unified Settings page (legacy URLs still resolve here) */}
            {['system_settings','saas_settings','rbac_settings'].includes(activeTab) && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SystemSettingsTab notify={notify} isAdmin={isAdmin} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'staff_performance' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><StaffPerformanceTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'retention' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><RetentionTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'cohort_analysis' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><CohortAnalysisTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'kpi_dashboard' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><KpiDashboardTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'forecast' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><ForecastTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'sales_team' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SalesTeamTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'sales_reports' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SalesReportsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'sales_goals' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SalesGoalsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'online_team' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><OnlineTeamMgmtTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'subscriptions' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SubscriptionsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'lead_scoring' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><LeadScoringTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'consultation_calendar' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><ConsultationCalendarTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'expense_analytics' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><ExpenseAnalyticsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'revenue_sources' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><RevenueSourcesTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'my_hr' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><MyHrTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'automation_dashboard' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><AutomationDashboardTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'ip_whitelist' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><IpWhitelistTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'sms_settings' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SmsSettingsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'notif_inbox' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><NotifInboxMgmtTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'email_campaigns' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><EmailCampaignsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'sms_campaigns' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SmsCampaignsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'drip_campaigns' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><DripCampaignsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'staff_home' && (
              currentStaff ? (
                <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}>
                  <TabErrorBoundary>
                    <StaffHomeTab
                      staff={currentStaff}
                      leads={isNonAdminStaff ? salesOwnLeads : leads}
                      subscribers={isNonAdminStaff ? salesOwnSubscribers : subscribers}
                      notify={notify}
                      onNavigate={(tab) => setActiveTabState(tab as TabKey)}
                    />
                  </TabErrorBoundary>
                </Suspense>
              ) : (
                <div className="bg-white border border-gray-200 rounded-2xl p-16 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-gray-100 grid place-items-center mx-auto mb-4"><User size={28} className="text-gray-300" /></div>
                  <h3 className="text-lg font-extrabold text-gray-700 mb-2">البوابة الشخصية للموظفين</h3>
                  <p className="text-gray-400 text-sm">هذه الصفحة مخصّصة لحسابات الموظفين. حسابك (مدير) لا يملك ملفاً وظيفياً مرتبطاً.</p>
                </div>
              )
            )}

            {/* ── Restored tab renders (were imported in lazyTabs + present in menu but missing here → blank pages) ── */}
            {activeTab === 'hr' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><HrTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'tickets' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><TicketsTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'support_inbox' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SupportInboxTab onOpen={(t) => setActiveTab(t as typeof activeTab)} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'waitlist' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><WaitlistTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'tasks_board' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><TasksBoardTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'nps_dashboard' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><NpsDashboardTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'security_dashboard' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><SecurityDashboardTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'balance_sheet' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><BalanceSheetTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'cash_flow' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><CashFlowTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'revenue_forecast' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><RevenueForecastTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'installment_plans' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><InstallmentPlansTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'recurring_expenses' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><RecurringExpensesTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'budget_tracker' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><BudgetTrackerTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'daqqi_team' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><DaqqiTeamTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'followup_reminders' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><FollowupRemindersTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {activeTab === 'webhooks' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><WebhooksTab notify={notify} /></TabErrorBoundary></Suspense>)}
            {/* daqqi_stats → reuse the Daqqi attendance + monthly-stats view */}
            {activeTab === 'daqqi_stats' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><DaqqiAttendanceTab notify={(msg: string, t?: 'success' | 'error') => notify(t === 'error' ? 'error' : 'success', msg)} /></TabErrorBoundary></Suspense>)}
            {/* staff_management → reuse the all-staff performance/overview view */}
            {activeTab === 'staff_management' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"/></div>}><TabErrorBoundary><StaffPerformanceTab notify={notify} /></TabErrorBoundary></Suspense>)}

            {/* ── Placeholder tabs (قيد الإنشاء) — no dedicated component yet ── */}
            {([] as TabKey[]).includes(activeTab) && (
              <div className="bg-white border border-gray-200 rounded-2xl p-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 grid place-items-center mx-auto mb-4">
                  <Settings2 size={28} className="text-gray-300" />
                </div>
                <h3 className="text-lg font-extrabold text-gray-700 mb-2">قيد الإنشاء</h3>
                <p className="text-gray-400 text-sm">هذا القسم سيكون متاحاً قريباً</p>
              </div>
            )}

              </>
              </TabErrorBoundary>
              );
            })()}
          </section>
        </div>
      </div>

      <QuickBookModal
        quickBookOpen={quickBookOpen}
        setQuickBookOpen={setQuickBookOpen}
        quickBookSearch={quickBookSearch}
        setQuickBookSearch={setQuickBookSearch}
        setLeadPayRow={setLeadPayRow}
        setLeadPayDraft={setLeadPayDraft}
        setSubPayRow={setSubPayRow}
        setSubPayDraft={setSubPayDraft}
      />

    </div>

    {monitorPanel && (
      <Suspense fallback={null}>
        <DashboardMonitorPanel monitorPanel={monitorPanel} setMonitorPanel={setMonitorPanel} />
      </Suspense>
    )}

    {/* ══════════════════════════════════════════════════════════════
        GLOBAL LEAD PAYMENT MODAL — used by ClientDbTab + QuickBook
    ══════════════════════════════════════════════════════════════ */}
    {leadPayRow && (
      <PaymentModal
        mode="lead"
        subject={{
          id: leadPayRow.id,
          name: leadPayRow.name,
          phone: leadPayRow.phone,
          branch: leadPayRow.branch,
          email: leadPayRow.email,
        }}
        draft={leadPayDraft}
        setDraft={setLeadPayDraft}
        onSubmit={(d) => { void handleLeadPayment(d); }}
        onClose={() => setLeadPayRow(null)}
        branchOptions={instituteBranches.map(b => ({ id: b.id, label: b.label }))}
        instituteName={content['institute.name'] || 'مهاد نفسي'}
      />
    )}

    {/* ══════════════════════════════════════════════════════════════
        GLOBAL SUBSCRIBER PAYMENT MODAL — used by ClientDbTab + QuickBook
    ══════════════════════════════════════════════════════════════ */}
    {subPayRow && (
      <PaymentModal
        mode="subscriber"
        subject={{
          id: subPayRow.id,
          name: subPayRow.name,
          phone: subPayRow.phone,
          enrolledCourseIds: subPayRow.enrolledCourseIds,
          paymentHistory: subPayRow.paymentHistory,
          extraCertificateRequests: subPayRow.extraCertificateRequests,
          branch: subPayRow.branch,
          email: subPayRow.email,
        }}
        draft={subPayDraft}
        setDraft={setSubPayDraft}
        onSubmit={(d) => { handleSubPayment(d); }}
        onClose={() => setSubPayRow(null)}
        instituteName={content['institute.name'] || 'مهاد نفسي'}
        requirePaymentApproval={isReceptionDaqqi}
      />
    )}
    </>
  );
};

export default Dashboard;
