import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Suspense } from 'react';
import {
  AlertCircle, Archive, Award, BookOpen, CalendarPlus,
  Columns, CreditCard, EyeOff, Eye,
  Inbox, Link2, MessageSquare, MessageSquareText,
  Plus, Search, Share2, Tag, Trash2,
  Upload, Wallet, X,
} from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { useBranches } from '../../../hooks/useBranches';
import { mysqlAdmin, mysqlClient } from '../../../lib/mysqlapi';
import { useResizableCols } from '../../../components/useResizableCols';
import type {
  LeadItem, LeadStatus, CommunicationRecord, SalesTarget, Course, Bundle,
  BranchType, FacebookLeadAdsConfig, PaymentHistoryEntry, PaymentItemType,
  SubscriberItem, StaffMember, CourseAccessSetting,
} from '../../../types';
import { DEFAULT_CRM_SETTINGS } from './CrmSettingsModal';
import type { PaymentDraft } from '../../../components/PaymentModal';
import { createClientPaymentDraft } from '../../../lib/clientActionDrafts';
import type { CrmSettings, NotifyFn } from './CrmSettingsModal';
import { DEFAULT_SOURCES, ONLINE_EXCLUDED_SOURCES, isOnlineSource, EMPTY_LEAD_DRAFT } from './crmConstants';
import { LeadTable } from './LeadTable';
import { blankLead } from './leads/leadDrafts';
import { useLeadSubTab } from './leads/useLeadSubTab';
import type { ConvertLeadModalState } from './leads/ConvertLeadModal';
import { useLeadCommunicationsData, type LeadCommunicationFilter } from './leads/useLeadCommunicationsData';
import { useLeadPerformanceData } from './leads/useLeadPerformanceData';
import { useLeadFilteringData } from './leads/useLeadFilteringData';
import { useLeadQuickCommunication } from './leads/useLeadQuickCommunication';
import { useLeadRemindersData } from './leads/useLeadRemindersData';
import { useLeadOpsInsights } from './leads/useLeadOpsInsights';
import { useLeadAnalyticsData } from './leads/useLeadAnalyticsData';
import { useLeadEffectiveRecords } from './leads/useLeadEffectiveRecords';
import { useSalesTargetsStorage } from './leads/useSalesTargetsStorage';
import {
  BRANCH_ENUM_LABELS,
  COMM_ICON,
  COMM_LABEL,
  IL_LABEL,
  PIPELINE_COLS,
  PRESET_TAGS,
  ROTTEN_CFG,
  STATUS_CFG,
  getLeadBranchRaw,
  getRottenLevel,
  // getScoreBreakdown intentionally NOT imported — this file defines a richer local version
} from './leadUtils';


// ── Props interface ────────────────────────────────────────────────────────
interface LeadsTabProps {
  notify: NotifyFn;
  staffSelf?: StaffMember | null;
  salesOwnLeads?: LeadItem[];
  salesOwnSubscribers?: SubscriberItem[];
  salesDataLoading?: boolean;
  fetchSalesData?: () => void;
  setActiveTab?: (tab: string) => void;
  branchFilter?: string;
}

type StaffSelfSnapshot = {
  id?: string;
  role?: string;
  name?: string;
};

import { TagInput, getScoreBreakdown, LeadJourneyTimeline, QuickEditPanel, MultiSelectDropdown, crmSourceLabels, normBranchId, mkPromoCode, paymentTypeLabels, EVENT_CFG } from './leads/LeadSubcomponents';
import type { CertPricingMap } from './leads/LeadSubcomponents';
import { LeadsTabHeader } from './leads/LeadsTabHeader';
import { LeadFilterBar } from './leads/LeadFilterBar';
import { LeadSalesKpiStrip } from './leads/LeadSalesKpiStrip';
import { LeadEmptyDiagnostics } from './leads/LeadEmptyDiagnostics';
import type { StaleLeadRow } from './leads/LeadStaleLeadsPanel';
import { buildCsv, leadFromCsvRow, parseCsvText, parseFacebookCsvLeads } from './leads/leadCsvUtils';
import { fetchFacebookLeadForms, syncFacebookLeadAds } from './leads/leadFacebookGraphApi';

const LeadArchiveViews = React.lazy(() => import('./leads/LeadArchiveViews').then(module => ({ default: module.LeadArchiveViews })));
const LeadCommunicationsTimeline = React.lazy(() => import('./leads/LeadCommunicationsTimeline').then(module => ({ default: module.LeadCommunicationsTimeline })));
const LeadModalsHost = React.lazy(() => import('./leads/LeadModalsHost').then(module => ({ default: module.LeadModalsHost })));
const LeadPerformancePanel = React.lazy(() => import('./leads/LeadPerformancePanel').then(module => ({ default: module.LeadPerformancePanel })));
const LeadPerformanceOverview = React.lazy(() => import('./leads/LeadPerformanceOverview').then(module => ({ default: module.LeadPerformanceOverview })));
const LeadPipelineBoard = React.lazy(() => import('./leads/LeadPipelineBoard').then(module => ({ default: module.LeadPipelineBoard })));
const LeadRemindersPanel = React.lazy(() => import('./leads/LeadRemindersPanel').then(module => ({ default: module.LeadRemindersPanel })));

