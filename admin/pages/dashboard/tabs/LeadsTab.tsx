import { QuickLogContactPanel } from './leads/QuickLogContactPanel';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cairoMonthOnly } from '../../../../shared/cairoDate';
import { useNavigate } from 'react-router-dom';
import { AlarmClock, Phone } from 'lucide-react';
import { useAccess } from '../../../hooks/useAccess';
import { Suspense } from 'react';
import { useSiteData } from '../../../context/SiteDataContext';
import { useBranches } from '../../../hooks/useBranches';
import type {
  LeadItem, LeadStatus, SubscriberItem, StaffMember,
} from '../../../types';
import type { PaymentDraft } from '../../../components/PaymentModal';
import { createClientPaymentDraft } from '../../../lib/clientActionDrafts';
import type { CrmSettingsSection, NotifyFn } from './CrmSettingsModal';
import { DEFAULT_SOURCES, isOnlineSource } from './crmConstants';
import { useLeadSubTab } from './leads/useLeadSubTab';
import type { SubTabKey } from './leads/LeadSubTabs';
import type { ConvertLeadModalState } from './leads/ConvertLeadModal';
import { useLeadPerformanceData, useRepRevenue } from './leads/useLeadPerformanceData';
import { useServerLeadTable } from './leads/useServerLeadTable';
import { useLeadFilteringData } from './leads/useLeadFilteringData';
import { useLeadQuickCommunication } from './leads/useLeadQuickCommunication';
import { useLeadRemindersData } from './leads/useLeadRemindersData';
import { useLeadOpsInsights } from './leads/useLeadOpsInsights';
import { useCrmInsights } from './leads/useCrmInsights';
import { useLeadAnalyticsData } from './leads/useLeadAnalyticsData';
import { useSalesTargetsStorage } from './leads/useSalesTargetsStorage';


// ── Props interface ────────────────────────────────────────────────────────
interface LeadsTabProps {
  notify: NotifyFn;
  staffSelf?: StaffMember | null;
  salesDataLoading?: boolean;
  fetchSalesData?: () => void;
  setActiveTab?: (tab: TabKey) => void;
  branchFilter?: string;
  /**
   * Only the team's performance — the targets, the scorecard, the charts —
   * for «أداء المبيعات» (SalesPerformancePage), the page it moved to: «تاب
   * اداء الفريق لازم يتشال من هنا ويكون صفحه لوحدة من برة القسم».
   */
  performanceOnly?: boolean;
}

import { normBranchId } from './leads/leadBranchUtils';
import { LeadsTabHeader } from './leads/LeadsTabHeader';
import { LeadFilterBar } from './leads/LeadFilterBar';
import { LeadSalesKpiStrip } from './leads/LeadSalesKpiStrip';
import SectionCustomTabs from './SectionCustomTabs';
import { LeadEmptyDiagnostics } from './leads/LeadEmptyDiagnostics';
import { useLeadActions } from './leads/useLeadActions';
import { useLeadCrmBootstrap } from './leads/useLeadCrmBootstrap';
import { POOL_REASON_LABELS, type PoolReason } from './leads/leadSourceGroups';
import { poolViewOf, useLeadPool, useLocalNewCount } from './leads/useLeadPool';
import type { TabKey } from '../navigation';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';

