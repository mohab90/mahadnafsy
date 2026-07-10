import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, AlertCircle, Award, BarChart2, Bell, BookOpen, CalendarPlus, CheckCheck,
  Clock, CreditCard, ExternalLink, EyeOff, Eye,
  Globe, Inbox, Link2, MessageSquare, MessageSquareText,
  Plus, Search, Settings, Share2, Star, Tag, Trash2,
  Upload, Wallet, X,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { useSiteData } from '../../../context/SiteDataContext';
import { useBranches } from '../../../hooks/useBranches';
import { mysqlAdmin, mysqlClient } from '../../../lib/mysqlapi';
import { useResizableCols } from '../../../components/useResizableCols';
import type {
  LeadItem, LeadStatus, CommunicationRecord, SalesTarget, Course, Bundle,
  BranchType, FacebookLeadAdsConfig, PaymentHistoryEntry, PaymentItemType,
  SubscriberItem, StaffMember, AccessMode, CourseAccessSetting,
} from '../../../types';
import { CrmSettingsModal, DEFAULT_CRM_SETTINGS } from './CrmSettingsModal';
import PaymentModal, { PaymentDraft, blankPaymentDraft } from '../../../components/PaymentModal';
import type { CrmSettings, NotifyFn } from './CrmSettingsModal';
import { useLeadsImport } from './useLeadsImport';
import { useLeadCrmContact } from './useLeadCrmContact';
import { useLeadPayment } from './useLeadPayment';
import { DEFAULT_SOURCES, ONLINE_EXCLUDED_SOURCES, isOnlineSource, EMPTY_LEAD_DRAFT } from './crmConstants';
import { LeadTable } from './LeadTable';
import {
  BRANCH_ENUM_LABELS,
  COMM_ICON,
  COMM_LABEL,
  IL_LABEL,
  PIE_COLORS,
  PIPELINE_COLS,
  PRESET_TAGS,
  ROTTEN_CFG,
  STATUS_CFG,
  calcLeadScore,
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
}

const blankLead = (): LeadItem => ({
  id: '', name: '', email: '', phone: '', status: 'new', leadType: 'general',
  enrolledCourseId: '', branch: undefined, interestLevel: 'medium',
  source: '', assignedSalesId: '', assignedSalesName: '',
  interestedCourseIds: [], communications: [], notes: '', createdAt: '', hidden: false,
});


import { AddLeadModal, BulkWhatsAppModal, WhatsAppRepModal, TagInput, getScoreBreakdown, ScoreBadge, LeadJourneyTimeline, QuickEditPanel, MultiSelectDropdown, ArchiveTab, crmSourceLabels, formatWaPhone, normBranchId, mkPromoCode, crmStatusLabels, paymentTypeLabels, EVENT_CFG } from './leads/LeadSubcomponents';
import { LeadsCommunicationsPanel } from './leads/LeadsCommunicationsPanel';
import { LeadsPerformancePanel } from './leads/LeadsPerformancePanel';
import type { ArchiveTabProps, CertPricingMap } from './leads/LeadSubcomponents';
import { LeadsHeaderBar } from './leads/LeadsHeaderBar';
import type { LeadsSubTabKey } from './leads/LeadsHeaderBar';
import { LeadsSalesKpiStrip } from './leads/LeadsSalesKpiStrip';
import { LeadsFilterBar } from './leads/LeadsFilterBar';
import type { FollowupFilter } from './leads/LeadsFilterBar';
import { LeadsPipelineBoard } from './leads/LeadsPipelineBoard';
import { ConvertLeadModal } from './leads/ConvertLeadModal';
import { SalesFollowupPanel } from './leads/SalesFollowupPanel';

