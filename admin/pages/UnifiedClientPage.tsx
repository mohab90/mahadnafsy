/**
 * UnifiedClientPage — ONE page for ALL clients (leads + subscribers)
 * URL: /client/:code  (stable, never changes even after conversion)
 *
 * Layout:
 *   LEFT sidebar  → full client data + actions (edit / pay / grant / contact / convert)
 *   RIGHT main    → overview tab first, then contextual tabs
 */
import React, { Suspense, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Phone, MessageSquare, Plus, Trash2, Mail,
  CheckCircle, Clock, CreditCard, Info, Copy,
  Activity, User, Key, Tag,
  Printer, DollarSign, CalendarCheck2, RefreshCw, AlertCircle, X,
} from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { mysqlAdmin } from '../lib/mysqlapi';
import type { PaymentDraft } from '../components/PaymentModal';
import { createClientPaymentDraft } from '../lib/clientActionDrafts';
import { SideRow } from './unified-client/SideRow';
import { useUnifiedClientActiveTab, type UnifiedClientTab } from './unified-client/useUnifiedClientActiveTab';
import { buildUnifiedClientTabs, UnifiedClientTabs } from './unified-client/UnifiedClientTabs';
import { UnifiedClientCertificatesPanel } from './unified-client/UnifiedClientCertificatesPanel';
import { useUnifiedClientPaymentProofs } from './unified-client/useUnifiedClientPaymentProofs';
import { useUnifiedClientPermissions } from './unified-client/useUnifiedClientPermissions';
import { useUnifiedClientCertificateState } from './unified-client/useUnifiedClientCertificateState';
import { useUnifiedClientInstallmentState } from './unified-client/useUnifiedClientInstallmentState';
import { UnifiedClientExtraCertificateModal } from './unified-client/UnifiedClientExtraCertificateModal';
import { UnifiedClientCertificateViewModal } from './unified-client/UnifiedClientCertificateViewModal';
import { UnifiedClientPaymentDetailModal } from './unified-client/UnifiedClientPaymentDetailModal';
import { UnifiedClientHeroHeader } from './unified-client/UnifiedClientHeroHeader';
import { UnifiedClientCommunicationsPanel } from './unified-client/UnifiedClientCommunicationsPanel';
import { UnifiedClientConsultationsPanel } from './unified-client/UnifiedClientConsultationsPanel';
import { UnifiedClientDaqqiPanel } from './unified-client/UnifiedClientDaqqiPanel';
import { UnifiedClientLeadPaymentsPanel } from './unified-client/UnifiedClientLeadPaymentsPanel';
import { UnifiedClientInstallmentsPanel } from './unified-client/UnifiedClientInstallmentsPanel';
import { UnifiedClientLegacyPaymentModal } from './unified-client/UnifiedClientLegacyPaymentModal';
import { UnifiedClientSubscriberPaymentsPanel } from './unified-client/UnifiedClientSubscriberPaymentsPanel';
import { UnifiedClientLoyaltyPanel } from './unified-client/UnifiedClientLoyaltyPanel';
import { UnifiedClientOverviewTab } from './unified-client/UnifiedClientOverviewTab';
import { UnifiedClientCoursesTab } from './unified-client/UnifiedClientCoursesTab';
import { UnifiedClientEditTab, type UnifiedClientSubscriberDraft } from './unified-client/UnifiedClientEditTab';
import { UnifiedClientAccessModal } from './unified-client/UnifiedClientAccessModal';
import {
  UnifiedClientSidebarFinancialCard,
  UnifiedClientSidebarLeadCourseCard,
  UnifiedClientSidebarActivityCard,
  UnifiedClientSidebarCertificatesCard,
  UnifiedClientSidebarDiscountCard,
  UnifiedClientSidebarInstallmentsCard,
  UnifiedClientSidebarLinkedSubscriberCard,
  UnifiedClientSidebarNotesCard,
  UnifiedClientSidebarPromoCard,
  UnifiedClientSidebarProfileCard,
  UnifiedClientSidebarQuickActions,
} from './unified-client/UnifiedClientSidebarCards';
import {
  branchLabels,
  commTypeMeta,
  generatePromoCode,
  normBranchKey,
  ptLabels,
  statusColors,
} from './unified-client/constants';

import {
  LeadItem, SubscriberItem, CommunicationRecord,
  PaymentRecord, BranchType, StaffMember, PaymentItemType,
  CourseAccessSetting, SubscriberCertificate,
  ExtraCertificateRequest, ExtraCertificateType,
  UserSessionData, InstallmentPlan, InstallmentEntry,
  PaymentHistoryEntry,
} from '../types';

// ─── Main Component ───────────────────────────────────────────────────────────

interface UnifiedClientPageProps {
  lead?: LeadItem;
  subscriber?: SubscriberItem;
}