const LeadSectionFallback = () => (
  <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm font-bold text-gray-400">
    جاري تحميل قسم العملاء المحتملين...
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
export default function LeadsTab({ notify, staffSelf: staffSelfProp, salesOwnLeads, salesOwnSubscribers, salesDataLoading, fetchSalesData, setActiveTab: setActiveDashboardTab, branchFilter: workspaceBranchFilter }: LeadsTabProps) {
  const { leads, staffMembers, subscribers, courses, bundles, updateLead, addLead, reloadLeads, deleteLead, addSubscriber, updateSubscriber, authUser, isAdmin, fbLeadAdsConfig, setFbLeadAdsConfig, issueClientCodeAsync, content } = useSiteData();
  const instituteBranches = useBranches();
  const navigate = useNavigate();
  const currentStaff = useMemo(() =>
    staffMembers.find(s => s.email?.toLowerCase() === (authUser?.email ?? '').toLowerCase()) ?? staffSelfProp ?? null,
    [staffMembers, staffSelfProp, authUser]
  );
  const branchLabelMap = useMemo(() =>
    Object.fromEntries(instituteBranches.flatMap(b => [[b.id, b.label], [normBranchId(b.id), b.label]])),
    [instituteBranches]
  );
  const salesStaff = useMemo(() => staffMembers.filter(s => s.role === 'sales'), [staffMembers]);

  const statusDebounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Drag-and-drop between kanban columns
  const draggedLeadRef = useRef<LeadItem | null>(null);
  const [dragOverCol, setDragOverCol] = useState<LeadStatus | null>(null);

  const { subTab, setSubTab } = useLeadSubTab();
  const [lostReasonRow, setLostReasonRow] = useState<{ lead: LeadItem; newStatus: LeadStatus } | null>(null);
  const [rottenFilter, setRottenFilter] = useState(false);
  const [showHiddenLeads, setShowHiddenLeads] = useState(false);
  const [waRepId, setWaRepId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddLead, setShowAddLead] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const [singleStatus, setSingleStatus] = useState<LeadStatus | ''>('');
  const [crmSettings, setCrmSettings] = useState<CrmSettings>(DEFAULT_CRM_SETTINGS);
  const [searchTerm, setSearchTerm] = useState('');
  const [assignFilter, setAssignFilter] = useState<Set<string>>(new Set());
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [distributing, setDistributing] = useState(false);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [migratingBranches, setMigratingBranches] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<LeadStatus>>(new Set());
  const [courseFilter, setCourseFilter] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  useEffect(() => {
    setBranchFilter(workspaceBranchFilter || null);
  }, [workspaceBranchFilter]);
  const [targetMonth, setTargetMonth] = useState(new Date().toISOString().slice(0, 7));
  // Bulk WhatsApp
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [showBulkWA, setShowBulkWA] = useState(false);

  // Stale leads (server-fetched — leads not contacted in 7+ days)
  const [staleLeads, setStaleLeads] = useState<StaleLeadRow[]>([]);
  const [staleLoading, setStaleLoading] = useState(false);
  const [staleBulkMsg, setStaleBulkMsg] = useState('أهلاً {name} 💚 نتمنى تواصلك معنا لمعرفة المزيد عن برامجنا. فريق مهاد للدراسات النفسية 🌿');
  const [staleSending, setStaleSending] = useState(false);
  const [staleSelected, setStaleSelected] = useState<Set<string>>(new Set());

  // Due-today leads (server-fetched — follow-up date is today)
  const [dueToday, setDueToday] = useState<{
    id: string; name: string; phone: string; email: string;
    status: string; interest_level: string;
    next_follow_up_date: string; assigned_sales_name: string | null; overdue_days: number;
  }[]>([]);
  const [dueTodayLoading, setDueTodayLoading] = useState(false);

  // Self staff — for role-based UI gating (SALES vs admin)
  const [selfStaff, setSelfStaff] = useState<{ id: string; role: string; name: string } | null>(null);
  useEffect(() => {
    mysqlClient.getStaffSelf()
      .then((s: StaffSelfSnapshot) => { if (s?.id) setSelfStaff({ id: s.id, role: s.role || '', name: s.name || '' }); })
      .catch(() => {});
  }, []);
  const isSalesOnly = selfStaff?.role === 'sales' || staffSelfProp?.role === 'sales';
  const { effectiveLeads, effectiveSubs } = useLeadEffectiveRecords({
    leads,
    subscribers,
    isSalesOnly,
    selfStaff,
    staffSelfProp,
    salesOwnLeads,
    salesOwnSubscribers,
  });
  // Sales users: do NOT auto-set assignFilter — salesOwnLeads is already pre-filtered server-side

  // Close actions menu on outside click
  useEffect(() => {
    if (!showActionsMenu) return;
    const handler = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setShowActionsMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showActionsMenu]);

  // Load CRM settings on mount
  useEffect(() => {
    mysqlAdmin.getCrmSettings().then(data => {
      if (data && (data as Partial<CrmSettings>).leadSources?.length) {
        setCrmSettings(x => ({ ...x, ...(data as Partial<CrmSettings>) }));
      }
    }).catch(() => {});
  }, []);

  const refreshStaleLeads = useCallback(() => {
    setStaleLoading(true);
    mysqlAdmin.adminGet<StaleLeadRow[]>('/api/admin/crm/stale-leads?days=7')
      .then(data => { setStaleLeads(Array.isArray(data) ? data : []); })
      .catch(() => {})
      .finally(() => setStaleLoading(false));
  }, []);

  const sendStaleBulkWhatsapp = useCallback(async () => {
    if (!staleBulkMsg.trim() || staleSelected.size === 0) return;
    setStaleSending(true);
    try {
      const selectedLeads = staleLeads
        .filter(lead => staleSelected.has(lead.id))
        .map(lead => ({ id: lead.id, phone: lead.phone, name: lead.name }));
      const result = await mysqlAdmin.adminPost<{ sent: number; failed: number }>('/api/admin/crm/bulk-whatsapp', { leads: selectedLeads, message: staleBulkMsg });
      notify('success', `تم الإرسال: ${result.sent} رسالة ✅`);
      setStaleSelected(new Set());
      const fresh = await mysqlAdmin.adminGet<StaleLeadRow[]>('/api/admin/crm/stale-leads?days=7');
      setStaleLeads(Array.isArray(fresh) ? fresh : []);
    } catch (e: unknown) {
      notify('error', (e as Error).message || 'فشل الإرسال');
    } finally {
      setStaleSending(false);
    }
  }, [notify, staleBulkMsg, staleLeads, staleSelected]);

  const refreshDueToday = useCallback(() => {
    setDueTodayLoading(true);
    mysqlAdmin.adminGet<typeof dueToday>('/api/admin/crm/follow-up-due')
      .then(data => { setDueToday(Array.isArray(data) ? data : []); })
      .catch(() => {})
      .finally(() => setDueTodayLoading(false));
  }, []);

  // Fetch stale leads + due-today leads when reminders tab is active
  useEffect(() => {
    if (subTab !== 'reminders') return;
    refreshStaleLeads();
    refreshDueToday();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  // Pagination: how many cards shown per column (default 15)
  const [colLimit, setColLimit] = useState<Record<LeadStatus, number>>(
    Object.fromEntries(Object.keys(STATUS_CFG).map(k => [k, 15])) as Record<LeadStatus, number>
  );
  const { salesTargets, saveSalesTargets } = useSalesTargetsStorage();


  // ── Extra state (payment / convert / FB / CRM contact) ──────────────────
  const [salesNotifOpen, setSalesNotifOpen] = useState(false);
  const [editingLeadId, setEditingLeadId] = useState('');
  const [isLeadFormOpen, setIsLeadFormOpen] = useState(false);
  const [leadDraft, setLeadDraft] = useState<LeadItem>(blankLead());
  const [bulkUploadNotice, setBulkUploadNotice] = useState('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const [convertLeadModal, setConvertLeadModal] = useState<ConvertLeadModalState>({ lead: null, courseId: '', accessMode: 'full' });
  const [leadPayRow, setLeadPayRow] = useState<LeadItem | null>(null);
  const [leadPayDraft, setLeadPayDraft] = useState<PaymentDraft>(createClientPaymentDraft());
  const [showDiscountSection, setShowDiscountSection] = useState(false);
  const [leadPayPrintData, setLeadPayPrintData] = useState<null | {
    subName: string; phone: string; courseName: string;
    items: { label: string; amount: number; currency: string }[];
    total: number; currency: string; method: string; date: string;
    note?: string; bookingType: string; courseExpected: number;
    prevPaid: number; remaining: number; staffName: string; transactionId?: string;
  }>(null);
  const [fbDraft, setFbDraft] = useState<FacebookLeadAdsConfig>(() => fbLeadAdsConfig ?? ({
    enabled: false, pageId: '', pageAccessToken: '', appId: '', webhookVerifyToken: '',
    adForms: [], defaultLeadType: 'course' as LeadItem['leadType'],
    defaultStatus: 'new' as LeadStatus,
    defaultInterestedCourseId: '', defaultAssignedSalesId: '',
    autoSyncEnabled: false, totalImported: 0, updatedAt: '',
  }));
  const [fbIntegOpen, setFbIntegOpen] = useState(false);
  const [fbSyncLoading, setFbSyncLoading] = useState(false);
  const [fbSyncNotice, setFbSyncNotice] = useState('');
  const [fbFormsLoading, setFbFormsLoading] = useState(false);
  const [fbAvailableForms, setFbAvailableForms] = useState<{ id: string; name: string; status: string }[]>([]);
  const [crmContactRow, setCrmContactRow] = useState<LeadItem | null>(null);
  const [crmContactDraft, setCrmContactDraft] = useState<{
    type: CommunicationRecord['type']; date: string; notes: string;
    outcome: string; nextFollowUp: string; newStatus: LeadStatus | '';
  }>({ type: 'whatsapp', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '', newStatus: '' });
  const [leadsSearch, setLeadsSearch] = useState('');
  const [leadsStatusFilter, setLeadsStatusFilter] = useState<string[]>([]);
  const [leadsBranchFilter, setLeadsBranchFilter] = useState<'all' | string>('all');
  const [leadsSalesFilter, setLeadsSalesFilter] = useState<string>('all');
  const [leadsCourseFilter, setLeadsCourseFilter] = useState<string>('all');
  const [leadsFollowupFilter, setLeadsFollowupFilter] = useState<'all' | 'today' | 'overdue' | 'past3d' | 'past7d' | 'past30d' | 'next3d' | 'next7d' | 'no_followup'>('all');
  const [salesSourceFilter, setSalesSourceFilter] = useState<string>('');

  // ── Smart redistribution threshold (admin-tunable) ───────────────────────
  const [smartIdleDays, setSmartIdleDays] = useState(7);
  // ── Communications tab state ─────────────────────────────────────────────
  const [commFilter, setCommFilter] = useState<LeadCommunicationFilter>({ staffId: '', type: '', dateFrom: '', dateTo: '', search: '' });
  const {
    showAddComm,
    setShowAddComm,
    addCommDraft,
    setAddCommDraft,
    addCommSearchResults,
    handleLeadSearchChange,
    selectLeadForCommunication,
    saveQuickCommunication,
  } = useLeadQuickCommunication({ effectiveLeads, updateLead });
  // ── Reminders tab state ──────────────────────────────────────────────────
  const [reminderStaffFilter, setReminderStaffFilter] = useState('');
  const [reminderView, setReminderView] = useState<'list' | 'kanban'>('kanban');
  const [snoozeIds, setSnoozeIds] = useState<Set<string>>(new Set());
  const {
    overdue,
    today: reminderToday,
    upcoming,
    overdueFiltered,
    todayFiltered,
    upcomingFiltered,
    completionRate,
    snooze1Day,
    markDone,
  } = useLeadRemindersData({
    leads,
    reminderStaffFilter,
    snoozeIds,
    updateLead,
    setSnoozeIds,
  });

  const salesReps = useMemo(() =>
    staffMembers.filter(s =>
      (s.role || '').toLowerCase() === 'sales' &&
      s.status === 'active'
    ),
    [staffMembers]
  );
  const {
    todayStr: commTodayStr,
    allComms,
    filteredComms,
    callCount,
    waCount,
    meetingCount,
    uniqueLeadsToday,
    typeMeta: TYPE_META,
    exportCommsCsv,
    repStats,
  } = useLeadCommunicationsData(effectiveLeads, commFilter, salesReps);

  const { weeklyScorecard, smartRedistCandidates } = useLeadOpsInsights(leads, salesReps, smartIdleDays);

  const { activeLead, assignedReps, visibleLeads, scoredLeads, activeStatusCols, overdueLeads, today } = useLeadFilteringData({
    effectiveLeads,
    leads,
    salesReps,
    selectedId,
    isSalesOnly,
    assignFilter,
    searchTerm,
    tagFilter,
    sourceFilter,
    courseFilter,
    branchFilter,
    singleStatus,
    showHiddenLeads,
    rottenFilter,
    salesSourceFilter,
    leadsFollowupFilter,
    statusFilter,
    instituteBranches,
  });

  const leadFiltersActive = Boolean(
    searchTerm.trim() ||
    assignFilter.size ||
    tagFilter ||
    sourceFilter.size ||
    statusFilter.size ||
    courseFilter ||
    branchFilter ||
    singleStatus ||
    showHiddenLeads ||
    rottenFilter ||
    salesSourceFilter ||
    leadsFollowupFilter !== 'all'
  );

  const clearLeadFilters = useCallback(() => {
    setSearchTerm('');
    setAssignFilter(new Set());
    setTagFilter(null);
    setSourceFilter(new Set());
    setStatusFilter(new Set());
    setCourseFilter(null);
    setBranchFilter(workspaceBranchFilter || null);
    setSingleStatus('');
    setShowHiddenLeads(false);
    setRottenFilter(false);
    setSalesSourceFilter('');
    setLeadsFollowupFilter('all');
  }, [workspaceBranchFilter]);

  const { salesPerformance, commsByRep } = useLeadPerformanceData(salesReps, leads, subscribers, salesTargets, targetMonth);

  const { monthlyTrend, funnelData, sourcesData, totalConverted, totalLost } = useLeadAnalyticsData(leads, effectiveLeads);


  const waActiveRep = waRepId ? salesReps.find(r => r.id === waRepId) ?? null : null;

  const handleSave = (updated: LeadItem) => {
    updateLead(updated);
    setSelectedId(null);
    notify('success', 'تم حفظ بيانات العميل');
  };

  const handleSyncSheet = async () => {
    setSyncingSheet(true);
    try {
      const r = await mysqlAdmin.syncAllSheets();
      await reloadLeads();
      notify('success', `تمت المزامنة · ${r.imported} جديد، ${r.skipped} مكرر`);
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'فشلت المزامنة');
    } finally {
      setSyncingSheet(false);
    }
  };

  const handleDistribute = async () => {
    if (salesReps.length === 0) return notify('error', 'لا يوجد مندوبو مبيعات');
    setDistributing(true);
    try {
      const validRepIds = new Set(salesReps.map(r => r.id));
      // Include unassigned leads AND leads assigned to reps no longer active
      const toAssign = leads.filter(l =>
        !l.hidden && !['converted', 'lost'].includes(l.status) &&
        (!l.assignedSalesId || !validRepIds.has(l.assignedSalesId))
      );
      if (toAssign.length === 0) return notify('info', 'جميع الليدز النشطة لديها مندوب مُعيَّن');
      const updates = toAssign.map((lead, i) => {
        const rep = salesReps[i % salesReps.length];
        return { ...lead, assignedSalesId: rep.id, assignedSalesName: rep.name };
      });
      for (const u of updates) await updateLead(u);
      notify('success', `تم توزيع ${toAssign.length} ليد على ${salesReps.length} مندوب بالتساوي`);
    } finally {
      setDistributing(false);
    }
  };

  const handleMigrateBranches = async () => {
    const missing = leads.filter(l => !l.hidden && !l.branch);
    if (missing.length === 0) return notify('info', 'جميع العملاء لديهم فرع مُعيَّن بالفعل');
    setMigratingBranches(true);
    let updated = 0;
    try {
      // Normalize helper: strip spaces, dashes, underscores, leading ال
      const norm = (s: string) => s.toLowerCase().replace(/[\s_\-]/g, '').replace(/^ال/, '');

      // Build list of all known branches with their normalized aliases
      const allBranches: { id: string; aliases: string[] }[] = [
        ...instituteBranches.map(b => ({ id: b.id, aliases: [norm(b.id), norm(b.label)] })),
        ...Object.entries(BRANCH_ENUM_LABELS).map(([k, v]) => ({ id: k, aliases: [norm(k), norm(v)] })),
      ];

      // Find branch id by scanning free text for any branch alias
      const detectBranch = (text: string): string | null => {
        const nt = norm(text);
        for (const br of allBranches) {
          for (const alias of br.aliases) {
            if (!alias || alias.length < 3) continue;
            if (nt === alias || nt.includes(alias)) return br.id;
          }
        }
        return null;
      };

      for (const lead of missing) {
        // 1. Try "الفرع: X" / "فرع: X" / "branch: X" pattern first
        let branchId: string | null = null;
        if (lead.notes) {
          const m = /(?:الفرع|فرع|branch)\s*[:\-]\s*([^|\n،,\|]+)/i.exec(lead.notes);
          if (m) branchId = detectBranch(m[1].trim());
        }
        // 2. If not found via prefix, scan all text fields freely
        if (!branchId) {
          const allText = [lead.notes, lead.source]
            .filter(Boolean).join(' ');
          branchId = detectBranch(allText);
        }
        if (!branchId) continue;
        await updateLead({ ...lead, branch: branchId });
        updated++;
      }
      if (updated > 0) {
        notify('success', `تم تحديث الفرع لـ ${updated} عميل`);
        reloadLeads();
      } else {
        notify('info', `لم يُعثر على اسم فرع معروف في بيانات ${missing.length} عميل — تأكد أن الملاحظات تحتوي على اسم الفرع`);
      }
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      setMigratingBranches(false);
    }
  };

  const handleAddLead = async (draft: typeof EMPTY_LEAD_DRAFT & { interestedCourseIds: string[] }) => {
    const mySelfId   = selfStaff?.id   || staffSelfProp?.id;
    const mySelfName = selfStaff?.name || staffSelfProp?.name;

    // For sales-only users, always assign the lead to themselves (staffMembers context is empty for sales)
    let resolvedSalesId = isSalesOnly && mySelfId ? mySelfId : draft.assignedSalesId;

    if (!isSalesOnly) {
      if (draft.autoAssign && salesReps.length > 0) {
        // Explicit "auto" selection → least-loaded rep
        const repCounts = salesReps.map(r => ({
          r,
          count: leads.filter(l => l.assignedSalesId === r.id && !['converted', 'lost'].includes(l.status)).length,
        }));
        const leastLoaded = repCounts.sort((a, b) => a.count - b.count)[0]?.r;
        if (leastLoaded) resolvedSalesId = leastLoaded.id;
      } else if (draft.assignedSalesId === '__rr__' && salesReps.length > 0) {
        // Explicit round-robin selection
        const idx = parseInt(localStorage.getItem('crm.rrIndex') || '0') % salesReps.length;
        localStorage.setItem('crm.rrIndex', String((idx + 1) % salesReps.length));
        resolvedSalesId = salesReps[idx].id;
      } else if (!resolvedSalesId && salesReps.length > 0) {
        // No manual assignment → use global setting, default to least-loaded
        const autoMode = crmSettings.autoAssign || 'least';
        if (autoMode === 'rr') {
          const idx = parseInt(localStorage.getItem('crm.rrIndex') || '0') % salesReps.length;
          localStorage.setItem('crm.rrIndex', String((idx + 1) % salesReps.length));
          resolvedSalesId = salesReps[idx].id;
        } else {
          // 'least' or any other value → assign to least-loaded rep
          const repCounts = salesReps.map(r => ({
            r,
            count: leads.filter(l => l.assignedSalesId === r.id && !['converted', 'lost'].includes(l.status)).length,
          }));
          const leastLoaded = repCounts.sort((a, b) => a.count - b.count)[0]?.r;
          if (leastLoaded) resolvedSalesId = leastLoaded.id;
        }
      }
    }

    const rep = isSalesOnly && mySelfId
      ? { id: mySelfId, name: mySelfName || '' }
      : salesReps.find(r => r.id === resolvedSalesId);
    const newLead: LeadItem = {
      id: `lead-${Date.now()}`,
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      notes: draft.notes.trim() || undefined,
      status: draft.status,
      interestLevel: draft.interestLevel,
      source: draft.source,
      leadType: 'general',
      assignedSalesId: resolvedSalesId && resolvedSalesId !== '__rr__' ? resolvedSalesId : undefined,
      assignedSalesName: rep?.name || undefined,
      interestedCourseIds: draft.interestedCourseIds,
      branch: (draft.branch || undefined) as LeadItem['branch'],
      tags: draft.tags.length > 0 ? draft.tags : undefined,
      communications: [],
      createdAt: new Date().toISOString(),
      hidden: false,
    };
    await addLead(newLead);
    notify('success', `تم إضافة ${newLead.name} بنجاح`);
    // Refresh sales user's own data so new lead appears immediately in CRM list
    if (isSalesOnly && fetchSalesData) fetchSalesData();
  };
  const handleStatusChange = (lead: LeadItem, status: LeadStatus) => {
    // Debounce: if user changes status twice quickly, only the last change is saved
    const existing = statusDebounceRef.current.get(lead.id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      updateLead({ ...lead, status });
      statusDebounceRef.current.delete(lead.id);
      notify('success', `${lead.name} → ${STATUS_CFG[status].label}`);
    }, 600);
    statusDebounceRef.current.set(lead.id, timer);
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Extra handlers from LeadsTab
  // ═══════════════════════════════════════════════════════════════════════

  const exportLeadsCsv = () => {
    const rows = leads;
    if (rows.length === 0) return;
    const header = ['id', 'name', 'phone', 'email', 'status', 'source', 'branch', 'leadType', 'assignedSalesName', 'createdAt', 'notes'];
    const csvRows = rows.map(r => [r.id, r.name, r.phone, r.email, r.status, r.source, r.branch, r.leadType, r.assignedSalesName, r.createdAt, r.notes]);
    const csv = buildCsv([header, ...csvRows]);
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


  const openLeadBook = (row: LeadItem) => {
    setLeadPayRow(row);
    const defaultCourseId = row.interestedCourseIds?.[0] || row.enrolledCourseId || '';
    const currency = (['ONLINE_SAUDI', 'ONLINE_ABROAD'].includes(normBranchId(row.branch))) ? 'SAR' : 'EGP';
    setLeadPayDraft(createClientPaymentDraft({ courseId: defaultCourseId, currency, branch: row.branch || '', email: row.email || '' }));
  };


  const handleLeadPayment = async (draft: PaymentDraft) => {
    if (!leadPayRow) return;
    // shadow leadPayDraft so handler body needs no changes
    const _courseItems = draft.paymentType === 'course'
      ? [{ courseId: draft.courseId, amount: draft.amount, discountPct: draft.discountPct, customExpected: draft.customExpected }]
      : [];
    const leadPayDraft = {
      ...draft,
      courseItems: _courseItems,
      transferRef: draft.fromAccountNumber,
      discountCustom: '',
    };
    const freshLead = effectiveLeads.find(l => l.id === leadPayRow.id) || leadPayRow;
    const _isCustomPrice = leadPayDraft.discountPct === 'custom';
    const _customFinalPrice = _isCustomPrice ? Number(leadPayDraft.discountCustom) : 0;
    const _discountPct = _isCustomPrice ? 0 : Number(leadPayDraft.discountPct);
    const _totalOrig = leadPayDraft.paymentType === 'course'
      ? leadPayDraft.courseItems.reduce((s, i) => s + (Number(i.amount) || 0), 0)
      : Number(leadPayDraft.amount);
    const _applyDiscount = (amt: number) => {
      if (_isCustomPrice && _customFinalPrice > 0 && _totalOrig > 0) return Math.round(_customFinalPrice * amt / _totalOrig);
      return _discountPct > 0 ? Math.round(amt * (1 - _discountPct / 100)) : amt;
    };
    // Lookup system price for a course/bundle by ID
    const _getSystemPrice = (courseId: string): number => {
      if (courseId.startsWith('bundle:')) {
        const bId = courseId.replace('bundle:', '');
        const b = bundles.find(bx => bx.id === bId);
        return (b?.price as unknown as Record<string,number>)?.[leadPayDraft.currency] || (b?.price as unknown as Record<string,number>)?.EGP || 0;
      }
      const c = courses.find(cx => cx.id === courseId);
      return (c?.price as unknown as Record<string,number>)?.[leadPayDraft.currency] || (c?.price as unknown as Record<string,number>)?.EGP || 0;
    };
    const _getExpectedPrice = (courseId: string, fallbackAmount: number): number => {
      const sysPrice = _getSystemPrice(courseId);
      if (_isCustomPrice && _customFinalPrice > 0) return _customFinalPrice;
      if (sysPrice > 0 && _discountPct > 0) return Math.round(sysPrice * (1 - _discountPct / 100));
      return sysPrice || fallbackAmount;
    };
    // Branch-based access level for new enrollments
    const _branchForAccess = normBranchId(leadPayDraft.branch || freshLead.branch || '');
    const _isOnlineBranch = ['ONLINE_EGYPT', 'ONLINE_SAUDI', 'ONLINE_ABROAD'].includes(_branchForAccess);
    const _newCourseAccess: CourseAccessSetting = _isOnlineBranch
      ? { mode: 'limited', lectureLimit: 20 }
      : { mode: 'preview' };
    // Build price note for courses
    const _buildCourseNote = (courseId: string, advanceAmt: number): string => {
      const sysPrice = _getSystemPrice(courseId);
      if (sysPrice > 0 && _discountPct > 0) {
        const afterDiscount = Math.round(sysPrice * (1 - _discountPct / 100));
        return `سعر الكورس: ${sysPrice.toLocaleString()}، خصم ${_discountPct}%، بعد الخصم: ${afterDiscount.toLocaleString()}، مقدم: ${advanceAmt.toLocaleString()}`;
      }
      if (sysPrice > 0 && _isCustomPrice && _customFinalPrice > 0) {
        return `سعر الكورس: ${sysPrice.toLocaleString()}، سعر نهائي: ${_customFinalPrice.toLocaleString()}، مقدم: ${advanceAmt.toLocaleString()}`;
      }
      if (sysPrice > 0 && advanceAmt > 0 && advanceAmt < sysPrice) {
        return `سعر الكورس: ${sysPrice.toLocaleString()}، مقدم: ${advanceAmt.toLocaleString()}`;
      }
      return '';
    };
    const noteParts = [leadPayDraft.note, leadPayDraft.transactionId, leadPayDraft.transferRef ? `تحويل: ${leadPayDraft.transferRef}` : '', leadPayDraft.nationalId ? `ر.ق: ${leadPayDraft.nationalId}` : '', leadPayDraft.branch ? `فرع: ${branchLabelMap[leadPayDraft.branch] || leadPayDraft.branch}` : '', leadPayDraft.paymentType === 'certificate' && leadPayDraft.certType ? leadPayDraft.certType : '', leadPayDraft.paymentType === 'book' && leadPayDraft.courseId ? `كتاب: ${courses.find(c => c.id === leadPayDraft.courseId)?.title || ''}` : ''].filter(Boolean);
    const isMultiCourse = leadPayDraft.paymentType === 'course';

    const normPhone = (freshLead.phone || '').replace(/\D/g, '');
    const normEmail = (freshLead.email || '').toLowerCase().trim();
    const existingSub = effectiveSubs.find(s =>
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
          const isBundleItem = item.courseId.startsWith('bundle:');
          const bundleId = isBundleItem ? item.courseId.replace('bundle:', '') : undefined;
          const expectedPrice = _getExpectedPrice(item.courseId, Number(item.amount));
          return {
            id: `pay-${Date.now()}-${item.courseId}`,
            amount: Number(item.amount),
            currency: leadPayDraft.currency,
            paymentType: leadPayDraft.paymentType as PaymentItemType,
            isInstallment: leadPayDraft.bookingType === 'installment',
            courseId: isBundleItem ? undefined : (item.courseId || undefined),
            bundleId,
            courseExpected: leadPayDraft.bookingType === 'new_booking' && expectedPrice > 0 ? expectedPrice : undefined,
            note: [...noteParts, _buildCourseNote(item.courseId, Number(item.amount))].filter(Boolean).join(' | ') || undefined,
            paymentMethod: leadPayDraft.paymentMethod || undefined,
            transactionId: leadPayDraft.transactionId || undefined,
            fromAccountNumber: leadPayDraft.transferRef || undefined,
            at: leadPayDraft.date,
          } as PaymentHistoryEntry;
        }),
        ...(leadPayDraft.extraItems || []).filter(i => i.amount && Number(i.amount) > 0).map((i, ix) => ({
          id: `pay-${Date.now()}-xtra-${ix}`,
          amount: Number(i.amount),
          currency: leadPayDraft.currency,
          paymentType: i.type as PaymentItemType,
          isInstallment: leadPayDraft.bookingType === 'installment',
          note: [i.label, ...noteParts].filter(Boolean).join(' | ') || undefined,
          paymentMethod: leadPayDraft.paymentMethod || undefined,
          at: leadPayDraft.date,
        } as PaymentHistoryEntry)),
      ];
      // Expand bundle:b-xxx → individual course IDs so enrolledCourseIds never stores raw bundle IDs
      const enrollIds: string[] = [];
      for (const item of validItems) {
        if (item.courseId.startsWith('bundle:')) {
          const bId = item.courseId.replace('bundle:', '');
          const bObj = bundles.find((b: { id: string; courses: { id: string }[] }) => b.id === bId);
          if (bObj) enrollIds.push(...bObj.courses.map((c: { id: string }) => c.id));
          else enrollIds.push(item.courseId);
        } else {
          enrollIds.push(item.courseId);
        }
      }
      const enrollIds_unique = [...new Set(enrollIds)];
      const courseAccessPatch = Object.fromEntries(enrollIds_unique.map(id => [id, _newCourseAccess]));

      if (existingSub) {
        const allCourseIds = [...new Set([...(existingSub.enrolledCourseIds || []), ...enrollIds_unique])];
        updateSubscriber({
          ...existingSub,
          enrolledCourseIds: allCourseIds,
          courseAccess: { ...(existingSub.courseAccess ?? {}), ...courseAccessPatch },
          paymentHistory: [...(existingSub.paymentHistory || []), ...payEntries],
          leadId: existingSub.leadId || freshLead.id,
          email: leadPayDraft.email || existingSub.email,
        });
      } else {
        const added = await addSubscriber({
          id: `sub-${Date.now()}`, clientCode: freshLead.clientCode || await issueClientCodeAsync(),
          leadId: freshLead.id, name: freshLead.name, email: leadPayDraft.email || freshLead.email, phone: freshLead.phone,
          enrolledCourseIds: enrollIds_unique, courseAccess: courseAccessPatch,
          paymentHistory: payEntries, branch: ((leadPayDraft.branch || freshLead.branch) as BranchType) || undefined,
          status: 'active', assignedSalesId: freshLead.assignedSalesId, assignedSalesName: freshLead.assignedSalesName,
          createdAt: new Date().toLocaleString('ar-EG', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        });
        if (!added) { notify('error', 'فشل إنشاء المشترك'); return; }
      }
      updatedLead = { ...updatedLead, status: 'converted', email: leadPayDraft.email || updatedLead.email };
    } else {
      // Single payment (installment or non-course type)
      if (!leadPayDraft.amount) return;
      const singlePaymentIsBundle = Boolean(leadPayDraft.courseId?.startsWith('bundle:'));
      const singlePaymentBundleId = singlePaymentIsBundle ? leadPayDraft.courseId.replace('bundle:', '') : undefined;
      const singlePaymentExpected = leadPayDraft.courseId
        ? _getExpectedPrice(leadPayDraft.courseId, Number(leadPayDraft.amount))
        : 0;
      const payHistEntry: PaymentHistoryEntry = {
        id: `pay-${Date.now()}`, amount: _applyDiscount(Number(leadPayDraft.amount)),
        currency: leadPayDraft.currency, paymentType: leadPayDraft.paymentType as PaymentItemType,
        isInstallment: leadPayDraft.bookingType === 'installment',
        courseId: singlePaymentIsBundle ? undefined : (leadPayDraft.courseId || undefined),
        bundleId: singlePaymentBundleId,
        courseExpected: leadPayDraft.bookingType === 'new_booking' && singlePaymentExpected > 0 ? singlePaymentExpected : undefined,
        note: noteParts.join(' | ') || undefined,
        paymentMethod: leadPayDraft.paymentMethod || undefined,
        transactionId: leadPayDraft.transactionId || undefined,
        fromAccountNumber: leadPayDraft.transferRef || undefined,
        at: leadPayDraft.date,
      };
      if (leadPayDraft.bookingType === 'new_booking' && leadPayDraft.paymentType === 'course' && leadPayDraft.courseId) {
        // Expand bundle ID to actual course IDs for single-item booking too
        const singleCourseId = leadPayDraft.courseId;
        let singleEnrollIds: string[];
        if (singleCourseId.startsWith('bundle:')) {
          const bId = singleCourseId.replace('bundle:', '');
          const bObj = bundles.find((b: { id: string; courses: { id: string }[] }) => b.id === bId);
          singleEnrollIds = bObj ? bObj.courses.map((c: { id: string }) => c.id) : [singleCourseId];
        } else {
          singleEnrollIds = [singleCourseId];
        }
        const singleAccessPatch = Object.fromEntries(singleEnrollIds.map(id => [id, _newCourseAccess]));
        if (existingSub) {
          const newCourseIds = [...new Set([...(existingSub.enrolledCourseIds || []), ...singleEnrollIds])];
          const singleNote = [...noteParts, _buildCourseNote(leadPayDraft.courseId, Number(leadPayDraft.amount))].filter(Boolean).join(' | ') || undefined;
          updateSubscriber({ ...existingSub, enrolledCourseIds: newCourseIds, courseAccess: { ...(existingSub.courseAccess ?? {}), ...singleAccessPatch }, paymentHistory: [...(existingSub.paymentHistory || []), { ...payHistEntry, note: singleNote }], leadId: existingSub.leadId || freshLead.id, email: leadPayDraft.email || existingSub.email });
        } else {
          const singleNote = [...noteParts, _buildCourseNote(leadPayDraft.courseId, Number(leadPayDraft.amount))].filter(Boolean).join(' | ') || undefined;
          const added = await addSubscriber({ id: `sub-${Date.now()}`, clientCode: freshLead.clientCode || await issueClientCodeAsync(), leadId: freshLead.id, name: freshLead.name, email: leadPayDraft.email || freshLead.email, phone: freshLead.phone, enrolledCourseIds: singleEnrollIds, courseAccess: singleAccessPatch, paymentHistory: [{ ...payHistEntry, note: singleNote }], branch: ((leadPayDraft.branch || freshLead.branch) as BranchType) || undefined, status: 'active', assignedSalesId: freshLead.assignedSalesId, assignedSalesName: freshLead.assignedSalesName, createdAt: new Date().toLocaleString('ar-EG', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) });
          if (!added) { notify('error', 'فشل إنشاء المشترك'); return; }
        }
        updatedLead = { ...updatedLead, status: 'converted', email: leadPayDraft.email || updatedLead.email };
      } else if (existingSub) {
        updateSubscriber({ ...existingSub, paymentHistory: [...(existingSub.paymentHistory || []), payHistEntry] });
      } else {
        await addSubscriber({ id: `sub-${Date.now()}`, clientCode: freshLead.clientCode || await issueClientCodeAsync(), leadId: freshLead.id, name: freshLead.name, email: freshLead.email, phone: freshLead.phone, enrolledCourseIds: [], paymentHistory: [payHistEntry], branch: ((leadPayDraft.branch || freshLead.branch) as BranchType) || undefined, status: 'active', assignedSalesId: freshLead.assignedSalesId, assignedSalesName: freshLead.assignedSalesName, createdAt: new Date().toLocaleString('ar-EG', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) });
      }
    }

    updateLead(updatedLead);

    setLeadPayRow(null);
    const _notifCourse = leadPayDraft.paymentType === 'course'
      ? leadPayDraft.courseItems.filter(i => i.courseId && i.amount).map(i => {
          if (i.courseId.startsWith('bundle:')) return bundles.find((b: {id:string;title:string}) => b.id === i.courseId.replace('bundle:', ''))?.title || '';
          return courses.find((c: {id:string;title:string}) => c.id === i.courseId)?.title || '';
        }).filter(Boolean).join(' + ')
      : '';
    const _notifAmt = leadPayDraft.paymentType === 'course'
      ? leadPayDraft.courseItems.reduce((s, i) => s + (Number(i.amount) || 0), 0)
      : Number(leadPayDraft.amount);
    notify('success', `✅ ${updatedLead.name}${_notifCourse ? ' — ' + _notifCourse : ''} | ${_notifAmt.toLocaleString()} ${leadPayDraft.currency}`);
    // Fire welcome email if new_booking for a course and email is available
    if (leadPayDraft.paymentType === 'course' && updatedLead.status === 'converted') {
      const _welcomeEmail = leadPayDraft.email || freshLead.email;
      if (_welcomeEmail && _welcomeEmail.includes('@')) {
        const _courseTitles = leadPayDraft.courseItems
          .filter(i => i.courseId)
          .map(i => {
            if (i.courseId.startsWith('bundle:')) {
              const bId = i.courseId.replace('bundle:', '');
              return bundles.find((b: { id: string; title: string }) => b.id === bId)?.title || i.courseId;
            }
            return courses.find((c: { id: string; title: string }) => c.id === i.courseId)?.title || i.courseId;
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
    // Refresh sales user's own data so new subscriber/payment appears immediately in عملائي and مدفوعاتي
    if (fetchSalesData) fetchSalesData();
    // Auto-navigate: if booking was for DAQQI branch, go to daqqi_clients tab (admins/managers only)
    const _branchNorm = (leadPayDraft.branch || freshLead.branch || '').toUpperCase().trim().replace(/[-\s]/g, '_');
    if ((_branchNorm === 'DAQQI' || _branchNorm === 'DQI') && setActiveDashboardTab && !isSalesOnly) {
      setActiveDashboardTab('daqqi_clients');
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


  const saveLeadDraft = () => {
    if (!leadDraft.name || !leadDraft.email) return;
    if (!leadDraft.branch) { notify('error', 'الفرع مطلوب — اختر الفرع أولاً'); return; }

    // Auto-assign to least-loaded sales rep for new leads (round-robin)

    let assignedSalesId = leadDraft.assignedSalesId || '';
    let assignedSalesName = leadDraft.assignedSalesName || '';
    if (!editingLeadId && !assignedSalesId && salesStaff.length > 0) {
      const counts = leads.reduce((acc: Record<string, number>, l) => {
        if (l.assignedSalesId) acc[l.assignedSalesId] = (acc[l.assignedSalesId] || 0) + 1;
        return acc;
      }, {});
      const sorted = [...salesStaff].sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0));
      assignedSalesId = sorted[0].id;
      assignedSalesName = sorted[0].name;
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
    if (editingLeadId) updateLead(payload); else addLead(payload);
    setEditingLeadId('');
    setIsLeadFormOpen(false);
    setLeadDraft(blankLead());
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
      const createdAt = new Date().toLocaleString('ar-EG', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const importedLeads = parseFacebookCsvLeads(text, leads, createdAt);
      if (!importedLeads) { setBulkUploadNotice('الملف فارغ أو غير صحيح.'); return; }
      importedLeads.forEach(addLead);
      const added = importedLeads.length;
      setBulkUploadNotice(`تم إضافة ${added} عميل من فيسبوك.`);
      setTimeout(() => setBulkUploadNotice(''), 4000);
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  // ── General CSV Import ────────────────────────────────────────────────────
  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) || '';
      const parsed = parseCsvText(text);
      if (!parsed) { notify('error', 'الملف فارغ أو لا يحتوي صفوف بيانات.'); return; }
      setCsvHeaders(parsed.headers);
      setCsvRows(parsed.rows);
      setCsvMapping(parsed.autoMap);
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
      const importedLead = leadFromCsvRow(row, csvMapping, leads, now);
      if (!importedLead) continue;
      addLead(importedLead);
      added++;
    }
    setCsvImporting(false);
    setCsvImportOpen(false);
    setCsvRows([]);
    setCsvHeaders([]);
    setCsvMapping({});
    notify('success', `تم استيراد ${added} عميل بنجاح.`);
  };

  // ── Facebook Lead Ads: Fetch available forms from Graph API ───────────────

  const handleFetchFbForms = async () => {
    const token = fbDraft.pageAccessToken.trim();
    const pageId = fbDraft.pageId.trim();
    if (!token || !pageId) { setFbSyncNotice('أدخل Page ID و Access Token أولاً.'); return; }
    setFbFormsLoading(true);
    setFbSyncNotice('');
    try {
      const forms = await fetchFacebookLeadForms(pageId, token);
      setFbAvailableForms(forms);
      if (forms.length === 0) setFbSyncNotice('لا توجد نماذج. تأكد من صحة الـ Page ID والـ Access Token.');
    } catch (error) {
      setFbSyncNotice(`فشل الاتصال بـ Facebook Graph API: ${error instanceof Error ? error.message : 'تأكد من الإعدادات والاتصال بالإنترنت.'}`);
    } finally {
      setFbFormsLoading(false);
    }
  };

  // ── Facebook Lead Ads: Sync leads from Graph API ──────────────────────────
  const handleFbApiSync = async () => {
    const token = fbDraft.pageAccessToken.trim();
    if (!token) { setFbSyncNotice('أدخل Access Token أولاً.'); return; }
    const enabledForms = fbDraft.adForms.filter(f => f.enabled);
    if (enabledForms.length === 0) { setFbSyncNotice('اختر نموذجاً واحداً على الأقل.'); return; }
    setFbSyncLoading(true);
    setFbSyncNotice('');
    try {
      const result = await syncFacebookLeadAds({
        config: { ...fbDraft, totalImported: fbLeadAdsConfig?.totalImported || fbDraft.totalImported || 0 },
        leads,
        staffMembers,
        addLead,
      });
      setFbLeadAdsConfig(result.updatedConfig);
      setFbDraft(result.updatedConfig);
      setFbSyncNotice(`✅ تم: إضافة ${result.added} عميل جديد (تخطي ${result.skipped} مكرر).`);
    } catch (error) {
      setFbSyncNotice(`فشل الاتصال: ${error instanceof Error ? error.message : 'تحقق من الإنترنت والإعدادات.'}`);
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

  const handleExportVisibleLeadsCsv = () => {
    const headers = ['الاسم', 'الهاتف', 'البريد', 'المصدر', 'الحالة', 'مستوى الاهتمام', 'المندوب', 'تاريخ الإنشاء'];
    const rows = visibleLeads.map(l => [
      l.name,
      l.phone,
      l.email || '',
      l.source || '',
      l.status,
      l.interestLevel || '',
      l.assignedSalesName || '',
      (l.createdAt || '').slice(0, 10),
    ]);
    const csv = buildCsv([headers, ...rows]);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCleanupJunkLeads = async () => {
    if (!window.confirm('سيتم إخفاء العملاء المحتملين بدون اسم ولا هاتف. تأكيد؟')) return;
    try {
      const r = await mysqlAdmin.adminPost('/api/admin/cleanup-junk-leads', {}) as Record<string, unknown>;
      notify('success', `تم إخفاء ${r.hidden as number} سجل جنك`);
      reloadLeads();
    } catch {
      notify('error', 'فشل التنظيف');
    }
  };


  return (
    <div className="space-y-4" dir="rtl">
      {/* Row 1: Title + tabs + primary actions — all on one line */}
      <LeadsTabHeader
        isSalesOnly={isSalesOnly}
        totalOfflineLeads={leads.filter(l => !l.hidden && !isOnlineSource(l.source)).length}
        overdueCount={overdueLeads.length}
        rottenCount={effectiveLeads.filter(l => !l.hidden && getRottenLevel(l) >= 2).length}
        dueTodayCount={dueToday.length}
        subTab={subTab}
        setSubTab={setSubTab}
        onAddLead={() => setShowAddLead(true)}
        showActionsMenu={showActionsMenu}
        actionsMenuRef={actionsMenuRef}
        onToggleActionsMenu={() => setShowActionsMenu(v => !v)}
        onCloseActionsMenu={() => setShowActionsMenu(false)}
        onOpenSettings={() => setShowSettings(true)}
        notify={notify}
        onSyncSheet={handleSyncSheet}
        syncingSheet={syncingSheet}
        onMigrateBranches={handleMigrateBranches}
        migratingBranches={migratingBranches}
        onExportCsv={handleExportVisibleLeadsCsv}
        bulkMode={bulkMode}
        selectedLeadCount={selectedLeadIds.size}
        onToggleBulkMode={() => { setBulkMode(b => !b); setSelectedLeadIds(new Set()); }}
        onOpenBulkWhatsApp={() => setShowBulkWA(true)}
        onCleanupJunk={handleCleanupJunkLeads}
      />

      <LeadSalesKpiStrip
        isSalesOnly={isSalesOnly}
        effectiveLeads={effectiveLeads}
        effectiveSubs={effectiveSubs}
      />

      {/* ─── border separator under the top row ─── */}
      <div className="border-b border-gray-100 -mt-1" />

      <LeadFilterBar
        visible={subTab === 'pipeline' || subTab === 'table'}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        isSalesOnly={isSalesOnly}
        assignedReps={assignedReps}
        assignFilter={assignFilter}
        setAssignFilter={setAssignFilter}
        singleStatus={singleStatus}
        setSingleStatus={setSingleStatus}
        courses={courses}
        bundles={bundles}
        courseFilter={courseFilter}
        setCourseFilter={setCourseFilter}
        branchFilter={branchFilter}
        setBranchFilter={setBranchFilter}
        instituteBranches={instituteBranches}
        effectiveLeads={effectiveLeads}
        salesSourceFilter={salesSourceFilter}
        setSalesSourceFilter={setSalesSourceFilter}
        leadsFollowupFilter={leadsFollowupFilter}
        setLeadsFollowupFilter={setLeadsFollowupFilter}
        showHiddenLeads={showHiddenLeads}
        setShowHiddenLeads={setShowHiddenLeads}
        totalConverted={totalConverted}
        totalLost={totalLost}
        visibleLeadsCount={visibleLeads.length}
      />

      <LeadEmptyDiagnostics
        visible={subTab === 'pipeline' || subTab === 'table'}
        isSalesOnly={isSalesOnly}
        salesDataLoading={salesDataLoading}
        totalLeads={leads.length}
        effectiveCount={effectiveLeads.length}
        visibleCount={visibleLeads.length}
        filtersActive={leadFiltersActive}
        currentStaffName={currentStaff?.name || selfStaff?.name || authUser?.email || ''}
        onClearFilters={clearLeadFilters}
        onReload={reloadLeads}
        onOpenLeadSources={setActiveDashboardTab ? () => setActiveDashboardTab('lead_sources_settings') : undefined}
      />

      {/* ═══════════════ PIPELINE ═══════════════ */}
      {subTab === 'pipeline' && (
        <Suspense fallback={<LeadSectionFallback />}>
          <LeadPipelineBoard
            activeStatusCols={activeStatusCols}
            scoredLeads={scoredLeads}
            colLimit={colLimit}
            setColLimit={setColLimit}
            dragOverCol={dragOverCol}
            setDragOverCol={setDragOverCol}
            draggedLeadRef={draggedLeadRef}
            bulkMode={bulkMode}
            selectedLeadIds={selectedLeadIds}
            setSelectedLeadIds={setSelectedLeadIds}
            setSelectedId={setSelectedId}
            handleStatusChange={handleStatusChange}
            openLeadBook={openLeadBook}
            setCrmContactRow={setCrmContactRow}
            setCrmContactDraft={setCrmContactDraft}
            instituteBranches={instituteBranches}
            courses={courses}
            bundles={bundles}
          />
        </Suspense>
      )}

      {/* ═══════════════ REMINDERS ═══════════════ */}

      {/* ─── TABLE VIEW ──────────────────────────────────────────────── */}
      {subTab === 'table' && (
        <LeadTable
          rows={scoredLeads}
          showCourseCol={true}
          courses={courses}
          bundles={bundles}
          navigate={navigate}
          updateLead={updateLead}
          deleteLead={deleteLead ?? (() => Promise.resolve())}
          addSubscriber={addSubscriber ?? ((_: SubscriberItem) => Promise.resolve(false))}
          updateSubscriber={updateSubscriber ?? (() => Promise.resolve())}
          subscribers={effectiveSubs}
          salesStaff={salesReps}
          isSalesOnly={isSalesOnly}
          onBook={openLeadBook}
          branchOptions={instituteBranches}
          sources={crmSettings.leadSources.length > 0 ? crmSettings.leadSources : DEFAULT_SOURCES}
        />
      )}

      {subTab === 'communications' && (
        <Suspense fallback={<LeadSectionFallback />}>
          <LeadCommunicationsTimeline
            todayStr={commTodayStr}
            callCount={callCount}
            waCount={waCount}
            meetingCount={meetingCount}
            uniqueLeadsToday={uniqueLeadsToday}
            repStats={repStats}
            filteredComms={filteredComms}
            allComms={allComms}
            commFilter={commFilter}
            setCommFilter={setCommFilter}
            salesReps={salesReps}
            isSalesOnly={isSalesOnly}
            showAddComm={showAddComm}
            setShowAddComm={setShowAddComm}
            addCommDraft={addCommDraft}
            setAddCommDraft={setAddCommDraft}
            addCommSearchResults={addCommSearchResults}
            handleLeadSearchChange={handleLeadSearchChange}
            selectLeadForCommunication={selectLeadForCommunication}
            saveQuickCommunication={saveQuickCommunication}
            exportCommsCsv={exportCommsCsv}
            effectiveLeads={effectiveLeads}
            setSelectedId={setSelectedId}
            typeMeta={TYPE_META}
          />
        </Suspense>
      )}

      {subTab === 'communications' && (
        <Suspense fallback={<LeadSectionFallback />}>
          <LeadRemindersPanel
            overdueCount={overdue.length}
            todayCount={reminderToday.length}
            upcomingCount={upcoming.length}
            completionRate={completionRate}
            reminderView={reminderView}
            setReminderView={setReminderView}
            isSalesOnly={isSalesOnly}
            reminderStaffFilter={reminderStaffFilter}
            setReminderStaffFilter={setReminderStaffFilter}
            salesReps={salesReps}
            snoozeCount={snoozeIds.size}
            onClearSnoozes={() => setSnoozeIds(new Set())}
            dueTodayLoading={dueTodayLoading}
            onRefreshDueToday={refreshDueToday}
            overdueFiltered={overdueFiltered}
            todayFiltered={todayFiltered}
            upcomingFiltered={upcomingFiltered}
            todayStr={todayStr}
            onSnooze={snooze1Day}
            onDone={markDone}
            onOpenLead={setSelectedId}
            staleLeads={staleLeads}
            staleLoading={staleLoading}
            staleBulkMsg={staleBulkMsg}
            staleSending={staleSending}
            staleSelected={staleSelected}
            setStaleBulkMsg={setStaleBulkMsg}
            setStaleSelected={setStaleSelected}
            onRefreshStaleLeads={refreshStaleLeads}
            onSendStaleBulk={sendStaleBulkWhatsapp}
          />
        </Suspense>
      )}

      {subTab === 'performance' && (
        <Suspense fallback={<LeadSectionFallback />}>
          <LeadPerformanceOverview
            targetMonth={targetMonth}
            setTargetMonth={setTargetMonth}
            salesReps={salesReps}
            handleDistribute={handleDistribute}
            distributing={distributing}
            leads={leads}
            salesPerformance={salesPerformance}
            salesTargets={salesTargets}
            saveSalesTargets={saveSalesTargets}
            weeklyScorecard={weeklyScorecard}
            smartIdleDays={smartIdleDays}
            setSmartIdleDays={setSmartIdleDays}
            smartRedistCandidates={smartRedistCandidates}
            updateLead={updateLead}
            notify={notify}
            navigate={navigate}
            scoredLeads={scoredLeads}
            totalConverted={totalConverted}
            overdueLeads={overdueLeads}
          />
        </Suspense>
      )}

      {/* ═══════════════ ANALYTICS / FEES ═══════════════ */}
      {subTab === 'performance' && (
        <Suspense fallback={<div className="text-center py-10 text-gray-400">جاري تحميل الرسوم...</div>}>
          <LeadPerformancePanel
            leads={leads}
            totalConverted={totalConverted}
            monthlyTrend={monthlyTrend}
            funnelData={funnelData}
            sourcesData={sourcesData}
            commsByRep={commsByRep}
          />
        </Suspense>
      )}

      {/* online25 section moved to Dashboard.tsx */}

      <Suspense fallback={null}>
        <LeadArchiveViews
          subTab={subTab}
          leads={leads}
          staffMembers={staffMembers}
          addLead={addLead}
          updateLead={updateLead}
          notify={notify}
          courses={courses}
          bundles={bundles}
          navigate={navigate}
          deleteLead={deleteLead ?? (() => Promise.resolve())}
          addSubscriber={addSubscriber ?? ((_: SubscriberItem) => Promise.resolve(false))}
          updateSubscriber={updateSubscriber ?? (() => Promise.resolve())}
          subscribers={effectiveSubs}
          salesReps={salesReps}
          isSalesOnly={isSalesOnly}
          onBook={openLeadBook}
          branchOptions={instituteBranches}
          sources={crmSettings.leadSources.length > 0 ? crmSettings.leadSources : DEFAULT_SOURCES}
        />
      </Suspense>

      {/* Quick Edit Panel */}
      {activeLead && (
        <QuickEditPanel
          lead={activeLead}
          onClose={() => setSelectedId(null)}
          onSave={handleSave}
          courses={courses}
          bundles={bundles}
          notify={notify}
          instituteBranches={instituteBranches}
        />
      )}

      <Suspense fallback={null}>
        <LeadModalsHost
          convertLeadModal={convertLeadModal}
          setConvertLeadModal={setConvertLeadModal}
          convertLeadToSubscriber={convertLeadToSubscriber}
          courses={courses}
          bundles={bundles}
          leadPayRow={leadPayRow}
          leadPayDraft={leadPayDraft}
          setLeadPayDraft={setLeadPayDraft}
          handleLeadPayment={handleLeadPayment}
          setLeadPayRow={setLeadPayRow}
          instituteBranches={instituteBranches}
          salesNotifOpen={salesNotifOpen}
          leads={leads}
          isSalesOnly={isSalesOnly}
          currentStaff={currentStaff}
          setSalesNotifOpen={setSalesNotifOpen}
          setLeadsFollowupFilter={setLeadsFollowupFilter}
          setActiveDashboardTab={setActiveDashboardTab}
          showSettings={showSettings}
          setShowSettings={setShowSettings}
          notify={notify}
          salesReps={salesReps}
          reloadLeads={reloadLeads}
          setCrmSettings={setCrmSettings}
          showAddLead={showAddLead}
          setShowAddLead={setShowAddLead}
          sources={crmSettings.leadSources}
          handleAddLead={handleAddLead}
          showBulkWA={showBulkWA}
          selectedLeads={leads.filter(l => selectedLeadIds.has(l.id))}
          closeBulkWhatsApp={() => { setShowBulkWA(false); setBulkMode(false); setSelectedLeadIds(new Set()); }}
          waActiveRep={waActiveRep}
          setWaRepId={setWaRepId}
        />
      </Suspense>
    </div>
  );
}
