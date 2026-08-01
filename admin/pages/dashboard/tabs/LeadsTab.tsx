import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hasPermission as hasStaffPermission } from '../../../constants/permissions';
import type { PermissionKey, RoleKey } from '../../../constants/permissions';
import { Suspense } from 'react';
import { useSiteData } from '../../../context/SiteDataContext';
import { useBranches } from '../../../hooks/useBranches';
import type {
  LeadItem, LeadStatus, CommunicationRecord, 
  SubscriberItem, StaffMember,
} from '../../../types';
import type { PaymentDraft } from '../../../components/PaymentModal';
import { createClientPaymentDraft } from '../../../lib/clientActionDrafts';
import type { NotifyFn } from './CrmSettingsModal';
import { DEFAULT_SOURCES, isOnlineSource } from './crmConstants';
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
  STATUS_CFG,
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

import { normBranchId } from './leads/leadBranchUtils';
import { LeadsTabHeader } from './leads/LeadsTabHeader';
import { LeadFilterBar } from './leads/LeadFilterBar';
import { LeadSalesKpiStrip } from './leads/LeadSalesKpiStrip';
import { LeadEmptyDiagnostics } from './leads/LeadEmptyDiagnostics';
import { useLeadActions } from './leads/useLeadActions';
import { useLeadCrmBootstrap } from './leads/useLeadCrmBootstrap';
import { useLeadRemoteReminders } from './leads/useLeadRemoteReminders';