const LeadArchiveViews = React.lazy(() => import('./leads/LeadArchiveViews').then(module => ({ default: module.LeadArchiveViews })));
const LeadDuplicateReviewPanel = React.lazy(() => import('./leads/LeadDuplicateReviewPanel').then(module => ({ default: module.LeadDuplicateReviewPanel })));
const LeadModalsHost = React.lazy(() => import('./leads/LeadModalsHost').then(module => ({ default: module.LeadModalsHost })));
const LeadPerformancePanel = React.lazy(() => import('./leads/LeadPerformancePanel').then(module => ({ default: module.LeadPerformancePanel })));
const LeadPerformanceOverview = React.lazy(() => import('./leads/LeadPerformanceOverview').then(module => ({ default: module.LeadPerformanceOverview })));
const LeadCardsGrid = React.lazy(() => import('./leads/LeadCardsGrid').then(module => ({ default: module.LeadCardsGrid })));
const LeadFollowUpsPage = React.lazy(() => import('./leads/LeadFollowUpsPage').then(module => ({ default: module.LeadFollowUpsPage })));
const CrmQuotesWorkspace = React.lazy(() => import('./leads/CrmQuotesWorkspace').then(module => ({ default: module.CrmQuotesWorkspace })));
const LeadPipelineSettings = React.lazy(() => import('./leads/LeadPipelineSettings').then(module => ({ default: module.LeadPipelineSettings })));
const SalesOffersPanel = React.lazy(() => import('./leads/SalesOffersPanel'));
const LeadTable = React.lazy(() => import('./LeadTable').then(module => ({ default: module.LeadTable })));
const QuickEditPanel = React.lazy(() => import('./leads/LeadSubcomponents').then(module => ({ default: module.QuickEditPanel })));

/** The rows this screen hands the filtering hook: none — see useLeadFilteringData below. */
const NO_ROWS: LeadItem[] = [];

