import { QuickLogContactPanel } from './leads/QuickLogContactPanel';
import { cairoDateOnly } from '../../../../shared/cairoDate';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cairoMonthOnly } from '../../../../shared/cairoDate';
import { useNavigate } from 'react-router-dom';
import { AlarmClock, Phone } from 'lucide-react';
import { hasPermission as hasStaffPermission } from '../../../constants/permissions';
import type { PermissionKey, RoleKey } from '../../../constants/permissions';
import { Suspense } from 'react';
import { useSiteData } from '../../../context/SiteDataContext';
import { useBranches } from '../../../hooks/useBranches';
import type {
  LeadItem, LeadStatus, SubscriberItem, StaffMember,
} from '../../../types';
import type { PaymentDraft } from '../../../components/PaymentModal';
import { createClientPaymentDraft } from '../../../lib/clientActionDrafts';
import type { NotifyFn } from './CrmSettingsModal';
import { DEFAULT_SOURCES, isOnlineSource } from './crmConstants';
import { useLeadSubTab } from './leads/useLeadSubTab';
import type { ConvertLeadModalState } from './leads/ConvertLeadModal';
import { useLeadPerformanceData } from './leads/useLeadPerformanceData';
import { useServerLeadTable } from './leads/useServerLeadTable';
import { useLeadFilteringData } from './leads/useLeadFilteringData';
import { useLeadQuickCommunication } from './leads/useLeadQuickCommunication';
import { useLeadRemindersData } from './leads/useLeadRemindersData';
import { useLeadOpsInsights } from './leads/useLeadOpsInsights';
import { useCrmInsights } from './leads/useCrmInsights';
import { fullLeadArraySubTabs } from '../dashboardTabGroups';
import { useLeadAnalyticsData } from './leads/useLeadAnalyticsData';
import { useLeadEffectiveRecords } from './leads/useLeadEffectiveRecords';
import { useSalesTargetsStorage } from './leads/useSalesTargetsStorage';
import {
  STATUS_CFG,
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
  setActiveTab?: (tab: TabKey) => void;
  branchFilter?: string;
}

import { normBranchId } from './leads/leadBranchUtils';
import { LeadsTabHeader } from './leads/LeadsTabHeader';
import { LeadFilterBar } from './leads/LeadFilterBar';
import { LeadSalesKpiStrip } from './leads/LeadSalesKpiStrip';
import SectionCustomTabs from './SectionCustomTabs';
import { LeadEmptyDiagnostics } from './leads/LeadEmptyDiagnostics';
import { useLeadActions } from './leads/useLeadActions';
import { useLeadCrmBootstrap } from './leads/useLeadCrmBootstrap';
import { useLeadRemoteReminders } from './leads/useLeadRemoteReminders';
import { explainUnassigned, isLocalNewLead } from './leads/leadSourceGroups';
import type { TabKey } from '../navigation';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';

const LeadArchiveViews = React.lazy(() => import('./leads/LeadArchiveViews').then(module => ({ default: module.LeadArchiveViews })));
const LeadDuplicateReviewPanel = React.lazy(() => import('./leads/LeadDuplicateReviewPanel').then(module => ({ default: module.LeadDuplicateReviewPanel })));
const LeadModalsHost = React.lazy(() => import('./leads/LeadModalsHost').then(module => ({ default: module.LeadModalsHost })));
const LeadPerformancePanel = React.lazy(() => import('./leads/LeadPerformancePanel').then(module => ({ default: module.LeadPerformancePanel })));
const LeadPerformanceOverview = React.lazy(() => import('./leads/LeadPerformanceOverview').then(module => ({ default: module.LeadPerformanceOverview })));
const LeadPipelineBoard = React.lazy(() => import('./leads/LeadPipelineBoard').then(module => ({ default: module.LeadPipelineBoard })));
const LeadRemindersPanel = React.lazy(() => import('./leads/LeadRemindersPanel').then(module => ({ default: module.LeadRemindersPanel })));
const CrmQuotesWorkspace = React.lazy(() => import('./leads/CrmQuotesWorkspace').then(module => ({ default: module.CrmQuotesWorkspace })));
const CrmCoachingButton = React.lazy(() => import('./leads/CrmCoachingPanel').then(module => ({ default: module.CrmCoachingButton })));
const TeamDailyReport = React.lazy(() => import('./leads/TeamDailyReport').then(module => ({ default: module.TeamDailyReport })));
const LeadPipelineSettings = React.lazy(() => import('./leads/LeadPipelineSettings').then(module => ({ default: module.LeadPipelineSettings })));
const SalesOffersPanel = React.lazy(() => import('./leads/SalesOffersPanel'));
const LeadTable = React.lazy(() => import('./LeadTable').then(module => ({ default: module.LeadTable })));
const QuickEditPanel = React.lazy(() => import('./leads/LeadSubcomponents').then(module => ({ default: module.QuickEditPanel })));