const UnifiedClientPage: React.FC<UnifiedClientPageProps> = ({ lead, subscriber }) => {
  const navigate = useNavigate();
  const {
    courses, bundles, staffMembers, subscribers, leads, isAdmin, authUser,
    updateLead, deleteLead, addSubscriber, updateSubscriber, deleteSubscriber,
    getCourseLectures, daqqiRounds, consultations, communityPosts, content,
  } = useSiteData();

  const { isOnlineManager, canManageCourseAccess } = useUnifiedClientPermissions({
    isAdmin,
    authUser,
    staffMembers,
  });

  const isSub = !!subscriber;
  const clientName   = subscriber?.name   ?? lead?.name   ?? '';
  const clientPhone  = subscriber?.phone  ?? lead?.phone  ?? '';
  const clientEmail  = subscriber?.email  ?? lead?.email  ?? '';
  const clientCode   = subscriber?.clientCode ?? subscriber?.id ?? lead?.clientCode ?? lead?.id ?? '';
  const clientBranch = subscriber?.branch ?? lead?.branch;

  // ── link between lead ↔ subscriber ──────────────────────────────────────
  const linkedSub  = lead      ? (subscribers.find(s => s.leadId === lead.id) ?? subscribers.find(s => (lead.phone && s.phone === lead.phone) || (lead.email && s.email === lead.email))) : undefined;
  const linkedLead = subscriber?.leadId ? leads.find(l => l.id === subscriber.leadId) : undefined;

  // ── tabs ──────────────────────────────────────────────────────────────────
  const { activeTab, setActiveTab } = useUnifiedClientActiveTab();
  // scroll to section from navigation state (e.g. 📅 button in Dashboard)
  // ── copy code ──────────────────────────────────────────────────────────────
  const [codeCopied, setCodeCopied] = useState(false);

  // Fetch current (plain) password when edit tab becomes active
  useEffect(() => {
    if (activeTab !== 'edit' || !subscriber || !(isAdmin || isOnlineManager)) return;
    setCurrentPasswordLoading(true);
    mysqlAdmin.getSubscriberPassword(subscriber.id)
      .then((r: { plain_password: string | null }) => setCurrentPassword(r.plain_password))
      .catch(() => setCurrentPassword(null))
      .finally(() => setCurrentPasswordLoading(false));
  }, [activeTab, subscriber?.id, isAdmin, isOnlineManager]);

  // ── session / activity stats — no longer tracked from Firestore ──────────
  const [sessionData] = useState<UserSessionData | null>(null);
  useEffect(() => {
    /* no-op: userSessions Firestore collection removed */
  }, [isSub, subscriber?.firebaseUid]);

  // ── editing ────────────────────────────────────────────────────────────────
  const [editing, setEditing]   = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Lead edit draft
  const salesStaffList = staffMembers.filter((s: StaffMember) => s.role === 'sales' && s.status === 'active');
  const csStaffList = staffMembers.filter((s: StaffMember) => s.role === 'support' && s.status === 'active');
  const [leadDraft, setLeadDraft] = useState<LeadItem>(lead ?? ({} as LeadItem));
  useEffect(() => { if (lead) setLeadDraft(lead); }, [lead]);

  // Subscriber edit draft
  const [subDraft, setSubDraft] = useState<UnifiedClientSubscriberDraft>({
    name:   subscriber?.name   || '',
    email:  subscriber?.email  || '',
    phone:  subscriber?.phone  || '',
    branch: subscriber?.branch as BranchType | undefined,
    expectedEGP: String(subscriber?.expectedTotals?.EGP || ''),
    expectedSAR: String(subscriber?.expectedTotals?.SAR || ''),
    expectedUSD: String(subscriber?.expectedTotals?.USD || ''),
    assignedSalesId: subscriber?.assignedSalesId || '',
    assignedSalesName: subscriber?.assignedSalesName || '',
    assignedCsId: subscriber?.assignedCsId || '',
    assignedCsName: subscriber?.assignedCsName || '',
    discount: String(subscriber?.discount || ''),
  });
  // Password / credentials change state (admin + online manager)
  const [credNewPassword, setCredNewPassword] = useState('');
  const [credMsg, setCredMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [currentPassword, setCurrentPassword] = useState<string | null>(null);
  const [currentPasswordLoading, setCurrentPasswordLoading] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  // Account diagnostic (admin only)
  const [accountDiag, setAccountDiag] = useState<Record<string, unknown> | null>(null);
  const [accountDiagLoading, setAccountDiagLoading] = useState(false);
  const [createAccLoading, setCreateAccLoading] = useState(false);
  const [createAccMsg, setCreateAccMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => {
    if (subscriber) setSubDraft({
      name: subscriber.name, email: subscriber.email, phone: subscriber.phone,
      branch: subscriber.branch,
      expectedEGP: String(subscriber.expectedTotals?.EGP || ''),
      expectedSAR: String(subscriber.expectedTotals?.SAR || ''),
      expectedUSD: String(subscriber.expectedTotals?.USD || ''),
      assignedSalesId: subscriber.assignedSalesId || '',
      assignedSalesName: subscriber.assignedSalesName || '',
      assignedCsId: subscriber.assignedCsId || '',
      assignedCsName: subscriber.assignedCsName || '',
      discount: String(subscriber.discount || ''),
    });
  }, [subscriber]);

  // ── communications ─────────────────────────────────────────────────────────
  const [showAddComm, setShowAddComm] = useState(false);
  const [newComm, setNewComm] = useState({
    type: 'call' as CommunicationRecord['type'],
    date: new Date().toISOString().slice(0, 16),
    notes: '', outcome: '', nextFollowUp: '',
  });

  // ── payments (lead) ────────────────────────────────────────────────────────
  const [showLeadPayForm, setShowLeadPayForm] = useState(false);
  const [leadPayDraft, setLeadPayDraft] = useState<Omit<PaymentRecord, 'id'>>({
    amount: 0, currency: 'EGP',
    courseId: lead?.enrolledCourseId || '',
    date: new Date().toISOString().slice(0, 10),
    note: '', paymentType: 'course',
  });

  // ── payments (subscriber) ──────────────────────────────────────────────────
  const [showSubPayForm, setShowSubPayForm] = useState(false);
  const [payModalDraft, setPayModalDraft] = useState<PaymentDraft>(createClientPaymentDraft());

  // ── grant (subscriber) ─────────────────────────────────────────────────────
  const [grantDraft, setGrantDraft] = useState({
    courseId: '', note: '',
  });

  // ── convert to subscriber ──────────────────────────────────────────────────
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertCourseId, setConvertCourseId] = useState(lead?.enrolledCourseId || '');
  const [convertAccessMode, setConvertAccessMode] = useState<'full' | 'limited'>('full');
  const [convertPartialCount, setConvertPartialCount] = useState(1);

  // ── contact popup ──────────────────────────────────────────────────────────
  const [showContactPopup, setShowContactPopup] = useState(false);
  const [contactPopupDraft, setContactPopupDraft] = useState({
    type: 'call' as CommunicationRecord['type'],
    date: new Date().toISOString().slice(0, 16),
    notes: '', outcome: '', nextFollowUp: '', newStatus: '',
  });
  const [showAccessModal, setShowAccessModal] = useState(false);

  // ── quick notes (internal, stored in localStorage) ────────────────────────
  const noteKey = `client-note-${clientCode}`;
  const [quickNote, setQuickNote] = useState<string>(() => {
    try { return localStorage.getItem(noteKey) || ''; } catch { return ''; }
  });
  const saveQuickNote = (val: string) => {
    setQuickNote(val);
    try { localStorage.setItem(noteKey, val); } catch { /* ignore */ }
  };

  // ── course access level editing ────────────────────────────────────────────
  const [accessSaving, setAccessSaving] = useState<Record<string, boolean>>({});
  const [accessMsg, setAccessMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  // per-course custom lecture limits for preset buttons (preset1=مقدم, preset2=أول قسط)
  const [accessPresets, setAccessPresets] = useState<Record<string, { p1: number; p2: number }>>({});
  const getPreset = (courseId: string) => accessPresets[courseId] ?? { p1: Number(content['access.videos_on_deposit'] || 20), p2: Number(content['access.videos_per_payment'] || 15) };
  // manual direct input for lecture limit per course
  const [manualLimitDraft, setManualLimitDraft] = useState<Record<string, string>>({});

  const applyAccessLevel = async (courseId: string, mode: 'full' | 'limited', lectureLimit?: number) => {
    if (!subscriber) return;
    setAccessSaving(p => ({ ...p, [courseId]: true }));
    setAccessMsg(p => ({ ...p, [courseId]: { ok: true, text: '' } }));
    try {
      await mysqlAdmin.updateEnrollmentAccess(subscriber.id, courseId, mode, lectureLimit);
      const updatedAccess: CourseAccessSetting = mode === 'full' ? { mode: 'full' } : { mode: 'limited', lectureLimit: lectureLimit ?? 1 };
      updateSubscriber({
        ...subscriber,
        courseAccess: { ...(subscriber.courseAccess ?? {}), [courseId]: updatedAccess },
      });
      setAccessMsg(p => ({ ...p, [courseId]: { ok: true, text: '✓ تم التحديث' } }));
      setTimeout(() => setAccessMsg(p => ({ ...p, [courseId]: { ok: true, text: '' } })), 2500);
    } catch {
      setAccessMsg(p => ({ ...p, [courseId]: { ok: false, text: '✗ فشل الحفظ' } }));
    } finally {
      setAccessSaving(p => ({ ...p, [courseId]: false }));
    }
  };

  // ── show grant form from courses tab ────────────────────────────────────────
  const [showGrantFromCourses, setShowGrantFromCourses] = useState(false);
  const [grantFromCourseId, setGrantFromCourseId] = useState('');

  // ── promo code ────────────────────────────────────────────────────────────
  const [promoCopied, setPromoCopied] = useState(false);

  // ── cert view ─────────────────────────────────────────────────────────────
  const {
    viewCertId,
    setViewCertId,
    showExtraCertForm,
    setShowExtraCertForm,
    extraCertDraft,
    setExtraCertDraft,
    resetExtraCertDraft,
  } = useUnifiedClientCertificateState();

  // ── per-course pay detail popup ───────────────────────────────────────────
  const [showPayDetailModal, setShowPayDetailModal] = useState(false);

  // ── extra certificate request form ────────────────────────────────────────

  // ── legacy payment (old clients with custom prices) ───────────────────────
  const [showLegacyPayForm, setShowLegacyPayForm] = useState(false);
  const [legacyPayDraft, setLegacyPayDraft] = useState({ courseId: '', courseExpected: '', amountPaid: '', note: '' });

  // ── installment plans ──────────────────────────────────────────────────────
  const installmentState = useUnifiedClientInstallmentState();
  const {
    showInstPlanForm,
    setShowInstPlanForm,
    instPlanDraft,
    setInstPlanDraft,
    resetInstPlanDraft,
    payingEntryKey,
    setPayingEntryKey,
    payEntryAmount,
    setPayEntryAmount,
    payEntryDate,
    setPayEntryDate,
    resetPaidEntryState,
  } = installmentState;

  // ── payment proofs (client-uploaded receipts) ─────────────────────────────
  const {
    clientProofs,
    clientProofsLoaded,
    reviewingProofId,
    reviewerNote,
    proofImageUrl,
    reviewLoading,
    setReviewingProofId,
    setReviewerNote,
    loadClientProofs,
    loadProofImage,
    handleReviewProof,
  } = useUnifiedClientPaymentProofs({
    isSubscriber: isSub,
    subscriber,
    updateSubscriber,
  });

  // ── computed ──────────────────────────────────────────────────────────────
  const subCerts  = subscriber?.certificates ?? [];
  const extraReqs = subscriber?.extraCertificateRequests ?? [];
  const subInstallmentPlans = subscriber?.installmentPlans ?? [];
  const _todayStr = new Date().toISOString().slice(0, 10);
  const _soon3Str = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const instOverdueCount = subInstallmentPlans.flatMap(p => p.entries.filter(e => !e.paidAt && e.dueDate < _todayStr)).length;
  const instSoonCount = subInstallmentPlans.flatMap(p => p.entries.filter(e => !e.paidAt && e.dueDate >= _todayStr && e.dueDate <= _soon3Str)).length;

  const allComms: CommunicationRecord[] = [
    ...((lead?.communications       || []).map(c => ({ ...c, _src: 'lead'       as const }))),
    ...((subscriber?.communications || []).map(c => ({ ...c, _src: 'subscriber' as const }))),
  ].sort((a, b) => b.date.localeCompare(a.date));

  // lead payments
  const leadPayments   = lead?.paymentRecords ?? [];
  const leadPaidEGP    = leadPayments.reduce((s, p) => p.currency === 'EGP' ? s + p.amount : s, 0);
  const leadPaidSAR    = leadPayments.reduce((s, p) => p.currency === 'SAR' ? s + p.amount : s, 0);
  const enrolledCourse = lead?.enrolledCourseId ? courses.find(c => c.id === lead.enrolledCourseId) : null;
  const coursePriceEGP = enrolledCourse?.price?.EGP ?? 0;
  const leadRemaining  = Math.max(0, coursePriceEGP - leadPaidEGP);
  const leadPaidPct    = coursePriceEGP > 0 ? Math.min(100, Math.round((leadPaidEGP / coursePriceEGP) * 100)) : 0;

  // subscriber payments — only show confirmed (paid) entries in client view
  const subHistory = subscriber?.paymentHistory ?? [];
  const confirmedHistory = subHistory.filter(p => !p.status || p.status === 'paid');
  const subPaidTotals = { EGP: 0, SAR: 0, USD: 0 };
  confirmedHistory.forEach(p => { subPaidTotals[p.currency] += p.amount; });

  // per-course booking map — use confirmed payments only
  const bookingMap: Record<string, { paidEGP: number; expectedEGP?: number; discount?: number }> = {};
  confirmedHistory.forEach(p => {
    if (p.courseId) {
      if (!bookingMap[p.courseId]) bookingMap[p.courseId] = { paidEGP: 0 };
      if (p.currency === 'EGP') bookingMap[p.courseId].paidEGP += p.amount;
      if (p.isInstallment === false && p.courseExpected) bookingMap[p.courseId].expectedEGP = p.courseExpected;
      if (p.isInstallment === false && p.discount) bookingMap[p.courseId].discount = p.discount;
    }
  });
  const bookedCourseIds: string[] = subscriber
    ? [...new Set<string>([
        // courses with an explicit new_booking payment entry
        ...subHistory.filter(p => p.courseId && p.isInstallment === false).map(p => p.courseId as string),
        // all enrolled courses (enrolled via convert, grant, or any other flow)
        ...subscriber.enrolledCourseIds,
      ])]
    : [];

  // Detect complete bundles from enrolled course IDs to collapse them in the installment selector

  // total expected + remaining for subscriber
  const subExpectedEGP = subscriber?.expectedTotals?.EGP ||
    Object.values(bookingMap).reduce((s, bm) => bm.expectedEGP ? s + bm.expectedEGP : s, 0);
  const subRemainingEGP = subExpectedEGP > 0
    ? Math.max(0, subExpectedEGP - subPaidTotals.EGP - (subscriber?.discount || 0))
    : 0;
  // discount base for percentage buttons
  const discountBase = subExpectedEGP || subPaidTotals.EGP;

  // consultations
  const nm = clientName.trim().toLowerCase();
  const ph = clientPhone.trim();
  const subConsults = consultations.filter(c =>
    c.clientName.trim().toLowerCase() === nm || (ph && c.clientPhone?.trim() === ph)
  );

  // daqqi
  const subDaqqiRounds = subscriber ? (daqqiRounds || []).filter(r => r.attendees.some(a => a.subscriberId === subscriber.id)) : [];

  // ── save handlers ─────────────────────────────────────────────────────────

  const handleSaveLeadEdit = () => {
    if (isSaving || !lead) return;
    setIsSaving(true);
    updateLead(leadDraft);
    setEditing(false);
    setIsSaving(false);
  };

  const handleSaveSubEdit = async () => {
    if (isSaving || !subscriber) return;
    setIsSaving(true);
    setCredMsg(null);

    // 1. Save basic subscriber info
    updateSubscriber({
      ...subscriber,
      name: subDraft.name, email: subDraft.email, phone: subDraft.phone,
      branch: subDraft.branch,
      expectedTotals: (subDraft.expectedEGP || subDraft.expectedSAR || subDraft.expectedUSD)
        ? { EGP: Number(subDraft.expectedEGP) || undefined, SAR: Number(subDraft.expectedSAR) || undefined, USD: Number(subDraft.expectedUSD) || undefined }
        : undefined,
      assignedSalesId: subDraft.assignedSalesId || undefined,
      assignedSalesName: subDraft.assignedSalesName || undefined,
      assignedCsId: subDraft.assignedCsId || undefined,
      assignedCsName: subDraft.assignedCsName || undefined,
      discount: Number(subDraft.discount) || undefined,
    });

    // 2. Credentials update (email and/or password) — if anything changed
    const emailChanged = subDraft.email.trim().toLowerCase() !== subscriber.email.trim().toLowerCase();
    const passwordFilled = credNewPassword.trim().length > 0;
    if (emailChanged || passwordFilled) {
      try {
        const opts: { newEmail?: string; newPassword?: string } = {};
        if (emailChanged) opts.newEmail = subDraft.email.trim();
        if (passwordFilled) opts.newPassword = credNewPassword.trim();
        await mysqlAdmin.updateSubscriberCredentials(subscriber.id, subscriber.email, opts);
        setCredMsg({ type: 'success', text: passwordFilled && emailChanged ? 'تم تحديث الإيميل وكلمة المرور ✓' : passwordFilled ? 'تم تغيير كلمة المرور ✓' : 'تم تحديث الإيميل ✓' });
        if (passwordFilled) setCurrentPassword(credNewPassword.trim());
        setCredNewPassword('');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'فشل تحديث بيانات الدخول';
        setCredMsg({ type: 'error', text: msg });
        setIsSaving(false);
        return; // Don't close edit mode on error
      }
    }

    setEditing(false);
    setIsSaving(false);
  };

  const handleSaveComm = () => {
    if (isSaving || !newComm.notes.trim()) return;
    setIsSaving(true);
    const rec: CommunicationRecord = {
      id: `comm-${Date.now()}`,
      type: newComm.type,
      date: newComm.date.replace('T', ' '),
      notes: newComm.notes,
      outcome: newComm.outcome || undefined,
      nextFollowUp: newComm.nextFollowUp || undefined,
    };
    if (subscriber) {
      updateSubscriber({ ...subscriber, communications: [...(subscriber.communications || []), rec] });
    } else if (lead) {
      updateLead({
        ...lead,
        communications: [...(lead.communications || []), rec],
        status: lead.status === 'new' ? 'contacted' : lead.status,
        lastFollowUp: rec.date,
        nextFollowUpDate: newComm.nextFollowUp || lead.nextFollowUpDate,
      });
    }
    setShowAddComm(false);
    setNewComm({ type: 'call', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '' });
    setIsSaving(false);
  };

  const handleSaveContactPopup = () => {
    if (isSaving || !contactPopupDraft.notes.trim()) return;
    setIsSaving(true);
    const rec: CommunicationRecord = {
      id: `comm-${Date.now()}`,
      type: contactPopupDraft.type,
      date: contactPopupDraft.date.replace('T', ' '),
      notes: contactPopupDraft.notes,
      outcome: contactPopupDraft.outcome || undefined,
      nextFollowUp: contactPopupDraft.nextFollowUp || undefined,
    };
    if (subscriber) {
      updateSubscriber({ ...subscriber, communications: [...(subscriber.communications || []), rec] });
    } else if (lead) {
      const newStatus = (contactPopupDraft.newStatus as LeadItem['status']) || (lead.status === 'new' ? 'contacted' : lead.status);
      updateLead({
        ...lead,
        communications: [...(lead.communications || []), rec],
        status: newStatus,
        lastFollowUp: rec.date,
        nextFollowUpDate: contactPopupDraft.nextFollowUp || lead.nextFollowUpDate,
      });
    }
    setShowContactPopup(false);
    setContactPopupDraft({ type: 'call', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '', newStatus: '' });
    setIsSaving(false);
  };

  const handleDeleteComm = (commId: string, src: 'lead' | 'subscriber') => {
    if (src === 'subscriber' && subscriber) {
      updateSubscriber({ ...subscriber, communications: (subscriber.communications || []).filter(c => c.id !== commId) });
    } else if (src === 'lead' && lead) {
      updateLead({ ...lead, communications: (lead.communications || []).filter(c => c.id !== commId) });
    }
  };

  const handleAddLeadPayment = () => {
    if (!leadPayDraft.amount || !lead) return;
    const rec: PaymentRecord = { id: `pay-${Date.now()}`, ...leadPayDraft };
    updateLead({ ...lead, paymentRecords: [...leadPayments, rec] });
    setShowLeadPayForm(false);
    setLeadPayDraft({ amount: 0, currency: 'EGP', courseId: lead.enrolledCourseId || '', date: new Date().toISOString().slice(0, 10), note: '', paymentType: 'course' });
  };

  const handlePayModalSubmit = (draft: PaymentDraft) => {
    const amt = Number(draft.amount);
    if (!amt || amt <= 0 || !subscriber) return;
    const isBundleSelection = draft.courseId?.startsWith('bundle:');
    const bundleId = isBundleSelection ? draft.courseId.replace('bundle:', '') : null;
    const bundle = bundleId ? bundles.find(b => b.id === bundleId) : null;
    const catalogPx = isBundleSelection && bundle
      ? ((bundle.price as unknown as Record<string, number>)?.[draft.currency] || bundle.price.EGP || 0)
      : (!isBundleSelection && draft.courseId
          ? (courses.find(c => c.id === draft.courseId)?.price?.[draft.currency as 'EGP'|'SAR'|'USD'] || courses.find(c => c.id === draft.courseId)?.price?.EGP || 0)
          : 0);
    const customExp = Number(draft.customExpected) || 0;
    const discAbs = draft.discountPct && catalogPx ? Math.round(catalogPx * Number(draft.discountPct) / 100) : 0;
    const expectedPrice = customExp > 0 ? customExp : (discAbs > 0 ? catalogPx - discAbs : catalogPx);
    const entry: PaymentHistoryEntry = {
      id: `pay-${Date.now()}`,
      amount: amt,
      currency: draft.currency,
      paymentType: draft.paymentType,
      isInstallment: draft.bookingType === 'installment',
      courseId: isBundleSelection ? undefined : (draft.courseId || undefined),
      bundleId: bundleId || undefined,
      courseExpected: draft.bookingType !== 'installment' && expectedPrice > 0 ? expectedPrice : undefined,
      discount: discAbs || undefined,
      paymentMethod: draft.paymentMethod || undefined,
      fromAccountNumber: draft.fromAccountNumber || undefined,
      source: 'staff',
      note: [
        draft.note || undefined,
        draft.transactionId || undefined,
        isBundleSelection && bundle ? `مسار تعليمي: ${bundle.title}` : undefined,
        draft.certType || undefined,
      ].filter(Boolean).join(' | ') || undefined,
      at: draft.date,
    };
    const newBookingAccess = draft.bookingType === 'installment' ? 'limited' : 'full';
    let updatedSub = { ...subscriber, paymentHistory: [...subHistory, entry] };
    if (draft.paymentType === 'course' && draft.bookingType === 'new_booking') {
      if (isBundleSelection && bundle) {
        const bundleCourseIds = bundle.courses.map(c => c.id);
        const newIds = [...new Set([...updatedSub.enrolledCourseIds, ...bundleCourseIds])];
        const newAccess = { ...(updatedSub.courseAccess ?? {}) };
        bundleCourseIds.forEach(cId => { if (!newAccess[cId]) newAccess[cId] = { mode: newBookingAccess }; });
        updatedSub = { ...updatedSub, enrolledCourseIds: newIds, courseAccess: newAccess };
      } else if (draft.courseId && !updatedSub.enrolledCourseIds.includes(draft.courseId)) {
        updatedSub = {
          ...updatedSub,
          enrolledCourseIds: [...updatedSub.enrolledCourseIds, draft.courseId],
          courseAccess: { ...(updatedSub.courseAccess ?? {}), [draft.courseId]: { mode: newBookingAccess } },
        };
      }
    }
    if (draft.paymentType === 'certificate' && draft.certReqId) {
      updatedSub = {
        ...updatedSub,
        extraCertificateRequests: (updatedSub.extraCertificateRequests || []).map(req =>
          req.id === draft.certReqId ? { ...req, paidAmount: (req.paidAmount || 0) + amt } : req
        ),
      };
    }
    if (draft.paymentType === 'certificate' && draft.bookingType === 'new_booking' && draft.certType) {
      const newCertReq: ExtraCertificateRequest = {
        id: `certreq-${Date.now()}`,
        type: draft.certType as ExtraCertificateType,
        courseId: draft.courseId || undefined,
        status: 'priced',
        price: amt,
        paidAmount: amt,
        currency: draft.currency,
        requestedAt: draft.date,
        note: draft.note || undefined,
      };
      updatedSub = { ...updatedSub, extraCertificateRequests: [...(updatedSub.extraCertificateRequests || []), newCertReq] };
    }
    updateSubscriber(updatedSub);
    void mysqlAdmin.saveSubscriberPayment(subscriber!.id, entry as unknown as Record<string, unknown>).catch(() => {});
    setShowSubPayForm(false);
    setPayModalDraft(createClientPaymentDraft());
  };

  const handleGrant = () => {
    if (!grantDraft.courseId || !subscriber) return;
    const alreadyEnrolled = subscriber.enrolledCourseIds.includes(grantDraft.courseId);
    const newIds = alreadyEnrolled ? subscriber.enrolledCourseIds : [...subscriber.enrolledCourseIds, grantDraft.courseId];
    updateSubscriber({
      ...subscriber,
      enrolledCourseIds: newIds,
      courseAccess: { ...(subscriber.courseAccess ?? {}), [grantDraft.courseId]: { mode: 'full' } },
    });
    // Write directly to enrollments table so client sees it immediately even if crm_json sync fails
    if (!alreadyEnrolled) {
      mysqlAdmin.addEnrollment(subscriber.id, grantDraft.courseId, null, 'full').catch(() => {});
    }
    setGrantDraft({ courseId: '', note: '' });
  };

  const handleAddExtraCertRequest = () => {
    if (!extraCertDraft.courseId || !extraCertDraft.type || !subscriber) return;
    const newReq: ExtraCertificateRequest = {
      id: `ecr-${Date.now()}`,
      type: extraCertDraft.type as ExtraCertificateType,
      courseId: extraCertDraft.courseId,
      status: 'pending',
      requestedAt: new Date().toLocaleString('ar-EG', { hour12: false }),
      price: extraCertDraft.certExpected ? Number(extraCertDraft.certExpected) : undefined,
      paidAmount: extraCertDraft.certPaid ? Number(extraCertDraft.certPaid) : undefined,
      currency: 'EGP',
    };
    updateSubscriber({ ...subscriber, extraCertificateRequests: [...(subscriber.extraCertificateRequests || []), newReq] });
    setShowExtraCertForm(false);
    resetExtraCertDraft();
  };

  const handleAddLegacyPayment = () => {
    const expected = Number(legacyPayDraft.courseExpected);
    const paid = Number(legacyPayDraft.amountPaid);
    if (!legacyPayDraft.courseId || !expected || paid < 0 || !subscriber) return;
    const entry = {
      id: `pay-${Date.now()}`,
      amount: paid,
      currency: 'EGP' as const,
      paymentType: 'course' as PaymentItemType,
      isInstallment: false,
      courseId: legacyPayDraft.courseId,
      courseExpected: expected,
      note: ['مدفوع قديماً', legacyPayDraft.note].filter(Boolean).join(' — '),
      at: new Date().toISOString().slice(0, 10),
    };
    // Enroll in course if not yet enrolled
    let updatedSub = { ...subscriber, paymentHistory: [...subHistory, entry] };
    const needsEnroll = !updatedSub.enrolledCourseIds.includes(legacyPayDraft.courseId);
    if (needsEnroll) {
      updatedSub = { ...updatedSub, enrolledCourseIds: [...updatedSub.enrolledCourseIds, legacyPayDraft.courseId], courseAccess: { ...(updatedSub.courseAccess ?? {}), [legacyPayDraft.courseId]: { mode: 'full' } } };
    }
    updateSubscriber(updatedSub);
    // Write directly to enrollments table (belt+suspenders)
    if (needsEnroll) {
      mysqlAdmin.addEnrollment(subscriber.id, legacyPayDraft.courseId, null, 'full').catch(() => {});
    }
    setShowLegacyPayForm(false);
    setLegacyPayDraft({ courseId: '', courseExpected: '', amountPaid: '', note: '' });
  };

  const handleConvert = () => {
    if (isSaving || !convertCourseId || !lead) return;
    setIsSaving(true);
    const existingSub = subscribers.find(s => s.leadId === lead.id || s.phone === lead.phone || s.email === lead.email);
    if (existingSub) {
      const alreadyIn = existingSub.enrolledCourseIds.includes(convertCourseId);
      const newCourseIds = alreadyIn ? existingSub.enrolledCourseIds : [...existingSub.enrolledCourseIds, convertCourseId];
      updateSubscriber({
        ...existingSub,
        enrolledCourseIds: newCourseIds,
        courseAccess: { ...(existingSub.courseAccess ?? {}), [convertCourseId]: { mode: convertAccessMode, ...(convertAccessMode === 'limited' ? { lectureLimit: convertPartialCount } : {}) } },
        paymentHistory: [...(existingSub.paymentHistory ?? []), ...leadPayments.map(p => ({ id: p.id, amount: p.amount, currency: p.currency, note: p.note || undefined, at: p.date }))],
        leadId: existingSub.leadId || lead.id,
      });
      // Write directly to enrollments table
      if (!alreadyIn) {
        mysqlAdmin.addEnrollment(existingSub.id, convertCourseId, null, convertAccessMode, convertAccessMode === 'limited' ? convertPartialCount : undefined).catch(() => {});
      }
    } else {
      const newSubId = `s-${Date.now()}`;
      void addSubscriber({
        id: newSubId,
        clientCode: lead.clientCode,
        leadId: lead.id,
        name: lead.name, email: lead.email, phone: lead.phone,
        branch: lead.branch,
        enrolledCourseIds: [convertCourseId],
        courseAccess: { [convertCourseId]: { mode: convertAccessMode, ...(convertAccessMode === 'limited' ? { lectureLimit: convertPartialCount } : {}) } },
        lectureProgress: {},
        paymentHistory: leadPayments.map(p => ({ id: p.id, amount: p.amount, currency: p.currency, note: p.note || undefined, at: p.date })),
        status: 'active',
        createdAt: new Date().toLocaleString('ar-EG', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      });
      // Write directly to enrollments table
      mysqlAdmin.addEnrollment(newSubId, convertCourseId, null, convertAccessMode, convertAccessMode === 'limited' ? convertPartialCount : undefined).catch(() => {});
    }
    updateLead({ ...lead, status: 'converted' });
    setShowConvertModal(false);
    setIsSaving(false);
  };

  // ── installment plan handlers ──────────────────────────────────────────────

  // Helper: get booking info for a course or bundle selection
  const getInstBookingInfo = (courseIdOrBundle: string) => {
    if (!courseIdOrBundle) return { expectedEGP: 0, paidEGP: 0, remainingEGP: 0, currency: 'EGP' as 'EGP' | 'SAR' | 'USD', title: '' };
    if (courseIdOrBundle.startsWith('bundle:')) {
      const bid = courseIdOrBundle.replace('bundle:', '');
      const b = bundles.find(x => x.id === bid);
      const bCourseIds = (b?.courses || []).map(c => c.id);
      const paidViaBundleId = confirmedHistory.filter(p => p.bundleId === bid).reduce((s, p) => s + p.amount, 0);
      const paidViaCourses = bCourseIds.reduce((s, cId) => s + (bookingMap[cId]?.paidEGP || 0), 0);
      const paidEGP = paidViaBundleId + paidViaCourses;
      const expectedFromCourses = bCourseIds.reduce((s, cId) => s + (bookingMap[cId]?.expectedEGP || 0), 0);
      const bundleEGPPrice = (b?.price as unknown as Record<string, number>)?.EGP || 0;
      const expectedEGP = expectedFromCourses || bundleEGPPrice;
      return { expectedEGP, paidEGP, remainingEGP: Math.max(0, expectedEGP - paidEGP), currency: 'EGP' as const, title: b?.title || '' };
    }
    const bm = bookingMap[courseIdOrBundle];
    const c = courses.find(x => x.id === courseIdOrBundle);
    const expectedEGP = bm?.expectedEGP || c?.price.EGP || 0;
    const paidEGP = bm?.paidEGP || 0;
    return { expectedEGP, paidEGP, remainingEGP: Math.max(0, expectedEGP - paidEGP), currency: 'EGP' as const, title: c?.title || '' };
  };

  const handleCreateInstallmentPlan = () => {
    if (!subscriber || !instPlanDraft.courseId || !instPlanDraft.numInstallments) return;
    const info = getInstBookingInfo(instPlanDraft.courseId);
    const remaining = info.remainingEGP;
    const n = Math.max(1, Number(instPlanDraft.numInstallments));
    const perInstRaw = instPlanDraft.inputMode === 'amount' && instPlanDraft.amountPerInst
      ? Number(instPlanDraft.amountPerInst)
      : Math.floor(remaining / n);
    const perInst = Math.max(1, perInstRaw);
    const actualN = instPlanDraft.inputMode === 'amount' && instPlanDraft.amountPerInst
      ? Math.ceil(remaining / perInst)
      : n;
    const intervalDays = Number(instPlanDraft.intervalDays || 30);
    const startDate = new Date(instPlanDraft.startDate);

    const entries: InstallmentEntry[] = Array.from({ length: actualN }, (_, i) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i * intervalDays);
      const isLast = i === actualN - 1;
      return {
        id: `ie-${Date.now()}-${i}`,
        amount: isLast ? remaining - perInst * (actualN - 1) : perInst,
        currency: instPlanDraft.currency,
        dueDate: d.toISOString().slice(0, 10),
      };
    });

    const isBundleSel = instPlanDraft.courseId.startsWith('bundle:');
    const resolvedCourseId = isBundleSel ? undefined : instPlanDraft.courseId;
    const resolvedTitle = isBundleSel
      ? bundles.find(b => `bundle:${b.id}` === instPlanDraft.courseId)?.title
      : courses.find(c => c.id === instPlanDraft.courseId)?.title;

    const plan: InstallmentPlan = {
      id: `ip-${Date.now()}`,
      courseId: resolvedCourseId,
      courseTitle: resolvedTitle,
      totalAmount: remaining,
      currency: instPlanDraft.currency,
      downPayment: info.paidEGP > 0 ? info.paidEGP : undefined,
      entries,
      notes: instPlanDraft.notes || undefined,
      createdAt: new Date().toISOString().slice(0, 10),
    };

    updateSubscriber({ ...subscriber, installmentPlans: [...(subscriber.installmentPlans || []), plan] });
    setShowInstPlanForm(false);
    resetInstPlanDraft();
  };

  const handlePayInstallmentEntry = (planId: string, entryId: string) => {
    if (!subscriber) return;
    const amt = Number(payEntryAmount);
    if (!amt || amt <= 0) return;
    const plans = (subscriber.installmentPlans || []).map(plan => {
      if (plan.id !== planId) return plan;
      return {
        ...plan,
        entries: plan.entries.map(e =>
          e.id !== entryId ? e : { ...e, paidAt: payEntryDate, paidAmount: amt }
        ),
      };
    });
    updateSubscriber({ ...subscriber, installmentPlans: plans });
    resetPaidEntryState();
  };

  const handleDeleteInstallmentPlan = (planId: string) => {
    if (!subscriber || !window.confirm('هل تريد حذف خطة الأقساط؟')) return;
    updateSubscriber({ ...subscriber, installmentPlans: (subscriber.installmentPlans || []).filter(p => p.id !== planId) });
  };

  const handleDeleteInstallmentEntry = (planId: string, entryId: string) => {
    if (!subscriber || !window.confirm('حذف هذا القسط؟')) return;
    const plans = (subscriber.installmentPlans || []).map(plan => {
      if (plan.id !== planId) return plan;
      return { ...plan, entries: plan.entries.filter(e => e.id !== entryId) };
    });
    updateSubscriber({ ...subscriber, installmentPlans: plans });
  };

  const handleGeneratePromo = () => {
    if (!lead) return;
    const code = generatePromoCode(lead.name);
    updateLead({ ...lead, promoCode: code });
    setLeadDraft(prev => ({ ...prev, promoCode: code }));
  };

  // ─────────────────────────────── JSX ──────────────────────────────────────
  const tabs = buildUnifiedClientTabs({
    isSubscriber: isSub,
    communicationsCount: allComms.length,
    paymentCount: isSub ? subHistory.length : leadPayments.length,
    courseCount: subscriber?.enrolledCourseIds.length ?? 0,
    certificateCount: subCerts.length + extraReqs.length,
    installmentPlanCount: subInstallmentPlans.length,
    overdueInstallmentCount: instOverdueCount,
    soonInstallmentCount: instSoonCount,
    daqqiRoundCount: subDaqqiRounds.length,
    consultationCount: subConsults.length,
  });

  // ── hero KPI calculations ─────────────────────────────────────────────────
  const lastCommDate = allComms[0]?.date?.slice(0, 10) ?? null;
  const heroPaidEGP  = isSub ? subPaidTotals.EGP : leadPaidEGP;
  const heroCourseCount = isSub ? subscriber!.enrolledCourseIds.length : (enrolledCourse ? 1 : 0);

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">

      <UnifiedClientHeroHeader
        lead={lead}
        subscriber={subscriber}
        linkedSub={linkedSub}
        isSub={isSub}
        clientName={clientName}
        clientPhone={clientPhone}
        clientEmail={clientEmail}
        clientCode={clientCode}
        clientBranch={clientBranch}
        codeCopied={codeCopied}
        allCommsCount={allComms.length}
        heroPaidEGP={heroPaidEGP}
        heroCourseCount={heroCourseCount}
        lastCommDate={lastCommDate}
        canManageCourseAccess={canManageCourseAccess}
        isAdmin={isAdmin}
        onDashboard={() => navigate('/dashboard')}
        onList={() => navigate(isSub ? '/dashboard/subscribers' : '/dashboard')}
        onCopyClientLink={() => {
          navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname.replace(/\/[^/]+$/, '')}#/client/${clientCode}`).catch(() => {});
          setCodeCopied(true);
          setTimeout(() => setCodeCopied(false), 2000);
        }}
        onConvertLead={() => setShowConvertModal(true)}
        onOpenLinkedSubscriber={() => linkedSub && navigate(`/client/${linkedSub.clientCode || linkedSub.id}`)}
        onAddCommunication={() => setShowAddComm(true)}
        onOpenInstallmentPlan={() => setShowInstPlanForm(true)}
        onOpenExtraCertificate={() => { setShowExtraCertForm(true); resetExtraCertDraft(); }}
        onOpenAccess={() => setShowAccessModal(true)}
        onEdit={() => { setEditing(true); setActiveTab('edit'); }}
        onToggleSubscriberStatus={() => updateSubscriber({ ...subscriber!, status: subscriber!.status === 'active' ? 'paused' : 'active' })}
        onDeleteClient={() => {
          if (!window.confirm(`هل تريد حذف ${clientName}؟`)) return;
          if (subscriber) { deleteSubscriber(subscriber.id); navigate('/dashboard/subscribers'); }
          else if (lead) { deleteLead(lead.id); navigate('/dashboard'); }
        }}
      />


      {/* ══ Overdue installments warning banner ══ */}
      {isSub && instOverdueCount > 0 && (
        <div className="bg-red-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-bold">
            <span className="text-lg">🔴</span>
            لدى هذا العميل {instOverdueCount} {instOverdueCount === 1 ? 'قسط متأخر' : 'أقساط متأخرة'} —
            يجب المتابعة
          </div>
          <button onClick={() => setActiveTab('installments')}
            className="text-xs bg-white text-red-700 font-bold px-3 py-1.5 rounded-lg hover:bg-red-50 transition flex-shrink-0">
            عرض الأقساط ←
          </button>
        </div>
      )}

      {/* ══ Body: sidebar + main ══ */}
      <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col lg:flex-row gap-6">

        {/* ════════ LEFT SIDEBAR ════════ */}
        <div className="w-full lg:w-72 flex-shrink-0 space-y-3">

          <UnifiedClientSidebarProfileCard
            isSub={isSub}
            lead={lead}
            subscriber={subscriber}
            linkedLead={linkedLead}
            clientName={clientName}
            clientPhone={clientPhone}
            clientEmail={clientEmail}
            clientBranch={clientBranch}
          />

          {/* ── 2. Financial summary (subscriber) ── */}
          {isSub && subscriber && (
            <UnifiedClientSidebarFinancialCard
              subscriber={subscriber}
              courses={courses}
              bookingMap={bookingMap}
              subPaidTotals={subPaidTotals}
              subRemainingEGP={subRemainingEGP}
              onOpenDetails={() => setShowPayDetailModal(true)}
            />
          )}

          {/* ── 2b. Lead course (lead only) ── */}
          {!isSub && (
            <UnifiedClientSidebarLeadCourseCard
              lead={lead}
              enrolledCourse={enrolledCourse}
              leadPaidEGP={leadPaidEGP}
              leadRemaining={leadRemaining}
            />
          )}

          {/* ── 3. Installment alerts ── */}
          <UnifiedClientSidebarInstallmentsCard
            plans={subInstallmentPlans}
            courses={courses}
            todayStr={_todayStr}
            overdueCount={instOverdueCount}
            soonCount={instSoonCount}
            onOpen={() => setActiveTab('installments')}
          />

          <UnifiedClientSidebarCertificatesCard
            certificates={subCerts}
            extraRequests={extraReqs}
            courses={courses}
          />

          <UnifiedClientSidebarActivityCard
            subscriber={subscriber}
            sessionData={sessionData}
            getCourseLectures={getCourseLectures}
            allComms={allComms}
            installmentPlans={subInstallmentPlans}
            todayStr={_todayStr}
          />

          <UnifiedClientSidebarQuickActions
            isSub={isSub}
            onAddCommunication={() => { setActiveTab('communications'); setShowAddComm(true); }}
            onSubscriberPayment={() => { setActiveTab('payments'); setShowSubPayForm(true); }}
            onLeadPayment={() => setShowLeadPayForm(true)}
            onLegacyPayment={() => setShowLegacyPayForm(true)}
            onExtraCertificate={() => { setActiveTab('certificates'); setShowExtraCertForm(true); resetExtraCertDraft(); }}
            onInstallmentPlan={() => setShowInstPlanForm(true)}
            onEdit={() => { setEditing(!editing); setActiveTab('edit'); }}
          />

          <UnifiedClientSidebarNotesCard quickNote={quickNote} onSaveQuickNote={saveQuickNote} />

          {/* ── 8. Promo code (lead only) ── */}
          {!isSub && lead && (
            <UnifiedClientSidebarPromoCard
              lead={lead}
              promoCopied={promoCopied}
              onCopyPromo={() => { navigator.clipboard.writeText(lead.promoCode!).then(() => { setPromoCopied(true); setTimeout(() => setPromoCopied(false), 2000); }); }}
              onGeneratePromo={handleGeneratePromo}
            />
          )}

          {/* ── 9. Discount quick-setter (subscriber only) ── */}
          {isSub && discountBase > 0 && (
            <UnifiedClientSidebarDiscountCard
              subscriber={subscriber}
              discountBase={discountBase}
              onUpdateDiscount={(discount) => updateSubscriber({ ...subscriber!, discount })}
            />
          )}

          {/* ── 10. Linked subscriber cross-link (lead view only) ── */}
          {!isSub && linkedSub && (
            <UnifiedClientSidebarLinkedSubscriberCard
              linkedSub={linkedSub}
              onOpen={() => navigate(`/client/${linkedSub.clientCode || linkedSub.id}`)}
            />
          )}

        </div>

        {/* ════════ MAIN CONTENT ════════ */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100">

            {/* ── Tab Navigation ── */}
            <UnifiedClientTabs activeTab={activeTab} setActiveTab={setActiveTab} tabs={tabs} />

            <div className="p-5 space-y-6">

              {/* ══ OVERVIEW ══ */}
              {activeTab === 'overview' && (
                <UnifiedClientOverviewTab
                  isSub={isSub}
                  subscriber={subscriber}
                  lead={lead}
                  allComms={allComms}
                  getCourseLectures={getCourseLectures}
                  subInstallmentPlans={subInstallmentPlans}
                  todayStr={_todayStr}
                  leadPayments={leadPayments}
                  courses={courses}
                  bundles={bundles}
                  leadPaidEGP={leadPaidEGP}
                  subCerts={subCerts}
                  bookingMap={bookingMap}
                  enrolledCourse={enrolledCourse ?? undefined}
                  leadRemaining={leadRemaining}
                  setActiveTab={(tab) => setActiveTab(tab as UnifiedClientTab)}
                  subConsults={subConsults}
                />
              )}

              {/* ══ 💬 التواصل ══ */}
              {activeTab === 'communications' && (
                <UnifiedClientCommunicationsPanel
                  communications={allComms}
                  clientName={clientName}
                  clientPhone={clientPhone}
                  isSubscriber={isSub}
                  onAdd={() => setShowAddComm(true)}
                  onDelete={handleDeleteComm}
                />
              )}

              {/* ══ 💳 الدفعات ══ */}
              {activeTab === 'payments' && (
                <div id="section-payments" className="space-y-3">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-1 h-5 rounded-full bg-emerald-500 flex-shrink-0" />
                    <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-2 flex-1">
                      <CreditCard size={14} className="text-emerald-500" /> الدفعات والمعاملات
                    </h3>
                    <span className="text-[11px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{isSub ? subHistory.length : leadPayments.length}</span>
                  </div>
                  {/* ── Subscriber payment form ── */}
                  {isSub && subscriber && (
                    <UnifiedClientSubscriberPaymentsPanel
                      subscriber={subscriber}
                      courses={courses}
                      clientName={clientName}
                      isAdmin={isAdmin}
                      showSubPayForm={showSubPayForm}
                      payModalDraft={payModalDraft}
                      setPayModalDraft={setPayModalDraft}
                      onShowPaymentForm={() => setShowSubPayForm(true)}
                      onClosePaymentForm={() => setShowSubPayForm(false)}
                      onPaymentSubmit={handlePayModalSubmit}
                      subPaidTotals={subPaidTotals}
                      subRemainingEGP={subRemainingEGP}
                      bookedCourseIds={bookedCourseIds}
                      bookingMap={bookingMap}
                      confirmedHistory={confirmedHistory}
                      subHistory={subHistory}
                      onUpdateSubscriber={updateSubscriber}
                      clientProofs={clientProofs}
                      clientProofsLoaded={clientProofsLoaded}
                      reviewingProofId={reviewingProofId}
                      reviewerNote={reviewerNote}
                      proofImageUrl={proofImageUrl}
                      reviewLoading={reviewLoading}
                      setReviewingProofId={setReviewingProofId}
                      setReviewerNote={setReviewerNote}
                      loadClientProofs={loadClientProofs}
                      loadProofImage={loadProofImage}
                      handleReviewProof={handleReviewProof}
                    />
                  )}

                  {/* ── Lead payment form ── */}
                  {!isSub && (
                    <UnifiedClientLeadPaymentsPanel
                      lead={lead}
                      payments={leadPayments}
                      showForm={showLeadPayForm}
                      onShowForm={() => setShowLeadPayForm(true)}
                      onUpdateLead={updateLead}
                    />
                  )}
                </div>
              )}

              {/* ══ 🎓 الكورسات ══ */}
              {isSub && activeTab === 'courses' && subscriber && (
                <UnifiedClientCoursesTab
                  subscriber={subscriber}
                  courses={courses}
                  showGrantFromCourses={showGrantFromCourses}
                  setShowGrantFromCourses={setShowGrantFromCourses}
                  grantFromCourseId={grantFromCourseId}
                  setGrantFromCourseId={setGrantFromCourseId}
                  updateSubscriber={updateSubscriber}
                  getCourseLectures={getCourseLectures}
                  canManageCourseAccess={canManageCourseAccess}
                  accessSaving={accessSaving}
                  accessMsg={accessMsg}
                  getPreset={getPreset}
                  setAccessPresets={setAccessPresets}
                  manualLimitDraft={manualLimitDraft}
                  setManualLimitDraft={setManualLimitDraft}
                  applyAccessLevel={applyAccessLevel}
                  isAdmin={isAdmin}
                />
              )}

              {/* ══ 🏆 الشهادات ══ */}
              {isSub && activeTab === 'certificates' && (
                <UnifiedClientCertificatesPanel
                  subscriber={subscriber!}
                  courses={courses}
                  certificates={subCerts}
                  extraRequests={extraReqs}
                  onRequestExtraCertificate={() => {
                    setShowExtraCertForm(true);
                    resetExtraCertDraft();
                  }}
                  onViewCertificate={setViewCertId}
                  onDeleteCertificate={(certificateId) => updateSubscriber({
                    ...subscriber!,
                    certificates: subCerts.filter((certificate) => certificate.id !== certificateId),
                  })}
                />
              )}

              {isSub && activeTab === 'loyalty' && subscriber && (
                <UnifiedClientLoyaltyPanel subscriberId={subscriber.id} />
              )}

              {/* ══ 📅 الأقساط ══ */}
              {isSub && activeTab === 'installments' && subscriber && (
                <UnifiedClientInstallmentsPanel
                  subscriber={subscriber}
                  plans={subInstallmentPlans}
                  courses={courses}
                  todayStr={_todayStr}
                  soon3Str={_soon3Str}
                  overdueCount={instOverdueCount}
                  soonCount={instSoonCount}
                  payingEntryKey={payingEntryKey}
                  payEntryAmount={payEntryAmount}
                  payEntryDate={payEntryDate}
                  onAddPlan={() => setShowInstPlanForm(true)}
                  onSetPayingEntryKey={setPayingEntryKey}
                  onSetPayEntryAmount={setPayEntryAmount}
                  onSetPayEntryDate={setPayEntryDate}
                  onPayEntry={handlePayInstallmentEntry}
                  onDeletePlan={handleDeleteInstallmentPlan}
                  onDeleteEntry={handleDeleteInstallmentEntry}
                  onUpdateSubscriber={updateSubscriber}
                />
              )}

              {/* ══ 🧠 الاستشارات ══ */}
              {activeTab === 'consultations' && subConsults.length > 0 && (
                <UnifiedClientConsultationsPanel consultations={subConsults} />
              )}

              {/* ══ 🗓️ جدول الدقي ══ */}
              {isSub && activeTab === 'daqqi' && subDaqqiRounds.length > 0 && (
                <UnifiedClientDaqqiPanel
                  rounds={subDaqqiRounds}
                  courses={courses}
                  subscriber={subscriber}
                />
              )}

              {/* ══ ✏️ تعديل البيانات ══ */}
              {activeTab === 'edit' && (
                <UnifiedClientEditTab
                  isSub={isSub}
                  isAdmin={isAdmin}
                  isOnlineManager={isOnlineManager}
                  isSaving={isSaving}
                  lead={lead}
                  subscriber={subscriber}
                  clientEmail={clientEmail}
                  subDraft={subDraft}
                  setSubDraft={setSubDraft}
                  leadDraft={leadDraft}
                  setLeadDraft={setLeadDraft}
                  salesStaffList={salesStaffList}
                  csStaffList={csStaffList}
                  courses={courses}
                  bundles={bundles}
                  onSaveSubscriber={handleSaveSubEdit}
                  onSaveLead={handleSaveLeadEdit}
                  currentPassword={currentPassword}
                  currentPasswordLoading={currentPasswordLoading}
                  showCurrentPassword={showCurrentPassword}
                  setShowCurrentPassword={setShowCurrentPassword}
                  showNewPassword={showNewPassword}
                  setShowNewPassword={setShowNewPassword}
                  credNewPassword={credNewPassword}
                  setCredNewPassword={setCredNewPassword}
                  credMsg={credMsg}
                  setCredMsg={setCredMsg}
                  accountDiag={accountDiag}
                  setAccountDiag={setAccountDiag}
                  accountDiagLoading={accountDiagLoading}
                  setAccountDiagLoading={setAccountDiagLoading}
                  createAccMsg={createAccMsg}
                  setCreateAccMsg={setCreateAccMsg}
                  createAccLoading={createAccLoading}
                  setCreateAccLoading={setCreateAccLoading}
                />
              )}

            </div>
          </div>
        </div>
      </div>

      <UnifiedClientAccessModal
        open={showAccessModal && isSub}
        subscriber={subscriber}
        canManageCourseAccess={canManageCourseAccess}
        courses={courses}
        getCourseLectures={getCourseLectures}
        accessSaving={accessSaving}
        accessMsg={accessMsg}
        accessPresets={accessPresets}
        setAccessPresets={setAccessPresets}
        manualLimitDraft={manualLimitDraft}
        setManualLimitDraft={setManualLimitDraft}
        getPreset={getPreset}
        applyAccessLevel={applyAccessLevel}
        onClose={() => setShowAccessModal(false)}
      />

      {/* ══ Contact Popup Modal ══ */}
      {showContactPopup && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowContactPopup(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full space-y-4" onClick={e => e.stopPropagation()} dir="rtl">
            <div className="flex items-center justify-between">
              <h2 className="font-extrabold text-lg text-gray-900 flex items-center gap-2">
                <span className="text-xl">📞</span> تسجيل تواصل جديد
              </h2>
              <button onClick={() => setShowContactPopup(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none">×</button>
            </div>

            {/* type + date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-semibold">نوع التواصل</label>
                <select value={contactPopupDraft.type} onChange={e => setContactPopupDraft(d => ({ ...d, type: e.target.value as CommunicationRecord['type'] }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
                  {Object.entries(commTypeMeta).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-semibold">التاريخ والوقت</label>
                <input type="datetime-local" value={contactPopupDraft.date}
                  onChange={e => setContactPopupDraft(d => ({ ...d, date: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
            </div>

            {/* notes */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block font-semibold">الملاحظات *</label>
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {['تم التواصل ولا يرد', 'مهتم وطلب التفكير', 'طلب تأجيل الدفع', 'تذكير بالقسط', 'تم الانتهاء من الكورس'].map(t => (
                  <button key={t} type="button" onClick={() => setContactPopupDraft(d => ({ ...d, notes: t }))}
                    className="text-[10px] bg-gray-100 hover:bg-indigo-50 hover:text-indigo-700 text-gray-600 px-2 py-1 rounded-full border border-gray-200 transition">
                    {t}
                  </button>
                ))}
              </div>
              <textarea value={contactPopupDraft.notes}
                onChange={e => setContactPopupDraft(d => ({ ...d, notes: e.target.value }))}
                placeholder="ماذا تم في هذا التواصل؟"
                rows={3}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-semibold">النتيجة</label>
                <input value={contactPopupDraft.outcome}
                  onChange={e => setContactPopupDraft(d => ({ ...d, outcome: e.target.value }))}
                  placeholder="مثال: سيدفع الأسبوع القادم"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-semibold">موعد المتابعة</label>
                <input type="date" value={contactPopupDraft.nextFollowUp}
                  onChange={e => setContactPopupDraft(d => ({ ...d, nextFollowUp: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
            </div>

            {/* status change (lead only) */}
            {!isSub && lead && (
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-semibold">تغيير الحالة (اختياري)</label>
                <select value={contactPopupDraft.newStatus}
                  onChange={e => setContactPopupDraft(d => ({ ...d, newStatus: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
                  <option value="">— بدون تغيير —</option>
                  <option value="contacted">تم التواصل</option>
                  <option value="interested">مهتم</option>
                  <option value="interested_followup">مهتم ومتابعة</option>
                  <option value="not_interested">غير مهتم</option>
                  <option value="lost">خسرنا</option>
                </select>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={handleSaveContactPopup} disabled={isSaving || !contactPopupDraft.notes.trim()}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold disabled:opacity-50 transition">
                {isSaving ? 'جاري الحفظ...' : '💾 حفظ التواصل'}
              </button>
              <button onClick={() => setShowContactPopup(false)}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-medium transition">
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Convert Modal ══ */}
      {showConvertModal && lead && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowConvertModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4" onClick={e => e.stopPropagation()} dir="rtl">
            <h2 className="font-bold text-lg text-gray-800">تحويل إلى مشترك</h2>
            <div>
              <label className="text-xs text-gray-600 mb-1 block">الكورس *</label>
              <select value={convertCourseId} onChange={e => setConvertCourseId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="">اختر الكورس</option>
                {(() => {
                  const bundledIds = new Set(bundles.flatMap(b => b.courses.map(x => x.id)));
                  return (<>
                    {bundles.map(b => (
                      <optgroup key={b.id} label={`📌 ${b.title}`}>
                        {b.courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                      </optgroup>
                    ))}
                    <optgroup label="🎓 الكورسات الفردية">
                      {courses.filter(c => !bundledIds.has(c.id)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </optgroup>
                  </>);
                })()}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600 mb-1 block">نوع الوصول</label>
              <div className="grid grid-cols-2 gap-2">
                {(['full', 'limited'] as const).map(m => (
                  <button key={m} onClick={() => setConvertAccessMode(m)}
                    className={`py-2 rounded-lg text-sm font-medium border-2 ${convertAccessMode === m ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500'}`}>
                    {m === 'full' ? 'وصول كامل' : 'محدود'}
                  </button>
                ))}
              </div>
            </div>
            {convertAccessMode === 'limited' && (
              <div>
                <label className="text-xs text-gray-600 mb-1 block">عدد المحاضرات</label>
                <input type="number" min={1} value={convertPartialCount} onChange={e => setConvertPartialCount(Number(e.target.value))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button onClick={handleConvert} disabled={!convertCourseId || isSaving} className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 disabled:opacity-40">تحويل</button>
              <button onClick={() => setShowConvertModal(false)} className="flex-1 py-2.5 bg-gray-200 rounded-lg text-sm">إلغاء</button>
            </div>
          </div>
        </div>
      )}

            {/* ══ Installment Plan Modal ══ */}
      {showInstPlanForm && isSub && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowInstPlanForm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-lg shadow">📅</div>
                <div>
                  <p className="font-extrabold text-gray-900 text-sm">خطة أقساط جديدة</p>
                  <p className="text-[11px] text-gray-400">{clientName}</p>
                </div>
              </div>
              <button onClick={() => setShowInstPlanForm(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* ── 1. Course / Bundle selector ── */}
              <div>
                <label className="text-xs font-bold text-gray-700 mb-1.5 block">📚 الكورس أو المسار</label>
                {(() => {
                  const completeBundles = bundles.filter(b =>
                    b.courses.length > 0 && b.courses.every(cc => subscriber!.enrolledCourseIds.includes(cc.id))
                  );
                  const bundleCourseIds = new Set(completeBundles.flatMap(b => b.courses.map(cc => cc.id)));
                  const soloEnrolled = subscriber!.enrolledCourseIds.filter(cId => !bundleCourseIds.has(cId));
                  return (
                    <div className="space-y-1.5">
                      {completeBundles.map(b => {
                        const val = `bundle:${b.id}`;
                        const info = getInstBookingInfo(val);
                        const isActive = instPlanDraft.courseId === val;
                        return (
                          <button key={val} type="button" onClick={() => setInstPlanDraft({ ...instPlanDraft, courseId: val, currency: info.currency, amountPerInst: '', numInstallments: '3' })}
                            className={`w-full text-right px-3 py-2.5 rounded-xl border-2 text-sm transition ${isActive ? 'border-purple-500 bg-white' : 'border-gray-200 bg-white hover:border-purple-200'}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-gray-800">📌 {b.title}</span>
                              <span className="text-[10px] font-bold text-purple-600">{b.courses.length} كورس</span>
                            </div>
                            {info.expectedEGP > 0 && (
                              <div className="text-[10px] text-gray-400 mt-0.5 flex gap-2">
                                <span>الإجمالي: {info.expectedEGP.toLocaleString()} ج.م</span>
                                <span>·</span><span className="text-green-600">مدفوع: {info.paidEGP.toLocaleString()}</span>
                                <span>·</span><span className={`font-bold ${info.remainingEGP > 0 ? 'text-red-600' : 'text-green-600'}`}>متبقي: {info.remainingEGP.toLocaleString()}</span>
                              </div>
                            )}
                          </button>
                        );
                      })}
                      {soloEnrolled.map(cId => {
                        const mc = courses.find(x => x.id === cId);
                        const info = getInstBookingInfo(cId);
                        const isActive = instPlanDraft.courseId === cId;
                        return (
                          <button key={cId} type="button" onClick={() => setInstPlanDraft({ ...instPlanDraft, courseId: cId, currency: info.currency, amountPerInst: '', numInstallments: '3' })}
                            className={`w-full text-right px-3 py-2.5 rounded-xl border-2 text-sm transition ${isActive ? 'border-purple-500 bg-white' : 'border-gray-200 bg-white hover:border-purple-200'}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-gray-800">🎓 {mc?.title || cId}</span>
                            </div>
                            {info.expectedEGP > 0 && (
                              <div className="text-[10px] text-gray-400 mt-0.5 flex gap-2">
                                <span>الإجمالي: {info.expectedEGP.toLocaleString()} ج.م</span>
                                <span>·</span><span className="text-green-600">مدفوع: {info.paidEGP.toLocaleString()}</span>
                                <span>·</span><span className={`font-bold ${info.remainingEGP > 0 ? 'text-red-600' : 'text-green-600'}`}>متبقي: {info.remainingEGP.toLocaleString()}</span>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* ── 2. Auto-info card ── */}
              {instPlanDraft.courseId && (() => {
                const info = getInstBookingInfo(instPlanDraft.courseId);
                if (!info.expectedEGP) return null;
                const currLabel = instPlanDraft.currency === 'SAR' ? 'ر.س' : instPlanDraft.currency === 'USD' ? '$' : 'ج.م';
                return (
                  <div className="bg-white border border-purple-200 rounded-xl px-4 py-3 grid grid-cols-3 gap-3 text-center text-xs">
                    <div><p className="text-gray-400">إجمالي الكورس</p><p className="font-extrabold text-gray-800 text-base">{info.expectedEGP.toLocaleString()} <span className="text-[10px] font-normal">{currLabel}</span></p></div>
                    <div><p className="text-gray-400">مدفوع بالفعل</p><p className="font-extrabold text-green-600 text-base">{info.paidEGP.toLocaleString()} <span className="text-[10px] font-normal">{currLabel}</span></p></div>
                    <div><p className="text-gray-400">المتبقي للأقساط</p><p className={`font-extrabold text-base ${info.remainingEGP > 0 ? 'text-red-600' : 'text-green-600'}`}>{info.remainingEGP > 0 ? info.remainingEGP.toLocaleString() : '✅ مكتمل'} {info.remainingEGP > 0 ? <span className="text-[10px] font-normal">{currLabel}</span> : null}</p></div>
                  </div>
                );
              })()}

              {/* ── 3. Count / amount controls ── */}
              {instPlanDraft.courseId && getInstBookingInfo(instPlanDraft.courseId).remainingEGP > 0 && (() => {
                const info = getInstBookingInfo(instPlanDraft.courseId);
                const remaining = info.remainingEGP;
                const currLabel = instPlanDraft.currency === 'SAR' ? 'ر.س' : instPlanDraft.currency === 'USD' ? '$' : 'ج.م';
                const n = Math.max(1, Number(instPlanDraft.numInstallments) || 1);
                const perInstCalc = instPlanDraft.inputMode === 'count' ? Math.floor(remaining / n) : (Number(instPlanDraft.amountPerInst) || 0);
                const numCalc = instPlanDraft.inputMode === 'amount' && Number(instPlanDraft.amountPerInst) > 0 ? Math.ceil(remaining / Number(instPlanDraft.amountPerInst)) : n;
                return (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setInstPlanDraft({ ...instPlanDraft, inputMode: 'count', amountPerInst: '' })}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition ${instPlanDraft.inputMode === 'count' ? 'border-purple-500 bg-purple-100 text-purple-700' : 'border-gray-200 bg-white text-gray-500'}`}>
                        أحدد عدد الأقساط
                      </button>
                      <button type="button" onClick={() => setInstPlanDraft({ ...instPlanDraft, inputMode: 'amount', numInstallments: '' })}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition ${instPlanDraft.inputMode === 'amount' ? 'border-purple-500 bg-purple-100 text-purple-700' : 'border-gray-200 bg-white text-gray-500'}`}>
                        أحدد قيمة القسط
                      </button>
                    </div>
                    {instPlanDraft.inputMode === 'count' ? (
                      <div>
                        <label className="text-xs font-bold text-gray-700 mb-1.5 block">عدد الأقساط</label>
                        <div className="flex gap-1.5 flex-wrap mb-2">
                          {[2,3,4,6,8,12].map(nt => (
                            <button key={nt} type="button" onClick={() => setInstPlanDraft({ ...instPlanDraft, numInstallments: String(nt) })}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition ${instPlanDraft.numInstallments === String(nt) ? 'border-purple-500 bg-purple-100 text-purple-700' : 'border-gray-200 bg-white text-gray-600 hover:border-purple-200'}`}>
                              {nt} <span className="font-normal text-[10px]">({Math.floor(remaining / nt).toLocaleString()} {currLabel})</span>
                            </button>
                          ))}
                        </div>
                        <input type="number" min="1" max="60" value={instPlanDraft.numInstallments}
                          onChange={e => setInstPlanDraft({ ...instPlanDraft, numInstallments: e.target.value })}
                          placeholder="أو اكتب العدد يدوياً"
                          className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
                        {perInstCalc > 0 && <p className="text-xs text-purple-700 font-bold mt-1">👉 كل قسط ≈ {perInstCalc.toLocaleString()} {currLabel}</p>}
                      </div>
                    ) : (
                      <div>
                        <label className="text-xs font-bold text-gray-700 mb-1.5 block">قيمة القسط الواحد ({currLabel})</label>
                        <input type="number" min="1" value={instPlanDraft.amountPerInst}
                          onChange={e => setInstPlanDraft({ ...instPlanDraft, amountPerInst: e.target.value })}
                          placeholder={`مثال: ${Math.floor(remaining / 3).toLocaleString()}`}
                          className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
                        {numCalc > 0 && Number(instPlanDraft.amountPerInst) > 0 && (
                          <p className="text-xs text-purple-700 font-bold mt-1">👉 العدد المطلوب ≈ {numCalc} قسط</p>
                        )}
                      </div>
                    )}
                    <div>
                      <label className="text-xs font-bold text-gray-700 mb-1.5 block">تكرار القسط</label>
                      <div className="flex gap-2">
                        {[['30','كل شهر'],['14','كل أسبوعين'],['7','كل أسبوع']].map(([d, lbl]) => (
                          <button key={d} type="button" onClick={() => setInstPlanDraft({ ...instPlanDraft, intervalDays: d })}
                            className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition ${instPlanDraft.intervalDays === d ? 'border-purple-500 bg-purple-100 text-purple-700' : 'border-gray-200 bg-white text-gray-600 hover:border-purple-200'}`}>
                            {lbl}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-bold text-gray-700 mb-1 block">تاريخ القسط القادم</label>
                        <input type="date" value={instPlanDraft.startDate}
                          onChange={e => setInstPlanDraft({ ...instPlanDraft, startDate: e.target.value })}
                          className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-gray-700 mb-1 block">ملاحظة (اختياري)</label>
                        <input type="text" value={instPlanDraft.notes}
                          onChange={e => setInstPlanDraft({ ...instPlanDraft, notes: e.target.value })}
                          placeholder="مثال: متفق مع العميل"
                          className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
                      </div>
                    </div>
                    {(perInstCalc > 0 || numCalc > 0) && (
                      <div className="bg-white border border-purple-200 rounded-xl px-4 py-3 text-xs space-y-1">
                        <p className="font-bold text-purple-700 mb-1.5">📊 ملخص الخطة</p>
                        <div className="flex justify-between"><span className="text-gray-500">المتبقي للتقسيط</span><span className="font-bold">{remaining.toLocaleString()} {currLabel}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">عدد الأقساط</span><span className="font-bold text-purple-700">{instPlanDraft.inputMode === 'amount' ? numCalc : n} قسط</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">قيمة كل قسط</span><span className="font-bold text-purple-700">{perInstCalc.toLocaleString()} {currLabel}</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">أول قسط</span><span className="font-bold">{instPlanDraft.startDate}</span></div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {instPlanDraft.courseId && getInstBookingInfo(instPlanDraft.courseId).remainingEGP === 0 && (
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 font-bold text-center">✅ هذا الكورس/المسار مدفوع بالكامل — لا يحتاج تقسيط</div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={handleCreateInstallmentPlan}
                  disabled={!instPlanDraft.courseId || !instPlanDraft.numInstallments || getInstBookingInfo(instPlanDraft.courseId).remainingEGP === 0}
                  className="flex-1 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-bold hover:bg-purple-700 disabled:opacity-40">
                  💾 إنشاء الخطة
                </button>
                <button onClick={() => setShowInstPlanForm(false)}
                  className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ Add Communication Modal ══ */}

      {showAddComm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowAddComm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-black text-base shadow">
                  {(clientName||'ع').charAt(0)}
                </div>
                <div>
                  <p className="font-extrabold text-gray-900 text-sm">تسجيل تواصل جديد</p>
                  <p className="text-[11px] text-gray-400">{clientName}</p>
                </div>
              </div>
              <button onClick={() => setShowAddComm(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">نوع التواصل</label>
                  <select value={newComm.type} onChange={e => setNewComm({ ...newComm, type: e.target.value as CommunicationRecord['type'] })}
                    className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm">
                    {Object.entries(commTypeMeta).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">التاريخ والوقت</label>
                  <input type="datetime-local" value={newComm.date} onChange={e => setNewComm({ ...newComm, date: e.target.value })}
                    className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">ملاحظات *</label>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {['تم التواصل ولا يرد','مهتم وطلب التفكير','طلب تأجيل الدفع','تذكير بالقسط القادم','تم الانتهاء من الكورس'].map(t => (
                    <button key={t} type="button" onClick={() => setNewComm({ ...newComm, notes: t })}
                      className="text-[10px] bg-gray-100 hover:bg-indigo-50 hover:text-indigo-700 text-gray-600 px-2 py-1 rounded-full border border-gray-200 transition">{t}</button>
                  ))}
                </div>
                <textarea value={newComm.notes} onChange={e => setNewComm({ ...newComm, notes: e.target.value })}
                  placeholder="ماذا تم في هذه المكالمة / المحادثة؟"
                  className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm h-24 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">النتيجة</label>
                  <input value={newComm.outcome} onChange={e => setNewComm({ ...newComm, outcome: e.target.value })}
                    placeholder="مثال: سيدفع الأسبوع القادم"
                    className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">موعد المتابعة</label>
                  <input type="date" value={newComm.nextFollowUp} onChange={e => setNewComm({ ...newComm, nextFollowUp: e.target.value })}
                    className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={handleSaveComm} disabled={isSaving} className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50">💾 حفظ التواصل</button>
                <button onClick={() => setShowAddComm(false)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ Lead Payment Modal ══ */}
      {showLeadPayForm && !isSub && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowLeadPayForm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" dir="rtl" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-l from-red-700 to-red-500 px-5 py-4 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 rounded-xl p-2"><CreditCard size={20} className="text-white" /></div>
                  <div>
                    <p className="font-extrabold text-white text-base leading-tight">تسجيل دفعة جديدة</p>
                    <p className="text-red-100 text-xs mt-0.5">{clientName}</p>
                  </div>
                </div>
                <button onClick={() => setShowLeadPayForm(false)} className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition"><X size={16} /></button>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-600 mb-1 block">المبلغ</label>
                  <input type="number" min="0" value={leadPayDraft.amount || ''} onChange={e => setLeadPayDraft({ ...leadPayDraft, amount: Number(e.target.value) })}
                    className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="text-xs text-gray-600 mb-1 block">العملة</label>
                  <select value={leadPayDraft.currency} onChange={e => setLeadPayDraft({ ...leadPayDraft, currency: e.target.value as 'EGP' | 'SAR' | 'USD' })}
                    className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm">
                    <option value="EGP">ج.م</option><option value="SAR">ر.س</option><option value="USD">$</option>
                  </select></div>
                <div><label className="text-xs text-gray-600 mb-1 block">الكورس</label>
                  <select value={leadPayDraft.courseId} onChange={e => setLeadPayDraft({ ...leadPayDraft, courseId: e.target.value })}
                    className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm">
                    <option value="">اختر</option>
                    {(() => {
                      const bundledIds = new Set(bundles.flatMap(b => b.courses.map(x => x.id)));
                      return (<>
                        {bundles.map(b => (
                          <optgroup key={b.id} label={`📌 ${b.title}`}>
                            {b.courses.map(bc => <option key={bc.id} value={bc.id}>{bc.title}</option>)}
                          </optgroup>
                        ))}
                        <optgroup label="🎓 الكورسات الفردية">
                          {courses.filter(bc => !bundledIds.has(bc.id)).map(bc => <option key={bc.id} value={bc.id}>{bc.title}</option>)}
                        </optgroup>
                      </>);
                    })()}
                  </select></div>
                <div><label className="text-xs text-gray-600 mb-1 block">التاريخ</label>
                  <input type="date" value={leadPayDraft.date} onChange={e => setLeadPayDraft({ ...leadPayDraft, date: e.target.value })}
                    className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" /></div>
              </div>
              <div><label className="text-xs text-gray-600 mb-1 block">ملاحظة</label>
                <input value={leadPayDraft.note || ''} onChange={e => setLeadPayDraft({ ...leadPayDraft, note: e.target.value })}
                  className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" /></div>
              <div className="flex gap-2 pt-1">
                <button onClick={handleAddLeadPayment} className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 flex items-center justify-center gap-2"><CreditCard size={15} /> تسجيل الدفعة</button>
                <button onClick={() => setShowLeadPayForm(false)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <UnifiedClientExtraCertificateModal
        open={showExtraCertForm && isSub}
        subscriber={subscriber}
        clientName={clientName}
        courses={courses}
        draft={extraCertDraft}
        setDraft={setExtraCertDraft}
        onSubmit={handleAddExtraCertRequest}
        onClose={() => setShowExtraCertForm(false)}
      />
      <UnifiedClientLegacyPaymentModal
        open={showLegacyPayForm && isSub}
        clientName={clientName}
        courses={courses}
        bundles={bundles}
        legacyPayDraft={legacyPayDraft}
        setLegacyPayDraft={setLegacyPayDraft}
        onSubmit={handleAddLegacyPayment}
        onClose={() => setShowLegacyPayForm(false)}
      />

      <UnifiedClientCertificateViewModal
        certificateId={viewCertId}
        certificates={subCerts}
        subscriber={subscriber}
        clientName={clientName}
        courses={courses}
        onClose={() => setViewCertId(null)}
      />
      <UnifiedClientPaymentDetailModal
        open={showPayDetailModal && isSub}
        subscriber={subscriber}
        clientName={clientName}
        courses={courses}
        paidTotals={subPaidTotals}
        remainingEGP={subRemainingEGP}
        bookingMap={bookingMap}
        confirmedHistory={confirmedHistory}
        onClose={() => setShowPayDetailModal(false)}
      />
    </div>
  );
}

export default UnifiedClientPage;