// ── Main Component ────────────────────────────────────────────────────────────
export default function LeadsTab({ notify, staffSelf: staffSelfProp, salesOwnLeads, salesOwnSubscribers, salesDataLoading, fetchSalesData, setActiveTab: setActiveDashboardTab }: LeadsTabProps) {
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

  type SubTabKey = LeadsSubTabKey;
  const [searchParams, setSearchParams] = useSearchParams();
  const subTab = (searchParams.get('tab') as SubTabKey) || 'table';
  const setSubTab = (t: SubTabKey) => setSearchParams(p => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
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
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [migratingBranches, setMigratingBranches] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<LeadStatus>>(new Set());
  const [courseFilter, setCourseFilter] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  // Bulk WhatsApp
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [showBulkWA, setShowBulkWA] = useState(false);



  // Self staff — for role-based UI gating (SALES vs admin)
  const [selfStaff, setSelfStaff] = useState<{ id: string; role: string; name: string } | null>(null);
  useEffect(() => {
    mysqlClient.getStaffSelf()
      .then((s: any) => { if (s?.id) setSelfStaff(s); })
      .catch(() => {});
  }, []);
  const isSalesOnly = selfStaff?.role === 'sales' || staffSelfProp?.role === 'sales';
  // Merge salesOwnLeads (API snapshot) with context leads — new/updated leads appear immediately
  const effectiveLeads = isSalesOnly
    ? (() => {
        const staffId = selfStaff?.id || staffSelfProp?.id;
        const snapMap = new Map((salesOwnLeads || []).map(l => [l.id, l]));
        // Context wins: override any lead already in the snapshot by id, or assigned to this sales person
        leads.filter(l => snapMap.has(l.id) || l.assignedSalesId === staffId)
          .forEach(l => snapMap.set(l.id, l));
        return [...snapMap.values()];
      })()
    : leads;
  // Merge salesOwnSubscribers (API snapshot) with context subscribers so new bookings appear immediately
  const effectiveSubs = isSalesOnly
    ? (() => {
        const snapMap = new Map((salesOwnSubscribers || []).map(s => [s.id, s]));
        const contextOwn = subscribers.filter(s => s.assignedSalesId === (selfStaff?.id || staffSelfProp?.id));
        contextOwn.forEach(s => snapMap.set(s.id, s));
        return [...snapMap.values()];
      })()
    : subscribers;
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

  // Fetch stale leads + due-today leads when reminders tab is active

  // Pagination: how many cards shown per column (default 15)
  const [colLimit, setColLimit] = useState<Record<LeadStatus, number>>(
    Object.fromEntries(Object.keys(STATUS_CFG).map(k => [k, 15])) as Record<LeadStatus, number>
  );


  // ── Extra state (payment / convert / FB / CRM contact) ──────────────────
  const [salesNotifOpen, setSalesNotifOpen] = useState(false);
  const [editingLeadId, setEditingLeadId] = useState('');
  const [isLeadFormOpen, setIsLeadFormOpen] = useState(false);
  const [leadDraft, setLeadDraft] = useState<LeadItem>(blankLead());
  // CSV + Facebook lead-import feature — extracted to ./useLeadsImport (state +
  // handlers). Destructured with identical names so the render JSX is unchanged.
  const {
    bulkUploadNotice, setBulkUploadNotice,
    csvHeaders, setCsvHeaders, csvRows, setCsvRows, csvMapping, setCsvMapping,
    csvImportOpen, setCsvImportOpen, csvImporting, setCsvImporting,
    fbDraft, setFbDraft, fbIntegOpen, setFbIntegOpen,
    fbSyncLoading, setFbSyncLoading, fbSyncNotice, setFbSyncNotice,
    fbFormsLoading, setFbFormsLoading, fbAvailableForms, setFbAvailableForms,
    handleBulkFbUpload, handleCsvFileChange, handleCsvImport,
    handleFetchFbForms, handleFbApiSync, handleSaveFbConfig,
  } = useLeadsImport(notify);
  const [convertLeadModal, setConvertLeadModal] = useState<{
    lead: LeadItem | null; courseId: string; accessMode: AccessMode;
  }>({ lead: null, courseId: '', accessMode: 'full' });
  // Lead payment / conversion (220-line money handler) — extracted to ./useLeadPayment.
  // Same names returned so the render JSX (PaymentModal + print) is unchanged.
  const {
    leadPayRow, setLeadPayRow, leadPayDraft, setLeadPayDraft,
    showDiscountSection, setShowDiscountSection, leadPayPrintData, setLeadPayPrintData,
    handleLeadPayment,
  } = useLeadPayment({ effectiveLeads, effectiveSubs, branchLabelMap, isSalesOnly, fetchSalesData, setActiveDashboardTab, notify });
  // "Log CRM contact" feature — extracted to ./useLeadCrmContact (same names, render unchanged).
  const { crmContactRow, setCrmContactRow, crmContactDraft, setCrmContactDraft, handleSaveCrmContact } = useLeadCrmContact(notify);
  const [leadsSearch, setLeadsSearch] = useState('');
  const [leadsStatusFilter, setLeadsStatusFilter] = useState<string[]>([]);
  const [leadsBranchFilter, setLeadsBranchFilter] = useState<'all' | string>('all');
  const [leadsSalesFilter, setLeadsSalesFilter] = useState<string>('all');
  const [leadsCourseFilter, setLeadsCourseFilter] = useState<string>('all');
  const [leadsFollowupFilter, setLeadsFollowupFilter] = useState<FollowupFilter>('all');
  const [salesSourceFilter, setSalesSourceFilter] = useState<string>('');


  const salesReps = useMemo(() =>
    staffMembers.filter(s =>
      (s.role || '').toLowerCase() === 'sales' &&
      s.status === 'active'
    ),
    [staffMembers]
  );

  // ── Weekly scorecard (last 7 days) ────────────────────────────────────────

  // ── Smart redistribution candidates ──────────────────────────────────────

  const today = new Date().toISOString().slice(0, 10);
  const activeLead = selectedId ? (leads.find(l => l.id === selectedId) ?? null) : null;

  // For filter dropdown: only actual sales-role staff
  const assignedReps = useMemo(() => {
    return salesReps
      .map(s => ({ id: s.id, name: s.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [salesReps]);

  const visibleLeads = useMemo(() => effectiveLeads.filter(l =>
    (showHiddenLeads ? l.hidden === true : !l.hidden) &&
    (isSalesOnly || !isOnlineSource(l.source)) &&
    !['converted', 'lost'].includes((l.status || '').toLowerCase()) &&
    (isSalesOnly || sourceFilter.size === 0 || sourceFilter.has(l.source || '')) &&
    (isSalesOnly || assignFilter.size === 0 || (() => {
      if (assignFilter.has('__none__')) return !l.assignedSalesId && !l.assignedSalesName;
      return assignFilter.has(l.assignedSalesId || '') || (!l.assignedSalesId && assignFilter.has(l.assignedSalesName || ''));
    })()) &&
    (!tagFilter || (l.tags || []).includes(tagFilter)) &&
    (courseFilter === null || (courseFilter === '__none__'
      ? !(l.interestedCourseIds || []).length
      : (l.interestedCourseIds || []).includes(courseFilter)
    )) &&
    (branchFilter === null || (branchFilter === '__none__'
      ? !getLeadBranchRaw(l)
      : (() => {
          const raw = getLeadBranchRaw(l);
          if (!raw) return false;
          if (raw === branchFilter) return true;
          const normRaw = normBranchId(raw);
          const normFilter = normBranchId(branchFilter);
          if (normRaw === normFilter) return true;
          const filterLabel = instituteBranches.find(b => b.id === branchFilter)?.label
            || BRANCH_ENUM_LABELS[branchFilter] || BRANCH_ENUM_LABELS[normFilter];
          return !!filterLabel && (raw === filterLabel || normBranchId(raw) === normBranchId(filterLabel));
        })()
    )) &&
    (singleStatus === '' || l.status === singleStatus) &&
    (!rottenFilter || getRottenLevel(l) >= 2) &&
    !!(l.name?.trim() || l.phone?.trim()) &&
    (!salesSourceFilter || (salesSourceFilter === '__none__' ? !l.source?.trim() : (l.source || '') === salesSourceFilter)) &&
    (leadsFollowupFilter === 'all' || (() => {
      const td = new Date().toISOString().slice(0, 10);
      const nfd = l.nextFollowUpDate || '';
      if (leadsFollowupFilter === 'no_followup') return !nfd;
      if (!nfd) return false;
      const d3ago = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      const d7ago = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const d30ago = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const d3fwd = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      const d7fwd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      if (leadsFollowupFilter === 'today') return nfd === td;
      if (leadsFollowupFilter === 'overdue') return nfd < td;
      if (leadsFollowupFilter === 'past3d') return nfd >= d3ago && nfd < td;
      if (leadsFollowupFilter === 'past7d') return nfd >= d7ago && nfd < td;
      if (leadsFollowupFilter === 'past30d') return nfd >= d30ago && nfd < td;
      if (leadsFollowupFilter === 'next3d') return nfd > td && nfd <= d3fwd;
      if (leadsFollowupFilter === 'next7d') return nfd > td && nfd <= d7fwd;
      return true;
    })()) &&
    (searchTerm === '' || (() => {
      const q = searchTerm.trim().toLowerCase();
      const qd = q.replace(/\D/g, '');
      const phoneMatch = qd.length >= 4
        ? (l.phone || '').replace(/\D/g, '').includes(qd)
        : (l.phone || '').includes(searchTerm);
      return l.name.toLowerCase().includes(q) || phoneMatch || (l.email || '').toLowerCase().includes(q)
        || (l.notes || '').toLowerCase().includes(q);
    })())
  ), [effectiveLeads, isSalesOnly, assignFilter, searchTerm, tagFilter, sourceFilter, courseFilter, branchFilter, singleStatus, showHiddenLeads, rottenFilter, salesSourceFilter, leadsFollowupFilter]);

  const scoredLeads = useMemo(() =>
    [...visibleLeads]
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .map(l => ({ ...l, _score: calcLeadScore(l) })),
    [visibleLeads]
  );

  // Dynamic kanban columns: show ALL PIPELINE_COLS that have leads OR are always-on columns
  const activeStatusCols = useMemo(() => {
    const alwaysOn: LeadStatus[] = ['new', 'interested_booking', 'interested_followup', 'no_answer_wa', 'no_answer_nowa', 'not_interested'];
    const inUse = new Set(visibleLeads.map(l => l.status));
    // Show always-on cols always; also show any other PIPELINE_COLS col that has leads
    const baseCols = PIPELINE_COLS.filter(s => alwaysOn.includes(s) || inUse.has(s));
    return statusFilter.size === 0 ? baseCols : baseCols.filter(s => statusFilter.has(s));
  }, [visibleLeads, statusFilter]);

  const overdueLeads = useMemo(() =>
    leads
      .filter(l => !l.hidden && l.nextFollowUpDate && l.nextFollowUpDate <= today && !['converted', 'lost'].includes(l.status))
      .sort((a, b) => (a.nextFollowUpDate || '').localeCompare(b.nextFollowUpDate || '')),
    [leads, today]
  );

  // Sales performance per rep for targetMonth

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

  const totalConverted = effectiveLeads.filter(l => l.status === 'converted').length;
  const totalLost = effectiveLeads.filter(l => l.status === 'lost').length;

  // ═══════════════════════════════════════════════════════════════════════
  // Extra handlers from LeadsTab
  // ═══════════════════════════════════════════════════════════════════════

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


  const openLeadBook = (row: LeadItem) => {
    setLeadPayRow(row);
    const defaultCourseId = row.interestedCourseIds?.[0] || row.enrolledCourseId || '';
    const currency = (['ONLINE_SAUDI', 'ONLINE_ABROAD'].includes(normBranchId(row.branch))) ? 'SAR' : 'EGP';
    setLeadPayDraft(blankPaymentDraft({ courseId: defaultCourseId, currency, branch: row.branch || '', email: row.email || '' }));
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
      createdAt: leadDraft.createdAt || new Date().toLocaleString('ar-EG-u-nu-latn', {
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
        createdAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      });
    }
    updateLead({ ...lead, status: 'converted' });
    setConvertLeadModal({ lead: null, courseId: '', accessMode: 'full' });
  };

  const startEditLead = (row: LeadItem) => {
    setEditingLeadId(row.id);
    setLeadDraft({ ...row });
    setIsLeadFormOpen(true);
  };


  return (
    <div className="space-y-4" dir="rtl">
      {/* Row 1: Title + tabs + primary actions — all on one line */}
      <LeadsHeaderBar
        notify={notify}
        isSalesOnly={isSalesOnly}
        leads={leads}
        overdueLeadsCount={overdueLeads.length}
        rottenCount={effectiveLeads.filter(l => !l.hidden && getRottenLevel(l) >= 2).length}
        subTab={subTab}
        setSubTab={setSubTab}
        showActionsMenu={showActionsMenu}
        setShowActionsMenu={setShowActionsMenu}
        actionsMenuRef={actionsMenuRef}
        setShowAddLead={setShowAddLead}
        setShowSettings={setShowSettings}
        syncingSheet={syncingSheet}
        handleSyncSheet={handleSyncSheet}
        migratingBranches={migratingBranches}
        handleMigrateBranches={handleMigrateBranches}
        visibleLeads={visibleLeads}
        bulkMode={bulkMode}
        setBulkMode={setBulkMode}
        selectedLeadIds={selectedLeadIds}
        setSelectedLeadIds={setSelectedLeadIds}
        setShowBulkWA={setShowBulkWA}
        reloadLeads={reloadLeads}
      />

      {/* ── Sales KPI strip — 7 احصائيات ─────────────────────────────── */}
      {isSalesOnly && <LeadsSalesKpiStrip effectiveLeads={effectiveLeads} effectiveSubs={effectiveSubs} />}

      {/* ─── border separator under the top row ─── */}
      <div className="border-b border-gray-100 -mt-1" />

      {/* ═══════════════ SHARED FILTER BAR (pipeline + table) ═══════════════ */}
      {(subTab === 'pipeline' || subTab === 'table') && (
        <LeadsFilterBar
          isSalesOnly={isSalesOnly}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          assignedReps={assignedReps}
          assignFilter={assignFilter}
          setAssignFilter={setAssignFilter}
          singleStatus={singleStatus}
          setSingleStatus={setSingleStatus}
          courses={courses}
          bundles={bundles}
          courseFilter={courseFilter}
          setCourseFilter={setCourseFilter}
          instituteBranches={instituteBranches}
          branchFilter={branchFilter}
          setBranchFilter={setBranchFilter}
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
      )}

      {/* ═══════════════ PIPELINE ═══════════════ */}
      {subTab === 'pipeline' && (
        <LeadsPipelineBoard
          activeStatusCols={activeStatusCols}
          scoredLeads={scoredLeads}
          colLimit={colLimit}
          setColLimit={setColLimit}
          dragOverCol={dragOverCol}
          setDragOverCol={setDragOverCol}
          draggedLeadRef={draggedLeadRef}
          handleStatusChange={handleStatusChange}
          bulkMode={bulkMode}
          selectedLeadIds={selectedLeadIds}
          setSelectedLeadIds={setSelectedLeadIds}
          setSelectedId={setSelectedId}
          openLeadBook={openLeadBook}
          setCrmContactRow={setCrmContactRow}
          setCrmContactDraft={setCrmContactDraft}
          instituteBranches={instituteBranches}
          courses={courses}
          bundles={bundles}
        />
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

      {/* ═══════════════ COMMUNICATIONS (Full Rebuild) ═══════════════ */}
      {subTab === 'communications' && <LeadsCommunicationsPanel effectiveLeads={effectiveLeads} isSalesOnly={isSalesOnly} notify={notify} onSelectLead={id => setSelectedId(id)} />}

      {/* ═══════════════ PERFORMANCE ═══════════════ */}
      {subTab === 'performance' && <LeadsPerformancePanel notify={notify} />}

      {/* online25 section moved to Dashboard.tsx */}

      {/* ═══════════════ DAWLI NEW ═══════════════ */}
      {subTab === 'dawliNew' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Globe size={20} className="text-blue-500" />
              دولي جديد
            </h3>
          </div>
          <LeadTable
            rows={[]}
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
        </div>
      )}

      {/* ═══════════════ DAWLI OLD ═══════════════ */}
      {subTab === 'dawliOld' && (
        <ArchiveTab
          leads={leads}
          staffMembers={staffMembers}
          addLead={addLead as (l: Partial<LeadItem>) => Promise<unknown>}
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
          title="محلي قديم — الاستيراد والتعيين الجماعي"
          defaultSource="محلي قديم"
        />
      )}

      {/* ═══════════════ ARCHIVE / OLD DATA ═══════════════ */}
      {subTab === 'archive' && (
        <ArchiveTab
          leads={leads}
          staffMembers={staffMembers}
          addLead={addLead as (l: Partial<LeadItem>) => Promise<unknown>}
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
      )}


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

      {/* CRM Settings Modal */}

      {/* ── CONVERT LEAD MODAL ──────────────────────────────────────── */}
      <ConvertLeadModal
        convertLeadModal={convertLeadModal}
        setConvertLeadModal={setConvertLeadModal}
        courses={courses}
        convertLeadToSubscriber={convertLeadToSubscriber}
      />

      {/* ── PAYMENT MODAL ─────────────────────────────────────────────── */}
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
          instituteName={'مهاد نفسي'}
        />
      )}

      {/* ── SALES NOTIF PANEL ───────────────────────────────────────── */}
      {salesNotifOpen && (
        <SalesFollowupPanel
          isSalesOnly={isSalesOnly}
          currentStaff={currentStaff}
          leads={leads}
          setSalesNotifOpen={setSalesNotifOpen}
          setLeadsFollowupFilter={setLeadsFollowupFilter}
          setActiveDashboardTab={setActiveDashboardTab}
        />
      )}

      {showSettings && (
        <CrmSettingsModal
          onClose={() => setShowSettings(false)}
          notify={notify}
          salesReps={salesReps}
          onSynced={async () => {
            setShowSettings(false);
            await reloadLeads();
            // Reload settings so sources list updates
            mysqlAdmin.getCrmSettings().then(data => {
              if (data && (data as Partial<CrmSettings>).leadSources?.length) {
                setCrmSettings(x => ({ ...x, ...(data as Partial<CrmSettings>) }));
              }
            }).catch(() => {});
          }}
        />
      )}

      {/* Add Lead Modal */}
      {showAddLead && (
        <AddLeadModal
          courses={courses}
          bundles={bundles}
          salesReps={salesReps}
          leads={leads}
          sources={crmSettings.leadSources}
          branches={instituteBranches}
          onClose={() => setShowAddLead(false)}
          onSave={handleAddLead}
        />
      )}

      {/* Bulk WhatsApp Modal */}
      {showBulkWA && (
        <BulkWhatsAppModal
          selectedLeads={leads.filter(l => selectedLeadIds.has(l.id))}
          onClose={() => { setShowBulkWA(false); setBulkMode(false); setSelectedLeadIds(new Set()); }}
          notify={notify}
        />
      )}

      {/* WhatsApp Per-Rep Modal */}
      {waActiveRep && (
        <WhatsAppRepModal
          rep={waActiveRep}
          leads={leads}
          onClose={() => setWaRepId(null)}
          notify={notify}
        />
      )}
    </div>
  );
}