const LeadSectionFallback = () => (
  <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm font-bold text-gray-400">
    جاري تحميل قسم العملاء المحتملين...
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
export default function LeadsTab({ notify, staffSelf: staffSelfProp, salesOwnLeads, salesOwnSubscribers, salesDataLoading, fetchSalesData, setActiveTab: setActiveDashboardTab, branchFilter: workspaceBranchFilter }: LeadsTabProps) {
  const {
    leads, leadStats, loadFullCrmData, loadFullLeads, staffMembers, subscribers, courses, bundles, updateLead, addLead,
    reloadLeads, reloadSubscribers, deleteLead, addSubscriber, updateSubscriber,
    authUser, isAdmin, recordSubscriberPayment, bulkRedistributeLeads,
    currentStaff: contextStaff,
  } = useSiteData();
  const instituteBranches = useBranches();
  const navigate = useNavigate();
  // From the context. This one already had the staffSelfProp fallback and so
  // was correct, but it was still a twelfth answer to the same question.
  const currentStaff = contextStaff ?? staffSelfProp ?? null;
  const branchLabelMap = useMemo(() =>
    Object.fromEntries(instituteBranches.flatMap(b => [[b.id, b.label], [normBranchId(b.id), b.label]])),
    [instituteBranches]
  );

  const statusDebounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => () => {
    statusDebounceRef.current.forEach(clearTimeout);
    statusDebounceRef.current.clear();
  }, []);
  // Drag-and-drop between kanban columns
  const draggedLeadRef = useRef<LeadItem | null>(null);
  const [dragOverCol, setDragOverCol] = useState<LeadStatus | null>(null);

  const { subTab, setSubTab } = useLeadSubTab();
  // The whole leads table, fetched only for the sub-tabs that scan it. Opening
  // the CRM used to pull all 26,878 rows before drawing anything; the landing
  // table is paginated and the panels beside it read aggregates, so nothing here
  // needs them until one of these four views is opened. loadFullCrmData()
  // de-duplicates its own in-flight promise, so repeated switching is one fetch.
  //
  // The pull takes seconds, and until it lands the pools count whatever has
  // arrived — a «محلي جديد» of a few leads that grows by itself — so the screen
  // says it is still loading, against the server's own total, instead of showing
  // the partial number as if it were the pool.
  const [fullLeadsState, setFullLeadsState] = useState<'loading' | 'ready' | 'failed'>('ready');
  const [fullLeadsAttempt, setFullLeadsAttempt] = useState(0);
  useEffect(() => {
    if (fullLeadArraySubTabs.has(subTab)) void loadFullCrmData();
  }, [subTab, loadFullCrmData, fullLeadsAttempt]);
  // loadFullCrmData settles both tables whatever happens, so it cannot tell a
  // failed leads pull from a finished one; loadFullLeads (the same cached
  // promise) rejects, and that is what the banner follows.
  useEffect(() => {
    if (!fullLeadArraySubTabs.has(subTab)) return undefined;
    let alive = true;
    setFullLeadsState('loading');
    loadFullLeads().then(
      () => { if (alive) setFullLeadsState('ready'); },
      () => { if (alive) setFullLeadsState('failed'); },
    );
    return () => { alive = false; };
  }, [subTab, loadFullLeads, fullLeadsAttempt]);
  const { crmSettings, setCrmSettings, pipelineStages, reloadPipeline, selfStaff } =
    useLeadCrmBootstrap(notify);
  const {
    staleLeads, staleLoading, staleBulkMsg, setStaleBulkMsg, staleSending,
    staleSelected, setStaleSelected, dueToday, dueTodayLoading,
    refreshStaleLeads, refreshDueToday, sendStaleBulkWhatsapp,
  } = useLeadRemoteReminders(subTab, notify);
  const [rottenFilter, setRottenFilter] = useState(false);
  const [showHiddenLeads, setShowHiddenLeads] = useState(false);
  const [waRepId, setWaRepId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddLead, setShowAddLead] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // The staff-built tabs dialog, opened from the header's الإعدادات menu.
  const [showSectionTabs, setShowSectionTabs] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const [singleStatus, setSingleStatus] = useState<LeadStatus | ''>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [assignFilter, setAssignFilter] = useState<Set<string>>(new Set());
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [distributing, setDistributing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveBefore, setArchiveBefore] = useState('');
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [migratingBranches, setMigratingBranches] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<LeadStatus>>(new Set());
  const [courseFilter, setCourseFilter] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<string | null>(null);

  useEffect(() => {
    setBranchFilter(workspaceBranchFilter || null);
  }, [workspaceBranchFilter]);
  const [targetMonth, setTargetMonth] = useState(cairoMonthOnly());
  // Bulk WhatsApp
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [showBulkWA, setShowBulkWA] = useState(false);

  // A collection officer works leads the way a rep does — their own list, no
  // desk tools. They were shown the manager's CRM: every tab, the team's
  // performance, the distribution panels — «ليه بيظهر في حساب التحصيل قيم
  // العملاء المحتملين كامله؟ خلي يظهرله زي ما بيظهر للسيلز».
  const isSalesOnly = ['sales', 'collection'].includes(String(selfStaff?.role || staffSelfProp?.role || '').toLowerCase());
  const permissionSubject = currentStaff
    ? {
        role: currentStaff.role as RoleKey,
        permissions: currentStaff.permissions as PermissionKey[] | undefined,
      }
    : null;
  const canExportLeads = isAdmin || hasStaffPermission(permissionSubject, 'export_leads');
  const canBulkWhatsApp = isAdmin || hasStaffPermission(permissionSubject, 'bulk_whatsapp');
  const canManageLeads = isAdmin || hasStaffPermission(permissionSubject, 'manage_leads');
  // Publishing an offer changes what a course may be sold for, so it sits behind
  // the same manager-level gate as sales targets — not `manage_leads`, which
  // every rep holds.
  const canViewReports = isAdmin || hasStaffPermission(permissionSubject, 'view_reports');
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

  // Pagination: how many cards shown per column (default 15)
  const [colLimit, setColLimit] = useState<Record<LeadStatus, number>>(
    Object.fromEntries(Object.keys(STATUS_CFG).map(k => [k, 15])) as Record<LeadStatus, number>
  );
  const { salesTargets, saveSalesTargets } = useSalesTargetsStorage(targetMonth);


  // ── Extra state (payment / convert / FB / CRM contact) ──────────────────
  const [salesNotifOpen, setSalesNotifOpen] = useState(false);
  const [convertLeadModal, setConvertLeadModal] = useState<ConvertLeadModalState>({ lead: null, courseId: '', accessMode: 'full' });
  const [leadPayRow, setLeadPayRow] = useState<LeadItem | null>(null);
  const [leadPayDraft, setLeadPayDraft] = useState<PaymentDraft>(createClientPaymentDraft());
  // crmContactRow / crmContactDraft used to live here: the pipeline board set
  // them when the contact button on a lead card was clicked, but no modal ever
  // read them back, so the button silently did nothing. Replaced by wiring that
  // button into the quick-communication modal below, which is the real flow for
  // logging a contact.
  const [leadsFollowupFilter, setLeadsFollowupFilter] = useState<'all' | 'today' | 'overdue' | 'past3d' | 'past7d' | 'past30d' | 'next3d' | 'next7d' | 'no_followup'>('all');
  const [salesSourceFilter, setSalesSourceFilter] = useState<string>('');

  // ── Smart redistribution threshold (admin-tunable) ───────────────────────
  const [smartIdleDays, setSmartIdleDays] = useState(7);
  // One request that answers what the reminders, scorecard and redistribution
  // panels used to answer by scanning every lead in the browser.
  const crmInsights = useCrmInsights(smartIdleDays);
  // ── Communications tab state ─────────────────────────────────────────────
  const {
    showAddComm,
    setShowAddComm,
    addCommDraft,
    setAddCommDraft,
    addCommSearchResults,
    handleLeadSearchChange,
    selectLeadForCommunication,
    saveQuickCommunication,
  } = useLeadQuickCommunication({ effectiveLeads, reloadLeads });
  // Contact button on a kanban lead card → open the quick-communication modal
  // already targeting that lead, instead of the dead state it used to set.
  const openContactLog = useCallback((lead: LeadItem) => {
    selectLeadForCommunication(lead);
    setShowAddComm(true);
  }, [selectLeadForCommunication, setShowAddComm]);
  // ── Reminders tab state ──────────────────────────────────────────────────
  const [reminderStaffFilter, setReminderStaffFilter] = useState('');
  const [reminderView, setReminderView] = useState<'list' | 'kanban'>('kanban');
  const [snoozeIds, setSnoozeIds] = useState<Set<string>>(new Set());
  const {
    overdue,
    today: reminderToday,
    upcoming,
    untouchedFiltered,
    promisedFiltered,
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
    insights: crmInsights,
  });

  const salesReps = useMemo(() =>
    staffMembers.filter(s =>
      (s.role || '').toLowerCase() === 'sales' &&
      s.status === 'active'
    ),
    [staffMembers]
  );
  // "محلي جديد" pool — the same predicate LeadArchiveViews lists, so the badge,
  // the counter and the table agree.
  const unassignedLeads = useMemo(() => leads.filter(isLocalNewLead), [leads]);
  // Where the leads nobody owns are, including the ones this tab does not list.
  const unassignedBreakdown = useMemo(
    () => (subTab === 'localNew' ? explainUnassigned(leads) : null), [leads, subTab]);

  const { weeklyScorecard, smartRedistCandidates } = useLeadOpsInsights(leads, salesReps, smartIdleDays, crmInsights);

  const {
    activeLead, assignedReps, visibleLeads, scoredLeads, activeStatusCols, overdueLeads,
    matchesFilters,
  } = useLeadFilteringData({
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
    pipelineColumns: pipelineStages.length
      ? pipelineStages.filter(stage => stage.showInPipeline).map(stage => stage.status as LeadStatus)
      : undefined,
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

  // The main table pages against the server instead of filtering the whole
  // leads array (leads/useServerLeadTable.ts).
  const serverTable = useServerLeadTable(subTab === 'table', {
    searchTerm, assignFilter, tagFilter, sourceFilter, courseFilter, branchFilter, singleStatus,
    showHiddenLeads, rottenFilter, salesSourceFilter, leadsFollowupFilter,
  }, instituteBranches);
  const refreshServerTable = serverTable.refresh;
  // An edit made from the table changes the row on the server; the page is
  // re-read so it shows what was saved.
  const tableUpdateLead = useCallback(async (item: LeadItem) => {
    const result = await updateLead(item);
    refreshServerTable();
    return result;
  }, [updateLead, refreshServerTable]);
  const tableReloadLeads = useCallback(async () => {
    await reloadLeads();
    refreshServerTable();
  }, [reloadLeads, refreshServerTable]);
  const tableDeleteLead = useCallback(async (id: string) => {
    await (deleteLead ?? (() => Promise.resolve()))(id);
    refreshServerTable();
  }, [deleteLead, refreshServerTable]);

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

  const { salesPerformance, commsByRep } = useLeadPerformanceData(salesReps, leads, subscribers, salesTargets, targetMonth, leadStats);

  // The CRM header's "N عميل محتمل" — every lead whose source is not one of the
  // online ones. It counted the array, which since this screen stopped loading
  // the table is the 500-row bootstrap page: the header read 500 against 27,012.
  //
  // bySource answers it exactly, because it is a count per source over the whole
  // table: total minus the online buckets is the offline count. Falls back to
  // the array until the aggregate lands.
  const offlineLeadTotal = useMemo(() => {
    if (!leadStats?.bySource) {
      return leads.filter(l => !l.hidden && !isOnlineSource(l.source)).length;
    }
    return Object.entries(leadStats.bySource)
      .filter(([source]) => !isOnlineSource(source))
      .reduce((sum, [, count]) => sum + count, 0);
  }, [leadStats, leads]);

  const { monthlyTrend, funnelData, sourcesData, totalConverted, totalLost } = useLeadAnalyticsData(leads, effectiveLeads, leadStats);


  const waActiveRep = waRepId ? salesReps.find(r => r.id === waRepId) ?? null : null;

  const {
    handleSave, handleSyncSheet, handleDistribute, handleMigrateBranches,
    handleAddLead, handleStatusChange, openLeadBook, handleLeadPayment,
    convertLeadToSubscriber, handleExportVisibleLeadsCsv, handleCleanupJunkLeads,
  } = useLeadActions({
    notify, updateLead, addLead, reloadLeads, reloadSubscribers,
    bulkRedistributeLeads,
    recordSubscriberPayment, fetchSalesData, setActiveDashboardTab,
    salesReps, leads, effectiveLeads, effectiveSubs, visibleLeads, bundles,
    courses, branchLabelMap, currentStaff, isAdmin, isSalesOnly: Boolean(isSalesOnly),
    statusDebounceRef, leadPayRow, setLeadPayRow, setLeadPayDraft,
    convertLeadModal, setConvertLeadModal, setSelectedId, setSyncingSheet,
    setDistributing, setMigratingBranches,
  });


  // Puts old unassigned data away in "محلي قديم" in one server call — the
  // alternative was editing thousands of leads one at a time. Nothing is
  // deleted; the rows can still be distributed from the archive tab.
  const handleMoveToArchive = async () => {
    setArchiving(true);
    try {
      const options = archiveBefore ? { createdBefore: archiveBefore } : {};
      const preview = await mysqlAdmin.moveLeadsToArchive({ ...options, dryRun: true });
      const matched = preview.matched || 0;
      if (!matched) { notify('info', 'لا يوجد عملاء غير موزّعين لنقلهم'); return; }
      const scope = archiveBefore ? ` المسجّلين قبل ${archiveBefore}` : '';
      if (!await confirmDialog(`نقل ${matched} عميل غير موزّع${scope} إلى تبويب «محلي قديم»؟ لن يُحذف أي شيء، ويمكن توزيعهم لاحقًا من هناك.`)) return;
      const result = await mysqlAdmin.moveLeadsToArchive(options);
      await reloadLeads();
      notify('success', `تم نقل ${result.moved || 0} عميل إلى «محلي قديم»`);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر النقل للأرشيف');
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Row 1: Title + tabs + primary actions — all on one line */}
      <LeadsTabHeader
        isSalesOnly={isSalesOnly}
        canAdministerCrm={isAdmin}
        canManageLeads={canManageLeads}
        canExportLeads={canExportLeads}
        canBulkWhatsApp={canBulkWhatsApp}
        canManageDuplicates={isAdmin}
        totalOfflineLeads={offlineLeadTotal}
        overdueCount={overdueLeads.length}
        unassignedCount={unassignedLeads.length}
        subTab={subTab}
        setSubTab={setSubTab}
        onAddLead={() => setShowAddLead(true)}
        showActionsMenu={showActionsMenu}
        actionsMenuRef={actionsMenuRef}
        onToggleActionsMenu={() => setShowActionsMenu(v => !v)}
        onCloseActionsMenu={() => setShowActionsMenu(false)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenSectionTabs={() => setShowSectionTabs(true)}
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

      {/* Staff-built tabs. Creating one lives in the header's own الإعدادات
          menu now — this drew a second gear here, halfway down the page, and a
          new tab appeared below beside «محلي قديم» rather than with the tabs. */}
      <SectionCustomTabs
        section="leads"
        notify={notify}
        onBook={openLeadBook}
        settingsOpen={showSectionTabs}
        onSettingsOpenChange={setShowSectionTabs}
      />

      <LeadSalesKpiStrip
        isSalesOnly={isSalesOnly}
        effectiveLeads={effectiveLeads}
        effectiveSubs={effectiveSubs}
      />

      {/* ─── border separator under the top row ─── */}
      <div className="border-b border-gray-100 -mt-1" />

      {fullLeadArraySubTabs.has(subTab) && leadStats && leads.length < leadStats.total && fullLeadsState !== 'ready' && (
        <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${fullLeadsState === 'failed' ? 'border-red-200 bg-red-50 text-red-800' : 'border-sky-200 bg-sky-50 text-sky-800'}`} role="status">
          {fullLeadsState === 'failed'
            ? <span>تعذّر تحميل كل الليدز — الأرقام هنا جزئية ({leads.length.toLocaleString('ar-EG-u-nu-latn')} من {leadStats.total.toLocaleString('ar-EG-u-nu-latn')}).</span>
            : <span>جاري تحميل كل الليدز… {leads.length.toLocaleString('ar-EG-u-nu-latn')} من {leadStats.total.toLocaleString('ar-EG-u-nu-latn')} — الأعداد تحت مؤقتة لحد ما يخلص.</span>}
          {fullLeadsState === 'failed' && (
            <button type="button" onClick={() => setFullLeadsAttempt(count => count + 1)} className="rounded-lg bg-red-600 px-3 py-1 text-white hover:bg-red-700">إعادة المحاولة</button>
          )}
        </div>
      )}

      {/* The archive views render the same table with the same actions, so
          they get the same controls — they had none at all. */}
      <LeadFilterBar
        visible={subTab === 'pipeline' || subTab === 'table' || ['archive', 'dawliOld', 'localNew'].includes(subTab)}
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
        knownSources={Object.keys(leadStats?.bySource || {})}
        visibleLeadsCount={subTab === 'table' ? serverTable.total : visibleLeads.length}
      />

      <LeadEmptyDiagnostics
        visible={subTab === 'pipeline' || (subTab === 'table' && !serverTable.loading && !serverTable.error)}
        isSalesOnly={isSalesOnly}
        salesDataLoading={salesDataLoading}
        totalLeads={leadStats?.total ?? leads.length}
        effectiveCount={subTab === 'table' ? (leadStats?.total ?? effectiveLeads.length) : effectiveLeads.length}
        visibleCount={subTab === 'table' ? serverTable.total : visibleLeads.length}
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
            canManageLeads={canManageLeads}
            selectedLeadIds={selectedLeadIds}
            setSelectedLeadIds={setSelectedLeadIds}
            setSelectedId={setSelectedId}
            handleStatusChange={handleStatusChange}
            onOutcomeRecorded={reloadLeads}
            openLeadBook={openLeadBook}
            onLogContact={openContactLog}
            instituteBranches={instituteBranches}
            courses={courses}
            bundles={bundles}
          />
        </Suspense>
      )}

      {/* ═══════════════ REMINDERS ═══════════════ */}

      {/* ─── TABLE VIEW ──────────────────────────────────────────────── */}
      {subTab === 'table' && (
        <Suspense fallback={<LeadSectionFallback />}>
          {serverTable.error && (
            <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              تعذّر تحميل الجدول: {serverTable.error}
              <button type="button" onClick={refreshServerTable} className="mr-2 underline">إعادة المحاولة</button>
            </div>
          )}
          <LeadTable
            rows={serverTable.rows}
            paging={{ page: serverTable.page, pageSize: serverTable.pageSize, total: serverTable.total, onPageChange: serverTable.setPage, loading: serverTable.loading }}
            showCourseCol={true}
            courses={courses}
            bundles={bundles}
            navigate={navigate}
            updateLead={tableUpdateLead}
            reloadLeads={tableReloadLeads}
            deleteLead={tableDeleteLead}
            addSubscriber={addSubscriber ?? ((_: SubscriberItem) => Promise.resolve(false))}
            updateSubscriber={updateSubscriber ?? (() => Promise.resolve())}
            subscribers={effectiveSubs}
            salesStaff={salesReps}
            isSalesOnly={isSalesOnly}
            canManageLeads={canManageLeads}
            onBook={openLeadBook}
            branchOptions={instituteBranches}
            sources={crmSettings.leadSources.length > 0 ? crmSettings.leadSources : DEFAULT_SOURCES}
            onSalesClick={!isSalesOnly ? (staffId: string) => navigate(`/staff/${staffId}`) : undefined}
          />
        </Suspense>
      )}

      {subTab === 'duplicates' && isAdmin && (
        <Suspense fallback={<LeadSectionFallback />}>
          <LeadDuplicateReviewPanel notify={notify} onChanged={reloadLeads} />
        </Suspense>
      )}

      {subTab === 'localNew' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-bold text-gray-900">محلي جديد — بانتظار التوزيع</h3>
              <p className="text-xs text-gray-500 mt-0.5">ليدات بدون مندوب مبيعات — وزّعها يدوياً من الجدول (عمود "المندوب") أو تلقائياً بالتساوي</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">غير موزّع: <strong className="text-amber-600">{unassignedLeads.length}</strong></span>
              {isAdmin && <button onClick={handleDistribute} disabled={distributing || unassignedLeads.length === 0}
                className="flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm hover:bg-emerald-700 disabled:opacity-40 transition whitespace-nowrap">
                {distributing ? 'جارٍ التوزيع...' : 'توزيع تلقائي'}
              </button>}
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-gray-500">
                    أقدم من
                    <input type="date" value={archiveBefore} onChange={e => setArchiveBefore(e.target.value)}
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
                  </label>
                  <button onClick={handleMoveToArchive} disabled={archiving || unassignedLeads.length === 0}
                    title="ينقل العملاء غير الموزّعين إلى تبويب محلي قديم — بدون حذف"
                    className="bg-gray-700 text-white px-4 py-2 rounded-xl text-sm hover:bg-gray-800 disabled:opacity-40 transition whitespace-nowrap">
                    {archiving ? 'جارٍ النقل...' : 'نقل للأرشيف'}
                  </button>
                </div>
              )}
            </div>
          </div>
          {unassignedBreakdown && unassignedBreakdown.withoutOwner > unassignedBreakdown.localNew && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 space-y-1" role="status">
              <p className="font-bold">
                في {unassignedBreakdown.withoutOwner.toLocaleString('ar-EG-u-nu-latn')} ليد بدون مندوب، المعروض هنا منهم {unassignedBreakdown.localNew.toLocaleString('ar-EG-u-nu-latn')} بس. الباقي موجود في أماكن تانية:
              </p>
              <ul className="list-disc pr-5 space-y-0.5">
                {unassignedBreakdown.dawliNew > 0 && <li>{unassignedBreakdown.dawliNew.toLocaleString('ar-EG-u-nu-latn')} في تبويب «داتا سعودي»</li>}
                {unassignedBreakdown.archiveSource > 0 && <li>{unassignedBreakdown.archiveSource.toLocaleString('ar-EG-u-nu-latn')} داتا مستوردة قديمة (محلي قديم / دولي قديم)</li>}
                {unassignedBreakdown.terminal.map(t => (
                  <li key={t.status}>
                    {t.count.toLocaleString('ar-EG-u-nu-latn')} حالتهم «{t.label}» — مش بتتوزع{t.status === 'archived' ? ' (الأرشفة التلقائية للليدات اللي محدش كلمها، من إعدادات الـCRM)' : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* The list itself is LeadArchiveViews' below — the one with bulk
              assignment. This section drew a second copy of the same pool, so
              the tab showed every waiting lead twice. */}
        </div>
      )}

      {/* An action, not a view: the button that opens it is on a pipeline card,
          so it has to be mounted beside the screen rather than inside one tab. */}
      <QuickLogContactPanel
        canManageLeads={canManageLeads}
        showAddComm={showAddComm}
        setShowAddComm={setShowAddComm}
        addCommDraft={addCommDraft}
        setAddCommDraft={setAddCommDraft}
        addCommSearchResults={addCommSearchResults}
        handleLeadSearchChange={handleLeadSearchChange}
        selectLeadForCommunication={selectLeadForCommunication}
        saveQuickCommunication={saveQuickCommunication}
      />

      {subTab === 'reminders' && (
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
            untouchedFiltered={untouchedFiltered}
            promisedFiltered={promisedFiltered}
            overdueFiltered={overdueFiltered}
            todayFiltered={todayFiltered}
            upcomingFiltered={upcomingFiltered}
            todayStr={cairoDateOnly()}
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

      {subTab === 'pipelineSettings' && (
        <Suspense fallback={<LeadSectionFallback />}>
          <LeadPipelineSettings notify={notify} />
        </Suspense>
      )}

      {/* 'العروض' now covers both: offers management publishes to the whole
          sales team, and the per-client price quotes that already lived here. */}
      {subTab === 'quotes' && (
        <Suspense fallback={<LeadSectionFallback />}>
          <div className="space-y-6">
            <SalesOffersPanel
              courses={courses}
              bundles={bundles}
              branchOptions={instituteBranches}
              canManage={canViewReports}
              notify={notify}
            />
            <div className="border-t border-gray-100 pt-5">
              <CrmQuotesWorkspace
                leads={effectiveLeads}
                courses={courses}
                bundles={bundles}
                subscribers={salesOwnSubscribers || subscribers}
                notify={notify}
              />
            </div>
          </div>
        </Suspense>
      )}

      {subTab === 'performance' && (
        <Suspense fallback={<LeadSectionFallback />}>
          <div className="space-y-5">
            {/* The day first — «تقرير يومي في أول الصفحة» — and the quality
                review one click away rather than on top of it. */}
            <TeamDailyReport notify={notify} />
            <div className="flex justify-end"><CrmCoachingButton notify={notify} /></div>
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
          </div>
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
          matchesFilters={matchesFilters}
          staffMembers={staffMembers}
          addLead={addLead}
          updateLead={updateLead}
          reloadLeads={reloadLeads}
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
          canManageLeads={canManageLeads}
          onBook={openLeadBook}
          branchOptions={instituteBranches}
          sources={crmSettings.leadSources.length > 0 ? crmSettings.leadSources : DEFAULT_SOURCES}
          // The whole pool, the workspace's branch included: a lead with no branch
          // shows in no branch workspace, and the pools are where it waits.
          onShowAll={() => { clearLeadFilters(); setBranchFilter(null); }}
        />
      </Suspense>

      {/* Quick Edit Panel */}
      {activeLead && (
        <Suspense fallback={null}>
          <QuickEditPanel
            lead={activeLead}
            onClose={() => setSelectedId(null)}
            onSave={handleSave}
            courses={courses}
            bundles={bundles}
            notify={notify}
            instituteBranches={instituteBranches}
          />
        </Suspense>
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
          salesOwnLeads={salesOwnLeads}
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
          reloadPipeline={reloadPipeline}
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