const LeadSectionFallback = () => (
  <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm font-bold text-gray-400">
    جاري تحميل قسم العملاء المحتملين...
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
export default function LeadsTab({ notify, staffSelf: staffSelfProp, salesDataLoading, fetchSalesData, setActiveTab: setActiveDashboardTab, branchFilter: workspaceBranchFilter, performanceOnly = false }: LeadsTabProps) {
  const {
    leadStats, staffMembers, courses, bundles, updateLead, addLead,
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
  const { subTab: requestedSubTab, setSubTab } = useLeadSubTab();
  const subTab: SubTabKey = performanceOnly ? 'performance' : requestedSubTab;
  // The screen holds no list of leads or clients: the table, the board and the pools page from the server
  // (useServerLeadTable, useLeadPool), and every figure on it is a server aggregate — the lead stats, the follow-ups
  // count, the CRM insights and the reps' revenue. It used to ask for the 500 newest leads and the 500 newest clients
  // with their payments (1 MB on the lab) to fall back on, and those fallbacks counted the page as if it were the table.
  const { crmSettings, setCrmSettings, pipelineStages, reloadPipeline, selfStaff } =
    useLeadCrmBootstrap(notify);
  const [rottenFilter, setRottenFilter] = useState(false);
  const [showHiddenLeads, setShowHiddenLeads] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The lead as the card held it. The panel looked its lead up in the leads held in memory — the newest 500 — so
  // a lead from the server's page that is older than those opened nothing: «تفاصيل / تعديل» was dead for it.
  const [pickedLead, setPickedLead] = useState<LeadItem | null>(null);
  const pickLead = useCallback((lead: LeadItem) => { setPickedLead(lead); setSelectedId(lead.id); }, []);
  const [showAddLead, setShowAddLead] = useState(false);
  // Which section of the CRM settings is open, from the الإعدادات menu.
  const [settingsSection, setSettingsSection] = useState<CrmSettingsSection | null>(null);
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
  // Which of «محلي جديد»'s four kinds the list shows; the waiting ones first.
  const [poolReason, setPoolReason] = useState<PoolReason>('waiting');
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

  // A collection officer works leads the way a rep does — their own list, no
  // desk tools. They were shown the manager's CRM: every tab, the team's
  // performance, the distribution panels — «ليه بيظهر في حساب التحصيل قيم
  // العملاء المحتملين كامله؟ خلي يظهرله زي ما بيظهر للسيلز».
  const isSalesOnly = ['sales', 'collection'].includes(String(selfStaff?.role || staffSelfProp?.role || '').toLowerCase());
  // lib/access.ts: the server's permission table for this account (an admin holds all of them).
  const access = useAccess();
  const canExportLeads = access.can('export_leads');
  const canManageLeads = access.can('manage_leads');
  // Publishing an offer changes what a course may be sold for, so it sits behind
  // the same manager-level gate as sales targets — not `manage_leads`, which
  // every rep holds.
  const canViewReports = access.can('view_reports');
  // Sales users: do NOT auto-set assignFilter — the table, the board and every other figure are scoped by the server

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
  // Bumped after every follow-up action, so the lists show what is left.
  const [insightsKey, bumpInsights] = React.useReducer((count: number) => count + 1, 0);
  // Only where it is drawn: the follow-ups page and the performance page. It answered on every sub-tab (634 KB on the
  // lab — up to 500 reminders and 500 promised leads) for a table that reads none of it.
  const crmInsights = useCrmInsights(smartIdleDays, performanceOnly || subTab === 'reminders', insightsKey);
  // The header's «متأخر» and the performance page's overdue card: open leads due today or before, counted by the
  // server over the caller's scope (the same rule as the bell).
  const [dueFollowups, setDueFollowups] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    mysqlAdmin.getDueFollowups().then(answer => { if (alive) setDueFollowups(answer.due); }).catch(() => { /* keep the last */ });
    return () => { alive = false; };
  }, [insightsKey]);
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
  } = useLeadQuickCommunication({ reloadLeads, onSaved: bumpInsights });
  // Contact button on a kanban lead card → open the quick-communication modal
  // already targeting that lead, instead of the dead state it used to set.
  const openContactLog = useCallback((lead: LeadItem) => {
    selectLeadForCommunication(lead);
    setShowAddComm(true);
  }, [selectLeadForCommunication, setShowAddComm]);
  // ── Reminders tab state ──────────────────────────────────────────────────
  const [reminderStaffFilter, setReminderStaffFilter] = useState('');
  const [snoozeIds, setSnoozeIds] = useState<Set<string>>(new Set());
  const {
    untouchedFiltered,
    promisedFiltered,
    overdueFiltered,
    todayFiltered,
    upcomingFiltered,
    snooze1Day,
    markDone,
  } = useLeadRemindersData({
    reminderStaffFilter,
    snoozeIds,
    onChanged: bumpInsights,
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
  // The pool tabs read their own pool from the server (leads/useLeadPool.ts)
  // instead of filtering every lead here.
  const poolView = poolViewOf(subTab);
  const leadPool = useLeadPool(poolView, poolView === 'localNew' ? poolReason : null);
  // The server's count everywhere: on «محلي جديد» from the pool itself, on
  // every other tab from a count-only request; zero until it answers.
  const serverLocalNewCount = useLocalNewCount(`${leadPool.total}:${distributing}:${archiving}`);
  const unassignedCount = poolView === 'localNew' && leadPool.breakdown ? leadPool.breakdown.waiting : (serverLocalNewCount ?? 0);
  // How many of each kind «محلي جديد» holds — the chips above its list.
  const poolBreakdown = subTab === 'localNew' ? leadPool.breakdown : null;
  // A distribution or a move to the archive changes the pool on the server.
  const poolBusy = distributing || archiving;
  const wasPoolBusy = useRef(false);
  const reloadPool = leadPool.reload;
  useEffect(() => {
    if (wasPoolBusy.current && !poolBusy) reloadPool();
    wasPoolBusy.current = poolBusy;
  }, [poolBusy, reloadPool]);

  const { weeklyScorecard, smartRedistCandidates } = useLeadOpsInsights(salesReps, crmInsights);

  // The filter bar's predicate, for the pool rows the archive views filter on screen (LeadArchiveViews), and the rep
  // list. The hook is also the browser's half of the table's parity contract (api/tests/integration/
  // leadTableParity.integration.test.js); this screen hands it no rows of its own.
  const { assignedReps, matchesFilters } = useLeadFilteringData({
    effectiveLeads: NO_ROWS,
    leads: NO_ROWS,
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
  // The pipeline's cards read the same page under the same filters, 48 at a time (four across, twelve rows).
  const serverTable = useServerLeadTable(subTab === 'table' || subTab === 'pipeline', {
    searchTerm, assignFilter, tagFilter, sourceFilter, courseFilter, branchFilter, singleStatus,
    showHiddenLeads, rottenFilter, salesSourceFilter, leadsFollowupFilter,
  }, instituteBranches, subTab === 'pipeline' ? 48 : undefined);
  const refreshServerTable = serverTable.refresh;
  // The table and the pipeline's cards are one server page; the counts above them are that page's.
  const onServerPage = subTab === 'table' || subTab === 'pipeline';

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

  const repRevenue = useRepRevenue(targetMonth, performanceOnly);
  const { salesPerformance, commsByRep } = useLeadPerformanceData(salesReps, repRevenue, salesTargets, targetMonth, leadStats);

  // The CRM header's "N عميل محتمل" — every lead whose source is not one of the
  // online ones: total minus the online buckets of bySource, a count per source
  // over the whole table (0 until the stats answer).
  const offlineLeadTotal = useMemo(() => Object.entries(leadStats?.bySource || {})
    .filter(([source]) => !isOnlineSource(source))
    .reduce((sum, [, count]) => sum + count, 0), [leadStats]);

  const { monthlyTrend, funnelData, sourcesData, totalConverted, totalLost } = useLeadAnalyticsData(leadStats);


  // The lead the card or the row was drawn from (the server's page holds the freshest copy).
  const openLead = selectedId && pickedLead?.id === selectedId ? pickedLead : null;

  const {
    handleSave, handleDistribute, handleMigrateBranches,
    handleAddLead, handleStatusChange, openLeadBook, handleLeadPayment,
    convertLeadToSubscriber, handleExportVisibleLeadsCsv,
  } = useLeadActions({
    notify, updateLead, addLead, reloadLeads, reloadSubscribers,
    bulkRedistributeLeads,
    recordSubscriberPayment, fetchSalesData, setActiveDashboardTab,
    salesReps, fetchVisibleLeads: serverTable.exportAll, bundles,
    courses, branchLabelMap, currentStaff, isAdmin, isSalesOnly: Boolean(isSalesOnly),
    statusDebounceRef, leadPayRow, setLeadPayRow, setLeadPayDraft,
    convertLeadModal, setConvertLeadModal, setSelectedId,
    setDistributing, setMigratingBranches,
  });
  // A status changed on a card is saved on the server and the page is read again.
  const cardStatusChange = useCallback(async (lead: LeadItem, status: LeadStatus) => {
    await handleStatusChange(lead, status);
    refreshServerTable();
  }, [handleStatusChange, refreshServerTable]);

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

  if (performanceOnly) {
    return (
      <div className="space-y-5" dir="rtl">
        <Suspense fallback={<LeadSectionFallback />}>
          <LeadPerformanceOverview
            targetMonth={targetMonth}
            setTargetMonth={setTargetMonth}
            salesReps={salesReps}
            handleDistribute={handleDistribute}
            distributing={distributing}
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
            totalConverted={totalConverted}
            overdueCount={dueFollowups}
          />
        </Suspense>
        <Suspense fallback={<div className="text-center py-10 text-gray-400">جاري تحميل الرسوم...</div>}>
          <LeadPerformancePanel
            totalConverted={totalConverted}
            monthlyTrend={monthlyTrend}
            funnelData={funnelData}
            sourcesData={sourcesData}
            commsByRep={commsByRep}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Row 1: Title + tabs + primary actions — all on one line */}
      <LeadsTabHeader
        isSalesOnly={isSalesOnly}
        canAdministerCrm={isAdmin}
        canManageLeads={canManageLeads}
        canExportLeads={canExportLeads}
        totalOfflineLeads={offlineLeadTotal}
        overdueCount={dueFollowups ?? 0}
        unassignedCount={unassignedCount}
        subTab={subTab}
        setSubTab={setSubTab}
        onAddLead={() => setShowAddLead(true)}
        showActionsMenu={showActionsMenu}
        actionsMenuRef={actionsMenuRef}
        onToggleActionsMenu={() => setShowActionsMenu(v => !v)}
        onCloseActionsMenu={() => setShowActionsMenu(false)}
        onOpenSettings={setSettingsSection}
        onOpenSectionTabs={() => setShowSectionTabs(true)}
        notify={notify}
        onMigrateBranches={handleMigrateBranches}
        migratingBranches={migratingBranches}
        onExportCsv={handleExportVisibleLeadsCsv}
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

      <LeadSalesKpiStrip isSalesOnly={isSalesOnly} refreshKey={insightsKey} />

      {/* ─── border separator under the top row ─── */}
      <div className="border-b border-gray-100 -mt-1" />

      {/* The archive views render the same table with the same actions, so
          they get the same controls — they had none at all. */}
      <LeadFilterBar
        visible={subTab === 'pipeline' || subTab === 'table' || ['archive', 'dawliOld', 'localNew'].includes(subTab)}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        isSalesOnly={isSalesOnly}
        assignedReps={assignedReps}
        collectionHolders={leadStats?.collectionHolders}
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
        salesSourceFilter={salesSourceFilter}
        setSalesSourceFilter={setSalesSourceFilter}
        leadsFollowupFilter={leadsFollowupFilter}
        setLeadsFollowupFilter={setLeadsFollowupFilter}
        showHiddenLeads={showHiddenLeads}
        setShowHiddenLeads={setShowHiddenLeads}
        totalConverted={totalConverted}
        totalLost={totalLost}
        knownSources={Object.keys(leadStats?.bySource || {})}
        sourceCounts={leadStats?.bySource}
        visibleLeadsCount={onServerPage ? serverTable.total : leadPool.total}
      />

      <LeadEmptyDiagnostics
        visible={onServerPage && !serverTable.loading && !serverTable.error}
        isSalesOnly={isSalesOnly}
        salesDataLoading={salesDataLoading}
        totalLeads={leadStats?.total ?? 0}
        effectiveCount={leadStats?.total ?? serverTable.total}
        visibleCount={onServerPage ? serverTable.total : leadPool.total}
        filtersActive={leadFiltersActive}
        currentStaffName={currentStaff?.name || selfStaff?.name || authUser?.email || ''}
        onClearFilters={clearLeadFilters}
        onReload={reloadLeads}
        onOpenLeadSources={setActiveDashboardTab ? () => setActiveDashboardTab('lead_sources_settings') : undefined}
      />

      {/* ═══════════════ PIPELINE ═══════════════ */}
      {subTab === 'pipeline' && (
        <Suspense fallback={<LeadSectionFallback />}>
          <LeadCardsGrid
            rows={serverTable.rows}
            loading={serverTable.loading}
            error={serverTable.error}
            onRetry={refreshServerTable}
            page={serverTable.page + 1}
            pageSize={serverTable.pageSize}
            total={serverTable.total}
            onPageChange={next => serverTable.setPage(next - 1)}
            canManageLeads={canManageLeads}
            onSelect={pickLead}
            onStatusChange={cardStatusChange}
            onBook={openLeadBook}
            onContact={openContactLog}
            onOutcomeRecorded={async () => { await reloadLeads(); refreshServerTable(); }}
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
              <span className="text-sm text-gray-500">غير موزّع: <strong className="text-amber-600">{unassignedCount.toLocaleString('ar-EG-u-nu-latn')}</strong></span>
              {isAdmin && <button onClick={handleDistribute} disabled={distributing || unassignedCount === 0}
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
                  <button onClick={handleMoveToArchive} disabled={archiving || unassignedCount === 0}
                    title="ينقل العملاء غير الموزّعين إلى تبويب محلي قديم — بدون حذف"
                    className="bg-gray-700 text-white px-4 py-2 rounded-xl text-sm hover:bg-gray-800 disabled:opacity-40 transition whitespace-nowrap">
                    {archiving ? 'جارٍ النقل...' : 'نقل للأرشيف'}
                  </button>
                </div>
              )}
            </div>
          </div>
          {/* Every lead nobody is working is here, by kind: «مينفعش عميل مش ظاهر
              ادامي خلي اي عميل مورشف او مش ظاهر يكون موجود في محلي جديد».
              Handing one to a rep brings it back into play — un-hidden, and an
              archived one as new. */}
          {poolBreakdown && (
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="نوع العملاء">
              {(['waiting', 'archived', 'hidden', 'closed'] as const).map(reason => (
                <button key={reason} type="button" role="tab" aria-selected={poolReason === reason}
                  onClick={() => setPoolReason(reason)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${poolReason === reason
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-300'}`}>
                  {POOL_REASON_LABELS[reason]} ({poolBreakdown[reason].toLocaleString('ar-EG-u-nu-latn')})
                </button>
              ))}
              <span className="text-[11px] text-gray-500">
                {poolReason === 'archived' ? 'الأرشفة التلقائية للليدات اللي محدش كلمها، من إعدادات الـCRM — بيرجع «جديد» لما توزعه'
                  : poolReason === 'hidden' ? 'اتخفى من سيلز أو من الإدارة — بيظهر تاني لما توزعه'
                    : poolReason === 'closed' ? 'حالته مقفولة ومحدش ماسكه — مش بيدخل التوزيع التلقائي'
                      : 'دول اللي التوزيع التلقائي بيوزعهم'}
              </span>
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
          <LeadFollowUpsPage
            groups={{
              overdue: overdueFiltered, today: todayFiltered, week: upcomingFiltered,
              promised: promisedFiltered, untouched: untouchedFiltered,
            }}
            isSalesOnly={isSalesOnly}
            salesReps={salesReps}
            staffFilter={reminderStaffFilter}
            setStaffFilter={setReminderStaffFilter}
            refreshing={!crmInsights}
            onRefresh={bumpInsights}
            onLogContact={openContactLog}
            onSnooze={snooze1Day}
            onDone={markDone}
            onOpenLead={setSelectedId}
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
                courses={courses}
                bundles={bundles}
                notify={notify}
              />
            </div>
          </div>
        </Suspense>
      )}

      {/* online25 section moved to Dashboard.tsx */}

      <Suspense fallback={null}>
        {poolView && (leadPool.error || leadPool.truncated || (leadPool.loading && !leadPool.ready)) && (
          <div className={`mb-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${leadPool.error ? 'border-red-200 bg-red-50 text-red-800' : 'border-sky-200 bg-sky-50 text-sky-800'}`} role="status">
            {leadPool.error
              ? <><span>تعذّر تحميل القائمة: {leadPool.error}</span>
                  <button type="button" onClick={leadPool.reload} className="rounded-lg bg-red-600 px-3 py-1 text-white hover:bg-red-700">إعادة المحاولة</button></>
              : leadPool.truncated
                ? <span>القائمة فيها {leadPool.total.toLocaleString('ar-EG-u-nu-latn')} عميل — المعروض أحدث {leadPool.rows.length.toLocaleString('ar-EG-u-nu-latn')}. استخدم الفلاتر أو البحث عشان توصل للباقي.</span>
                : <span>جاري التحميل…</span>}
          </div>
        )}
        <LeadArchiveViews
          subTab={subTab}
          leads={leadPool.rows}
          matchesFilters={matchesFilters}
          staffMembers={staffMembers}
          addLead={addLead}
          updateLead={async lead => {
            const saved = await updateLead(lead);
            if (saved !== false) leadPool.patch(lead);
            return saved;
          }}
          reloadLeads={async () => { await reloadLeads(); leadPool.reload(); }}
          notify={notify}
          courses={courses}
          bundles={bundles}
          navigate={navigate}
          deleteLead={async id => { await (deleteLead ?? (() => Promise.resolve()))(id); leadPool.drop(id); }}
          addSubscriber={addSubscriber ?? ((_: SubscriberItem) => Promise.resolve(false))}
          updateSubscriber={updateSubscriber ?? (() => Promise.resolve())}
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
      {openLead && (
        <Suspense fallback={null}>
          <QuickEditPanel
            lead={openLead}
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
          knownSources={Object.keys(leadStats?.bySource || {}).filter(Boolean)}
          isSalesOnly={isSalesOnly}
          setSalesNotifOpen={setSalesNotifOpen}
          setLeadsFollowupFilter={setLeadsFollowupFilter}
          setActiveDashboardTab={setActiveDashboardTab}
          settingsSection={settingsSection}
          setSettingsSection={setSettingsSection}
          notify={notify}
          salesReps={salesReps}
          reloadLeads={reloadLeads}
          setCrmSettings={setCrmSettings}
          reloadPipeline={reloadPipeline}
          showAddLead={showAddLead}
          setShowAddLead={setShowAddLead}
          sources={crmSettings.leadSources}
          handleAddLead={handleAddLead}
        />
      </Suspense>
    </div>
  );
}