const LeadArchiveViews = React.lazy(() => import('./leads/LeadArchiveViews').then(module => ({ default: module.LeadArchiveViews })));
const LeadCommunicationsTimeline = React.lazy(() => import('./leads/LeadCommunicationsTimeline').then(module => ({ default: module.LeadCommunicationsTimeline })));
const LeadDuplicateReviewPanel = React.lazy(() => import('./leads/LeadDuplicateReviewPanel').then(module => ({ default: module.LeadDuplicateReviewPanel })));
const LeadModalsHost = React.lazy(() => import('./leads/LeadModalsHost').then(module => ({ default: module.LeadModalsHost })));
const LeadPerformancePanel = React.lazy(() => import('./leads/LeadPerformancePanel').then(module => ({ default: module.LeadPerformancePanel })));
const LeadPerformanceOverview = React.lazy(() => import('./leads/LeadPerformanceOverview').then(module => ({ default: module.LeadPerformanceOverview })));
const LeadPipelineBoard = React.lazy(() => import('./leads/LeadPipelineBoard').then(module => ({ default: module.LeadPipelineBoard })));
const LeadRemindersPanel = React.lazy(() => import('./leads/LeadRemindersPanel').then(module => ({ default: module.LeadRemindersPanel })));
const CrmQuotesWorkspace = React.lazy(() => import('./leads/CrmQuotesWorkspace').then(module => ({ default: module.CrmQuotesWorkspace })));
const CrmCoachingPanel = React.lazy(() => import('./leads/CrmCoachingPanel').then(module => ({ default: module.CrmCoachingPanel })));
const LeadPipelineSettings = React.lazy(() => import('./leads/LeadPipelineSettings').then(module => ({ default: module.LeadPipelineSettings })));
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
    leads, staffMembers, subscribers, courses, bundles, updateLead, addLead,
    reloadLeads, reloadSubscribers, deleteLead, addSubscriber, updateSubscriber,
    authUser, isAdmin, recordSubscriberPayment, bulkRedistributeLeads,
  } = useSiteData();
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

  const statusDebounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => () => {
    statusDebounceRef.current.forEach(clearTimeout);
    statusDebounceRef.current.clear();
  }, []);
  // Drag-and-drop between kanban columns
  const draggedLeadRef = useRef<LeadItem | null>(null);
  const [dragOverCol, setDragOverCol] = useState<LeadStatus | null>(null);

  const { subTab, setSubTab } = useLeadSubTab();
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
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const [singleStatus, setSingleStatus] = useState<LeadStatus | ''>('');
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

  const isSalesOnly = selfStaff?.role === 'sales' || staffSelfProp?.role === 'sales';
  const permissionSubject = currentStaff
    ? {
        role: currentStaff.role as RoleKey,
        permissions: currentStaff.permissions as PermissionKey[] | undefined,
      }
    : null;
  const canExportLeads = isAdmin || hasStaffPermission(permissionSubject, 'export_leads');
  const canBulkWhatsApp = isAdmin || hasStaffPermission(permissionSubject, 'bulk_whatsapp');
  const canManageLeads = isAdmin || hasStaffPermission(permissionSubject, 'manage_leads');
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
  const [crmContactRow, setCrmContactRow] = useState<LeadItem | null>(null);
  const [crmContactDraft, setCrmContactDraft] = useState<{
    type: CommunicationRecord['type']; date: string; notes: string;
    outcome: string; nextFollowUp: string; newStatus: LeadStatus | '';
  }>({ type: 'whatsapp', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '', newStatus: '' });
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
  } = useLeadQuickCommunication({ effectiveLeads, reloadLeads });
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
  // "محلي جديد" pool — same filter as the sub-tab badge count.
  const unassignedLeads = useMemo(() =>
    leads.filter(l => !l.hidden && !l.assignedSalesId && !['converted', 'lost'].includes(l.status)),
    [leads]
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

  const { activeLead, assignedReps, visibleLeads, scoredLeads, activeStatusCols, overdueLeads } = useLeadFilteringData({
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
        totalOfflineLeads={leads.filter(l => !l.hidden && !isOnlineSource(l.source)).length}
        overdueCount={overdueLeads.length}
        rottenCount={effectiveLeads.filter(l => !l.hidden && getRottenLevel(l) >= 2).length}
        dueTodayCount={dueToday.length}
        unassignedCount={leads.filter(l => !l.hidden && !l.assignedSalesId && !['converted', 'lost'].includes(l.status)).length}
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
            canManageLeads={canManageLeads}
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
        <Suspense fallback={<LeadSectionFallback />}>
          <LeadTable
            rows={scoredLeads}
            showCourseCol={true}
            courses={courses}
            bundles={bundles}
            navigate={navigate}
            updateLead={updateLead}
            reloadLeads={reloadLeads}
            deleteLead={deleteLead ?? (() => Promise.resolve())}
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
            </div>
          </div>
          <Suspense fallback={<LeadSectionFallback />}>
            <LeadTable
              rows={unassignedLeads}
              showCourseCol={true}
              courses={courses}
              bundles={bundles}
              navigate={navigate}
              updateLead={updateLead}
              reloadLeads={reloadLeads}
              deleteLead={deleteLead ?? (() => Promise.resolve())}
              addSubscriber={addSubscriber ?? ((_: SubscriberItem) => Promise.resolve(false))}
              updateSubscriber={updateSubscriber ?? (() => Promise.resolve())}
              subscribers={effectiveSubs}
              salesStaff={salesReps}
              isSalesOnly={isSalesOnly}
              canManageLeads={canManageLeads}
              onBook={openLeadBook}
              branchOptions={instituteBranches}
              sources={crmSettings.leadSources.length > 0 ? crmSettings.leadSources : DEFAULT_SOURCES}
            />
          </Suspense>
        </div>
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
            canManageLeads={canManageLeads}
            canExportLeads={canExportLeads}
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
            overdueFiltered={overdueFiltered}
            todayFiltered={todayFiltered}
            upcomingFiltered={upcomingFiltered}
            todayStr={commTodayStr}
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

      {subTab === 'quotes' && (
        <Suspense fallback={<LeadSectionFallback />}>
          <CrmQuotesWorkspace
            leads={effectiveLeads}
            courses={courses}
            bundles={bundles}
            subscribers={salesOwnSubscribers || subscribers}
            notify={notify}
          />
        </Suspense>
      )}

      {subTab === 'performance' && (
        <Suspense fallback={<LeadSectionFallback />}>
          <div className="space-y-5">
            <CrmCoachingPanel notify={notify} />
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
