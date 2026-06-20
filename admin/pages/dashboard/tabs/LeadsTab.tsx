import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, AlertCircle, Archive, Award, BarChart2, Bell, BookOpen, CalendarPlus, CheckCheck, CheckCircle,
  ChevronDown, Clock, Columns, CreditCard, Download, ExternalLink, EyeOff, Eye,
  FolderKanban, Globe, Inbox, Link2, MapPin, MessageCircle, MessageSquare, MessageSquareText,
  Phone, Plus, RefreshCw, Search, Settings, Share2, Star, Tag, Trash2, TrendingUp,
  Upload, UserPlus, Users, Wallet, X,
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


import { AddLeadModal, BulkWhatsAppModal, CsvImportButton, WhatsAppRepModal, TagInput, getScoreBreakdown, ScoreBadge, LeadJourneyTimeline, QuickEditPanel, LeadCard, MultiSelectDropdown, ArchiveTab, LEAD_STATUS_CFG, crmSourceLabels, formatWaPhone, normBranchId, mkPromoCode, crmStatusLabels, paymentTypeLabels, EVENT_CFG } from './leads/LeadSubcomponents';
import { LeadsCommunicationsPanel } from './leads/LeadsCommunicationsPanel';
import { LeadsPerformancePanel } from './leads/LeadsPerformancePanel';
import type { ArchiveTabProps, CertPricingMap } from './leads/LeadSubcomponents';

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

  type SubTabKey = 'pipeline' | 'table' | 'communications' | 'performance' | 'dawliNew' | 'dawliOld' | 'archive' | 'reminders';
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
  const [bulkUploadNotice, setBulkUploadNotice] = useState('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const [convertLeadModal, setConvertLeadModal] = useState<{
    lead: LeadItem | null; courseId: string; accessMode: AccessMode;
  }>({ lead: null, courseId: '', accessMode: 'full' });
  const [leadPayRow, setLeadPayRow] = useState<LeadItem | null>(null);
  const [leadPayDraft, setLeadPayDraft] = useState<PaymentDraft>(blankPaymentDraft());
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
        ...validItems.map(item => ({
          id: `pay-${Date.now()}-${item.courseId}`,
          amount: Number(item.amount),
          currency: leadPayDraft.currency,
          paymentType: leadPayDraft.paymentType as PaymentItemType,
          isInstallment: leadPayDraft.bookingType === 'installment',
          courseId: item.courseId || undefined,
          note: [...noteParts, _buildCourseNote(item.courseId, Number(item.amount))].filter(Boolean).join(' | ') || undefined,
          paymentMethod: leadPayDraft.paymentMethod || undefined,
          transactionId: leadPayDraft.transactionId || undefined,
          fromAccountNumber: leadPayDraft.transferRef || undefined,
          at: leadPayDraft.date,
        })),
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
      const payHistEntry: PaymentHistoryEntry = {
        id: `pay-${Date.now()}`, amount: _applyDiscount(Number(leadPayDraft.amount)),
        currency: leadPayDraft.currency, paymentType: leadPayDraft.paymentType as PaymentItemType,
        isInstallment: leadPayDraft.bookingType === 'installment',
        courseId: leadPayDraft.courseId || undefined,
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

  // ── General CSV Import ────────────────────────────────────────────────────
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
      const normalizePhone = (value?: string | null) => (value || '').replace(/\D/g, '');
      const normalizedPhone = normalizePhone(phone);
      const isDup = leads.some(l =>
        (normalizedPhone && normalizePhone(l.phone) === normalizedPhone) ||
        (email && email.length > 3 && (l.email || '').toLowerCase() === email.toLowerCase())
      );
      if (isDup) continue;
      const rawTags = get('tags');
      const tags = rawTags ? rawTags.split(/[,،|]/).map(t => t.trim()).filter(Boolean) : [];
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

  // ── Facebook Lead Ads: Fetch available forms from Graph API ───────────────

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

  // ── Facebook Lead Ads: Sync leads from Graph API ──────────────────────────
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


  return (
    <div className="space-y-4" dir="rtl">
      {/* Row 1: Title + tabs + primary actions — all on one line */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <FolderKanban size={22} className="text-primary-600" />
            {isSalesOnly ? 'عملائي المحتملون' : 'CRM — إدارة المبيعات'}
          </h2>
          {!isSalesOnly && (
            <p className="text-sm text-gray-500 mt-0.5">
              {leads.filter(l => !l.hidden && !isOnlineSource(l.source)).length} عميل محتمل ·{' '}
              <span className={overdueLeads.length > 0 ? 'text-red-600 font-bold' : ''}>{overdueLeads.length} يحتاج متابعة عاجلة</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Sub-tab buttons — inline with actions */}
          {(() => {
            const rottenCount = effectiveLeads.filter(l => !l.hidden && getRottenLevel(l) >= 2).length;
            return ([
              ['pipeline', 'البايبلاين', Columns],
              ['table', 'الجدول', Users],
              ['communications', 'الاتصالات', Phone],
              ...(!isSalesOnly ? [['performance', 'أداء الفريق', TrendingUp]] : []),
              ['dawliNew', 'دولي جديد', Globe],
              ['dawliOld', 'دولي قديم', Globe],
              ...(!isSalesOnly ? [['archive', 'محلي قديم', Archive]] : []),
            ] as [SubTabKey, string, React.ElementType][]).map(([t, lbl, Ic]) => (
              <button key={t} onClick={() => setSubTab(t)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition relative ${
                  subTab === t ? 'bg-primary-600 text-white shadow-sm shadow-primary-500/30' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                <Ic size={13} />
                {lbl}
                {t === 'communications' && (rottenCount + overdueLeads.length) > 0 && (
                  <span className="w-3.5 h-3.5 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center">
                    {rottenCount + overdueLeads.length}
                  </span>
                )}
              </button>
            ));
          })()}
          <div className="w-px h-6 bg-gray-200 mx-1" />
          <button onClick={() => setShowAddLead(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm shadow-emerald-500/30">
            <UserPlus size={15} />
            إضافة ليد
          </button>
          {!isSalesOnly && (
            <div className="relative" ref={actionsMenuRef}>
              <button
                onClick={() => setShowActionsMenu(v => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition border border-gray-200">
                <Settings size={15} />
                إجراءات
                <ChevronDown size={14} className={`transition-transform ${showActionsMenu ? 'rotate-180' : ''}`} />
              </button>
              {showActionsMenu && (
                <div className="absolute left-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-xl z-50 w-52 py-1 overflow-hidden">
                  <button onClick={() => { setShowSettings(true); setShowActionsMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition text-right">
                    <Settings size={14} className="text-indigo-500 flex-shrink-0" /> إعدادات CRM
                  </button>
                  <div className="border-t border-gray-100 my-0.5" />
                  <div className="px-3 py-1.5">
                    <CsvImportButton notify={notify} onImported={() => {}} />
                  </div>
                  <button onClick={() => { handleSyncSheet(); setShowActionsMenu(false); }}
                    disabled={syncingSheet}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-blue-700 hover:bg-blue-50 transition disabled:opacity-60 text-right">
                    <RefreshCw size={14} className={`flex-shrink-0 ${syncingSheet ? 'animate-spin' : ''}`} />
                    {syncingSheet ? 'جاري...' : 'مزامنة الشيت'}
                  </button>
                  <button onClick={() => { handleMigrateBranches(); setShowActionsMenu(false); }}
                    disabled={migratingBranches}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-amber-700 hover:bg-amber-50 transition disabled:opacity-60 text-right">
                    {migratingBranches
                      ? <span className="inline-block w-4 h-4 border-2 border-amber-400/40 border-t-amber-600 rounded-full animate-spin flex-shrink-0" />
                      : <MapPin size={14} className="flex-shrink-0" />}
                    {migratingBranches ? 'جاري...' : 'استيراد الفروع'}
                  </button>
                  <button onClick={() => {
                    const headers = ['الاسم', 'الهاتف', 'البريد', 'المصدر', 'الحالة', 'مستوى الاهتمام', 'المندوب', 'تاريخ الإنشاء'];
                    const rows = visibleLeads.map(l => [
                      l.name, l.phone, l.email || '', l.source || '',
                      l.status, l.interestLevel || '', l.assignedSalesName || '',
                      (l.createdAt || '').slice(0, 10),
                    ]);
                    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
                    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
                    URL.revokeObjectURL(url);
                    setShowActionsMenu(false);
                  }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition text-right">
                    <Download size={14} className="text-gray-500 flex-shrink-0" /> تصدير CSV
                  </button>
                  <div className="border-t border-gray-100 my-0.5" />
                  <button onClick={() => { setBulkMode(b => !b); setSelectedLeadIds(new Set()); setShowActionsMenu(false); }}
                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition text-right ${
                      bulkMode ? 'text-emerald-700 bg-emerald-50' : 'text-gray-700 hover:bg-gray-50'
                    }`}>
                    <MessageCircle size={14} className="flex-shrink-0" />
                    {bulkMode ? `إرسال جماعي (${selectedLeadIds.size})` : 'إرسال جماعي'}
                  </button>
                  {bulkMode && selectedLeadIds.size > 0 && (
                    <button onClick={() => { setShowBulkWA(true); setShowActionsMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition text-right font-bold">
                      <MessageCircle size={14} className="flex-shrink-0" />
                      إرسال واتساب ({selectedLeadIds.size})
                    </button>
                  )}
                  <div className="border-t border-gray-100 my-0.5" />
                  <button onClick={async () => {
                    if (!window.confirm('سيتم إخفاء العملاء المحتملين بدون اسم ولا هاتف. تأكيد؟')) return;
                    setShowActionsMenu(false);
                    try {
                      const r = await mysqlAdmin.adminPost('/api/admin/cleanup-junk-leads', {}) as Record<string, unknown>;
                      notify('success', `تم إخفاء ${r.hidden as number} سجل جنك`);
                      reloadLeads();
                    } catch { notify('error', 'فشل التنظيف'); }
                  }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition text-right">
                    <span className="flex-shrink-0">🗑</span> تنظيف جنك
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Sales KPI strip — 7 احصائيات ─────────────────────────────── */}
      {isSalesOnly && (() => {
        const todayStr = new Date().toISOString().slice(0, 10);
        const thisMonthStr = new Date().toISOString().slice(0, 7);
        const weekAgoStr = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        const todayCalls = effectiveLeads.reduce((n, l) =>
          n + (l.communications || []).filter(c => c.date?.slice(0,10) === todayStr).length, 0);
        const weekCalls = effectiveLeads.reduce((n, l) =>
          n + (l.communications || []).filter(c => c.date?.slice(0,10) >= weekAgoStr).length, 0);
        const monthConverted = effectiveLeads.filter(l =>
          l.status === 'converted' && (l.updatedAt || l.createdAt || '').slice(0,7) === thisMonthStr).length;
        const totalActive = effectiveLeads.filter(l => !['converted','lost','not_interested_hidden'].includes(l.status || '')).length;
        const overdueCount = effectiveLeads.filter(l =>
          l.nextFollowUpDate && l.nextFollowUpDate < todayStr && !['converted','lost'].includes(l.status || '')).length;
        const totalCollected = (effectiveSubs || []).reduce((s, sub) =>
          s + (sub.paymentHistory || []).reduce((a: number, p) =>
            a + (p.currency === 'EGP' ? (p.amount || 0) : 0), 0)
        , 0);
        const totalLeads = effectiveLeads.length;
        const totalConverted = effectiveLeads.filter(l => l.status === 'converted').length;
        const convRate = totalLeads > 0 ? Math.round((totalConverted / totalLeads) * 100) : 0;
        return (
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            {[
              { label: 'مكالمات اليوم', value: todayCalls, icon: '📞', cls: 'bg-blue-50 border-blue-200 text-blue-800', tip: 'عدد تسجيلات التواصل اليوم' },
              { label: 'مكالمات الأسبوع', value: weekCalls, icon: '📅', cls: 'bg-indigo-50 border-indigo-200 text-indigo-800', tip: 'عدد التواصلات في آخر 7 أيام' },
              { label: 'محوّلون / الشهر', value: monthConverted, icon: '🎯', cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', tip: 'عدد العملاء المحولين للتسجيل هذا الشهر' },
              { label: 'نشط الآن', value: totalActive, icon: '⚡', cls: 'bg-amber-50 border-amber-200 text-amber-800', tip: 'ليدز نشطة لم تُحوَّل أو تُفقد' },
              { label: 'متابعة متأخرة', value: overdueCount, icon: '⚠️', cls: overdueCount > 0 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-gray-50 border-gray-200 text-gray-500', tip: 'ليدز تجاوزت تاريخ المتابعة' },
              { label: 'نسبة التحويل', value: `${convRate}%`, icon: '📈', cls: convRate >= 30 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : convRate >= 15 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-gray-50 border-gray-200 text-gray-600', tip: `${totalConverted} من ${totalLeads} ليد` },
              { label: 'إجمالي التحصيلات', value: totalCollected > 0 ? `${totalCollected.toLocaleString()} ج.م` : '—', icon: '💰', cls: 'bg-teal-50 border-teal-200 text-teal-800', tip: 'إجمالي المبالغ المحصّلة من ليدزك بالجنيه' },
            ].map(c => (
              <div key={c.label} className={`border rounded-xl px-2.5 py-2 flex flex-col gap-0.5 ${c.cls}`} title={c.tip}>
                <div className="flex items-center gap-1.5">
                  <span className="text-lg leading-none">{c.icon}</span>
                  <span className="text-lg font-extrabold leading-tight truncate">{c.value}</span>
                </div>
                <div className="text-[10px] font-medium opacity-75 leading-tight">{c.label}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ─── border separator under the top row ─── */}
      <div className="border-b border-gray-100 -mt-1" />

      {/* ═══════════════ SHARED FILTER BAR (pipeline + table) ═══════════════ */}
      {(subTab === 'pipeline' || subTab === 'table') && (
        <>
        {/* rotting filter: shown only if user opts in via call_queue tab */}
        <div className="flex items-center gap-1.5 bg-gray-50 rounded-xl border border-gray-100 px-2.5 py-1.5 overflow-x-auto flex-nowrap">
          <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="بحث بالاسم أو الهاتف..."
            className="border border-gray-200 rounded-lg px-2.5 py-1 text-xs flex-shrink-0 w-48 bg-white" />
          {!isSalesOnly && assignedReps.length > 0 && (
            <select
              value={assignFilter.size === 1 ? [...assignFilter][0] : ''}
              onChange={e => setAssignFilter(e.target.value ? new Set([e.target.value]) : new Set())}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none flex-shrink-0">
              <option value="">👤 كل المندوبين</option>
              <option value="__none__">⬜ بدون مندوب</option>
              {assignedReps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <select
            value={singleStatus}
            onChange={e => setSingleStatus(e.target.value as LeadStatus | '')}
            className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none flex-shrink-0">
            <option value="">كل الحالات</option>
            {(Object.keys(STATUS_CFG) as LeadStatus[]).filter(s =>
              !['not_interested_hidden'].includes(s) &&
              (isSalesOnly || !['converted','lost'].includes(s))
            ).map(s => (
              <option key={s} value={s}>{STATUS_CFG[s].label}</option>
            ))}
          </select>
          {(courses.length > 0 || bundles.length > 0) && (
            <select
              value={courseFilter ?? ''}
              onChange={e => setCourseFilter(e.target.value || null)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none max-w-[130px] flex-shrink-0">
              <option value="">🎓 كل الكورسات</option>
              <option value="__none__">⬜ بدون كورس</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              {bundles.map(b => <option key={b.id} value={b.id}>📚 {b.title}</option>)}
            </select>
          )}
          {(() => {
            // Merge instituteBranches with ENUM fallbacks (no duplicates)
            const enumEntries = Object.entries(BRANCH_ENUM_LABELS).map(([id, label]) => ({ id, label }));
            const masterOpts = instituteBranches.length > 0
              ? [
                  ...instituteBranches,
                  ...enumEntries.filter(e => !instituteBranches.some(b => normBranchId(b.id) === normBranchId(e.id))),
                ]
              : enumEntries;
            if (masterOpts.length === 0) return null;
            return (
              <select
                value={branchFilter ?? ''}
                onChange={e => setBranchFilter(e.target.value || null)}
                className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none font-sans flex-shrink-0">
                <option value="">🏢 كل الفروع</option>
                <option value="__none__">⬜ بدون فرع</option>
                {masterOpts.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
              </select>
            );
          })()}
          {(() => {
            const srcOpts = [...new Map(
              effectiveLeads.map(l => l.source?.trim() || '').filter(Boolean)
                .map(s => [s.toLowerCase(), s] as [string, string])
            ).values()].sort((a, b) => a.localeCompare(b, 'ar'));
            if (srcOpts.length === 0) return null;
            return (
              <select
                value={salesSourceFilter}
                onChange={e => setSalesSourceFilter(e.target.value)}
                className="border border-gray-200 rounded-lg px-1.5 py-1 text-xs bg-white focus:outline-none flex-shrink-0 max-w-[110px]">
                <option value="">📡 مصادر</option>
                <option value="__none__">⬜ بدون مصدر</option>
                {srcOpts.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            );
          })()}
          <select
            value={leadsFollowupFilter}
            onChange={e => setLeadsFollowupFilter(e.target.value as typeof leadsFollowupFilter)}
            className={`border rounded-lg px-2 py-1 text-xs bg-white focus:outline-none flex-shrink-0 ${
              leadsFollowupFilter !== 'all' ? 'border-blue-400 bg-blue-50 text-blue-800 font-bold' : 'border-gray-200'
            }`}>
            <option value="all">📅 كل المتابعات</option>
            <option value="today">🔴 متابعة اليوم</option>
            <option value="overdue">⚠️ متأخرة</option>
            <option value="past3d">🕐 فاتت 3 أيام</option>
            <option value="past7d">🕐 فاتت أسبوع</option>
            <option value="past30d">🕐 فاتت شهر</option>
            <option value="next3d">🟢 خلال 3 أيام</option>
            <option value="next7d">🟢 خلال أسبوع</option>
            <option value="no_followup">❓ بدون متابعة</option>
          </select>
          <button
            onClick={() => setShowHiddenLeads(v => !v)}
            title={showHiddenLeads ? 'عرض الكل' : 'عرض المخفيين فقط'}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold border transition flex-shrink-0 ${showHiddenLeads ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}>
            {showHiddenLeads ? '👁 الكل' : '🙈 مخفيون'}
          </button>
          {(assignFilter.size > 0 || singleStatus || courseFilter || branchFilter || searchTerm || showHiddenLeads || salesSourceFilter || leadsFollowupFilter !== 'all') && (
            <button
              onClick={() => { setAssignFilter(new Set()); setSingleStatus(''); setCourseFilter(null); setBranchFilter(null); setSearchTerm(''); setShowHiddenLeads(false); setSalesSourceFilter(''); setLeadsFollowupFilter('all'); }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition font-bold flex-shrink-0">
              ✕ مسح
            </button>
          )}
          {!isSalesOnly && (
            <div className="mr-auto flex gap-2 text-[11px] text-gray-500 items-center flex-shrink-0">
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-green-500 rounded-full" /> {totalConverted}</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-red-400 rounded-full" /> {totalLost}</span>
              <span className="text-gray-400">{visibleLeads.length}</span>
            </div>
          )}
        </div>
        </>
      )}

      {/* ═══════════════ PIPELINE ═══════════════ */}
      {subTab === 'pipeline' && (
        <div className="space-y-4">
          {/* Kanban board */}
          <div className="overflow-x-auto pb-4 -mx-1 px-1" dir="rtl">
            <div className="flex gap-3 min-w-max">
              {activeStatusCols.length === 0 && (
                <div className="flex items-center justify-center w-full py-16 text-gray-400 text-sm">
                  لا توجد ليدز تطابق الفلاتر المختارة
                </div>
              )}
              {activeStatusCols.map(status => {
                const colLeads = scoredLeads.filter(l => l.status === status);
                const limit = colLimit[status];
                const visible = colLeads.slice(0, limit);
                const remaining = colLeads.length - visible.length;
                const cfg = STATUS_CFG[status];
                const isDropTarget = dragOverCol === status;
                return (
                  <div key={status}
                    className={`w-60 flex-shrink-0 rounded-xl border-t-4 transition ${cfg.colColor} ${isDropTarget ? 'bg-primary-50 ring-2 ring-primary-300' : 'bg-gray-50'}`}
                    dir="rtl"
                    onDragOver={e => { e.preventDefault(); setDragOverCol(status); }}
                    onDragLeave={() => setDragOverCol(null)}
                    onDrop={e => {
                      e.preventDefault();
                      setDragOverCol(null);
                      if (draggedLeadRef.current && draggedLeadRef.current.status !== status) {
                        handleStatusChange(draggedLeadRef.current, status);
                      }
                      draggedLeadRef.current = null;
                    }}
                  >
                    <div className="px-3 py-2.5 flex items-center justify-between border-b border-gray-100">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${cfg.color}`}>{cfg.label}</span>
                      <span className="text-xs text-gray-400 font-bold bg-white border border-gray-200 rounded-full w-5 h-5 flex items-center justify-center">
                        {colLeads.length}
                      </span>
                    </div>
                    <div className="p-2 space-y-2 overflow-y-visible">
                      {visible.length === 0 && (
                        <p className="text-xs text-gray-400 text-center py-8">لا يوجد</p>
                      )}
                      {visible.map(lead => (
                        <div key={lead.id} className="relative"
                          draggable
                          onDragStart={() => { draggedLeadRef.current = lead; }}
                          onDragEnd={() => { draggedLeadRef.current = null; setDragOverCol(null); }}
                        >
                          {bulkMode && (
                            <input type="checkbox"
                              checked={selectedLeadIds.has(lead.id)}
                              onChange={e => {
                                e.stopPropagation();
                                setSelectedLeadIds(prev => {
                                  const next = new Set(prev);
                                  e.target.checked ? next.add(lead.id) : next.delete(lead.id);
                                  return next;
                                });
                              }}
                              className="absolute top-2 left-2 z-10 w-4 h-4 accent-emerald-600"
                              onClick={e => e.stopPropagation()}
                            />
                          )}
                          <LeadCard lead={lead} score={lead._score}
                            onSelect={() => !bulkMode && setSelectedId(lead.id)}
                            onStatusChange={s => handleStatusChange(lead, s)}
                            onBook={openLeadBook}
                            onContact={l => { setCrmContactRow(l); setCrmContactDraft({ type: 'call', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '', newStatus: '' }); }}
                            instituteBranches={instituteBranches}
                            courses={courses}
                            bundles={bundles}
                          />
                        </div>
                      ))}
                      {remaining > 0 && (
                        <button
                          onClick={() => setColLimit(prev => ({ ...prev, [status]: (prev[status] || 15) + 15 }))}
                          className="w-full text-xs text-primary-600 font-bold py-2 bg-primary-50 hover:bg-primary-100 rounded-lg transition">
                          عرض {Math.min(remaining, 15)} أكثر ({remaining} متبقي)
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
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
                {convertLeadModal.lead && (
                  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setConvertLeadModal({ lead: null, courseId: '', accessMode: 'full' })}>
                    <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
                      <h3 className="font-bold text-gray-900 text-lg mb-1">????? ???? ??????</h3>
                      <p className="text-sm text-gray-500 mb-4">???? ????? <span className="font-bold text-gray-800">{convertLeadModal.lead.name}</span> ?????? ???? ?? ?????? ???? ??????.</p>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">?????? ????????</label>
                          <select className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm" value={convertLeadModal.courseId} onChange={(e) => setConvertLeadModal({ ...convertLeadModal, courseId: e.target.value })}>
                            <option value="">???? ??????...</option>
                            {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">??? ??????</label>
                          <select className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm" value={convertLeadModal.accessMode} onChange={(e) => setConvertLeadModal({ ...convertLeadModal, accessMode: e.target.value as AccessMode })}>
                            <option value="full">???? ????</option>
                            <option value="trial">??????</option>
                            <option value="limited">?????</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-5">
                        <button onClick={convertLeadToSubscriber} disabled={!convertLeadModal.courseId} className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-1.5">
                          <CheckCircle size={16} /> ????? ??????
                        </button>
                        <button onClick={() => setConvertLeadModal({ lead: null, courseId: '', accessMode: 'full' })} className="flex-1 border border-gray-300 text-gray-700 font-bold py-2.5 rounded-xl text-sm hover:bg-gray-50">
                          ?????
                        </button>
                      </div>
                    </div>
                  </div>
                )}

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
            {salesNotifOpen && (() => {
              const todayStr = new Date().toISOString().slice(0, 10);
              const myLeads = isSalesOnly && currentStaff
                ? leads.filter(l => l.assignedSalesId === currentStaff.id && !['converted', 'lost'].includes(l.status))
                : leads.filter(l => !['converted', 'lost'].includes(l.status));

              const overdue = myLeads
                .filter(l => l.nextFollowUpDate && l.nextFollowUpDate < todayStr)
                .sort((a, b) => (a.nextFollowUpDate || '').localeCompare(b.nextFollowUpDate || ''));
              const todayLeads = myLeads
                .filter(l => l.nextFollowUpDate === todayStr)
                .sort((a, b) => a.name.localeCompare(b.name));
              const noFollowup = myLeads
                .filter(l => !l.nextFollowUpDate && ['new', 'contacted', 'interested'].includes(l.status))
                .sort((a, b) => b.createdAt?.localeCompare(a.createdAt || '') || 0);

              const waPhone = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('0') ? '2' + d : d; };

              const LeadRow = ({ l, badge }: { l: LeadItem; badge: React.ReactNode }) => {
                const daysSince = l.nextFollowUpDate
                  ? Math.floor((Date.now() - new Date(l.nextFollowUpDate).getTime()) / 86_400_000)
                  : null;
                return (
                  <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition">
                    <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                      {l.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="font-bold text-gray-800 text-sm">{l.name}</span>
                        {badge}
                        {l.assignedSalesName && !isSalesOnly && (
                          <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">👤 {l.assignedSalesName}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                        {l.phone && <a href={`tel:${l.phone}`} className="text-blue-600 hover:underline">{l.phone}</a>}
                        {l.nextFollowUpDate && daysSince !== null && daysSince > 0 && (
                          <span className="text-red-500 font-bold">متأخر {daysSince} يوم</span>
                        )}
                        {l.lastContactNote && <span className="truncate max-w-[160px] text-gray-400 italic">{l.lastContactNote}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {l.phone && (
                        <a href={`https://wa.me/${waPhone(l.phone)}`} target="_blank" rel="noopener noreferrer"
                          className="w-7 h-7 rounded-full bg-green-500 hover:bg-green-600 text-white text-xs font-bold flex items-center justify-center">W</a>
                      )}
                    </div>
                  </div>
                );
              };

              return (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-end" onClick={() => setSalesNotifOpen(false)}>
                  <div className="bg-white h-full w-full max-w-md shadow-2xl flex flex-col" dir="rtl" onClick={e => e.stopPropagation()}>
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gradient-to-l from-primary-50 to-white">
                      <div>
                        <h2 className="font-bold text-gray-900 text-lg">🔔 متابعات السيلز</h2>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {isSalesOnly ? `قائمتك — ${myLeads.length} عميل` : `جميع السيلز — ${myLeads.length} عميل`}
                        </p>
                      </div>
                      <button onClick={() => setSalesNotifOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
                    </div>

                    {/* KPI strip */}
                    <div className="grid grid-cols-3 gap-0 border-b border-gray-100">
                      {[
                        { label: 'متأخرة', val: overdue.length, color: overdue.length > 0 ? 'text-red-600 bg-red-50' : 'text-gray-400 bg-gray-50' },
                        { label: 'اليوم', val: todayLeads.length, color: todayLeads.length > 0 ? 'text-amber-600 bg-amber-50' : 'text-gray-400 bg-gray-50' },
                        { label: 'بدون موعد', val: noFollowup.length, color: noFollowup.length > 0 ? 'text-violet-600 bg-violet-50' : 'text-gray-400 bg-gray-50' },
                      ].map(c => (
                        <div key={c.label} className={`${c.color} py-3 text-center`}>
                          <div className="text-2xl font-extrabold">{c.val}</div>
                          <div className="text-[11px] font-medium opacity-80">{c.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Scrollable list */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-5">

                      {/* Overdue */}
                      {overdue.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">⚠️ متأخرة ({overdue.length})</span>
                          </div>
                          <div className="space-y-2">
                            {overdue.map(l => (
                              <LeadRow key={l.id} l={l} badge={
                                <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                                  📅 {l.nextFollowUpDate}
                                </span>
                              } />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Today */}
                      {todayLeads.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">📅 متابعات اليوم ({todayLeads.length})</span>
                          </div>
                          <div className="space-y-2">
                            {todayLeads.map(l => (
                              <LeadRow key={l.id} l={l} badge={
                                <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">اليوم</span>
                              } />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* No followup date */}
                      {noFollowup.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-bold text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">🕐 بدون موعد متابعة ({noFollowup.length})</span>
                          </div>
                          <div className="space-y-2">
                            {noFollowup.slice(0, 20).map(l => (
                              <LeadRow key={l.id} l={l} badge={
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                                  l.status === 'interested' ? 'bg-emerald-100 text-emerald-700'
                                    : l.status === 'contacted' ? 'bg-amber-100 text-amber-700'
                                    : 'bg-blue-100 text-blue-700'
                                }`}>
                                  {LEAD_STATUS_CFG[l.status as LeadStatus]?.label || l.status}
                                </span>
                              } />
                            ))}
                            {noFollowup.length > 20 && (
                              <p className="text-xs text-gray-400 text-center pt-1">+{noFollowup.length - 20} عميل آخر</p>
                            )}
                          </div>
                        </div>
                      )}

                      {overdue.length === 0 && todayLeads.length === 0 && noFollowup.length === 0 && (
                        <div className="text-center py-20">
                          <div className="text-5xl mb-3">✅</div>
                          <p className="text-gray-500 font-bold">كل شيء على ما يرام!</p>
                          <p className="text-gray-400 text-sm mt-1">لا توجد متابعات معلّقة</p>
                        </div>
                      )}
                    </div>

                    {/* Footer actions */}
                    <div className="border-t border-gray-200 px-5 py-4 bg-gray-50 space-y-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setLeadsFollowupFilter('overdue'); setSalesNotifOpen(false); setActiveDashboardTab?.('leads'); }}
                          disabled={overdue.length === 0}
                          className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-xl disabled:opacity-40 transition"
                        >عرض المتأخرة في الجدول</button>
                        <button
                          onClick={() => { setLeadsFollowupFilter('today'); setSalesNotifOpen(false); setActiveDashboardTab?.('leads'); }}
                          disabled={todayLeads.length === 0}
                          className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl disabled:opacity-40 transition"
                        >عرض اليوم</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

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
