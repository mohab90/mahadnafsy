import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminAuthHeaders } from '../lib/adminAuthHeaders';

import {
  ActivityTab,
  AnalyticsTab,
  AutomationDashboardTab,
  BalanceSheetTab,
  BudgetTrackerTab,
  CashFlowTab,
  CohortAnalysisTab,
  ConsultationCalendarTab,
  CoursesTab,
  DaqqiAttendanceTab,
  DaqqiTeamTab,
  DripCampaignsTab,
  EmailCampaignsTab,
  ExpenseAnalyticsTab,
  FollowupRemindersTab,
  ForecastTab,
  HrTab,
  InstallmentPlansTab,
  IpWhitelistTab,
  KpiDashboardTab,
  LeadScoringTab,
  LiveStreamsTab,
  MyHrTab,
  NpsDashboardTab,
  NotifInboxMgmtTab,
  NotificationsAdminTab,
  OnlineTeamMgmtTab,
  QuizzesTab,
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
import { DASHBOARD_MENU_GROUPS, type TabKey } from './dashboard/navigation';
import { branchMatchesFilter, branchSlugToFilter } from './dashboard/branchWorkspaceFilters';
import {
  aboutPageFields, homeOfferFields, policySections,
} from './dashboard/contentFields';
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
import { TabErrorBoundary } from '../../shared/ui/TabErrorBoundary';
import { useToast } from '../../shared/ui/Toast';
import { useResizableCols } from '../components/useResizableCols';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { SiteDataStoreBridge } from '../stores/SiteDataStoreBridge';
import type { PaymentDraft } from '../components/PaymentModal';
import { createClientPaymentDraft } from '../lib/clientActionDrafts';
import { contentHubRouteTabs, directContentTabs, growthOpsTabs, saasOpsTabs } from './dashboard/dashboardTabGroups';
import { priceForCurrency, staffStatusFromWire, translatePayMethod, type StaffWire } from './dashboard/dashboardHelpers';
import { defaultFacebookLeadAdsConfig } from './dashboard/facebookLeadAdsDefaults';
import { useStaffRoleRedirects } from './dashboard/hooks/useStaffRoleRedirects';
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
  PaymentModal,
} from './dashboard/lazyDashboardComponents';

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
  const [searchParams] = useSearchParams();
  const branchQueryFilter = branchSlugToFilter(searchParams.get('branch'));

  const inboxUnreadCount = useMemo(() =>
    notifications.filter(n => !n.isRead).length,
    [notifications]
  );

  // branch label map from admin settings
  const instituteBranches = useMemo(() => {
    try {
      const parsed = JSON.parse(content['institute.branches'] || '[]');
      return Array.isArray(parsed) ? parsed as BranchEntry[] : [];
    } catch { return [] as BranchEntry[]; }
  }, [content]);
  const branchLabelMap = useMemo((): Record<string, string> => {
    const base = Object.fromEntries(instituteBranches.flatMap(b => [
      [b.id, b.label],
      [normBranchId(b.id), b.label],
    ]));
    // Legacy / un-normalized values that may still appear in DB or old records
    return {
      ...base,
      'online-egypt':        base['ONLINE_EGYPT']  || 'أونلاين مصر',
      'online-saudi':        base['ONLINE_SAUDI']  || 'أونلاين السعودية',
      'online-abroad':       base['ONLINE_ABROAD'] || 'أونلاين خارج مصر',
      'online-26':           base['ONLINE_EGYPT']  || 'أونلاين مصر',
      'daqqi':               base['DAQQI']         || 'دقي',
      'tagamoa':             base['TAGAMOA']       || 'التجمع',
      'other':               'أخرى',
      'اون_لاين_داخل_مصر':  base['ONLINE_EGYPT']  || 'أونلاين مصر',
      'اونلاين_داخل_مصر':   base['ONLINE_EGYPT']  || 'أونلاين مصر',
    };
  }, [instituteBranches]);

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

  const [searchText, setSearchText] = useState('');
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



  const [newContentKey, setNewContentKey] = useState('');
  const [newContentValue, setNewContentValue] = useState('');
  const [contentEdits, setContentEdits] = useState<Record<string, string>>({}); // local drafts for the All-Content tab
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, string>>({});
  const [offerSelectedCourseId, setOfferSelectedCourseId] = useState(() => content['offer.courseId'] || '');
  useEffect(() => {
    if (content['offer.courseId']) setOfferSelectedCourseId(content['offer.courseId']);
  }, [content['offer.courseId']]);
  const [instituteGalleryUrlInput, setInstituteGalleryUrlInput] = useState('');
  const instituteGalleryUploadRef = useRef<HTMLInputElement | null>(null);

  const [lectureCourseId, setLectureCourseId] = useState('');

  const [editingSubscriberId, setEditingSubscriberId] = useState('');
  const [subscriberSubTab, setSubscriberSubTab] = useState<'local' | 'abroad' | 'all' | 'online25'>('all');
  const [salesSubscriberSubTab, setSalesSubscriberSubTab] = useState<'all' | 'daqqi' | 'local' | 'abroad' | 'qatameya'>('all');
  const [salesSubSearch, setSalesSubSearch] = useState('');
  // Reception Daqqi role — daqqi clients tab state
  const [daqqiSubSearch, setDaqqiSubSearch] = useState('');
  const [daqqiSubPage, setDaqqiSubPage] = useState(1);
  const [daqqiStatusFilter, setDaqqiStatusFilter] = useState('');
  const [daqqiDateFrom, setDaqqiDateFrom] = useState('');
  const [daqqiDateTo, setDaqqiDateTo] = useState('');
  const [daqqiRemainingFilter, setDaqqiRemainingFilter] = useState<'all'|'has_remaining'|'paid'>('all');
  const [daqqiCourseFilter, setDaqqiCourseFilter] = useState('');
  const [daqqiSubTab, setDaqqiSubTab] = useState<'all'|'assigned'|'unassigned'>('all');
  const [daqqiAccDateFrom, setDaqqiAccDateFrom] = useState('');
  const [daqqiAccDateTo, setDaqqiAccDateTo] = useState('');
  const [daqqiAccView, setDaqqiAccView] = useState<'daily'|'by_course'|'by_method'|'by_staff'|'payments'>('daily');
  const [daqqiTaskinSub, setDaqqiTaskinSub] = useState<SubscriberItem | null>(null);
  const daqqiCreateRoundRef = React.useRef<(() => void) | null>(null);
  const [daqqiAddClientOpen, setDaqqiAddClientOpen] = useState(false);
  const [daqqiAddClientDraft, setDaqqiAddClientDraft] = useState({ name: '', phone: '', email: '', courseId: '', nationalId: '', gender: '', notes: '' });
  const [salesSubDateFrom, setSalesSubDateFrom] = useState('');
  const [salesSubDateTo, setSalesSubDateTo] = useState('');
  const [salesSubContactRow, setSalesSubContactRow] = useState<SubscriberItem | null>(null);
  const [salesSubContactNote, setSalesSubContactNote] = useState('');
  const [staffWaTemplates, setStaffWaTemplates] = useState<{ id: string; title: string; body: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem('sales.waTemplates') || '[]'); } catch { return []; }
  });
  const [staffWaTemplateEdit, setStaffWaTemplateEdit] = useState<{ id: string; title: string; body: string } | null>(null);
  const [staffContactTags, setStaffContactTags] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('sales.customTags') || '[]'); } catch { return []; }
  });
  const [staffNewTagInput, setStaffNewTagInput] = useState('');
  const [staffSettingsDraft, setStaffSettingsDraft] = useState<{ name: string; phone: string; image: string; waNumber: string; monthlyTarget: string } | null>(null);
  const [staffSettingsSaving, setStaffSettingsSaving] = useState(false);
  // HR self-service state
  const [myHrData, setMyHrData] = useState<{
    staff: { hire_date: string | null; department_name: string | null; employment_type: string | null; joined_at: string | null };
    salary: { base_salary: number; housing_allowance: number; transport_allowance: number } | null;
    commission: { thisMonth: { total: number; count: number } | null };
    attendance: { present_days: number; absent_days: number; late_days: number; total_late_minutes: number };
    leaveBalance: { annualEntitlement: number; usedDays: number; remaining: number };
    leaveHistory: { id: string; type: string; status: string; start_date: string; end_date: string; total_days: number; reason: string; approved_by_name: string | null }[];
    kpi: { leads_assigned: number; leads_converted: number; revenue_generated: number };
  } | null>(null);
  const [loadingMyHr, setLoadingMyHr] = useState(false);
  const [myAdvances, setMyAdvances] = useState<{ id: string; amount: number; currency: string; reason: string | null; status: string; created_at: string }[]>([]);
  const [showAdvanceForm, setShowAdvanceForm] = useState(false);
  const [advanceDraft, setAdvanceDraft] = useState({ amount: '', reason: '' });
  const [submittingAdvance, setSubmittingAdvance] = useState(false);
  const [showMyLeaveFormProfile, setShowMyLeaveFormProfile] = useState(false);
  const [myLeaveFormProfile, setMyLeaveFormProfile] = useState({ type: 'ANNUAL', start_date: '', end_date: '', reason: '' });
  const [submittingMyLeaveProfile, setSubmittingMyLeaveProfile] = useState(false);
  const [o25Search, setO25Search] = useState('');
  const [o25Page, setO25Page] = useState(1);
  const [o25Distributing, setO25Distributing] = useState(false);
  const [subCsDistributing, setSubCsDistributing] = useState(false);
  // Daqqi old-data distribution
  const [daqqiOldDistribPlan, setDaqqiOldDistribPlan] = useState<{staffId:string;count:string}[]>([{staffId:'',count:''}]);
  const [daqqiOldDistributing, setDaqqiOldDistributing] = useState(false);
  const [missingAccountsCount, setMissingAccountsCount] = useState<number | null>(null);
  const [bulkCreateLoading, setBulkCreateLoading] = useState(false);
  const [bulkCreateResult, setBulkCreateResult] = useState<{ created: number; failed: number; emailsSent: number } | null>(null);
  const [o25ClassFilter, setO25ClassFilter] = useState<'all' | 'paid' | 'partial' | 'none'>('all');
  const [subscriberCourseFilter, setSubscriberCourseFilter] = useState('');
  const [subscriberSearch, setSubscriberSearch] = useState('');
  const [subscriberBranchFilter, setSubscriberBranchFilter] = useState('all');
  const [subscriberSalesFilter, setSubscriberSalesFilter] = useState('all');
  const [subscriberCsFilter, setSubscriberCsFilter] = useState('all');
  const [subscriberInstFilter, setSubscriberInstFilter] = useState(''); // '' | 'overdue' | 'soon'
  const [subscriberRemainingFilter, setSubscriberRemainingFilter] = useState(''); // '' | '1000' | '2000' | '3000' | '5000' | '8000'
  const [subscriberCertFilter, setSubscriberCertFilter] = useState(''); // '' | 'has' | 'pending' | 'issued'
  const [subscriberPayFilter, setSubscriberPayFilter] = useState(''); // '' | 'pending'
  const [subscriberPage, setSubscriberPage] = useState(1);
  const [selectedSubIds, setSelectedSubIds] = useState<string[]>([]);
  const [bulkSubStatus, setBulkSubStatus] = useState<SubStatus | ''>('');
  const [isSubscriberFormOpen, setIsSubscriberFormOpen] = useState(false);
  const [grantSubscriberId, setGrantSubscriberId] = useState('');
  const [grantEnrolledCourseIds, setGrantEnrolledCourseIds] = useState<string[]>([]);
  const [grantCourseAccess, setGrantCourseAccess] = useState<Record<string, CourseAccessSetting>>({});
  const [grantPaymentAmount, setGrantPaymentAmount] = useState('');
  const [grantPaymentCurrency, setGrantPaymentCurrency] = useState<'EGP' | 'SAR' | 'USD'>('EGP');
  const [grantPaymentNote, setGrantPaymentNote] = useState('منح صلاحية مشاهدة');

  // Refund requests section state (shared with refund_requests tab)
  const [refundActionSaving, setRefundActionSaving] = useState<string|null>(null);

  // Subscriber payment modal (separate from grant)
  const [subPayRow, setSubPayRow] = useState<SubscriberItem | null>(null);
  const [subPayDraft, setSubPayDraft] = useState<PaymentDraft>(createClientPaymentDraft());

  // Per-course pay detail popup
  const [payDetailSub, setPayDetailSub] = useState<SubscriberItem | null>(null);
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
  const [activeLeadsTab, setActiveLeadsTab] = useState<'courses' | 'settings'>('courses');
  const [leadDraft, setLeadDraft] = useState<LeadItem>(blankLead());
  const [convertLeadModal, setConvertLeadModal] = useState<{ lead: LeadItem | null; courseId: string; accessMode: AccessMode }>({ lead: null, courseId: '', accessMode: 'full' });
  const [bulkUploadNotice, setBulkUploadNotice] = useState('');
  const bulkUploadRef = React.useRef<HTMLInputElement>(null);

  // -- Global Quick Booking FAB ---------------------------------------------
  const [quickBookOpen, setQuickBookOpen] = useState(false);
  const [quickBookSearch, setQuickBookSearch] = useState('');

  // -- Lead payment modal (unified — same design as subscriber payment modal) -
  const [leadPayRow, setLeadPayRow] = useState<LeadItem | null>(null);
  const [leadPayDraft, setLeadPayDraft] = useState<PaymentDraft>(createClientPaymentDraft());
  const [fbDraft, setFbDraft] = useState<FacebookLeadAdsConfig>(() => fbLeadAdsConfig || defaultFacebookLeadAdsConfig());
  const [fbIntegOpen, setFbIntegOpen] = useState(false);
  const [fbSyncLoading, setFbSyncLoading] = useState(false);
  const [fbSyncNotice, setFbSyncNotice] = useState('');
  const [fbFormsLoading, setFbFormsLoading] = useState(false);
  const [fbAvailableForms, setFbAvailableForms] = useState<{id: string; name: string; status: string}[]>([]);

  const [leadsSearch, setLeadsSearch] = useState('');
  const [leadsStatusFilter, setLeadsStatusFilter] = useState<string[]>([]); // empty = hide converted+hidden
  const [leadsStatusDropOpen, setLeadsStatusDropOpen] = useState(false);
  const [leadsFollowupFilter, setLeadsFollowupFilter] = useState<'all' | 'today' | 'overdue'>('all');
  const [leadsBranchFilter, setLeadsBranchFilter] = useState<'all' | string>('all');
  const [leadsSalesFilter, setLeadsSalesFilter] = useState<string>('all');
  const [leadsCourseFilter, setLeadsCourseFilter] = useState<string>('all');
  const [staffSearch, setStaffSearch] = useState('');
  const [staffRoleFilter, setStaffRoleFilter] = useState<'all' | 'instructor' | 'trainer' | 'expert' | 'sales' | 'manager' | 'admin' | 'support' | 'reception_daqqi' | 'daqqi_manager' | 'online_manager' | 'sales_collection_manager' | 'collection' | 'accountant' | 'consultant' | 'hr' | 'other'>('all');

  const [editingStaffId, setEditingStaffId] = useState('');
  const [isStaffFormOpen, setIsStaffFormOpen] = useState(false);
  const [staffDraft, setStaffDraft] = useState<StaffMember>(blankStaffMember());
  const [staffPassword, setStaffPassword] = useState('');
  const [staffShowPassword, setStaffShowPassword] = useState(false);
  const [staffAuthLoading, setStaffAuthLoading] = useState(false);
  const [subscriberAuthPanelId, setSubscriberAuthPanelId] = useState('');
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [pendingProofsCount, setPendingProofsCount] = useState(0);
  const [openFloatGroup, setOpenFloatGroup] = useState<string | null>(null);
  const [onlineMgrAcademyOpen, setOnlineMgrAcademyOpen] = useState(false);
  const [monitorPanel, setMonitorPanel] = useState<boolean>(false);
  // -- Horizontal dropdown nav state --
  const [activeDropdownGroup, setActiveDropdownGroup] = useState<string|null>(null);
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null);

  // -- In-app Notifications Bell --------------------------------------------
  type NotifRow = { id: string; type: string; title: string; message: string; read_at: string | null; created_at: string };
  const [notifRows, setNotifRows] = useState<NotifRow[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAdmin) return;
    const loadNotifs = () => {
      mysqlAdmin.getNotifications().then(res => {
        const r = res as { rows: NotifRow[]; unread: number };
        setNotifRows(r.rows || []);
        setNotifUnread(r.unread || 0);
      }).catch(() => {});
    };
    loadNotifs();
    const iv = setInterval(loadNotifs, 60000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    if (notifOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [notifOpen]);

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
  const [isConsultationFormOpen, setIsConsultationFormOpen] = useState(false);
  const [consultationStatusFilter, setConsultationStatusFilter] = useState<string>('all');
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

  const [communityPostDraft, setCommunityPostDraft] = useState({
    title: '',
    body: '',
    tag: 'نقاش عام',
    authorName: 'إدارة المنصة',
    authorRole: 'Admin',
    authorImage: '',
    pinned: false,
  });
  const [isCommunityPostFormOpen, setIsCommunityPostFormOpen] = useState(false);
  const [communityLibraryDraft, setCommunityLibraryDraft] = useState({
    title: '',
    description: '',
    fileType: 'PDF',
    fileSize: '',
    downloadUrl: '',
  });
  const [isCommunityLibraryFormOpen, setIsCommunityLibraryFormOpen] = useState(false);
  const [communityVideoDraft, setCommunityVideoDraft] = useState({
    title: '',
    duration: '',
    viewsLabel: '',
    thumbnail: '',
    videoUrl: '',
    description: '',
  });
  const [isCommunityVideoFormOpen, setIsCommunityVideoFormOpen] = useState(false);
  const [communityEventDraft, setCommunityEventDraft] = useState({
    dateLabel: '',
    title: '',
    eventType: 'ندوة',
    speaker: '',
    platform: 'Zoom',
    eventDate: '',
    description: '',
  });
  const [isCommunityEventFormOpen, setIsCommunityEventFormOpen] = useState(false);
  const [editingCommunityPostId, setEditingCommunityPostId] = useState('');
  const [editingCommunityLibraryId, setEditingCommunityLibraryId] = useState('');
  const [editingCommunityVideoId, setEditingCommunityVideoId] = useState('');
  const [editingCommunityEventId, setEditingCommunityEventId] = useState('');

  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | 'paid' | 'failed' | 'refunded'>('all');
  const [orderTypeFilter, setOrderTypeFilter] = useState<'all' | 'course' | 'bundle' | 'consultation'>('all');
  const [orderMethodFilter, setOrderMethodFilter] = useState<string>('all');
  const [orderDateFrom, setOrderDateFrom] = useState('');
  const [orderDateTo, setOrderDateTo] = useState('');
  const [orderReviewTab, setOrderReviewTab] = useState<'review' | 'accepted' | 'failed' | 'transfers'>('review');
  const [orderStaffFilter, setOrderStaffFilter] = useState<string>('all');
  const [omOrdReviewTab, setOmOrdReviewTab] = useState<'review' | 'accepted' | 'failed'>('review');
  const [reviewedOrders, setReviewedOrders] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('reviewedOrders') || '[]')); } catch { return new Set(); }
  });

  // -- Add Transfer Modal --
  const [showAddTransfer, setShowAddTransfer] = useState(false);
  // -- Link Transfer ? Pending Order modal --
  const [linkTransferModal, setLinkTransferModal] = useState<{ row: OrderItem } | null>(null);
  // -- Link Pending Order ? Transfer modal --
  const [linkOrderModal, setLinkOrderModal] = useState<{ row: OrderItem } | null>(null);
  const [transferForm, setTransferForm] = useState({
    amount: '',
    currency: 'EGP' as 'EGP' | 'SAR' | 'USD',
    method: '' as string,
    senderName: '',
    senderPhone: '',
    reference: '',
    note: '',
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toTimeString().slice(0, 5),
    status: 'paid' as 'paid' | 'pending',
  });

  // Discount management state
  const [featuredCourseId, setFeaturedCourseId] = useState(() => content['home.featured.courseId'] || '');
  const [featuredDiscountPct, setFeaturedDiscountPct] = useState(() => content['home.featured.discountPercent'] || '');

  // Notification state moved to NotificationsAdminTab.tsx

  // Quiz + LiveStream state moved to their own tab components

  const [clientDbSearch, setClientDbSearch] = useState('');
  const [clientDbPage, setClientDbPage] = useState(1);
  const [clientDbMainTab, setClientDbMainTab] = useState<'courses' | 'consultations'>('courses');
  const [clientDbTypeFilter, setClientDbTypeFilter] = useState<'all' | 'subscriber' | 'lead' | 'consultation'>('all');
  const [clientDbSourceFilter, setClientDbSourceFilter] = useState('');
  const [clientDbCourseFilter, setClientDbCourseFilter] = useState('');
  const [clientDbSalesFilter, setClientDbSalesFilter] = useState('');
  const [clientDbCollectionFilter, setClientDbCollectionFilter] = useState('');
  const [clientDbBranchFilter, setClientDbBranchFilter] = useState('');
  const [clientDbBundleFilter, setClientDbBundleFilter] = useState('');
  const [clientDbSort, setClientDbSort] = useState('date_desc');
  const [crmContactRow, setCrmContactRow] = useState<LeadItem | null>(null);
  const [crmContactDraft, setCrmContactDraft] = useState<{ type: CommunicationRecord['type']; date: string; notes: string; outcome: string; nextFollowUp: string; newStatus: LeadStatus | ''; }>({ type: 'whatsapp', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '', newStatus: '' });
  const [codeMigrating, setCodeMigrating] = useState(false);
  const [recodeMigrating, setRecodeMigrating] = useState(false);
  const [deduping, setDeduping] = useState(false);
  const [autoConverting, setAutoConverting] = useState(false);
  const [staffCleanupRunning, setStaffCleanupRunning] = useState(false);

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
  const [leadsView, setLeadsView] = useState<'table' | 'kanban' | 'performance' | 'proposals' | 'funnel'>('table');
  const [kanbanDragId, setKanbanDragId] = useState<string | null>(null);

  // -- Saved Segments --------------------------------------------------------
  type LeadSegment = { id: string; name: string; search: string; statuses: string[]; branch: string; sales: string; course: string; followup: string };
  const [savedSegments, setSavedSegments] = useState<LeadSegment[]>(() => {
    try { return JSON.parse(localStorage.getItem('crm.savedSegments') || '[]'); } catch { return []; }
  });
  const [segmentNameInput, setSegmentNameInput] = useState('');
  const [showSaveSegment, setShowSaveSegment] = useState(false);
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
  const [showWaTemplateModal, setShowWaTemplateModal] = useState(false);
  const [waBulkLeads, setWaBulkLeads] = useState<typeof leads>([]);
  const [waSelectedTemplate, setWaSelectedTemplate] = useState('');
  const [waCustomMessage, setWaCustomMessage] = useState('');
  const [waTemplateEditId, setWaTemplateEditId] = useState('');
  const [waTemplateDraft, setWaTemplateDraft] = useState({ name: '', body: '' });
  const [waSendMode, setWaSendMode] = useState<'template' | 'custom'>('template');
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
  const [quickEditLeadId, setQuickEditLeadId] = useState<string | null>(null);
  const [qeCommNote, setQeCommNote] = useState('');
  const [qeCommType, setQeCommType] = useState<CommunicationRecord['type']>('call');
  const [leadsSalesTargets, setLeadsSalesTargets] = useState<SalesTarget[]>(() => {
    try {
      // Try content first (Firebase-persisted), fallback to localStorage for migration
      const fromContent = (window as unknown as Record<string, unknown>)['__crm_targets__'];
      if (fromContent) return fromContent as SalesTarget[];
      return JSON.parse(localStorage.getItem('crm.salesTargets') || '[]');
    } catch { return []; }
  });
  const [leadTargetMonth, setLeadTargetMonth] = useState(new Date().toISOString().slice(0, 7));
  // CSV general import state
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});
  const [csvImporting, setCsvImporting] = useState(false);
  // Tag input (keyed by lead id being edited)
  const [tagInputVal, setTagInputVal] = useState('');

  // Community sub-tab
  const [communityAdminTab, setCommunityAdminTab] = useState<'pending' | 'posts' | 'library' | 'videos' | 'events' | 'comments'>('pending');

  // Join Us tab state moved to JoinUsAdminTab.tsx
  // Contacts tab state moved to ContactsTab.tsx

  // -- Automation tab state moved to AutomationTab.tsx ---------------------

  // -- Admin AI Assistant settings (separate from customer agent) -----------
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

  // -- Z.AI Dev Assistant ------------------------------------------------
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
  const [aiDevInput, setAiDevInput] = useState('');
  const [aiDevLoading, setAiDevLoading] = useState(false);
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

  // For non-admin staff: load own staff record from MySQL
  const [staffSelf, setStaffSelf] = useState<import('../types').StaffMember | null>(null);
  // Start as true so non-admin staff see a spinner immediately (no flash of admin tabs before permissions load)
  const [staffSelfLoading, setStaffSelfLoading] = useState(true);
  useEffect(() => {
    if (isAdmin || !authUser?.email) return;
    setStaffSelfLoading(true);
    (mysqlClient.getStaffSelf() as Promise<unknown>).then((record) => {
      if (record) {
        const s = record as StaffWire;
        setStaffSelf({ ...s, role: (s.role || '').toLowerCase() as StaffMember['role'], status: staffStatusFromWire(s) });
      }
    }).catch(() => {/* not a staff member or not logged in */})
      .finally(() => setStaffSelfLoading(false));
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
  // Reception Daqqi staff — sees only DAQQI branch subscribers
  const isReceptionDaqqi = currentStaff?.role === 'reception_daqqi';
  // Daqqi Manager — manages the whole Daqqi branch
  const isDaqqiManager = currentStaff?.role === 'daqqi_manager';
  // Online Manager — manages all online-branch subscribers + financial view
  const isOnlineManager = (currentStaff?.role as string) === 'online_manager';
  // Sales & Collection Manager — manages both sales team and online/collection team
  const isSalesCollectionManager = (currentStaff?.role as string) === 'sales_collection_manager';
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
  const [salesOwnLeads, setSalesOwnLeads] = useState<LeadItem[]>([]);
  const [salesOwnSubscribers, setSalesOwnSubscribers] = useState<SubscriberItem[]>([]);
  const [salesOwnOrders, setSalesOwnOrders] = useState<OrderItem[]>([]);
  const [salesOwnDaqqiRounds, setSalesOwnDaqqiRounds] = useState<DaqqiRound[] | null>(null);
  const [onlineTeamMembers, setOnlineTeamMembers] = useState<StaffMember[]>([]);
  const [salesDataLoading, setSalesDataLoading] = useState(false);
  // Badge count for staff notification bell (overdue + today followup leads)
  const _staffNotifTodayStr = new Date().toISOString().slice(0, 10);
  const staffNotifBadge = currentStaff ? (usesStaffScopedData ? salesOwnLeads : leads).filter(l =>
    !['converted', 'lost'].includes(l.status) && l.nextFollowUpDate && l.nextFollowUpDate <= _staffNotifTodayStr
  ).length : 0;

  // Online manager: collection/installment follow-up badge
  const onlineMgrFollowupBadge = React.useMemo(() => {
    if (!isOnlineManager) return 0;
    const today = new Date().toISOString().slice(0, 10);
    const subs = usesStaffScopedData ? salesOwnSubscribers : subscribers;
    let count = 0;
    for (const sub of subs) {
      for (const plan of (sub.installmentPlans || [])) {
        for (const entry of (plan.entries || [])) {
          if (!entry.paidAt && entry.dueDate && entry.dueDate <= today) count++;
        }
      }
    }
    return count;
  }, [isOnlineManager, usesStaffScopedData, salesOwnSubscribers, subscribers]);

  // Online manager: new subscribers + payments in last 7 days badge
  const onlineMgrNewEventsBadge = React.useMemo(() => {
    if (!isOnlineManager) return 0;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const subs = usesStaffScopedData ? salesOwnSubscribers : subscribers;
    const newSubs = subs.filter(s => s.createdAt && s.createdAt.slice(0, 10) >= since).length;
    const newPayments = subs.reduce((acc, s) =>
      acc + (s.paymentHistory || []).filter(p => p.at && p.at.slice(0, 10) >= since).length
    , 0);
    return newSubs + newPayments;
  }, [isOnlineManager, usesStaffScopedData, salesOwnSubscribers, subscribers]);

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

  const fetchSalesData = useCallback(async () => {
    // Online manager has isAdmin=true but still needs their own scoped data for the online_clients tab
    const staffRef = staffSelf || (isOnlineManager ? currentStaff : null);
    if (!staffRef) return;
    if (isAdmin && !isOnlineManager) return; // Real admins skip — they have full context data
    setSalesDataLoading(true);
    try {

      // ONE unified call — server scopes data automatically based on role
      const [subsRaw, leadsRaw] = await Promise.allSettled([
        mysqlAdmin.listStaffSubscribers() as Promise<unknown>,
        mysqlAdmin.listStaffLeads()       as Promise<unknown>,
      ]);

      const mySubs:  SubscriberItem[] = subsRaw.status  === 'fulfilled' ? subsRaw.value  as SubscriberItem[]  : [];
      const myLeads: LeadItem[]       = leadsRaw.status === 'fulfilled' ? leadsRaw.value as LeadItem[] : [];

      setSalesOwnSubscribers(mySubs);
      setSalesOwnLeads(myLeads);
      // Sync to context so ClientDbTab (and any other tab) can access scoped data
      setStaffScopedSubscribers(mySubs);
      setStaffScopedLeads(myLeads);

      const resolveCourseTitle = (courseId: string | undefined) => {
        if (!courseId) return '';
        if (courseId.startsWith('bundle:')) {
          const bId = courseId.replace('bundle:', '');
          return bundles.find(b => b.id === bId)?.title || courseId;
        }
        return courses.find(c => c.id === courseId)?.title || bundles.find(b => b.id === courseId)?.title || courseId;
      };
      const syntheticOrders: OrderItem[] = mySubs.flatMap(sub =>
        (sub.paymentHistory || []).map(p => ({
          id: p.id, type: 'course' as const, itemId: p.courseId || '',
          subscriberId: sub.id,
          itemTitle: resolveCourseTitle(p.courseId) || p.paymentType || '',
          amount: Number(p.amount) || 0, currency: (p.currency || 'EGP') as 'EGP' | 'SAR' | 'USD',
          paymentMethod: (p.paymentMethod || 'other') as OrderItem['paymentMethod'],
          customerName: sub.name, customerEmail: sub.email,
          status: 'paid' as const, createdAt: p.at || sub.createdAt || new Date().toISOString(),
          transactionId: p.id,
          staffId: (p as { staffId?: string }).staffId || undefined,
          staffName: (p as { staffName?: string }).staffName || undefined,
        }))
      );
      setSalesOwnOrders(syntheticOrders);

      // Daqqi rounds — only for daqqi roles
      const isDaqqiRole = staffRef.role === 'daqqi_manager' || staffRef.role === 'reception_daqqi';
      if (isDaqqiRole) {
        try {
          const roundsRaw = (await mysqlAdmin.listAllDaqqiRounds()) as unknown as Record<string, unknown>[];
          const parsedRounds: DaqqiRound[] = roundsRaw.map((r) => ({
            id: String(r.id || ''),
            code: String(r.code || ''),
            courseId: String(r.course_id || r.courseId || ''),
            instructorId: String(r.instructor_id || r.instructorId || ''),
            instructorName: String(r.instructor_name || r.instructorName || ''),
            receptionId: String(r.reception_id || r.receptionId || ''),
            receptionName: String(r.reception_name || r.receptionName || ''),
            dayOfWeek: (r.day_of_week || r.dayOfWeek || '') as DaqqiRound['dayOfWeek'],
            startDate: String(r.start_date || r.startDate || '').slice(0, 10),
            timeSlot: (r.time_slot || r.timeSlot || 'مساءً') as DaqqiRound['timeSlot'],
            status: ((r.status || 'new') as string).toLowerCase() as DaqqiRound['status'],
            currentLecture: Number(r.current_lecture || r.currentLecture || 0),
            attendees: Array.isArray(r.attendees) ? (r.attendees as DaqqiRound['attendees']) : [],
            postponedWeeks: r.postponedWeeks
              ? (r.postponedWeeks as string[])
              : r.postponed_weeks_json
                ? (() => { try { return JSON.parse(String(r.postponed_weeks_json)); } catch { return []; } })()
                : [],
            createdAt: String(r.created_at || r.createdAt || ''),
          }));
          setSalesOwnDaqqiRounds(parsedRounds);
        } catch { setSalesOwnDaqqiRounds([]); }
      }

      // Team members — for manager/online_manager/sales_collection_manager
      const needsTeam = ['online_manager', 'sales_collection_manager', 'manager'].includes(staffRef.role);
      if (needsTeam) {
        try {
          const allStaffData = (await mysqlAdmin.listAllStaff()) as unknown as StaffMember[];
          setOnlineTeamMembers(allStaffData.map(s => ({
            ...s,
            role: (s.role || '').toLowerCase() as StaffMember['role'],
            status: staffStatusFromWire(s as StaffWire),
          })));
        } catch { setOnlineTeamMembers([]); }
      }

      // Content (branches, payment methods, etc.)
      try {
        const contentData = (await mysqlAdmin.getContent()) as Record<string, string>;
        if (contentData && typeof contentData === 'object' && Object.keys(contentData).length > 0) {
          mergeContent(contentData);
        }
      } catch { /* non-fatal */ }
    } catch {
      // Keep dashboard usable if optional staff/content bootstrap data is unavailable.
    } finally {
      setSalesDataLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, isOnlineManager, staffSelf?.id, staffSelf?.role, currentStaff?.id, currentStaff?.role]);

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

  const filteredSubscribers = useMemo(() => {
    setSubscriberPage(1);
    return branchFilteredEffectiveSubs.filter((row) => {
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
  }, [branchFilteredEffectiveSubs, effectiveLeads, subscriberSearch, subscriberCourseFilter, subscriberSubTab, subscriberSalesFilter, isSalesOnly, currentStaff, bundles, subscriberCsFilter, subscriberInstFilter, subscriberRemainingFilter, subscriberCertFilter, subscriberPayFilter]);
  const enabledConsultationTherapists = useMemo(
    () => therapists.filter((row) => row.consultationSettings?.enabled),
    [therapists]
  );
  const grantSubscriber = grantSubscriberId ? subscribers.find((row) => row.id === grantSubscriberId) : undefined;
  const selectedConsultationTherapist = consultationDraft.therapistId
    ? therapists.find((row) => row.id === consultationDraft.therapistId)
    : therapists.find((row) => row.name === consultationDraft.therapistName);
  const filteredOrders = useMemo(() => branchFilteredEffectiveOrders.filter((row) => {
    const text = `${row.id} ${row.itemTitle} ${row.customerName} ${row.staffName || ''}`.toLowerCase();
    const matchesSearch = text.includes(orderSearch.toLowerCase());
    const matchesStatus = orderStatusFilter === 'all' || row.status === orderStatusFilter;
    const matchesType = orderTypeFilter === 'all' || row.type === orderTypeFilter;
    const matchesMethod = orderMethodFilter === 'all' || row.paymentMethod === orderMethodFilter;
    const matchesStaff = orderStaffFilter === 'all' || (row.staffName || '') === orderStaffFilter;
    const rowTime = new Date(row.createdAt.replace(' ', 'T')).getTime();
    const fromTime = orderDateFrom ? new Date(`${orderDateFrom}T00:00:00`).getTime() : null;
    const toTime = orderDateTo ? new Date(`${orderDateTo}T23:59:59`).getTime() : null;
    const hasValidTime = !Number.isNaN(rowTime);
    const matchesDate = hasValidTime && (fromTime === null || rowTime >= fromTime) && (toTime === null || rowTime <= toTime);
    return matchesSearch && matchesStatus && matchesType && matchesMethod && matchesStaff && matchesDate;
  }), [branchFilteredEffectiveOrders, orderSearch, orderStatusFilter, orderTypeFilter, orderMethodFilter, orderStaffFilter, orderDateFrom, orderDateTo]);

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
  const ordersStats = useMemo(() => {
    const paidOrders = branchFilteredEffectiveOrders.filter((row) => row.status === 'paid');
    const revenueEGP = paidOrders.filter((r) => r.currency === 'EGP').reduce((a, r) => a + r.amount, 0);
    const revenueSAR = paidOrders.filter((r) => r.currency === 'SAR').reduce((a, r) => a + r.amount, 0);
    const revenueUSD = paidOrders.filter((r) => r.currency === 'USD').reduce((a, r) => a + r.amount, 0);
    return {
      total: branchFilteredEffectiveOrders.length,
      paid: paidOrders.length,
      failed: branchFilteredEffectiveOrders.filter((row) => row.status === 'failed').length,
      refunded: branchFilteredEffectiveOrders.filter((row) => row.status === 'refunded').length,
      revenueEGP,
      revenueSAR,
      revenueUSD,
    };
  }, [branchFilteredEffectiveOrders]);

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

  // Helper: does an online25 lead have meaningful course data in notes?
  const _online25HasCourse = (l: LeadItem) => {
    if (l.source !== 'أونلاين 2025') return false;
    const m = (l.notes || '').match(/(?:السعر|price)[:\s]+([^\n|]+)/);
    const hasCourse = m && m[1].trim().length > 0;
    const hasPrice = /(?:السعر|price)[:\s]+[\d.]+/.test(l.notes || '');
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

  // -- Pre-computed maps for subscriber paid totals (avoid O(nÃ—m) in render) -
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

  // -- Overview stats (expensive O(nÃ—m), only recomputes when data changes) -
  const overviewStats = useMemo(() => {
    const sarRate = parseFloat(content['exchange.sar_to_egp'] || '13') || 13;
    const usdRate = parseFloat(content['exchange.usd_to_egp'] || '50') || 50;
    const toEGP = (o: { currency: string; amount: number }) =>
      o.currency === 'EGP' ? o.amount : o.currency === 'SAR' ? o.amount * sarRate : o.amount * usdRate;
    const paidOrders = orders.filter(o => o.status === 'paid');
    const totalRevenue = paidOrders.reduce((sum, o) => sum + toEGP(o), 0)
      + subscribers.reduce((s, sub) => s + (sub.paymentHistory ?? []).filter(p => !p.isInstallment).reduce((ps, p) => ps + toEGP(p), 0), 0);
    const leadsBySource: [string, number][] = (Object.entries(
      leads.reduce((acc: Record<string, number>, l) => { acc[l.source] = (acc[l.source] || 0) + 1; return acc; }, {})
    ) as [string, number][]).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const courseEnrollments = courses.map(c => ({
      id: c.id,
      title: c.title.length > 26 ? c.title.slice(0, 26) + '…' : c.title,
      count: subscribers.filter(s => (s.enrolledCourseIds || []).includes(c.id)).length,
    })).sort((a, b) => b.count - a.count).slice(0, 6);
    const consultsByStatus = consultations.reduce((acc: Record<string, number>, c) => { acc[c.status] = (acc[c.status] || 0) + 1; return acc; }, {});
    const salesStatsCalc = staffMembers.filter(s => s.role === 'sales').map(s => {
      const myLeads = leads.filter(l => l.assignedSalesId === s.id);
      const converted = myLeads.filter(l => l.status === 'converted').length;
      return { name: s.name, total: myLeads.length, converted, rate: myLeads.length > 0 ? Math.round((converted / myLeads.length) * 100) : 0 };
    });
    const seenIds = new Set<string>();
    const recentLeads = [...leads]
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .filter(l => { if (seenIds.has(l.id)) return false; seenIds.add(l.id); return true; })
      .slice(0, 5);
    // Today stats
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayRevenue = paidOrders
      .filter(o => (o.createdAt || '').slice(0, 10) === todayStr)
      .reduce((sum, o) => sum + toEGP(o), 0)
      + subscribers.reduce((s, sub) => s + (sub.paymentHistory ?? [])
        .filter(p => !p.isInstallment && (p.at || '').slice(0, 10) === todayStr)
        .reduce((ps, p) => ps + toEGP(p), 0), 0);
    const todayNewSubscribers = subscribers.filter(s => (s.createdAt || '').slice(0, 10) === todayStr).length;
    const todayNewLeads = leads.filter(l => (l.createdAt || '').slice(0, 10) === todayStr).length;
    const thisMonthStr = new Date().toISOString().slice(0, 7);
    const monthRevenue = paidOrders
      .filter(o => (o.createdAt || '').slice(0, 7) === thisMonthStr)
      .reduce((sum, o) => sum + toEGP(o), 0)
      + subscribers.reduce((s, sub) => s + (sub.paymentHistory ?? [])
        .filter(p => !p.isInstallment && (p.at || '').slice(0, 7) === thisMonthStr)
        .reduce((ps, p) => ps + toEGP(p), 0), 0);
    return { totalRevenue, leadsBySource, courseEnrollments, consultsByStatus, salesStats: salesStatsCalc, recentLeads, paidOrders, todayRevenue, todayNewSubscribers, todayNewLeads, monthRevenue };
  }, [orders, subscribers, leads, courses, staffMembers, consultations, content]);

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

  const exportFilteredOrdersCsv = () => {
    if (filteredOrders.length === 0) return;

    const escapeCsv = (value: string | number) => {
      const raw = String(value ?? '');
      const escaped = raw.replace(/"/g, '""');
      return `"${escaped}"`;
    };

    const header = ['order_id', 'item_title', 'type', 'customer_name', 'payment_method', 'amount', 'currency', 'status', 'created_at'];
    const rows = filteredOrders.map((row) => [
      row.id,
      row.itemTitle,
      row.type,
      row.customerName,
      row.paymentMethod,
      row.amount,
      row.currency,
      row.status,
      row.createdAt,
    ]);
    const csv = [header, ...rows].map(r => r.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportSubscribersCsv = () => {
    if (subscribers.length === 0) return;
    const escape = (v: string | number | undefined) => { const s = String(v ?? ''); return `"${s.replace(/"/g, '"""')}"`; };
    const branchLabel = (b?: string) => branchLabelMap[b || ''] || b || '';
    const header = ['معرف', 'الاسم', 'الهاتف', 'البريد', 'الفرع', 'الحالة', 'تاريخ التسجيل', 'الكورسات', 'عدد الكورسات', 'اسم السيلز', 'ملاحظات'];
    const rows = subscribers.map(s => [
      s.id, s.name, s.phone, s.email || '',
      branchLabel(s.branch), s.status, s.createdAt?.slice(0, 10) || '',
      (() => { const cIds = s.enrolledCourseIds || []; const cBnds = bundles.filter(b => b.courses.length > 0 && b.courses.every(co => cIds.includes(co.id))); const hIds = new Set(cBnds.flatMap(b => b.courses.map(co => co.id))); return [...cBnds.map(b => b.title), ...cIds.filter(id => !hIds.has(id)).map(id => courses.find(c => c.id === id)?.title || id)].join(' | '); })(),
      (s.enrolledCourseIds || []).length,
      s.assignedSalesName || '', s.notes || '',
    ]);
    const csv = [header, ...rows].map(r => r.map(c => escape(c as string)).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const exportLeadsCsv = () => {
    const rows = leads;
    if (rows.length === 0) return;
    const escapeCsv = (v: string | number | undefined) => { const s = String(v ?? ''); return `"${s.replace(/"/g, '""')}"`; };
    const header = ['id', 'name', 'phone', 'email', 'status', 'source', 'branch', 'leadType', 'assignedSalesName', 'createdAt', 'notes'];
    const csvRows = rows.map(r => [r.id, r.name, r.phone, r.email, r.status, r.source, r.branch, r.leadType, r.assignedSalesName, r.createdAt, r.notes]);
    const csv = [header, ...csvRows].map(line => line.map(c => escapeCsv(c as string)).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };

  const normalizeAccessEntry = (entry?: CourseAccessSetting | 'preview' | 'full'): CourseAccessSetting => {
    if (entry === 'full') return { mode: 'full' };
    if (entry === 'preview') return { mode: 'preview' };
    if (!entry) return { mode: 'preview' };
    if (entry.mode === 'limited') {
      const rawLimit = Number(entry.lectureLimit || 1);
      return { mode: 'limited', lectureLimit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 1 };
    }
    return { mode: entry.mode };
  };

  const normalizeCourseAccess = (enrolledCourseIds: string[], currentMap: Record<string, CourseAccessSetting | 'preview' | 'full'> = {}) => {
    const nextMap: Record<string, CourseAccessSetting> = {};
    enrolledCourseIds.forEach((courseId) => {
      nextMap[courseId] = normalizeAccessEntry(currentMap[courseId]);
    });
    return nextMap;
  };

  // lectureProgress is stored as { [lectureId]: percentNumber } where 100 = complete.
  // Pass through unchanged — it is keyed by lectureId, not courseId.
  const normalizeLectureProgress = (_enrolledCourseIds: string[], currentMap: Record<string, number> = {}) => {
    return currentMap;
  };

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
  const [staffProfileModalId, setStaffProfileModalId] = useState<string | null>(null);

  // -- Cert Requests filter state --------------------------------------------
  const [certSearch, setCertSearch] = useState('');
  const [certTypeFilter, setCertTypeFilter] = useState('all');
  const [certStatusFilter, setCertStatusFilter] = useState('all');

  const handleInstituteGalleryUpload = async (files: FileList | null) => {
    const readFileAsDataUrl = (file: File, maxWidth: number, quality: number): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new window.Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, maxWidth / img.width);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', quality));
          };
          img.onerror = reject;
          img.src = e.target!.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    if (!files || files.length === 0) return;
    try {
      // Compress to max 600px wide, 65% quality — keeps each image ~15-30KB in base64
      const uploaded = await Promise.all(Array.from(files).map((file) => readFileAsDataUrl(file, 600, 0.65)));
      saveInstituteGalleryImages(Array.from(new Set([...instituteGalleryImages, ...uploaded])));
      notify('success', 'تم رفع صور المعرض بنجاح.');
    } catch {
      notify('error', 'حدث خطأ أثناء رفع صور المعهد.');
    }
  };

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
    if (!subPayRow) return;
    // Adapt unified PaymentDraft to handler's legacy shape
    const courseItemsComputed = draft.paymentType === 'course'
      ? [
          { courseId: draft.courseId, amount: draft.amount, customExpected: draft.customExpected, discountPct: draft.discountPct },
          ...draft.extraItems.filter(i => i.type === 'course').map(i => ({
            courseId: i.courseId || '', amount: i.amount, customExpected: i.customExpected || '', discountPct: i.discountPct || '',
          })),
        ].filter(item => item.courseId && item.amount)
      : [];
    // Shadow outer subPayDraft so all existing references work unchanged
    const subPayDraft = {
      ...draft,
      courseItems: courseItemsComputed,
      transferRef: draft.fromAccountNumber,
      extraItems: draft.extraItems.filter(i => i.type !== 'course'),
    };
    const freshSub = subscribers.find(s => s.id === subPayRow.id) || subPayRow;
    const noteParts = [subPayDraft.note, subPayDraft.transactionId, subPayDraft.transferRef ? `تحويل: ${subPayDraft.transferRef}` : '', subPayDraft.nationalId ? `ر.ق: ${subPayDraft.nationalId}` : ''].filter(Boolean);
    const isMultiCourse = subPayDraft.paymentType === 'course' && subPayDraft.bookingType === 'new_booking';

    let updated = { ...freshSub };

    if (isMultiCourse) {
      // Multi-course new booking: one payment entry per course item
      const validItems = subPayDraft.courseItems.filter(item => item.courseId && item.amount);
      if (validItems.length === 0) return;
      const newEntries: PaymentHistoryEntry[] = [];
      for (const item of validItems) {
        const isBundleItem = item.courseId.startsWith('bundle:');
        const bId = isBundleItem ? item.courseId.replace('bundle:', '') : null;
        const bObj = bId ? bundles.find(b => b.id === bId) : null;
        const _bundleCatalog = isBundleItem && bObj ? priceForCurrency(bObj.price, subPayDraft.currency) : 0;
        const _courseCatalog = !isBundleItem && item.courseId ? (courses.find(c => c.id === item.courseId)?.price?.[subPayDraft.currency as 'EGP'|'SAR'|'USD'] || courses.find(c => c.id === item.courseId)?.price?.EGP || 0) : 0;
        const _catalogPx = isBundleItem ? _bundleCatalog : _courseCatalog;
        const _customExpSub = Number(item.customExpected) || 0;
        const _discPctSub = Number(item.discountPct) || 0;
        const _itemExpected = _customExpSub > 0 ? _customExpSub : (_discPctSub > 0 && _catalogPx > 0 ? Math.round(_catalogPx * (1 - _discPctSub / 100)) : _catalogPx);
        const entry: PaymentHistoryEntry = {
          id: `pay-${Date.now()}-${item.courseId}`,
          amount: Number(item.amount),
          courseExpected: _itemExpected > 0 ? _itemExpected : Number(item.amount),
          currency: subPayDraft.currency,
          paymentType: subPayDraft.paymentType,
          isInstallment: false,
          courseId: isBundleItem ? undefined : (item.courseId || undefined),
          note: [noteParts.join(' | '), isBundleItem && bObj ? `مسار تعليمي: ${bObj.title}` : undefined].filter(Boolean).join(' | ') || undefined,
          paymentMethod: subPayDraft.paymentMethod || undefined,
          at: subPayDraft.date,
          staffId: currentStaff?.id || undefined,
          staffName: currentStaff?.name || undefined,
          status: isAdmin ? 'paid' : 'pending',
        };
        newEntries.push(entry);
        if (isBundleItem && bObj) {
          const bundleCourseIds = bObj.courses.map((c: { id: string }) => c.id);
          const newIds = [...new Set([...(updated.enrolledCourseIds || []), ...bundleCourseIds])];
          updated = { ...updated, enrolledCourseIds: newIds };
        } else if (item.courseId && !(updated.enrolledCourseIds || []).includes(item.courseId)) {
          updated = { ...updated, enrolledCourseIds: [...(updated.enrolledCourseIds || []), item.courseId] };
        }
      }
      updated = { ...updated, paymentHistory: [...(updated.paymentHistory || []), ...newEntries] };
    } else {
      // Single-course installment OR non-course payment type
      if (!subPayDraft.amount) return;
      const isBundleSelection = subPayDraft.courseId?.startsWith('bundle:');
      const bundleId = isBundleSelection ? subPayDraft.courseId.replace('bundle:', '') : null;
      const bundle = bundleId ? bundles.find(b => b.id === bundleId) : null;
      const _singleExpected = isBundleSelection && bundle
        ? priceForCurrency(bundle.price, subPayDraft.currency)
        : (!isBundleSelection && subPayDraft.courseId ? (courses.find(c => c.id === subPayDraft.courseId)?.price?.[subPayDraft.currency as 'EGP'|'SAR'|'USD'] || courses.find(c => c.id === subPayDraft.courseId)?.price?.EGP || 0) : 0);
      const entry: PaymentHistoryEntry = {
        id: `pay-${Date.now()}`,
        amount: Number(subPayDraft.amount),
        courseExpected: subPayDraft.bookingType !== 'installment' && _singleExpected > 0 ? _singleExpected : undefined,
        currency: subPayDraft.currency,
        paymentType: subPayDraft.paymentType,
        isInstallment: subPayDraft.bookingType === 'installment',
        courseId: isBundleSelection ? undefined : (subPayDraft.courseId || undefined),
        note: [noteParts.join(' | '), isBundleSelection && bundle ? `مسار تعليمي: ${bundle.title}` : undefined].filter(Boolean).join(' | ') || undefined,
        paymentMethod: subPayDraft.paymentMethod || undefined,
        at: subPayDraft.date,
        staffId: currentStaff?.id || undefined,
        staffName: currentStaff?.name || undefined,
        status: isAdmin ? 'paid' : 'pending',
      };
      updated = { ...updated, paymentHistory: [...(updated.paymentHistory || []), entry] };

      // Auto-enroll course on installment/single payment (so the course row appears in the table)
      if (subPayDraft.paymentType === 'course') {
        if (isBundleSelection && bundle) {
          const bundleCourseIds = bundle.courses.map((c: { id: string }) => c.id);
          const newIds = [...new Set([...(updated.enrolledCourseIds || []), ...bundleCourseIds])];
          updated = { ...updated, enrolledCourseIds: newIds };
        } else if (!isBundleSelection && subPayDraft.courseId && !(updated.enrolledCourseIds || []).includes(subPayDraft.courseId)) {
          updated = { ...updated, enrolledCourseIds: [...(updated.enrolledCourseIds || []), subPayDraft.courseId] };
        }
      }

      // Cert installment: update paidAmount on the linked cert request
      if (subPayDraft.paymentType === 'certificate' && subPayDraft.certReqId) {
        updated = {
          ...updated,
          extraCertificateRequests: (updated.extraCertificateRequests || []).map(req =>
            req.id === subPayDraft.certReqId
              ? { ...req, paidAmount: (req.paidAmount || 0) + Number(subPayDraft.amount) }
              : req
          ),
        };
      }

      // Cert new_booking: create a cert request entry so it appears in cert_requests tab
      if (subPayDraft.paymentType === 'certificate' && subPayDraft.bookingType === 'new_booking' && subPayDraft.certType) {
        const newCertReq: ExtraCertificateRequest = {
          id: `certreq-${Date.now()}`,
          type: subPayDraft.certType as ExtraCertificateType,
          courseId: subPayDraft.courseId || undefined,
          status: 'priced',
          price: Number(subPayDraft.amount),
          paidAmount: Number(subPayDraft.amount),
          currency: subPayDraft.currency,
          requestedAt: subPayDraft.date,
          note: noteParts.join(' | ') || undefined,
        };
        updated = {
          ...updated,
          extraCertificateRequests: [...(updated.extraCertificateRequests || []), newCertReq],
        };
      }
    }

    // -- Auto-unlock videos on course payment ----------------------------------
    if (subPayDraft.paymentType === 'course') {
      const depositVids = Math.max(1, Number(content['access.videos_on_deposit'] || 20));
      const perPayVids = Math.max(1, Number(content['access.videos_per_payment'] || 15));

      // Collect affected courseIds
      const affectedCourseIds: string[] = [];
      if (isMultiCourse) {
        for (const item of subPayDraft.courseItems.filter(i => i.courseId && i.amount)) {
          if (item.courseId.startsWith('bundle:')) {
            const bId = item.courseId.replace('bundle:', '');
            const bObj = bundles.find(b => b.id === bId);
            if (bObj) bObj.courses.forEach((c: { id: string }) => affectedCourseIds.push(c.id));
          } else {
            affectedCourseIds.push(item.courseId);
          }
        }
      } else if (subPayDraft.courseId) {
        if (subPayDraft.courseId.startsWith('bundle:')) {
          const bId = subPayDraft.courseId.replace('bundle:', '');
          const bObj = bundles.find(b => b.id === bId);
          if (bObj) bObj.courses.forEach((c: { id: string }) => affectedCourseIds.push(c.id));
        } else {
          affectedCourseIds.push(subPayDraft.courseId);
        }
      }

      const isFirstPayment = subPayDraft.bookingType === 'new_booking';
      let newCourseAccess = { ...(updated.courseAccess ?? {}) };

      for (const cid of affectedCourseIds) {
        const curAccess = normalizeAccessEntry(newCourseAccess[cid]);
        if (curAccess.mode === 'full') continue; // already full — don't downgrade

        // Check if fully paid by looking at total paid vs installment plan total
        const plan = (updated.installmentPlans || []).find(p => p.courseId === cid);
        const totalPaid = (updated.paymentHistory || [])
          .filter(p => p.courseId === cid && (p.paymentType === 'course' || !p.paymentType))
          .reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const isFullyPaid = plan && plan.totalAmount > 0 && totalPaid >= plan.totalAmount;

        if (isFullyPaid) {
          newCourseAccess[cid] = { mode: 'full' };
        } else if (isFirstPayment) {
          // First payment: start with depositVids (only if not already limited with more)
          const existingLimit = curAccess.mode === 'limited' ? (curAccess.lectureLimit || 0) : 0;
          newCourseAccess[cid] = { mode: 'limited', lectureLimit: Math.max(depositVids, existingLimit) };
        } else {
          // Subsequent payment: add perPayVids to current limit
          const currentLimit = curAccess.mode === 'limited' ? (curAccess.lectureLimit || depositVids) : depositVids;
          newCourseAccess[cid] = { mode: 'limited', lectureLimit: currentLimit + perPayVids };
        }
      }
      updated = { ...updated, courseAccess: newCourseAccess };
    }

    // Extra paid items (book / certificate / carneh / other)
    const subExtraEntries: PaymentHistoryEntry[] = (subPayDraft.extraItems || [])
      .filter(i => i.amount && Number(i.amount) > 0)
      .map((i, ix) => ({
        id: `pay-${Date.now()}-xtra-${ix}`,
        amount: Number(i.amount),
        currency: subPayDraft.currency,
        paymentType: i.type,
        isInstallment: false,
        note: [i.label, ...noteParts].filter(Boolean).join(' | ') || undefined,
        paymentMethod: subPayDraft.paymentMethod || undefined,
        at: subPayDraft.date,
      }));
    if (subExtraEntries.length > 0) {
      updated = { ...updated, paymentHistory: [...(updated.paymentHistory || []), ...subExtraEntries] };
    }
    updateSubscriber(updated);
    notify('success', 'تم تسجيل الدفعة بنجاح.');
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
    if (!leadPayRow) return;
    // Adapt unified PaymentDraft to handler's legacy shape
    const courseItemsComputed = draft.paymentType === 'course'
      ? [
          { courseId: draft.courseId, amount: draft.amount, customExpected: draft.customExpected, discountPct: draft.discountPct },
          ...draft.extraItems.filter(i => i.type === 'course').map(i => ({
            courseId: i.courseId || '', amount: i.amount, customExpected: i.customExpected || '', discountPct: i.discountPct || '',
          })),
        ].filter(item => item.courseId && item.amount)
      : [];
    // Shadow outer leadPayDraft so all existing references work unchanged
    const leadPayDraft = {
      ...draft,
      courseItems: courseItemsComputed,
      transferRef: draft.fromAccountNumber,
      extraItems: draft.extraItems.filter(i => i.type !== 'course'),
      discountPct: draft.discountPct,
      discountCustom: draft.customExpected,
    };
    const freshLead = leads.find(l => l.id === leadPayRow.id) || leadPayRow;
    const noteParts = [leadPayDraft.note, leadPayDraft.transactionId, leadPayDraft.transferRef ? `تحويل: ${leadPayDraft.transferRef}` : '', leadPayDraft.nationalId ? `ر.ق: ${leadPayDraft.nationalId}` : '', leadPayDraft.branch ? `فرع: ${branchLabelMap[leadPayDraft.branch] || leadPayDraft.branch}` : ''].filter(Boolean);
    const isMultiCourse = leadPayDraft.paymentType === 'course';

    const normPhone = (freshLead.phone || '').replace(/\D/g, '');
    const normEmail = (freshLead.email || '').toLowerCase().trim();
    const existingSub = subscribers.find(s =>
      s.leadId === freshLead.id ||
      (normPhone.length > 5 && (s.phone || '').replace(/\D/g, '') === normPhone) ||
      (normEmail.length > 3 && (s.email || '').toLowerCase().trim() === normEmail)
    );
    let updatedLead = { ...freshLead };

    if (isMultiCourse) {
      // Multi-course new booking
      const validItems = leadPayDraft.courseItems.filter(item => item.courseId && item.amount);
      if (validItems.length === 0) return;

      const payEntries: PaymentHistoryEntry[] = [
        ...validItems.map(item => {
          const _isBndl = item.courseId.startsWith('bundle:');
          const _bId = _isBndl ? item.courseId.replace('bundle:', '') : null;
          const _bObj = _bId ? bundles.find(b => b.id === _bId) : null;
          const _catalogPxL = _isBndl && _bObj
            ? ((_bObj.price as unknown as Record<string,number>)?.[leadPayDraft.currency] || (_bObj.price as unknown as Record<string,number>)?.EGP || 0)
            : (courses.find(c => c.id === item.courseId)?.price?.[leadPayDraft.currency as 'EGP'|'SAR'|'USD'] || courses.find(c => c.id === item.courseId)?.price?.EGP || 0);
          const _customExpL = Number(item.customExpected) || 0;
          const _discPctL = Number(item.discountPct) || 0;
          const _itemExpectedL = _customExpL > 0 ? _customExpL : (_discPctL > 0 && _catalogPxL > 0 ? Math.round(_catalogPxL * (1 - _discPctL / 100)) : _catalogPxL);
          const _discNoteL = _discPctL > 0 ? `خصم ${_discPctL}%` : (_customExpL > 0 && _catalogPxL > 0 ? `سعر نهائي: ${_customExpL}` : '');
          return {
            id: `pay-${Date.now()}-${item.courseId}`,
            amount: Number(item.amount),
            courseExpected: _itemExpectedL > 0 ? _itemExpectedL : Number(item.amount),
            currency: leadPayDraft.currency,
            paymentType: leadPayDraft.paymentType,
            isInstallment: false,
            courseId: item.courseId || undefined,
            note: [noteParts.join(' | '), _discNoteL].filter(Boolean).join(' | ') || undefined,
            paymentMethod: leadPayDraft.paymentMethod || undefined,
            at: leadPayDraft.date,
          } as PaymentHistoryEntry;
        }),
        ...(leadPayDraft.extraItems || []).filter(i => i.amount && Number(i.amount) > 0).map((i, ix) => ({
          id: `pay-${Date.now()}-xtra-${ix}`,
          amount: Number(i.amount),
          currency: leadPayDraft.currency,
          paymentType: i.type,
          isInstallment: false,
          note: [i.label, ...noteParts].filter(Boolean).join(' | ') || undefined,
          paymentMethod: leadPayDraft.paymentMethod || undefined,
          at: leadPayDraft.date,
        } as PaymentHistoryEntry)),
      ];
      // Expand bundle IDs to individual course IDs so enrolledCourseIds never stores raw bundle:b-xxx
      const enrollIds: string[] = [];
      for (const item of validItems) {
        if (item.courseId.startsWith('bundle:')) {
          const bId = item.courseId.replace('bundle:', '');
          const bObj = bundles.find(b => b.id === bId);
          if (bObj) enrollIds.push(...bObj.courses.map((c: { id: string }) => c.id));
          else enrollIds.push(item.courseId); // fallback if bundle not found
        } else {
          enrollIds.push(item.courseId);
        }
      }
      const enrollIds_unique = [...new Set(enrollIds)];
      const _leadDepositVids = Math.max(1, Number(content['access.videos_on_deposit'] || 20));
      const courseAccessPatch = Object.fromEntries(enrollIds_unique.map(id => [id, { mode: 'limited' as const, lectureLimit: _leadDepositVids }]));

      if (existingSub) {
        const allCourseIds = [...new Set([...(existingSub.enrolledCourseIds || []), ...enrollIds_unique])];
        updateSubscriber({
          ...existingSub,
          enrolledCourseIds: allCourseIds,
          courseAccess: { ...(existingSub.courseAccess ?? {}), ...courseAccessPatch },
          paymentHistory: [...(existingSub.paymentHistory || []), ...payEntries],
          leadId: existingSub.leadId || freshLead.id,
        });
      } else {
        const added = await addSubscriber({
          id: `sub-${Date.now()}`, clientCode: freshLead.clientCode || await issueClientCodeAsync(),
          leadId: freshLead.id, name: freshLead.name, email: freshLead.email, phone: freshLead.phone,
          enrolledCourseIds: enrollIds_unique, courseAccess: courseAccessPatch,
          paymentHistory: payEntries, branch: (freshLead.branch as BranchType) || undefined,
          status: 'active', assignedSalesId: freshLead.assignedSalesId, assignedSalesName: freshLead.assignedSalesName,
          createdAt: new Date().toLocaleString('ar-EG', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        });
      notify('error', 'فشل حفظ البيانات. تحقق من الاتصال بالإنترنت وأعد المحاولة.');
      }
      updatedLead = { ...updatedLead, status: 'converted' };
    } else {
      // Single payment (installment or non-course type)
      if (!leadPayDraft.amount) return;
      const payHistEntry: PaymentHistoryEntry = {
        id: `pay-${Date.now()}`, amount: Number(leadPayDraft.amount),
        currency: leadPayDraft.currency, paymentType: leadPayDraft.paymentType,
        isInstallment: leadPayDraft.bookingType === 'installment',
        courseId: leadPayDraft.courseId || undefined,
        note: noteParts.join(' | ') || undefined,
        paymentMethod: leadPayDraft.paymentMethod || undefined,
        at: leadPayDraft.date,
      };
      // Extra subscriber fields to save from booking draft
      const _subExtra = {
        ...(leadPayDraft.nationalId ? { nationalId: leadPayDraft.nationalId } : {}),
        ...(leadPayDraft.email && leadPayDraft.email.includes('@') ? { email: leadPayDraft.email } : {}),
      };
      if (leadPayDraft.bookingType === 'new_booking' && leadPayDraft.paymentType === 'course' && leadPayDraft.courseId) {
        const _singleDepVids = Math.max(1, Number(content['access.videos_on_deposit'] || 20));
        const _initAccess = { mode: 'limited' as const, lectureLimit: _singleDepVids };
        if (existingSub) {
          const newCourseIds = (existingSub.enrolledCourseIds || []).includes(leadPayDraft.courseId)
            ? (existingSub.enrolledCourseIds || [])
            : [...(existingSub.enrolledCourseIds || []), leadPayDraft.courseId];
          updateSubscriber({ ...existingSub, ..._subExtra, enrolledCourseIds: newCourseIds, courseAccess: { ...(existingSub.courseAccess ?? {}), [leadPayDraft.courseId]: _initAccess }, paymentHistory: [...(existingSub.paymentHistory || []), payHistEntry], leadId: existingSub.leadId || freshLead.id });
        } else {
          const added = await addSubscriber({ id: `sub-${Date.now()}`, clientCode: freshLead.clientCode || await issueClientCodeAsync(), leadId: freshLead.id, name: freshLead.name, email: leadPayDraft.email || freshLead.email, phone: freshLead.phone, enrolledCourseIds: [leadPayDraft.courseId], courseAccess: { [leadPayDraft.courseId]: _initAccess }, paymentHistory: [payHistEntry], branch: (freshLead.branch as BranchType) || undefined, status: 'active', assignedSalesId: freshLead.assignedSalesId, assignedSalesName: freshLead.assignedSalesName, createdAt: new Date().toLocaleString('ar-EG', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), ..._subExtra });
      notify('error', 'فشل حفظ البيانات. تحقق من الاتصال بالإنترنت وأعد المحاولة.');
        }
        updatedLead = { ...updatedLead, status: 'converted' };
      } else if (existingSub) {
        updateSubscriber({ ...existingSub, ..._subExtra, paymentHistory: [...(existingSub.paymentHistory || []), payHistEntry] });
      } else {
        await addSubscriber({ id: `sub-${Date.now()}`, clientCode: freshLead.clientCode || await issueClientCodeAsync(), leadId: freshLead.id, name: freshLead.name, email: leadPayDraft.email || freshLead.email, phone: freshLead.phone, enrolledCourseIds: [], paymentHistory: [payHistEntry], branch: (freshLead.branch as BranchType) || undefined, status: 'active', assignedSalesId: freshLead.assignedSalesId, assignedSalesName: freshLead.assignedSalesName, createdAt: new Date().toLocaleString('ar-EG', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), ..._subExtra });
      }
    }

    updateLead(updatedLead);
    const _notifCourse = leadPayDraft.paymentType === 'course'
      ? leadPayDraft.courseItems.filter(i => i.courseId && i.amount).map(i => {
          if (i.courseId.startsWith('bundle:')) return bundles.find(b => b.id === i.courseId.replace('bundle:', ''))?.title || '';
          return courses.find(c => c.id === i.courseId)?.title || '';
        }).filter(Boolean).join(' + ')
      : '';
    const _notifAmt = leadPayDraft.paymentType === 'course'
      ? leadPayDraft.courseItems.reduce((s, i) => s + (Number(i.amount) || 0), 0)
      : Number(leadPayDraft.amount);
    notify('success', `? ${updatedLead.name}${_notifCourse ? ' — ' + _notifCourse : ''} | ${_notifAmt.toLocaleString()} ${leadPayDraft.currency}`);
    // Fire welcome email if new_booking for a course and email is available
    if (leadPayDraft.paymentType === 'course' && updatedLead.status === 'converted') {
      const _welcomeEmail = leadPayDraft.email || freshLead.email;
      if (_welcomeEmail && _welcomeEmail.includes('@')) {
        const _courseTitles = leadPayDraft.courseItems
          .filter(i => i.courseId)
          .map(i => {
            if (i.courseId.startsWith('bundle:')) return bundles.find(b => b.id === i.courseId.replace('bundle:', ''))?.title || i.courseId;
            return courses.find(c => c.id === i.courseId)?.title || i.courseId;
          })
          .filter(Boolean);
        void mysqlAdmin.enrollmentWelcome({
          email: _welcomeEmail,
          name: freshLead.name,
          courseTitle: _courseTitles.join(' + ') || 'الكورس',
          branch: leadPayDraft.branch || freshLead.branch || '',
          courseIds: leadPayDraft.courseItems.filter(i => i.courseId).map(i => i.courseId),
          phone: freshLead.phone || undefined,
        }).catch(() => {});
      }
    }
    // For sales/daqqi users: refresh salesOwnSubscribers so new subscriber appears immediately
    if (isSalesOnly || isDaqqiManager || isReceptionDaqqi) void fetchSalesData();
    // Auto-navigate: if booking was for DAQQI branch and user can see daqqi_clients, go there
    if (normBranchId(leadPayDraft.branch || freshLead.branch || '') === 'DAQQI' && (isDaqqiManager || isReceptionDaqqi || isAdmin)) {
      setActiveTab('daqqi_clients');
    }
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
    if (!subInstRow || !subInstDraft.courseId || !subInstDraft.numInstallments) return;
    const row = subInstRow;
    const payments = row.paymentHistory || [];
    const isAllSel = subInstDraft.courseId === '__all__';
    const isBundleSel = !isAllSel && subInstDraft.courseId.startsWith('bundle:');
    let expectedAmount: number;
    let paidAmount: number;
    let resolvedCourseId: string | undefined;
    let resolvedTitle: string | undefined;
    if (isAllSel) {
      const rowBundles = bundles.filter(b => b.courses.length > 0 && b.courses.every(co => row.enrolledCourseIds.includes(co.id)));
      const bundledCids = new Set(rowBundles.flatMap(b => b.courses.map(c => c.id)));
      const partIds = (row.enrolledCourseIds || []).filter((cid: string) => !bundledCids.has(cid));
      if (subInstDraft.overrideExpected) {
        expectedAmount = Number(subInstDraft.overrideExpected);
      } else {
        expectedAmount = 0;
        rowBundles.forEach(b => {
          const bCids = b.courses.map(c => c.id);
          const bPays = payments.filter(p => bCids.includes(p.courseId || '') || p.courseId === `bundle:${b.id}`);
          const nb = bPays.find(p => !p.isInstallment);
          expectedAmount += nb?.courseExpected || priceForCurrency(b.price, 'EGP') || b.courses.reduce((s, c) => s + (c.price?.EGP || 0), 0) || 0;
        });
        partIds.forEach((cid: string) => {
          const c = courses.find(x => x.id === cid);
          const cPays = payments.filter(p => p.courseId === cid);
          const nb = cPays.find(p => !p.isInstallment);
          expectedAmount += nb?.courseExpected || c?.price?.EGP || 0;
        });
      }
      paidAmount = payments.filter(p => !p.isInstallment).reduce((s, p) => s + (Number(p.amount) || 0), 0);
      resolvedCourseId = undefined;
      resolvedTitle = 'كل الكورسات';
    } else if (isBundleSel) {
      const bid = subInstDraft.courseId.replace('bundle:', '');
      const b = bundles.find(x => x.id === bid);
      const bCids = b?.courses.map(c => c.id) || [];
      const bPays = payments.filter(p => bCids.includes(p.courseId || '') || p.courseId === subInstDraft.courseId || (!p.courseId && !row.enrolledCourseIds.some((cid: string) => !bCids.includes(cid))));
      expectedAmount = subInstDraft.overrideExpected
        ? Number(subInstDraft.overrideExpected)
        : (priceForCurrency(b?.price, 'EGP') || b?.courses.reduce((s, c) => s + (c.price?.EGP || 0), 0) || 0);
      paidAmount = bPays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      resolvedCourseId = undefined;
      resolvedTitle = b?.title;
    } else {
      const cid = subInstDraft.courseId;
      const cPays = payments.filter(p => p.courseId === cid || (!p.courseId && payments.length === 1));
      const c = courses.find(x => x.id === cid);
      const bookingEntry = cPays.find(p => !p.isInstallment);
      expectedAmount = subInstDraft.overrideExpected
        ? Number(subInstDraft.overrideExpected)
        : (bookingEntry?.courseExpected || c?.price?.EGP || 0);
      paidAmount = cPays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      resolvedCourseId = cid;
      resolvedTitle = c?.title;
    }
    const remaining = Math.max(0, expectedAmount - paidAmount);
    if (remaining <= 0) { notify('info', 'المبلغ المتبقي صفر — لا يوجد أقساط للإنشاء.'); return; }
    const n = Math.max(1, Number(subInstDraft.numInstallments));
    const perInstRaw = subInstDraft.inputMode === 'amount' && subInstDraft.amountPerInst
      ? Number(subInstDraft.amountPerInst) : Math.floor(remaining / n);
    const perInst = Math.max(1, perInstRaw);
    const actualN = subInstDraft.inputMode === 'amount' && subInstDraft.amountPerInst
      ? Math.ceil(remaining / perInst) : n;
    const intervalDays = Number(subInstDraft.intervalDays || 30);
    const startDate = new Date(subInstDraft.startDate);
    const entries: InstallmentEntry[] = Array.from({ length: actualN }, (_, i) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i * intervalDays);
      const isLast = i === actualN - 1;
      return { id: `ie-${Date.now()}-${i}`, amount: isLast ? Math.max(1, remaining - perInst * (actualN - 1)) : perInst, currency: subInstDraft.currency, dueDate: d.toISOString().slice(0, 10) };
    });
    const plan: InstallmentPlan = {
      id: `ip-${Date.now()}`, courseId: resolvedCourseId, courseTitle: resolvedTitle,
      totalAmount: remaining, currency: subInstDraft.currency,
      downPayment: paidAmount > 0 ? paidAmount : undefined,
      entries, notes: subInstDraft.notes || undefined,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    updateSubscriber({ ...row, installmentPlans: [...(row.installmentPlans || []), plan] });
    notify('success', `تم إنشاء خطة الأقساط (${actualN} قسط) بنجاح.`);
    setSubInstRow(null);
    setSubInstDraft({ courseId: '', currency: 'EGP', amountPerInst: '', numInstallments: '3', inputMode: 'count', startDate: new Date().toISOString().slice(0, 10), intervalDays: '30', notes: '', overrideExpected: '' });
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
      setBulkUploadNotice(`تم إضافة ${added} عميل من فيسبوك.`);
      setTimeout(() => setBulkUploadNotice(''), 4000);
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  // -- General CSV Import ----------------------------------------------------
  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) || '';
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) { notify('error', 'الملف فارغ أو لا يحتوي صفوف بيانات.'); return; }
      // Parse CSV (simple — handles quoted values)
      const parseLine = (line: string): string[] => {
        const res: string[] = [];
        let cur = '';
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
          if (line[i] === '"') { inQ = !inQ; continue; }
          if (line[i] === ',' && !inQ) { res.push(cur.trim()); cur = ''; continue; }
          cur += line[i];
        }
        res.push(cur.trim());
        return res;
      };
      const headers = parseLine(lines[0]);
      const rows = lines.slice(1).map(l => {
        const vals = parseLine(l);
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
        return obj;
      }).filter(r => Object.values(r).some(v => v));
      setCsvHeaders(headers);
      setCsvRows(rows);
      // Auto-detect column mapping
      const autoMap: Record<string, string> = {};
      headers.forEach(h => {
        const hl = h.toLowerCase();
        if (hl.includes('name') || hl.includes('اسم')) autoMap[h] = 'name';
        else if (hl.includes('phone') || hl.includes('تليفون') || hl.includes('هاتف') || hl.includes('موبايل')) autoMap[h] = 'phone';
        else if (hl.includes('email') || hl.includes('بريد') || hl.includes('ايميل')) autoMap[h] = 'email';
        else if (hl.includes('source') || hl.includes('مصدر')) autoMap[h] = 'source';
        else if (hl.includes('note') || hl.includes('ملاحظ')) autoMap[h] = 'notes';
        else if (hl.includes('branch') || hl.includes('فرع')) autoMap[h] = 'branch';
        else if (hl.includes('status') || hl.includes('حالة')) autoMap[h] = 'status';
        else if (hl.includes('tag') || hl.includes('وسم')) autoMap[h] = 'tags';
        else autoMap[h] = 'skip';
      });
      setCsvMapping(autoMap);
      setCsvImportOpen(true);
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };
  const handleCsvImport = () => {
    if (!csvRows.length) return;
    setCsvImporting(true);
    let added = 0;
    const now = new Date().toLocaleString('ar-EG', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    for (const row of csvRows) {
      const get = (field: string) => {
        const col = Object.entries(csvMapping).find(([, v]) => v === field)?.[0];
        return col ? (row[col] || '') : '';
      };
      const name = get('name') || '';
      const phone = get('phone') || '';
      const email = get('email') || '';
      if (!name && !phone && !email) continue;
      // Dedup
      const isDup = leads.some(l =>
        (phone && (l.phone || '').replace(/\D/g,'') === phone.replace(/\D/g,'')) ||
        (email && email.length > 3 && (l.email || '').toLowerCase() === email.toLowerCase())
      );
      if (isDup) continue;
      const rawTags = get('tags');
      const tags = rawTags ? rawTags.split(/[,?|]/).map(t => t.trim()).filter(Boolean) : [];
      addLead({
        id: `csv-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
        name: name || 'عميل مستورد',
        email, phone,
        source: get('source') || 'استيراد CSV',
        status: (['new','contacted','interested','not_interested','no_answer','closed','converted','lost'].includes(get('status')) ? get('status') : 'new') as LeadStatus,
        leadType: 'course',
        enrolledCourseId: '',
        branch: 'other',
        interestLevel: 'medium',
        assignedSalesId: '',
        assignedSalesName: '',
        communications: [],
        notes: get('notes') || '',
        tags: tags.length ? tags : undefined,
        createdAt: now,
      });
      added++;
    }
    setCsvImporting(false);
    setCsvImportOpen(false);
    setCsvRows([]);
    setCsvHeaders([]);
    setCsvMapping({});
    notify('success', `تم استيراد ${added} عميل بنجاح.`);
  };

  // -- Facebook Lead Ads: Fetch available forms from Graph API ---------------
  const handleFetchFbForms = async () => {
    const token = fbDraft.pageAccessToken.trim();
    const pageId = fbDraft.pageId.trim();
    if (!token || !pageId) { setFbSyncNotice('أدخل Page ID و Access Token أولاً.'); return; }
    setFbFormsLoading(true);
    setFbSyncNotice('');
    try {
      const url = `https://graph.facebook.com/v19.0/${pageId}/leadgen_forms?access_token=${encodeURIComponent(token)}&fields=id,name,status&limit=50`;
      const res = await fetch(url);
      const data = await res.json() as { data?: {id:string;name:string;status:string}[]; error?: {message:string} };
      if (data.error) { setFbSyncNotice(`خطأ: ${data.error.message}`); return; }
      setFbAvailableForms(data.data || []);
      if ((data.data || []).length === 0) setFbSyncNotice('لا توجد نماذج. تأكد من صحة الـ Page ID والـ Access Token.');
    } catch {
      setFbSyncNotice('فشل الاتصال بـ Facebook Graph API. تأكد من الإعدادات والاتصال بالإنترنت.');
    } finally {
      setFbFormsLoading(false);
    }
  };

  // -- Facebook Lead Ads: Sync leads from Graph API --------------------------
  const handleFbApiSync = async () => {
    const token = fbDraft.pageAccessToken.trim();
    if (!token) { setFbSyncNotice('أدخل Access Token أولاً.'); return; }
    const enabledForms = fbDraft.adForms.filter(f => f.enabled);
    if (enabledForms.length === 0) { setFbSyncNotice('اختر نموذجاً واحداً على الأقل.'); return; }
    setFbSyncLoading(true);
    setFbSyncNotice('');
    let totalAdded = 0;
    let totalSkipped = 0;
    try {
      for (const form of enabledForms) {
        let nextUrl: string | null =
          `https://graph.facebook.com/v19.0/${form.formId}/leads?fields=id,created_time,field_data&access_token=${encodeURIComponent(token)}&limit=100`;
        while (nextUrl) {
          const res = await fetch(nextUrl);
          const data = await res.json() as {
            data?: { id: string; created_time: string; field_data: { name: string; values: string[] }[] }[];
            paging?: { next?: string };
            error?: { message: string };
          };
          if (data.error) { setFbSyncNotice(`خطأ API: ${data.error.message}`); nextUrl = null; break; }
          for (const entry of (data.data || [])) {
            const fields = Object.fromEntries((entry.field_data || []).map(f => [f.name.toLowerCase(), f.values?.[0] || '']));
            const name = fields['full_name'] || fields['name'] || fields['first_name'] + ' ' + (fields['last_name'] || '') || 'عميل فيسبوك';
            const phone = fields['phone_number'] || fields['phone'] || '';
            const email = fields['email'] || '';
            // Dedup by fbLeadId or phone or email
            const isDup = leads.some(l =>
              l.fbLeadId === entry.id ||
              (phone && l.phone === phone) ||
              (email && email.length > 3 && l.email.toLowerCase() === email.toLowerCase())
            );
            if (isDup) { totalSkipped++; continue; }
            addLead({
              id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name: name.trim() || 'عميل فيسبوك',
              email: email || '',
              phone: phone || '',
              source: `Facebook Lead Ads — ${form.formName}`,
              status: fbDraft.defaultStatus,
              leadType: fbDraft.defaultLeadType,
              enrolledCourseId: '',
              interestedCourseIds: (form.courseId || fbDraft.defaultInterestedCourseId) ? [(form.courseId || fbDraft.defaultInterestedCourseId)!] : [],
              branch: ((form.branch || fbDraft.defaultBranch) || undefined) as BranchType | undefined,
              interestLevel: 'medium',
              assignedSalesId: fbDraft.defaultAssignedSalesId || '',
              assignedSalesName: staffMembers.find(s => s.id === fbDraft.defaultAssignedSalesId)?.name || '',
              communications: [],
              notes: `مصدر: Facebook Lead Form "${form.formName}"${fields['city'] ? `\nالمدينة: ${fields['city']}` : ''}${fields['job_title'] ? `\nالمهنة: ${fields['job_title']}` : ''}`,
              fbLeadId: entry.id,
              fbFormId: form.formId,
              fbFormName: form.formName,
              createdAt: new Date(entry.created_time).toLocaleString('ar-EG', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
            });
            totalAdded++;
          }
          nextUrl = data.paging?.next || null;
        }
      }
      const newConfig: FacebookLeadAdsConfig = {
        ...fbDraft,
        lastSyncAt: new Date().toISOString(),
        totalImported: (fbLeadAdsConfig?.totalImported || 0) + totalAdded,
        updatedAt: new Date().toISOString(),
      };
      setFbLeadAdsConfig(newConfig);
      setFbDraft(newConfig);
      setFbSyncNotice(`✅ تم: إضافة ${totalAdded} عميل جديد (تخطي ${totalSkipped} مكرر).`);
    } catch {
      setFbSyncNotice('فشل الاتصال. تحقق من الإنترنت والإعدادات.');
    } finally {
      setFbSyncLoading(false);
    }
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
    return <StaffPermissionsLoading />;
  }

  // Show loading overlay while admin CRM bootstrap (Batch 1) is in progress
  if (isAdmin && !remoteReady) {
    return <AdminBootstrapLoading />;
  }

  return (
    <>
    <SiteDataStoreBridge />
    <div className={`min-h-screen bg-gradient-to-br from-gray-100 via-white to-primary-50/30 py-6 md:py-8${darkMode ? ' dark-dash' : ''}`}>
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
          darkMode={darkMode}
          toggleDarkMode={toggleDarkMode}
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

            {activeTab === 'kpi_dashboard' && (
              <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>}>
                <KpiDashboardTab notify={notify} />
              </Suspense>
            )}

            {activeTab === 'cohort_analysis' && (
              <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" /></div>}>
                <CohortAnalysisTab notify={notify} />
              </Suspense>
            )}

            {activeTab === 'daqqi_attendance' && (
              <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" /></div>}>
                <DaqqiAttendanceTab notify={(msg, type) => notify(type || 'info', msg)} />
              </Suspense>
            )}
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
                    authUser,
                    content,
                    updateOrderStatus,
                    addOrder,
                    deleteOrder,
                    exportFilteredOrdersCsv,
                  }}
                />
              </Suspense>
            )}

            {activeTab === 'consultations' && (<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"/></div>}><TabErrorBoundary><ConsultationCalendarTab notify={notify} /></TabErrorBoundary></Suspense>)}
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
            {activeTab === 'notifications' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <NotificationsAdminTab />
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

            {activeTab === 'activity' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" /></div>}>
                <ActivityTab isSalesOnly={isSalesOnly} />
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

            {activeTab === 'quizzes' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <QuizzesTab notify={notify} />
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

            {activeTab === 'live_streams' && (
              <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>}>
                <LiveStreamsTab notify={notify} />
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
    {/* --------------------------------------------------------------
        GLOBAL LEAD PAYMENT MODAL — used by ClientDbTab + QuickBook
    -------------------------------------------------------------- */}
    {leadPayRow && (
      <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black/20" />}>
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
      </Suspense>
    )}

    {/* --------------------------------------------------------------
        GLOBAL SUBSCRIBER PAYMENT MODAL — used by ClientDbTab + QuickBook
    -------------------------------------------------------------- */}
    {subPayRow && (
      <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black/20" />}>
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
      </Suspense>
    )}
    </>
  );
};

export default Dashboard;
