/**
 * UnifiedClientPage — ONE page for ALL clients (leads + subscribers)
 * URL: /client/:code  (stable, never changes even after conversion)
 *
 * Layout:
 *   LEFT sidebar  → full client data + actions (edit / pay / grant / contact / convert)
 *   RIGHT main    → overview tab first, then contextual tabs
 */
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, Phone, MessageSquare, Plus, Edit2, Trash2, Mail,
  CheckCircle, Clock, CreditCard, Info, Copy,
  Award, BookOpen, Activity, User, Key, Tag,
  Printer, Eye, DollarSign, CalendarCheck2, RefreshCw, CalendarDays, AlertCircle, X, Shield,
} from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { mysqlAdmin, mysqlClient } from '../lib/mysqlapi';
import PaymentModal, { PaymentDraft, blankPaymentDraft } from '../components/PaymentModal';
import {
  LeadItem, SubscriberItem, CommunicationRecord,
  PaymentRecord, BranchType, StaffMember, PaymentItemType,
  CourseAccessSetting, SubscriberCertificate,
  ExtraCertificateRequest, ExtraCertificateType,
  UserSessionData, PaymentProof, InstallmentPlan, InstallmentEntry,
  PaymentHistoryEntry,
} from '../types';

// ─── Constants + pure helpers live in a colocated module ───────────────────────
import {
  branchLabels, normBranchKey, commTypeMeta, ptLabels,
  statusColors, statusLabels, EXTRA_TYPE_LABELS,
  normalizeAccess, generatePromoCode, SideRow,
} from './unifiedClient.constants';
import CommunicationsTab from './unifiedClient/CommunicationsTab';
import CertificatesTab from './unifiedClient/CertificatesTab';
import CoursesAccessTab from './unifiedClient/CoursesAccessTab';
import ConsultationsTab from './unifiedClient/ConsultationsTab';
import DaqqiRoundsTab from './unifiedClient/DaqqiRoundsTab';
import InstallmentsTab from './unifiedClient/InstallmentsTab';

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

  // Determine current staff role for permission checks
  // staffMembers is only loaded for admins in SiteDataContext, so non-admin staff
  // (e.g. online_manager) need a separate self-fetch fallback.
  const [staffSelfRecord, setStaffSelfRecord] = useState<StaffMember | null>(null);
  useEffect(() => {
    if (isAdmin || !authUser?.email) return; // admins already have staffMembers populated
    mysqlClient.getStaffSelf().then((r: unknown) => {
      if (r && typeof r === 'object') setStaffSelfRecord(r as StaffMember);
    }).catch(() => {});
  }, [isAdmin, authUser?.email]);

  const currentStaff = React.useMemo(
    () => staffMembers.find(s => s.email?.toLowerCase() === (authUser?.email ?? '').toLowerCase())
       ?? staffSelfRecord
       ?? null,
    [staffMembers, staffSelfRecord, authUser?.email]
  );
  const isOnlineManager = (currentStaff?.role as string) === 'online_manager';
  const isCollectionManager = currentStaff?.role === 'collection' || currentStaff?.role === 'manager';
  // Admin, online_manager, collection, or manager can change course access & video limits
  const canManageCourseAccess = isAdmin || isOnlineManager || isCollectionManager;

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
  type Tab = 'overview' | 'communications' | 'payments' | 'courses' | 'certificates' | 'installments' | 'consultations' | 'daqqi' | 'edit';
  const TABS: Tab[] = ['overview', 'communications', 'payments', 'courses', 'certificates', 'installments', 'consultations', 'daqqi', 'edit'];
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  // Seed from the URL (?tab=) so each client tab is deep-linkable and the
  // browser back/forward buttons move between tabs; falls back to nav state.
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const urlTab = searchParams.get('tab');
    if (urlTab && TABS.includes(urlTab as Tab)) return urlTab as Tab;
    const s = (location.state as { openTab?: string } | null)?.openTab;
    return (s as Tab) || 'overview';
  });
  // Two-way sync activeTab ↔ ?tab=
  useEffect(() => {
    if (searchParams.get('tab') === activeTab) return;
    const next = new URLSearchParams(searchParams);
    next.set('tab', activeTab);
    setSearchParams(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
  useEffect(() => {
    const urlTab = searchParams.get('tab');
    if (urlTab && TABS.includes(urlTab as Tab) && urlTab !== activeTab) setActiveTab(urlTab as Tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  // scroll to section from navigation state (e.g. 📅 button in Dashboard)
  useEffect(() => {
    const s = (location.state as { openTab?: string } | null)?.openTab;
    if (s) {
      setTimeout(() => {
        document.getElementById(`section-${s}`)?.scrollIntoView({ behavior: 'smooth' });
      }, 500);
    }
  }, [location.state]);

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
  const [subDraft, setSubDraft] = useState({
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
  const [payModalDraft, setPayModalDraft] = useState<PaymentDraft>(blankPaymentDraft());

  // ── grant (subscriber) ─────────────────────────────────────────────────────
  const [showGrantForm, setShowGrantForm] = useState(false);
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
  const [viewCertId, setViewCertId] = useState<string | null>(null);

  // ── per-course pay detail popup ───────────────────────────────────────────
  const [showPayDetailModal, setShowPayDetailModal] = useState(false);

  // ── extra certificate request form ────────────────────────────────────────
  const [showExtraCertForm, setShowExtraCertForm] = useState(false);
  const [extraCertDraft, setExtraCertDraft] = useState<{ courseId: string; type: ExtraCertificateType | ''; certExpected: string; certPaid: string }>({ courseId: '', type: '', certExpected: '', certPaid: '' });

  // ── legacy payment (old clients with custom prices) ───────────────────────
  const [showLegacyPayForm, setShowLegacyPayForm] = useState(false);
  const [legacyPayDraft, setLegacyPayDraft] = useState({ courseId: '', courseExpected: '', amountPaid: '', note: '' });

  // ── installment plans ──────────────────────────────────────────────────────
  const [showInstPlanForm, setShowInstPlanForm] = useState(false);
  const [instPlanDraft, setInstPlanDraft] = useState({
    courseId: '',                       // courseId or 'bundle:bundleId'
    currency: 'EGP' as 'EGP' | 'SAR' | 'USD',
    amountPerInst: '',                  // قيمة القسط (user fills)
    numInstallments: '3',              // auto or user override
    inputMode: 'count' as 'count' | 'amount', // which field is primary
    startDate: new Date().toISOString().slice(0, 10),
    intervalDays: '30', notes: '',
  });
  const [payingEntryKey, setPayingEntryKey] = useState<string | null>(null); // `${planId}::${entryId}`
  const [payEntryAmount, setPayEntryAmount] = useState('');
  const [payEntryDate, setPayEntryDate] = useState(new Date().toISOString().slice(0, 10));

  // ── payment proofs (client-uploaded receipts) ─────────────────────────────
  const [clientProofs, setClientProofs] = useState<PaymentProof[]>([]);
  const [clientProofsLoaded, setClientProofsLoaded] = useState(false);
  const [reviewingProofId, setReviewingProofId] = useState<string | null>(null);
  const [reviewerNote, setReviewerNote] = useState('');
  const [proofImageUrl, setProofImageUrl] = useState<Record<string, string>>({});
  const [reviewLoading, setReviewLoading] = useState(false);

  const loadClientProofs = () => {
    if (!subscriber) return;
    mysqlAdmin.listPaymentProofs().then(rows => {
      const filtered = (rows as unknown as PaymentProof[]).filter(p => p.subscriber_id === subscriber.id);
      setClientProofs(filtered);
      setClientProofsLoaded(true);
    }).catch(() => setClientProofsLoaded(true));
  };

  // Auto-load payment proofs on mount (single-page view)
  useEffect(() => {
    if (isSub && !clientProofsLoaded) loadClientProofs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSub]);

  const loadProofImage = (proofId: string) => {
    if (proofImageUrl[proofId]) return;
    mysqlAdmin.getPaymentProofImage(proofId).then(r => {
      if (r.image) setProofImageUrl(prev => ({ ...prev, [proofId]: r.image }));
    }).catch(() => {});
  };

  const handleReviewProof = async (proofId: string, action: 'approve' | 'reject') => {
    setReviewLoading(true);
    try {
      await mysqlAdmin.reviewPaymentProof(proofId, action, reviewerNote || undefined);
      // On approval: add the payment to subscriber's paymentHistory so it appears in Finance
      if (action === 'approve' && subscriber) {
        const proof = clientProofs.find(p => p.id === proofId);
        if (proof) {
          const payEntry = {
            id: `proof-${proofId}`,
            amount: proof.amount,
            currency: proof.currency,
            paymentType: 'course' as const,
            isInstallment: true,
            courseId: proof.course_id ?? undefined,
            paymentMethod: proof.payment_method,
            note: `إيصال معتمد${reviewerNote ? ' | ' + reviewerNote : ''}`,
            at: new Date().toISOString().slice(0, 10),
          };
          const updatedSub = { ...subscriber, paymentHistory: [...(subscriber.paymentHistory ?? []), payEntry] };
          updateSubscriber(updatedSub);
          void mysqlAdmin.saveSubscriberPayment(subscriber.id, payEntry as unknown as Record<string, unknown>).catch(() => {});
        }
      }
      setClientProofs(prev => prev.map(p => p.id === proofId ? {
        ...p,
        status: action === 'approve' ? 'APPROVED' : 'REJECTED',
        reviewer_note: reviewerNote || null,
        reviewed_at: new Date().toISOString(),
      } : p));
      setReviewingProofId(null);
      setReviewerNote('');
    } catch { /* ignore */ } finally { setReviewLoading(false); }
  };

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
    setPayModalDraft(blankPaymentDraft());
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
    setShowGrantForm(false);
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
    setExtraCertDraft({ courseId: '', type: '', certExpected: '', certPaid: '' });
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
    setInstPlanDraft({ courseId: '', currency: 'EGP', amountPerInst: '', numInstallments: '3', inputMode: 'count', startDate: new Date().toISOString().slice(0, 10), intervalDays: '30', notes: '' });
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
    setPayingEntryKey(null);
    setPayEntryAmount('');
    setPayEntryDate(new Date().toISOString().slice(0, 10));
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
  const tabs: [Tab, string][] = [
    ['overview',       'نظرة عامة 📊'],
    ['communications', `التواصل (${allComms.length})`],
    ['payments',       isSub ? `حجز / دفع (${subHistory.length})` : `حجز / دفع (${leadPayments.length})`],
    ...(isSub ? [
      ['courses',       `الكورسات (${subscriber!.enrolledCourseIds.length})`] as [Tab, string],
      ['certificates',  `الشهادات (${subCerts.length + extraReqs.length})`]   as [Tab, string],
      ['installments',  `الأقساط${subInstallmentPlans.length > 0 ? ` (${subInstallmentPlans.length})` : ''}${instOverdueCount > 0 ? ` 🔴${instOverdueCount}` : instSoonCount > 0 ? ` 🟡` : ''}`] as [Tab, string],
      ...(subDaqqiRounds.length > 0 ? [['daqqi', `جدول الدقي (${subDaqqiRounds.length})`] as [Tab, string]] : []),
    ] : []),
    ...(subConsults.length > 0 ? [['consultations', `الاستشارات (${subConsults.length})`] as [Tab, string]] : []),
    ['edit', 'تعديل البيانات ✏️'],
  ];

  // ── hero KPI calculations ─────────────────────────────────────────────────
  const lastCommDate = allComms[0]?.date?.slice(0, 10) ?? null;
  const heroPaidEGP  = isSub ? subPaidTotals.EGP : leadPaidEGP;
  const heroCourseCount = isSub ? subscriber!.enrolledCourseIds.length : (enrolledCourse ? 1 : 0);

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">

      {/* ══════════════════ HERO HEADER ══════════════════ */}
      <div className="bg-gradient-to-br from-slate-800 via-slate-750 to-slate-900 text-white shadow-xl">
        <div className="max-w-7xl mx-auto px-4 pt-4 pb-5">

          {/* Breadcrumb nav */}
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-4 flex-wrap">
            <button onClick={() => navigate('/dashboard')} className="hover:text-white flex items-center gap-1 transition-colors">
              <ArrowRight size={13} /> لوحة التحكم
            </button>
            <span className="text-slate-600">/</span>
            <button onClick={() => navigate(isSub ? '/dashboard/subscribers' : '/dashboard')} className="hover:text-white transition-colors">
              {isSub ? 'المشتركون' : 'العملاء المحتملون'}
            </button>
            <span className="text-slate-600">/</span>
            <span className="text-slate-200 font-semibold">{clientName}</span>
            {/* code badge */}
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname.replace(/\/[^/]+$/, '')}#/client/${clientCode}`).catch(() => {});
                setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000);
              }}
              className="flex items-center gap-1 px-2 py-0.5 bg-slate-700 text-slate-300 border border-slate-600 rounded-full text-[10px] font-mono hover:bg-slate-600 transition-colors"
            >
              <Copy size={8} /> {clientCode.slice(0, 12)}
              {codeCopied && <span className="text-green-400 font-bold mr-1">✓</span>}
            </button>
          </div>

          {/* Avatar + name + status + contact */}
          <div className="flex items-start gap-4 mb-5">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center font-black text-3xl shadow-lg flex-shrink-0 ${isSub ? 'bg-gradient-to-br from-emerald-400 to-emerald-600' : 'bg-gradient-to-br from-blue-400 to-blue-600'}`}>
              {clientName.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-extrabold text-white leading-tight">{clientName}</h1>
                {isSub ? (
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${subscriber!.status === 'active' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border-amber-500/30'}`}>
                    {subscriber!.status === 'active' ? '● مشترك نشط' : '● متوقف'}
                  </span>
                ) : lead && (
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-slate-600/50 text-slate-300 border-slate-500/30`}>
                    {statusLabels[lead.status] || lead.status}
                  </span>
                )}
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${isSub ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/30' : 'bg-blue-900/40 text-blue-300 border-blue-700/30'}`}>
                  {isSub ? 'مشترك' : 'عميل محتمل'}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap text-slate-400 text-xs">
                {clientPhone && <span className="flex items-center gap-1"><Phone size={11} /> {clientPhone}</span>}
                {clientEmail && <span className="flex items-center gap-1 truncate max-w-[200px]"><Mail size={11} /> {clientEmail}</span>}
                {clientBranch && <span className="flex items-center gap-1">📍 {branchLabels[normBranchKey(clientBranch)] || clientBranch}</span>}
              </div>
            </div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl px-3 py-2.5 border border-white/10">
              <p className="text-2xl font-extrabold text-white">{allComms.length}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">رسالة / تواصل</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl px-3 py-2.5 border border-white/10">
              <p className="text-2xl font-extrabold text-emerald-300">{heroPaidEGP > 0 ? heroPaidEGP.toLocaleString() : '—'}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">ج.م مدفوع</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl px-3 py-2.5 border border-white/10">
              <p className="text-2xl font-extrabold text-blue-300">{heroCourseCount}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">كورس مسجّل</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl px-3 py-2.5 border border-white/10">
              <p className="text-sm font-extrabold text-slate-200 truncate">{lastCommDate ?? 'لا يوجد'}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">آخر تواصل</p>
            </div>
          </div>

          {/* Action buttons row */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Primary: call + WA + contact + booking/installment */}
            {clientPhone && (
              <>
                <a href={`https://wa.me/${clientPhone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer"
                  className="px-4 py-2 bg-green-500 hover:bg-green-400 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors shadow-sm">
                  <MessageSquare size={14} /> واتس أب
                </a>
                <a href={`tel:${clientPhone}`}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors shadow-sm">
                  <Phone size={14} /> اتصال
                </a>
              </>
            )}
            {/* Lead-only: حجز / ملف المشترك */}
            {lead && lead.status !== 'converted' ? (
              <button onClick={() => setShowConvertModal(true)}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors shadow-sm">
                <CalendarCheck2 size={14} /> حجز
              </button>
            ) : lead && lead.status === 'converted' && linkedSub ? (
              <button onClick={() => navigate(`/client/${linkedSub.clientCode || linkedSub.id}`)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors">
                <CheckCircle size={14} /> ملف المشترك
              </button>
            ) : null}
            {/* ── Action buttons strip ── */}
            {/* تسجيل تواصل */}
            <button onClick={() => setShowAddComm(true)}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors shadow-sm">
              <Phone size={14} /> تواصل
            </button>
            {/* خطة أقساط (مشترك فقط) */}
            {isSub && (
              <button onClick={() => setShowInstPlanForm(true)}
                className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors shadow-sm">
                <CalendarDays size={14} /> أقساط
              </button>
            )}
            {/* طلب شهادة (مشترك فقط) */}
            {isSub && (
              <button onClick={() => { setShowExtraCertForm(true); setExtraCertDraft({ courseId: '', type: '', certExpected: '', certPaid: '' }); }}
                className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors shadow-sm">
                <Award size={14} /> شهادة
              </button>
            )}
            {/* صلاحية الفيديوهات */}
            {canManageCourseAccess && isSub && (
              <button onClick={() => setShowAccessModal(true)}
                className="px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors border border-violet-500/30 shadow-sm">
                <Shield size={14} /> صلاحية
              </button>
            )}
            {/* تعديل البيانات */}
            <button onClick={() => { setEditing(true); setActiveTab('edit'); }}
              className="px-3 py-2 bg-white/15 hover:bg-white/25 text-white border border-white/20 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-colors">
              <Edit2 size={14} /> تعديل
            </button>
            {/* إيقاف / تفعيل (admin) */}
            {isSub && isAdmin && (
              <button
                onClick={() => updateSubscriber({ ...subscriber!, status: subscriber!.status === 'active' ? 'paused' : 'active' })}
                className="px-3 py-2 bg-amber-600/80 hover:bg-amber-500 text-white rounded-xl text-sm font-medium transition-colors border border-amber-500/30">
                {subscriber!.status === 'active' ? 'إيقاف' : 'تفعيل'}
              </button>
            )}
            {/* حذف (admin) */}
            {isAdmin && (
              <button
                onClick={() => {
                  if (!window.confirm(`هل تريد حذف ${clientName}؟`)) return;
                  if (subscriber) { deleteSubscriber(subscriber.id); navigate('/dashboard/subscribers'); }
                  else if (lead) { deleteLead(lead.id); navigate('/dashboard'); }
                }}
                className="px-3 py-2 bg-red-600/80 hover:bg-red-500 text-white rounded-xl text-sm font-medium flex items-center gap-1.5 transition-colors border border-red-500/30">
                <Trash2 size={14} /> حذف
              </button>
            )}
          </div>
        </div>
      </div>


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

          {/* ── 1. Profile Card ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className={`h-1.5 ${isSub ? (subscriber!.status === 'active' ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-gradient-to-r from-amber-400 to-orange-500') : 'bg-gradient-to-r from-blue-400 to-indigo-500'}`} />
            <div className="p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-xl shadow flex-shrink-0 ${isSub ? (subscriber!.status === 'active' ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white' : 'bg-gradient-to-br from-amber-400 to-orange-500 text-white') : 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white'}`}>
                  {clientName.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold text-gray-900 leading-tight truncate">{clientName}</p>
                  <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${isSub ? (subscriber!.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700') : 'bg-blue-100 text-blue-700'}`}>
                    {isSub ? (subscriber!.status === 'active' ? '● مشترك نشط' : '● متوقف') : (lead ? (statusLabels[lead.status] || lead.status) : 'عميل محتمل')}
                  </span>
                </div>
              </div>

              {/* Quick contact buttons */}
              {clientPhone && (
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <a href={`tel:${clientPhone}`} className="flex items-center justify-center gap-1.5 py-2 bg-blue-50 text-blue-700 rounded-xl text-xs font-bold hover:bg-blue-100 transition border border-blue-100">
                    <Phone size={13} /> اتصال
                  </a>
                  <a href={`https://wa.me/${clientPhone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 py-2 bg-green-50 text-green-700 rounded-xl text-xs font-bold hover:bg-green-100 transition border border-green-100">
                    <MessageSquare size={13} /> واتساب
                  </a>
                </div>
              )}

              {/* Info rows */}
              <div className="divide-y divide-gray-50 text-xs">
                {clientPhone && (
                  <div className="flex items-center justify-between py-1.5"><span className="text-gray-400">📞 الهاتف</span><span className="font-semibold text-gray-700">{clientPhone}</span></div>
                )}
                {clientEmail && (
                  <div className="flex items-center justify-between py-1.5"><span className="text-gray-400">✉️ البريد</span><a href={`mailto:${clientEmail}`} className="text-blue-600 hover:underline truncate max-w-[130px]">{clientEmail}</a></div>
                )}
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-gray-400">📍 الفرع</span>
                  <span className="font-semibold text-gray-700">{clientBranch ? (branchLabels[normBranchKey(clientBranch)] || clientBranch) : '—'}</span>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-gray-400">🗓️ التسجيل</span>
                  <span className="text-gray-600">{(isSub ? subscriber!.createdAt : lead?.createdAt)?.slice(0, 10) || '—'}</span>
                </div>
                {(isSub ? subscriber!.assignedSalesName : lead?.assignedSalesName) && (
                  <div className="flex items-center justify-between py-1.5"><span className="text-gray-400">🧑‍💼 السيلز</span><span className="font-semibold text-indigo-700">{isSub ? subscriber!.assignedSalesName : lead?.assignedSalesName}</span></div>
                )}
                {(isSub ? subscriber!.assignedCsName : lead?.assignedCsName) && (
                  <div className="flex items-center justify-between py-1.5"><span className="text-gray-400">🎧 خدمة العملاء</span><span className="font-semibold text-purple-700">{isSub ? subscriber!.assignedCsName : lead?.assignedCsName}</span></div>
                )}
                {(isSub ? linkedLead?.source : lead?.source) && (
                  <div className="flex items-center justify-between py-1.5"><span className="text-gray-400">📢 المصدر</span><span className="font-semibold text-gray-700">{isSub ? linkedLead?.source : lead?.source}</span></div>
                )}
                {!isSub && lead?.interestLevel && (
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-gray-400">⭐ الاهتمام</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${lead.interestLevel === 'high' ? 'bg-green-100 text-green-700' : lead.interestLevel === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                      {lead.interestLevel === 'high' ? 'مرتفع' : lead.interestLevel === 'medium' ? 'متوسط' : 'منخفض'}
                    </span>
                  </div>
                )}
                {!isSub && lead?.nextFollowUpDate && (
                  <div className="flex items-center justify-between py-1.5"><span className="text-gray-400">⏰ متابعة</span><span className="text-orange-600 font-bold">{lead.nextFollowUpDate}</span></div>
                )}
              </div>
            </div>
          </div>

          {/* ── 2. Financial summary (subscriber) ── */}
          {isSub && subscriber!.enrolledCourseIds.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5"><CreditCard size={13} className="text-emerald-500" /> الملخص المالي</p>
                <button onClick={() => setShowPayDetailModal(true)} className="text-[10px] text-blue-500 hover:underline font-semibold">تفاصيل ←</button>
              </div>
              {/* Totals row */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                {subPaidTotals.EGP > 0 && (
                  <div className="bg-emerald-50 rounded-xl p-2.5 text-center border border-emerald-100">
                    <p className="font-extrabold text-emerald-700 text-sm">{subPaidTotals.EGP.toLocaleString()}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">مدفوع ج.م</p>
                  </div>
                )}
                {subRemainingEGP > 0 && (
                  <div className="bg-red-50 rounded-xl p-2.5 text-center border border-red-100">
                    <p className="font-extrabold text-red-600 text-sm">{subRemainingEGP.toLocaleString()}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">متبقي ج.م</p>
                  </div>
                )}
                {subPaidTotals.SAR > 0 && (
                  <div className="bg-blue-50 rounded-xl p-2.5 text-center border border-blue-100">
                    <p className="font-extrabold text-blue-700 text-sm">{subPaidTotals.SAR.toLocaleString()}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">مدفوع ر.س</p>
                  </div>
                )}
              </div>
              {/* Per-course list */}
              <div className="space-y-1.5">
                {subscriber!.enrolledCourseIds.map(cId => {
                  const c = courses.find(x => x.id === cId);
                  const bm = bookingMap[cId];
                  const remaining = bm?.expectedEGP != null ? Math.max(0, bm.expectedEGP - bm.paidEGP) : null;
                  return (
                    <div key={cId} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                      <p className="font-semibold text-gray-800 text-xs truncate flex-1">{c?.title || cId}</p>
                      {bm ? (
                        <div className="flex-shrink-0 text-left">
                          <p className="text-[11px] font-bold text-emerald-700">{bm.paidEGP.toLocaleString()} ج.م</p>
                          {remaining !== null && remaining > 0 && <p className="text-[10px] text-red-600">باقي {remaining.toLocaleString()}</p>}
                          {remaining === 0 && <p className="text-[10px] text-emerald-600 font-bold">✅ مكتمل</p>}
                        </div>
                      ) : <span className="text-[10px] text-gray-400 italic flex-shrink-0">لا مدفوعات</span>}
                    </div>
                  );
                })}
              </div>
              {/* Discount badge */}
              {subscriber!.discount != null && subscriber!.discount > 0 && (
                <div className="mt-2 flex items-center justify-between bg-orange-50 border border-orange-100 rounded-xl px-3 py-1.5">
                  <span className="text-xs text-orange-600">🏷️ خصم</span>
                  <span className="font-extrabold text-orange-700 text-xs">{subscriber!.discount.toLocaleString()} ج.م</span>
                </div>
              )}
            </div>
          )}

          {/* ── 2b. Lead course (lead only) ── */}
          {!isSub && enrolledCourse && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <p className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5 mb-3"><BookOpen size={13} className="text-blue-500" /> الكورس المهتم به</p>
              <div className="bg-blue-50 rounded-xl px-3 py-2.5 border border-blue-100">
                <p className="font-bold text-blue-800 text-xs">{enrolledCourse.title}</p>
                {leadPaidEGP > 0 && (
                  <div className="flex items-center justify-between mt-1.5 flex-wrap gap-1">
                    <span className="text-[10px] text-emerald-700 font-bold">{leadPaidEGP.toLocaleString()} ج.م مدفوع</span>
                    {leadRemaining > 0 && <span className="text-[10px] text-red-600 font-bold">متبقي {leadRemaining.toLocaleString()}</span>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── 3. Installment alerts ── */}
          {isSub && subInstallmentPlans.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <button onClick={() => setActiveTab('installments')} className="flex items-center gap-2 w-full text-xs font-extrabold text-gray-700 mb-3 hover:text-purple-600 transition">
                <CalendarDays size={13} className="text-purple-500" /> خطط الأقساط
                {instOverdueCount > 0 && <span className="mr-auto bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">{instOverdueCount} متأخر</span>}
                {instOverdueCount === 0 && instSoonCount > 0 && <span className="mr-auto bg-amber-400 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">{instSoonCount} قريب</span>}
              </button>
              <div className="space-y-1.5">
                {subInstallmentPlans.map(plan => {
                  const unpaid = plan.entries.filter(e => !e.paidAt);
                  const paid = plan.entries.filter(e => e.paidAt);
                  const nextDue = unpaid.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
                  const isOverdue = nextDue && nextDue.dueDate < _todayStr;
                  return (
                    <div key={plan.id} className={`rounded-xl px-3 py-2.5 border ${isOverdue ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100'}`}>
                      <p className="font-semibold text-xs text-gray-800 truncate mb-1">{plan.courseTitle || courses.find(c => c.id === plan.courseId)?.title || plan.courseId}</p>
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <span className="text-[10px] text-emerald-700 font-bold">{paid.length}/{plan.entries.length} ✓</span>
                        {nextDue && <span className={`text-[10px] font-bold ${isOverdue ? 'text-red-600' : 'text-amber-600'}`}>{isOverdue ? '⚠️' : '⏰'} {nextDue.dueDate} — {nextDue.amount.toLocaleString()} ج.م</span>}
                        {!nextDue && <span className="text-[10px] text-emerald-600 font-bold">✅ مكتمل</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── 4. Certificates ── */}
          {isSub && (subCerts.length > 0 || extraReqs.length > 0) && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <p className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5 mb-3">
                <Award size={13} className="text-amber-500" /> الشهادات
                <span className="mr-auto text-[10px] font-normal text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{subCerts.length + extraReqs.filter(r => r.status === 'issued').length}</span>
              </p>
              <div className="space-y-1.5">
                {subCerts.map(cert => {
                  const certCourse = courses.find(c => c.id === cert.courseId);
                  return (
                    <div key={cert.id} className="flex items-center gap-2 bg-amber-50 rounded-xl px-2.5 py-2 border border-amber-100">
                      <span>🏆</span><span className="text-xs font-semibold text-amber-800 truncate">{certCourse?.title || cert.courseId}</span>
                    </div>
                  );
                })}
                {extraReqs.map(req => (
                  <div key={req.id} className="flex items-center justify-between gap-2 bg-gray-50 rounded-xl px-2.5 py-2 border border-gray-100">
                    <span className="text-xs text-gray-700 truncate">{req.customName || EXTRA_TYPE_LABELS[req.type] || req.type}</span>
                    <span className={`text-[10px] font-bold flex-shrink-0 ${req.status === 'issued' ? 'text-emerald-600' : req.status === 'paid' ? 'text-blue-600' : 'text-amber-600'}`}>
                      {req.status === 'issued' ? '✅' : req.status === 'paid' ? '💳' : '⏳'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 5. Activity stats ── */}
          {isSub && (sessionData || subscriber!.lectureProgress) && (() => {
            const totalLectures = subscriber!.enrolledCourseIds.reduce((acc, cId) => acc + getCourseLectures(cId).length, 0);
            const completedLectures = Object.values(subscriber!.lectureProgress || {}).filter((p) => (p as number) > 0).length;
            const completionPct = totalLectures > 0 ? Math.round((completedLectures / totalLectures) * 100) : null;
            return (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <p className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5 mb-3"><Activity size={13} className="text-teal-500" /> نشاط العميل</p>
                <div className="space-y-2 text-xs">
                  {sessionData?.visitCount != null && (
                    <div className="flex items-center justify-between"><span className="text-gray-400">زيارات الموقع</span><span className="font-bold text-indigo-700">{sessionData.visitCount} مرة</span></div>
                  )}
                  {sessionData?.lastActiveAt && (
                    <div className="flex items-center justify-between"><span className="text-gray-400">آخر نشاط</span><span className="font-semibold text-gray-700">{new Date(sessionData.lastActiveAt).toLocaleDateString('ar-EG')}</span></div>
                  )}
                  {completionPct !== null && (
                    <div>
                      <div className="flex items-center justify-between mb-1"><span className="text-gray-400">إتمام المحاضرات</span><span className={`font-bold ${completionPct === 100 ? 'text-emerald-600' : completionPct >= 50 ? 'text-amber-600' : 'text-gray-600'}`}>{completionPct}%</span></div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5"><div className={`h-1.5 rounded-full transition-all ${completionPct === 100 ? 'bg-emerald-500' : completionPct >= 50 ? 'bg-amber-400' : 'bg-blue-400'}`} style={{ width: `${completionPct}%` }} /></div>
                    </div>
                  )}
                </div>
                {allComms.length > 0 ? (
                  <div className="mt-2 flex items-center justify-between text-xs pt-2 border-t border-gray-50">
                    <span className="text-gray-400">📅 آخر تواصل</span><span className="font-semibold text-gray-700">{allComms[0].date?.slice(0, 10)}</span>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-amber-600 bg-amber-50 rounded-xl px-2.5 py-1.5 flex items-center gap-1 border border-amber-100">⚠️ لم يتم التواصل بعد</div>
                )}
                {(() => {
                  const overdueAmt = subInstallmentPlans.flatMap(p => p.entries.filter(e => !e.paidAt && e.dueDate < _todayStr)).reduce((s, e) => s + e.amount, 0);
                  return overdueAmt > 0 ? (
                    <div className="mt-2 flex items-center justify-between text-xs bg-red-50 rounded-xl px-2.5 py-1.5 border border-red-100">
                      <span className="text-red-600 font-bold">🔴 أقساط متأخرة</span><span className="text-red-700 font-extrabold">{overdueAmt.toLocaleString()} ج.م</span>
                    </div>
                  ) : null;
                })()}
              </div>
            );
          })()}

          {/* ── 6. Quick Actions Grid ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mb-3">إجراءات سريعة</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setActiveTab('communications'); setShowAddComm(true); }}
                className="flex flex-col items-center gap-1.5 py-3 bg-blue-50 text-blue-700 rounded-2xl hover:bg-blue-100 transition border border-blue-100">
                <Phone size={18} /><span className="text-[11px] font-bold">تسجيل تواصل</span>
              </button>
              {isSub ? (
                <button onClick={() => { setActiveTab('payments'); setShowSubPayForm(true); }}
                  className="flex flex-col items-center gap-1.5 py-3 bg-emerald-50 text-emerald-700 rounded-2xl hover:bg-emerald-100 transition border border-emerald-100">
                  <CreditCard size={18} /><span className="text-[11px] font-bold">تسجيل دفعة</span>
                </button>
              ) : (
                <button onClick={() => setShowLeadPayForm(true)}
                  className="flex flex-col items-center gap-1.5 py-3 bg-emerald-50 text-emerald-700 rounded-2xl hover:bg-emerald-100 transition border border-emerald-100">
                  <DollarSign size={18} /><span className="text-[11px] font-bold">تسجيل دفعة</span>
                </button>
              )}
              {isSub && (
                <>
                  <button onClick={() => { setShowGrantForm(true); setGrantDraft({ courseId: '', note: '' }); }}
                    className="flex flex-col items-center gap-1.5 py-3 bg-violet-50 text-violet-700 rounded-2xl hover:bg-violet-100 transition border border-violet-100">
                    <Key size={18} /><span className="text-[11px] font-bold">منح كورس</span>
                  </button>
                  <button onClick={() => setShowLegacyPayForm(true)}
                    className="flex flex-col items-center gap-1.5 py-3 bg-amber-50 text-amber-700 rounded-2xl hover:bg-amber-100 transition border border-amber-100">
                    <Clock size={18} /><span className="text-[11px] font-bold">مدفوع قديم</span>
                  </button>
                  <button onClick={() => { setActiveTab('certificates'); setShowExtraCertForm(true); setExtraCertDraft({ courseId: '', type: '', certExpected: '', certPaid: '' }); }}
                    className="flex flex-col items-center gap-1.5 py-3 bg-orange-50 text-orange-700 rounded-2xl hover:bg-orange-100 transition border border-orange-100">
                    <Award size={18} /><span className="text-[11px] font-bold">إصدار شهادة</span>
                  </button>
                  <button onClick={() => setShowInstPlanForm(true)}
                    className="flex flex-col items-center gap-1.5 py-3 bg-purple-50 text-purple-700 rounded-2xl hover:bg-purple-100 transition border border-purple-100">
                    <CalendarDays size={18} /><span className="text-[11px] font-bold">خطة أقساط</span>
                  </button>
                </>
              )}
              <button onClick={() => { setEditing(!editing); setActiveTab('edit'); }}
                className="flex flex-col items-center gap-1.5 py-3 bg-gray-50 text-gray-600 rounded-2xl hover:bg-gray-100 transition border border-gray-100">
                <Edit2 size={18} /><span className="text-[11px] font-bold">تعديل البيانات</span>
              </button>
            </div>
          </div>

          {/* ── 7. Internal notes ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mb-2">📌 ملاحظة داخلية</p>
            <textarea
              value={quickNote}
              onChange={e => saveQuickNote(e.target.value)}
              placeholder="ملاحظة خاصة بالفريق (لا تظهر للعميل)..."
              rows={3}
              className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100 bg-gray-50"
            />
          </div>

          {/* ── 8. Promo code (lead only) ── */}
          {!isSub && lead && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <p className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5 mb-3"><Tag size={13} className="text-purple-500" /> كود الخصم</p>
              {lead.promoCode ? (
                <div className="flex items-center gap-2 bg-purple-50 rounded-xl px-3 py-2.5 border border-purple-100">
                  <span className="font-mono font-bold text-purple-700 flex-1">{lead.promoCode}</span>
                  <button onClick={() => { navigator.clipboard.writeText(lead.promoCode!).then(() => { setPromoCopied(true); setTimeout(() => setPromoCopied(false), 2000); }); }}>
                    {promoCopied ? <CheckCircle size={14} className="text-emerald-600" /> : <Copy size={14} className="text-purple-500" />}
                  </button>
                </div>
              ) : (
                <button onClick={handleGeneratePromo} className="w-full py-2.5 bg-purple-50 text-purple-700 rounded-xl text-xs hover:bg-purple-100 flex items-center justify-center gap-2 border border-purple-100 font-bold transition">
                  <Tag size={13} /> توليد كود خصم
                </button>
              )}
            </div>
          )}

          {/* ── 9. Discount quick-setter (subscriber only) ── */}
          {isSub && discountBase > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <p className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5 mb-3"><Tag size={13} className="text-orange-500" /> خصم سريع</p>
              <div className="grid grid-cols-3 gap-1.5 mb-2">
                {[5, 10, 15, 20, 25, 30].map(pct => {
                  const val = Math.round(discountBase * pct / 100);
                  const isActive = subscriber!.discount === val;
                  return (
                    <button key={pct} onClick={() => updateSubscriber({ ...subscriber!, discount: val })}
                      className={`py-1.5 rounded-xl text-xs font-bold border-2 transition ${isActive ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 bg-white text-gray-600 hover:border-orange-300'}`}>
                      {pct}%<span className="block text-[9px] font-normal text-gray-400">{val.toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>
              {subscriber!.discount && subscriber!.discount > 0 && (
                <button onClick={() => updateSubscriber({ ...subscriber!, discount: 0 })} className="w-full py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-xl transition">
                  ✕ إلغاء الخصم ({subscriber!.discount.toLocaleString()} ج.م)
                </button>
              )}
              <p className="text-[10px] text-gray-400 mt-1.5 text-center">محسوبة من {discountBase.toLocaleString()} ج.م</p>
            </div>
          )}

          {/* ── 10. Linked subscriber cross-link (lead view only) ── */}
          {!isSub && linkedSub && (
            <div className="bg-emerald-50 rounded-2xl border border-emerald-200 p-4">
              <p className="text-xs font-extrabold text-emerald-700 flex items-center gap-1.5 mb-2"><CheckCircle size={13} /> ملف المشترك</p>
              <p className="font-bold text-emerald-800 text-sm">{linkedSub.name}</p>
              <p className="text-xs text-emerald-600 mb-2">{linkedSub.enrolledCourseIds.length} كورس مسجل</p>
              <button onClick={() => navigate(`/client/${linkedSub.clientCode || linkedSub.id}`)} className="w-full py-2 bg-emerald-600 text-white rounded-xl text-xs hover:bg-emerald-700 flex items-center justify-center gap-1.5 font-bold transition">
                <BookOpen size={12} /> عرض الملف الكامل
              </button>
            </div>
          )}

        </div>

        {/* ════════ MAIN CONTENT ════════ */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100">

            {/* ── Tab Navigation ── */}
            <div className="flex items-center gap-0 overflow-x-auto border-b border-gray-100 bg-white rounded-t-2xl px-3">
              {tabs.map(([tab, label]) => (
                <button key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-3 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === tab
                      ? 'text-indigo-700 border-indigo-500'
                      : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-50'
                  }`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="p-5 space-y-6">

              {/* ══ OVERVIEW ══ */}
              {activeTab === 'overview' && (
                <div className="space-y-5">
                  {/* ─── Client Pulse ─── */}
                  {(() => {
                    const regDate = isSub ? subscriber!.createdAt : lead?.createdAt;
                    const daysSinceReg = regDate ? Math.floor((Date.now() - new Date(regDate).getTime()) / 86400000) : null;
                    const lastCommDate = allComms[0]?.date;
                    const daysSinceComm = lastCommDate ? Math.floor((Date.now() - new Date(lastCommDate).getTime()) / 86400000) : null;
                    const totalLec = isSub ? subscriber!.enrolledCourseIds.reduce((acc, cId) => acc + getCourseLectures(cId).length, 0) : 0;
                    const doneLec = isSub ? Object.values(subscriber!.lectureProgress || {}).filter(p => (p as number) > 0).length : 0;
                    const pulsePct = totalLec > 0 ? Math.round((doneLec / totalLec) * 100) : null;
                    const overdueAmt = isSub ? subInstallmentPlans.flatMap(p => p.entries.filter(e => !e.paidAt && e.dueDate < _todayStr)).reduce((s, e) => s + e.amount, 0) : 0;
                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {/* Days since registration */}
                        <div className="bg-slate-50 rounded-2xl p-4 text-center border border-slate-200">
                          <p className="font-extrabold text-slate-700 text-2xl leading-none">{daysSinceReg ?? '—'}</p>
                          <p className="text-[11px] text-slate-400 mt-1 font-semibold">يوم منذ التسجيل</p>
                        </div>
                        {/* Days since last comm — color-coded */}
                        <div className={`rounded-2xl p-4 text-center border ${
                          daysSinceComm === null ? 'bg-amber-50 border-amber-200' :
                          daysSinceComm > 30 ? 'bg-red-50 border-red-200' :
                          daysSinceComm > 7 ? 'bg-amber-50 border-amber-200' :
                          'bg-emerald-50 border-emerald-200'
                        }`}>
                          <p className={`font-extrabold text-2xl leading-none ${
                            daysSinceComm === null ? 'text-amber-600' :
                            daysSinceComm > 30 ? 'text-red-600' :
                            daysSinceComm > 7 ? 'text-amber-600' : 'text-emerald-600'
                          }`}>{daysSinceComm ?? '—'}</p>
                          <p className={`text-[11px] mt-1 font-semibold ${
                            daysSinceComm === null ? 'text-amber-500' :
                            daysSinceComm > 30 ? 'text-red-400' :
                            daysSinceComm > 7 ? 'text-amber-500' : 'text-emerald-500'
                          }`}>{daysSinceComm === null ? 'لا تواصل بعد' : 'يوم منذ تواصل'}</p>
                        </div>
                        {/* Completion % (sub) | interest level (lead) */}
                        {isSub ? (
                          <div className={`rounded-2xl p-4 text-center border ${
                            pulsePct === null ? 'bg-gray-50 border-gray-200' :
                            pulsePct === 100 ? 'bg-emerald-50 border-emerald-200' :
                            pulsePct >= 50 ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200'
                          }`}>
                            <p className={`font-extrabold text-2xl leading-none ${
                              pulsePct === null ? 'text-gray-400' :
                              pulsePct === 100 ? 'text-emerald-600' :
                              pulsePct >= 50 ? 'text-amber-600' : 'text-blue-600'
                            }`}>{pulsePct !== null ? `${pulsePct}%` : '—'}</p>
                            <p className="text-[11px] text-gray-400 mt-1 font-semibold">إتمام المحاضرات</p>
                          </div>
                        ) : (
                          <div className={`rounded-2xl p-4 text-center border ${
                            lead?.interestLevel === 'high' ? 'bg-green-50 border-green-200' :
                            lead?.interestLevel === 'medium' ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'
                          }`}>
                            <p className={`font-extrabold text-2xl leading-none ${
                              lead?.interestLevel === 'high' ? 'text-green-600' :
                              lead?.interestLevel === 'medium' ? 'text-amber-600' : 'text-gray-400'
                            }`}>{lead?.interestLevel === 'high' ? '🔥' : lead?.interestLevel === 'medium' ? '〽️' : lead?.interestLevel ? '▽' : '—'}</p>
                            <p className="text-[11px] text-gray-400 mt-1 font-semibold">{lead?.interestLevel === 'high' ? 'اهتمام مرتفع' : lead?.interestLevel === 'medium' ? 'اهتمام متوسط' : 'مستوى الاهتمام'}</p>
                          </div>
                        )}
                        {/* Overdue (sub) | payments count (lead) */}
                        {isSub ? (
                          <div className={`rounded-2xl p-4 text-center border ${overdueAmt > 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
                            <p className={`font-extrabold leading-none ${overdueAmt > 0 ? 'text-red-600 text-lg' : 'text-emerald-600 text-2xl'}`}>
                              {overdueAmt > 0 ? overdueAmt.toLocaleString() : '✓'}
                            </p>
                            <p className={`text-[11px] mt-1 font-semibold ${overdueAmt > 0 ? 'text-red-400' : 'text-emerald-500'}`}>
                              {overdueAmt > 0 ? 'ج.م متأخر' : 'لا متأخرات'}
                            </p>
                          </div>
                        ) : (
                          <div className="bg-blue-50 rounded-2xl p-4 text-center border border-blue-200">
                            <p className="font-extrabold text-blue-700 text-2xl leading-none">{leadPayments.length}</p>
                            <p className="text-[11px] text-blue-400 mt-1 font-semibold">دفعة مسجّلة</p>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* ─── Lead Status + Follow-up Banner (leads only) ─── */}
                  {!isSub && lead && (
                    <div className="rounded-2xl border overflow-hidden shadow-sm">
                      {/* header */}
                      <div className={`px-4 py-3 flex items-center justify-between flex-wrap gap-2 ${
                        lead.status === 'converted' ? 'bg-emerald-600' :
                        lead.status === 'lost' || lead.status === 'not_interested' ? 'bg-red-500' :
                        lead.status === 'interested' || lead.status === 'interested_followup' ? 'bg-blue-600' :
                        'bg-slate-600'
                      }`}>
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">
                            {lead.status === 'converted' ? '✅' : lead.status === 'lost' ? '❌' : lead.status === 'interested' ? '⭐' : lead.status === 'new' ? '🆕' : '📋'}
                          </span>
                          <div>
                            <p className="text-white font-extrabold text-sm">{
                              ({ new: 'عميل جديد', contacted: 'تم التواصل', interested: 'مهتم', interested_followup: 'مهتم ومتابعة',
                                not_interested: 'غير مهتم', lost: 'خسرنا', converted: 'تم الحجز / التحويل' } as Record<string, string>)[lead.status] || lead.status
                            }</p>
                            <p className="text-white/70 text-[11px]">آخر تحديث: {lead.lastFollowUp?.slice(0, 10) || '—'}</p>
                          </div>
                        </div>
                        {lead.nextFollowUpDate && (
                          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold ${
                            lead.nextFollowUpDate < new Date().toISOString().slice(0,10) ? 'bg-red-100 text-red-700' :
                            lead.nextFollowUpDate === new Date().toISOString().slice(0,10) ? 'bg-orange-100 text-orange-700' :
                            'bg-white/20 text-white'
                          }`}>
                            <Clock size={12} />
                            {lead.nextFollowUpDate < new Date().toISOString().slice(0,10)
                              ? `متأخر — ${lead.nextFollowUpDate}`
                              : `متابعة: ${lead.nextFollowUpDate}`}
                          </div>
                        )}
                      </div>
                      {/* lead details grid */}
                      <div className="bg-white p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {lead.source && (
                          <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">المصدر</p>
                            <p className="font-bold text-gray-800 text-sm">📢 {lead.source}</p>
                          </div>
                        )}
                        {lead.interestLevel && (
                          <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">مستوى الاهتمام</p>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                              lead.interestLevel === 'high' ? 'bg-green-100 text-green-700' :
                              lead.interestLevel === 'medium' ? 'bg-amber-100 text-amber-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {lead.interestLevel === 'high' ? '⭐ مرتفع' : lead.interestLevel === 'medium' ? '〽️ متوسط' : '▽ منخفض'}
                            </span>
                          </div>
                        )}
                        {lead.createdAt && (
                          <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">تاريخ التسجيل</p>
                            <p className="font-bold text-gray-800 text-sm">📅 {lead.createdAt?.slice(0, 10)}</p>
                          </div>
                        )}
                        {lead.assignedSalesName && (
                          <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">السيلز</p>
                            <p className="font-bold text-indigo-700 text-sm">👤 {lead.assignedSalesName}</p>
                          </div>
                        )}
                        {lead.tags && lead.tags.length > 0 && (
                          <div className="col-span-2 sm:col-span-3 bg-gray-50 rounded-xl p-3 border border-gray-100">
                            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-2">التاجات</p>
                            <div className="flex flex-wrap gap-1.5">
                              {lead.tags.map(tag => (
                                <span key={tag} className="px-2.5 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-bold">🏷️ {tag}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ─── Interested Courses (leads) ─── */}
                  {!isSub && (lead?.interestedCourseIds?.length || 0) > 0 && (
                    <div>
                      <p className="font-extrabold text-gray-800 text-sm mb-3 flex items-center gap-2">
                        <BookOpen size={15} className="text-blue-500" /> الكورسات المهتم بها
                      </p>
                      <div className="space-y-2">
                        {(lead!.interestedCourseIds || []).map(id => {
                          const resolvedId = id.startsWith('bundle:') ? id.replace('bundle:', '') : id;
                          const course = courses.find(c => c.id === id);
                          const bundle = bundles.find(b => b.id === resolvedId) || bundles.find(b => b.id === id);
                          const title = course?.title || bundle?.title || id;
                          const isBundle = id.startsWith('bundle:') || !!bundle;
                          return (
                            <div key={id} className="flex items-center gap-3 bg-white border border-blue-100 rounded-xl px-4 py-2.5 shadow-sm hover:border-blue-300 transition">
                              <span className={`text-lg flex-shrink-0 ${isBundle ? '📦' : '🎓'}`}>{isBundle ? '📦' : '🎓'}</span>
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-gray-800 text-sm leading-tight truncate">{title}</p>
                                <p className="text-[10px] text-gray-400 mt-0.5">{isBundle ? 'باقة' : 'كورس'}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ─── Lead bookings / payments ─── */}
                  {!isSub && leadPayments.length > 0 && (
                    <div>
                      <p className="font-extrabold text-gray-800 text-sm mb-3 flex items-center gap-2">
                        <CreditCard size={15} className="text-emerald-600" /> الحجوزات والمدفوعات
                      </p>
                      <div className="space-y-2">
                        {leadPayments.map(p => (
                          <div key={p.id} className="bg-gradient-to-l from-emerald-50 to-white border border-emerald-100 rounded-xl p-4 flex items-center justify-between gap-3 shadow-sm">
                            <div>
                              <p className="font-bold text-emerald-700 text-base">{p.amount.toLocaleString()} {p.currency}</p>
                              {p.courseId && <p className="text-xs text-gray-500 mt-0.5">🎓 {courses.find(c => c.id === p.courseId)?.title || p.courseId}</p>}
                              {p.note && <p className="text-xs text-gray-400 mt-0.5 italic">{p.note}</p>}
                            </div>
                            <div className="text-left flex-shrink-0">
                              <p className="text-[11px] text-gray-400 font-semibold">{p.date?.slice(0, 10)}</p>
                              {p.paymentType && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold mt-1 block text-center">{p.paymentType}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center justify-between">
                        <span className="font-bold text-emerald-700 text-sm">الإجمالي المدفوع</span>
                        <span className="font-extrabold text-emerald-800 text-lg">{leadPaidEGP.toLocaleString()} ج.م</span>
                      </div>
                    </div>
                  )}

                  {/* ─── Subscriber Enrolled Courses (rich) ─── */}
                  {isSub && subscriber!.enrolledCourseIds.length > 0 && (
                    <div>
                      <p className="font-extrabold text-gray-800 text-sm mb-3 flex items-center gap-2">
                        <BookOpen size={15} className="text-emerald-600" /> الكورسات المشترك بها
                      </p>
                      <div className="space-y-3">
                        {subscriber!.enrolledCourseIds.map(courseId => {
                          const course = courses.find(c => c.id === courseId);
                          const bm = bookingMap[courseId];
                          const hasCert = subCerts.some(c => c.courseId === courseId);
                          const totalLec = getCourseLectures(courseId).length;
                          const watched = Number(subscriber!.lectureProgress?.[courseId]) || 0;
                          const pct = totalLec > 0 ? Math.round((watched / totalLec) * 100) : 0;
                          // Use recorded expectedEGP → else fall back to course catalogue price
                          const expectedForCourse = bm?.expectedEGP ?? (courses.find(c => c.id === courseId)?.price?.EGP ?? 0);
                          const paidForCourse = bm?.paidEGP ?? 0;
                          const remaining = expectedForCourse > 0 ? Math.max(0, expectedForCourse - paidForCourse) : null;
                          return (
                            <div key={courseId} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition">
                              {/* course header */}
                              <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-l from-emerald-50 to-white border-b border-gray-100">
                                <div className="flex items-center gap-2">
                                  <span className="text-xl">🎓</span>
                                  <p className="font-extrabold text-gray-800 text-sm">{course?.title || courseId}</p>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {hasCert && <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full flex-shrink-0">🏆 شهادة</span>}
                                  {remaining === 0 && <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✅ مكتمل</span>}
                                  {remaining != null && remaining > 0 && <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">💳 متبقي</span>}
                                </div>
                              </div>
                              <div className="px-4 py-3">
                                {(bm || expectedForCourse > 0) ? (
                                  <div className="grid grid-cols-3 gap-2 mb-3">
                                    <div className="bg-green-50 rounded-xl p-2.5 text-center border border-green-100">
                                      <p className="font-extrabold text-green-700 text-sm">{paidForCourse.toLocaleString()}</p>
                                      <p className="text-[10px] text-gray-400">مدفوع (ج.م)</p>
                                    </div>
                                    {expectedForCourse > 0 && (
                                      <div className="bg-blue-50 rounded-xl p-2.5 text-center border border-blue-100">
                                        <p className="font-extrabold text-blue-700 text-sm">{expectedForCourse.toLocaleString()}</p>
                                        <p className="text-[10px] text-gray-400">الإجمالي (ج.م)</p>
                                      </div>
                                    )}
                                    {remaining != null && (
                                      <div className={`rounded-xl p-2.5 text-center border ${remaining === 0 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                                        <p className={`font-extrabold text-sm ${remaining === 0 ? 'text-green-700' : 'text-red-600'}`}>{remaining === 0 ? '✅' : remaining.toLocaleString()}</p>
                                        <p className="text-[10px] text-gray-400">{remaining === 0 ? 'مكتمل' : 'متبقي (ج.م)'}</p>
                                      </div>
                                    )}
                                    {bm?.discount && bm.discount > 0 && (
                                      <div className="col-span-3 bg-orange-50 rounded-xl px-3 py-1.5 flex items-center justify-between border border-orange-100">
                                        <span className="text-[10px] text-orange-600 font-semibold">🏷️ خصم مطبّق</span>
                                        <span className="font-bold text-orange-700 text-sm">{bm.discount.toLocaleString()} ج.م</span>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-400 mb-3 italic">لا توجد مدفوعات مسجلة لهذا الكورس</p>
                                )}
                                {totalLec > 0 && (
                                  <div>
                                    <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                                      <span>تقدم المشاهدة</span><span>{watched}/{totalLec} ({pct}%)</span>
                                    </div>
                                    <div className="w-full bg-gray-100 rounded-full h-2">
                                      <div className={`h-2 rounded-full transition-all ${pct >= 80 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ─── Lead enrolled course (simple) ─── */}
                  {!isSub && enrolledCourse && (lead?.interestedCourseIds?.length || 0) === 0 && (
                    <div className="border border-blue-200 rounded-2xl overflow-hidden shadow-sm">
                      <div className="bg-gradient-to-l from-blue-50 to-white px-4 py-3 border-b border-blue-100 flex items-center gap-2">
                        <BookOpen size={14} className="text-blue-600" />
                        <p className="font-extrabold text-blue-800 text-sm">الكورس المهتم به</p>
                      </div>
                      <div className="p-4 bg-white">
                        <p className="font-bold text-gray-800 mb-3">{enrolledCourse.title}</p>
                        {leadPaidEGP > 0 && (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="bg-green-50 rounded-xl p-2.5 text-center border border-green-100">
                              <p className="font-extrabold text-green-700">{leadPaidEGP.toLocaleString()} ج.م</p>
                              <p className="text-[10px] text-gray-400">مدفوع</p>
                            </div>
                            {leadRemaining > 0 && (
                              <div className="bg-red-50 rounded-xl p-2.5 text-center border border-red-100">
                                <p className="font-extrabold text-red-600">{leadRemaining.toLocaleString()} ج.م</p>
                                <p className="text-[10px] text-gray-400">متبقي</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ─── Contact history strip ─── */}
                  {allComms.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <p className="font-extrabold text-gray-800 text-sm flex items-center gap-2">
                          <MessageSquare size={14} className="text-indigo-500" /> سجل التواصل ({allComms.length})
                        </p>
                        <button onClick={() => setActiveTab('communications')}
                          className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold hover:underline">
                          عرض الكل ←
                        </button>
                      </div>
                      <div className="space-y-2">
                        {allComms.slice(0, 4).map(comm => {
                          const c = comm as CommunicationRecord & { _src?: string };
                          const meta = commTypeMeta[c.type] || commTypeMeta.note;
                          return (
                            <div key={c.id} className="flex gap-3 bg-white border border-gray-100 rounded-xl p-3 shadow-sm hover:border-indigo-200 transition">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${meta.color}`}>{meta.icon}</div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span>
                                  <span className="text-[10px] text-gray-400">{c.date?.slice(0, 10)}</span>
                                </div>
                                {c.notes && <p className="text-xs text-gray-700 line-clamp-2 leading-snug">{c.notes}</p>}
                                {c.outcome && <p className="text-[10px] text-emerald-600 mt-0.5 flex items-center gap-1"><CheckCircle size={10} />{c.outcome}</p>}
                                {c.nextFollowUp && <p className="text-[10px] text-orange-600 mt-0.5 flex items-center gap-1"><Clock size={10} />متابعة: {c.nextFollowUp}</p>}
                              </div>
                            </div>
                          );
                        })}
                        {allComms.length > 4 && (
                          <button onClick={() => setActiveTab('communications')}
                            className="w-full py-2 text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-xl border border-dashed border-indigo-200 transition font-semibold">
                            + {allComms.length - 4} تواصل آخر — عرض الكل
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ─── Consultations ─── */}
                  {subConsults.length > 0 && (
                    <div>
                      <p className="font-extrabold text-gray-800 text-sm mb-3 flex items-center gap-2">
                        <Activity size={14} className="text-purple-600" /> الاستشارات ({subConsults.length})
                      </p>
                      <div className="space-y-2">
                        {subConsults.slice(0, 3).map(c => (
                          <div key={c.id} className="border border-gray-100 rounded-xl p-3 bg-white flex items-center justify-between gap-2 shadow-sm">
                            <div>
                              <p className="font-semibold text-sm text-gray-800">{c.therapistName}</p>
                              <p className="text-xs text-gray-500">{c.sessionDate} · {c.sessionType === 'individual' ? 'فردية' : c.sessionType === 'couple' ? 'زوجية' : 'عائلية'}</p>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-[11px] font-bold shrink-0 ${c.status === 'completed' ? 'bg-green-100 text-green-700' : c.status === 'confirmed' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                              {c.status === 'completed' ? 'مكتملة' : c.status === 'confirmed' ? 'مؤكدة' : 'معلقة'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ─── Unified Activity Timeline ─── */}
                  {(() => {
                    type TEvent = { date: string; type: 'payment' | 'comm' | 'enrollment'; title: string; subtitle?: string; color: string; icon: string };
                    const events: TEvent[] = [];
                    // payments
                    subHistory.forEach(p => {
                      events.push({ date: p.at || '', type: 'payment', icon: '💳', color: 'bg-emerald-100 text-emerald-700', title: `${p.amount.toLocaleString()} ${p.currency}`, subtitle: [p.isInstallment ? 'قسط' : 'حجز جديد', p.paymentType === 'course' ? (courses.find(c => c.id === p.courseId)?.title || '') : p.paymentType, p.paymentMethod].filter(Boolean).join(' · ') });
                    });
                    leadPayments.forEach(p => {
                      events.push({ date: p.date || '', type: 'payment', icon: '💰', color: 'bg-blue-100 text-blue-700', title: `${p.amount.toLocaleString()} ${p.currency}`, subtitle: p.note || undefined });
                    });
                    // communications (already shown above — just show in timeline too)
                    allComms.forEach(c => {
                      const cm = commTypeMeta[(c as any).type] || commTypeMeta.note;
                      events.push({ date: c.date || '', type: 'comm', icon: cm.icon, color: `${cm.color}`, title: cm.label, subtitle: (c as any).notes?.slice(0, 80) || undefined });
                    });
                    if (events.length === 0) return null;
                    const sorted = events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
                    return (
                      <div>
                        <p className="font-extrabold text-gray-800 text-sm mb-3 flex items-center gap-2">
                          <Activity size={14} className="text-slate-500" /> سجل النشاط الكامل
                          <span className="text-[10px] text-gray-400 font-normal">({events.length} حدث)</span>
                        </p>
                        <div className="relative">
                          <div className="absolute right-4 top-0 bottom-0 w-px bg-gray-200" />
                          <div className="space-y-3 pr-10">
                            {sorted.map((ev, i) => (
                              <div key={i} className="relative">
                                <div className={`absolute -right-[1.85rem] top-2 w-5 h-5 rounded-full flex items-center justify-center text-xs ${ev.color} border-2 border-white shadow-sm`}>
                                  {ev.icon}
                                </div>
                                <div className={`border rounded-xl px-3 py-2 ${ev.type === 'payment' ? 'border-emerald-100 bg-emerald-50/40' : ev.type === 'enrollment' ? 'border-purple-100 bg-purple-50/40' : 'border-gray-100 bg-white'}`}>
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-bold text-gray-800 leading-tight">{ev.title}</p>
                                      {ev.subtitle && <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">{ev.subtitle}</p>}
                                    </div>
                                    <span className="text-[10px] text-gray-400 whitespace-nowrap flex-shrink-0">{ev.date?.slice(0, 10)}</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                            {events.length > 12 && (
                              <div className="text-xs text-gray-400 text-center py-1">+ {events.length - 12} أحداث أقدم</div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {allComms.length === 0 && !enrolledCourse && (subscriber?.enrolledCourseIds.length || 0) === 0 && (lead?.interestedCourseIds?.length || 0) === 0 && (
                    <div className="text-center py-16 text-gray-400">
                      <Info size={48} className="mx-auto mb-3 text-gray-200" />
                      <p className="text-sm font-semibold">لا توجد بيانات بعد</p>
                      <p className="text-xs mt-1">ابدأ بتسجيل تواصل أو حجز كورس</p>
                    </div>
                  )}
                </div>
              )}

              {/* ══ 💬 التواصل ══ */}
              {activeTab === 'communications' && (
                <CommunicationsTab
                  allComms={allComms as (CommunicationRecord & { _src?: string })[]}
                  clientName={clientName}
                  clientPhone={clientPhone}
                  isSub={isSub}
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
                  {isSub && (
                    <>
                      <button onClick={() => setShowSubPayForm(true)}
                        className="w-full py-3 border-2 border-dashed border-emerald-200 rounded-xl text-emerald-600 hover:bg-emerald-50 text-sm flex items-center justify-center gap-2">
                        <Plus size={18} /> حجز أو دفع جديد
                      </button>
                      {showSubPayForm && subscriber && (
                        <PaymentModal
                          mode="subscriber"
                          subject={{ id: subscriber.id, name: subscriber.name, phone: subscriber.phone, enrolledCourseIds: subscriber.enrolledCourseIds, paymentHistory: subscriber.paymentHistory || [], extraCertificateRequests: subscriber.extraCertificateRequests || [] }}
                          draft={payModalDraft}
                          setDraft={setPayModalDraft}
                          onSubmit={(d) => handlePayModalSubmit(d)}
                          onClose={() => setShowSubPayForm(false)}
                        />
                      )}
                      {/* ── Financial Summary Strip ── */}
                      {subHistory.length > 0 && (
                        <div className="grid grid-cols-3 gap-2 mb-3">
                          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
                            <p className="text-[10px] text-gray-400 mb-0.5">إجمالي مدفوع</p>
                            <p className="text-base font-extrabold text-emerald-700">{subPaidTotals.EGP.toLocaleString()} ج.م</p>
                          </div>
                          <div className={`border rounded-xl p-3 text-center ${subRemainingEGP > 0 ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
                            <p className="text-[10px] text-gray-400 mb-0.5">المتبقي</p>
                            <p className={`text-base font-extrabold ${subRemainingEGP > 0 ? 'text-red-600' : 'text-gray-400'}`}>{subRemainingEGP > 0 ? subRemainingEGP.toLocaleString() + ' ج.م' : '✅'}</p>
                          </div>
                          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
                            <p className="text-[10px] text-gray-400 mb-0.5">معاملات</p>
                            <p className="text-base font-extrabold text-blue-700">{subHistory.length}</p>
                          </div>
                        </div>
                      )}

                      {/* ── Per-course breakdown cards ── */}
                      {bookedCourseIds.length > 0 && (
                        <div className="space-y-2 mb-3">
                          {bookedCourseIds.map(cId => {
                            const course = courses.find(c => c.id === cId);
                            const bm = bookingMap[cId] || { paidEGP: 0 };
                            const expected = bm.expectedEGP || 0;
                            const pct = expected > 0 ? Math.min(100, Math.round((bm.paidEGP / expected) * 100)) : 100;
                            const remaining = expected > 0 ? Math.max(0, expected - bm.paidEGP) : 0;
                            return (
                              <div key={cId} className="bg-white border border-gray-100 rounded-xl px-3 py-2.5 shadow-sm">
                                <div className="flex items-center justify-between mb-1.5 gap-2">
                                  <p className="text-sm font-bold text-gray-800 truncate flex-1">{course?.title || cId}</p>
                                  {remaining > 0
                                    ? <span className="text-xs font-bold text-red-600 shrink-0">متبقي {remaining.toLocaleString()} ج.م</span>
                                    : <span className="text-xs font-bold text-emerald-600 shrink-0">✅ مكتمل</span>}
                                </div>
                                {expected > 0 && (
                                  <>
                                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                      <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                                    </div>
                                    <p className="text-[10px] text-gray-400 mt-0.5">{bm.paidEGP.toLocaleString()} من {expected.toLocaleString()} ج.م ({pct}%)</p>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* ── Transaction History ── */}
                      {confirmedHistory.length > 0 && (
                        <div className="mb-3">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">سجل المعاملات ({confirmedHistory.length})</p>
                          <div className="space-y-2">
                            {[...confirmedHistory].sort((a, b) => {
                              const dc = b.at.localeCompare(a.at);
                              if (dc !== 0) return dc;
                              return confirmedHistory.indexOf(b) - confirmedHistory.indexOf(a);
                            }).map(p => (
                              <div key={p.id} className="group flex items-start justify-between bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 hover:border-gray-200 transition-colors">
                                <div className="space-y-1 min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-extrabold text-emerald-700 text-base">{Number(p.amount).toLocaleString()} {p.currency === 'EGP' ? 'ج.م' : p.currency === 'SAR' ? 'ر.س' : '$'}</span>
                                    {p.paymentType && <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{ptLabels[p.paymentType] || p.paymentType}</span>}
                                    {p.isInstallment === true && <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">💳 قسط</span>}
                                    {p.isInstallment === false && <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">🆕 حجز</span>}
                                  </div>
                                  {(p.itemTitle || p.courseId) && <p className="text-xs text-gray-500 truncate">{p.itemTitle || courses.find(c => c.id === p.courseId)?.title || p.courseId}</p>}
                                  <div className="flex items-center gap-2 flex-wrap text-[10px] text-gray-400">
                                    {p.paymentMethod && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{p.paymentMethod}</span>}
                                    {p.staffName && <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">بواسطة: {p.staffName}</span>}
                                    <span>{p.at?.slice(0, 10)}</span>
                                    {p.transactionId && <span className="italic">#{p.transactionId}</span>}
                                    {p.note && !p.transactionId && <span className="italic">{p.note}</span>}
                                  </div>
                                </div>
                                {/* Action buttons */}
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity mt-1 shrink-0 mr-2">
                                  {/* Print receipt */}
                                  <button
                                    title="طباعة إيصال"
                                    onClick={() => {
                                      const w = window.open('', '_blank', 'width=700,height=900');
                                      if (!w) return;
                                      const courseName = p.itemTitle || courses.find(c => c.id === p.courseId)?.title || '';
                                      w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>إيصال دفع</title><style>body{font-family:Arial,sans-serif;padding:40px;direction:rtl;color:#111}.header{text-align:center;border-bottom:3px solid #d97706;padding-bottom:20px;margin-bottom:30px}h1{color:#d97706;margin:0;font-size:24px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:12px 16px;border:1px solid #e5e7eb;text-align:right}th{background:#fffbeb;font-weight:700}tfoot td{font-weight:700;background:#f0fdf4}.footer{margin-top:40px;text-align:center;color:#888;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px}</style></head><body><div class="header"><h1>معهد الدراسات النفسية</h1><p style="color:#888;font-size:12px">إيصال دفع — ${p.at?.slice(0, 10) || ''}</p></div><h3>العميل: ${clientName}${p.staffName ? ` | بواسطة: ${p.staffName}` : ''}</h3><table><thead><tr><th>الخدمة</th><th>النوع</th><th>وسيلة الدفع</th><th>المبلغ</th></tr></thead><tbody><tr><td>${courseName || ptLabels[p.paymentType || ''] || 'دفعة'}</td><td>${ptLabels[p.paymentType || ''] || '—'}</td><td>${p.paymentMethod || '—'}</td><td>${Number(p.amount).toLocaleString()} ${p.currency || 'EGP'}</td></tr></tbody><tfoot><tr><td colspan="3">الإجمالي</td><td>${Number(p.amount).toLocaleString()} ${p.currency || 'EGP'}</td></tr></tfoot></table>${p.transactionId ? `<p style="margin-top:16px;font-size:12px;color:#888;">رقم المعاملة: ${p.transactionId}</p>` : ''}<div class="footer">معهد الدراسات النفسية — mahadnafsy.com</div></body></html>`);
                                      w.document.close(); setTimeout(() => w.print(), 500);
                                    }}
                                    className="text-amber-500 hover:text-amber-700 hover:bg-amber-50 p-1 rounded-lg transition">
                                    <Printer size={14} />
                                  </button>
                                  {/* Mark as failed - admin only */}
                                  {isAdmin && (
                                    <button
                                      title="تحديد كفشل"
                                      onClick={() => {
                                        if (!window.confirm('هل تريد تحديد هذه الدفعة كـ "فشل"؟')) return;
                                        const updated = subHistory.map(x => x.id === p.id ? { ...x, status: 'failed' as const } : x);
                                        updateSubscriber({ ...subscriber!, paymentHistory: updated });
                                      }}
                                      className="text-orange-400 hover:text-orange-600 hover:bg-orange-50 p-1 rounded-lg transition">
                                      <AlertCircle size={14} />
                                    </button>
                                  )}
                                  {/* Delete - admin only */}
                                  {isAdmin && (
                                    <button
                                      title="حذف الدفعة"
                                      onClick={() => {
                                        if (!window.confirm('هل تريد حذف هذه الدفعة؟ لا يمكن التراجع.')) return;
                                        updateSubscriber({ ...subscriber!, paymentHistory: subHistory.filter(x => x.id !== p.id) });
                                      }}
                                      className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1 rounded-lg transition">
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {confirmedHistory.length === 0 && !showSubPayForm && (
                        <div className="text-center py-10 text-gray-400"><CreditCard size={40} className="mx-auto mb-2 text-gray-200" /><p>لا توجد مدفوعات</p></div>
                      )}

                      {/* ── Payment Proofs (client-uploaded receipts) ── */}
                      {isSub && (
                        <div className="mt-4 border-t border-gray-100 pt-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-gray-700 text-sm">إيصالات التحويل</p>
                              {(() => {
                                const pendingCount = clientProofs.filter(p => p.status === 'PENDING').length;
                                return pendingCount > 0 ? <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{pendingCount} عالق</span> : null;
                              })()}
                            </div>
                            <button onClick={loadClientProofs} className="text-xs text-primary-600 hover:underline flex items-center gap-1">
                              <RefreshCw size={12} /> تحديث
                            </button>
                          </div>
                          {clientProofsLoaded && clientProofs.length === 0 && (
                            <p className="text-xs text-gray-400 text-center py-3">لا توجد إيصالات مرسلة</p>
                          )}
                          {clientProofsLoaded && clientProofs.map(pr => {
                            const isReviewing = reviewingProofId === pr.id;
                            return (
                              <div key={pr.id} className={`rounded-xl border p-3 mb-2 space-y-2 ${pr.status === 'PENDING' ? 'border-amber-200 bg-amber-50/40' : pr.status === 'APPROVED' ? 'border-green-200 bg-green-50/30' : 'border-red-200 bg-red-50/30'}`}>
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div>
                                    <p className="font-extrabold text-gray-800">{pr.amount.toLocaleString()} {pr.currency === 'EGP' ? 'ج.م' : pr.currency === 'SAR' ? 'ر.س' : '$'}</p>
                                    <p className="text-xs text-gray-500">{pr.payment_method} · {pr.submitted_at.slice(0, 10)}{pr.note ? ' · ' + pr.note : ''}</p>
                                    {pr.course_title && <p className="text-xs text-gray-400">الكورس: {pr.course_title}</p>}
                                  </div>
                                  <span className={`font-bold text-[11px] px-2 py-1 rounded-full ${pr.status === 'APPROVED' ? 'bg-green-100 text-green-700' : pr.status === 'REJECTED' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                                    {pr.status === 'APPROVED' ? '✅ مُعتمد' : pr.status === 'REJECTED' ? '❌ مرفوض' : '⏳ قيد المراجعة'}
                                  </span>
                                </div>
                                {pr.status === 'PENDING' && !proofImageUrl[pr.id] && (
                                  <button onClick={() => loadProofImage(pr.id)} className="text-xs text-primary-600 hover:underline">عرض الصورة</button>
                                )}
                                {proofImageUrl[pr.id] && (
                                  <img src={proofImageUrl[pr.id]} alt="receipt" className="max-h-48 rounded-lg object-contain border border-gray-100" />
                                )}
                                {pr.reviewer_note && <p className="text-xs text-gray-500">ملاحظة الإدارة: {pr.reviewer_note}</p>}
                                {pr.status === 'PENDING' && !isReviewing && (
                                  <div className="flex gap-2 pt-1">
                                    <button onClick={() => { setReviewingProofId(pr.id); setReviewerNote(''); }} className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition">قبول ✅</button>
                                    <button onClick={() => { setReviewingProofId(pr.id); setReviewerNote(''); }} className="flex-1 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg transition">رفض ❌</button>
                                  </div>
                                )}
                                {pr.status === 'PENDING' && isReviewing && (
                                  <div className="space-y-2 pt-1">
                                    <input value={reviewerNote} onChange={e => setReviewerNote(e.target.value)}
                                      placeholder="ملاحظة للعميل (اختياري)"
                                      className="w-full border border-gray-200 bg-white rounded-lg px-3 py-1.5 text-xs" />
                                    <div className="flex gap-2">
                                      <button onClick={() => handleReviewProof(pr.id, 'approve')} disabled={reviewLoading}
                                        className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold rounded-lg">
                                        {reviewLoading ? '...' : '✅ قبول واعتماد الدفعة'}
                                      </button>
                                      <button onClick={() => handleReviewProof(pr.id, 'reject')} disabled={reviewLoading}
                                        className="flex-1 py-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-xs font-bold rounded-lg">
                                        {reviewLoading ? '...' : '❌ رفض'}
                                      </button>
                                      <button onClick={() => setReviewingProofId(null)} className="px-3 border border-gray-200 rounded-lg text-xs text-gray-500">إلغاء</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}

                  {/* ── Lead payment form ── */}
                  {!isSub && (
                    <>
                      <button onClick={() => setShowLeadPayForm(true)}
                        className="w-full py-3 border-2 border-dashed border-emerald-200 rounded-xl text-emerald-600 hover:bg-emerald-50 text-sm flex items-center justify-center gap-2">
                        <Plus size={18} /> تسجيل دفعة جديدة
                      </button>
                      {leadPayments.map(p => (
                        <div key={p.id} className="group flex items-start justify-between bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                          <div>
                            <p className="font-bold text-emerald-700">{p.amount.toLocaleString()} {p.currency}</p>
                            <p className="text-xs text-gray-400">{p.date}</p>
                            {p.note && <p className="text-xs text-gray-500 italic">{p.note}</p>}
                          </div>
                          <button onClick={() => lead && updateLead({ ...lead, paymentRecords: leadPayments.filter(x => x.id !== p.id) })}
                            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity mt-1"><Trash2 size={14} /></button>
                        </div>
                      ))}
                      {leadPayments.length === 0 && !showLeadPayForm && (
                        <div className="text-center py-10 text-gray-400"><CreditCard size={40} className="mx-auto mb-2 text-gray-200" /><p>لا توجد مدفوعات</p></div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ══ 🎓 الكورسات ══ */}
              {isSub && activeTab === 'courses' && (
                <CoursesAccessTab
                  subscriber={subscriber!}
                  courses={courses}
                  updateSubscriber={updateSubscriber}
                  showGrantFromCourses={showGrantFromCourses}
                  setShowGrantFromCourses={setShowGrantFromCourses}
                  grantFromCourseId={grantFromCourseId}
                  setGrantFromCourseId={setGrantFromCourseId}
                  getCourseLectures={getCourseLectures}
                  getPreset={getPreset}
                  accessSaving={accessSaving}
                  accessMsg={accessMsg}
                  manualLimitDraft={manualLimitDraft}
                  setManualLimitDraft={setManualLimitDraft}
                  setAccessPresets={setAccessPresets}
                  canManageCourseAccess={canManageCourseAccess}
                  applyAccessLevel={applyAccessLevel}
                  isAdmin={isAdmin}
                />
              )}

              {/* ══ 🏆 الشهادات ══ */}
              {isSub && activeTab === 'certificates' && (
                <CertificatesTab
                  subscriber={subscriber!}
                  subCerts={subCerts}
                  extraReqs={extraReqs}
                  courses={courses}
                  onRequestExtra={() => { setShowExtraCertForm(true); setExtraCertDraft({ courseId: '', type: '', certExpected: '', certPaid: '' }); }}
                  onView={(certId) => setViewCertId(certId)}
                  onDeleteCert={(certId) => updateSubscriber({ ...subscriber!, certificates: subCerts.filter(c => c.id !== certId) })}
                />
              )}

              {/* ══ 📅 الأقساط ══ */}
              {isSub && activeTab === 'installments' && subscriber && (
                <InstallmentsTab
                  subscriber={subscriber}
                  subInstallmentPlans={subInstallmentPlans}
                  courses={courses}
                  todayStr={_todayStr}
                  soon3Str={_soon3Str}
                  instOverdueCount={instOverdueCount}
                  instSoonCount={instSoonCount}
                  setShowInstPlanForm={setShowInstPlanForm}
                  payingEntryKey={payingEntryKey}
                  setPayingEntryKey={setPayingEntryKey}
                  payEntryAmount={payEntryAmount}
                  setPayEntryAmount={setPayEntryAmount}
                  payEntryDate={payEntryDate}
                  setPayEntryDate={setPayEntryDate}
                  updateSubscriber={updateSubscriber}
                  onDeletePlan={handleDeleteInstallmentPlan}
                  onDeleteEntry={handleDeleteInstallmentEntry}
                  onPayEntry={handlePayInstallmentEntry}
                />
              )}

              {/* ══ 🧠 الاستشارات ══ */}
              {activeTab === 'consultations' && subConsults.length > 0 && (
                <ConsultationsTab subConsults={subConsults} />
              )}

              {/* ══ 🗓️ جدول الدقي ══ */}
              {isSub && activeTab === 'daqqi' && subDaqqiRounds.length > 0 && subscriber && (
                <DaqqiRoundsTab subDaqqiRounds={subDaqqiRounds} courses={courses} subscriber={subscriber} />
              )}

              {/* ══ ✏️ تعديل البيانات ══ */}
              {activeTab === 'edit' && (
                <div id="section-edit" className="space-y-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-1 h-5 rounded-full bg-gray-400 flex-shrink-0" />
                    <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-2 flex-1">
                      <Edit2 size={14} className="text-gray-500" /> تعديل بيانات العميل
                    </h3>
                  </div>
                  {isSub ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div><label className="text-xs text-gray-600 mb-1 block">الاسم</label>
                        <input value={subDraft.name} onChange={e => setSubDraft({ ...subDraft, name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                      <div><label className="text-xs text-gray-600 mb-1 block">الهاتف</label>
                        <input value={subDraft.phone} onChange={e => setSubDraft({ ...subDraft, phone: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                      <div><label className="text-xs text-gray-600 mb-1 block">البريد الإلكتروني</label>
                        <input value={subDraft.email} onChange={e => setSubDraft({ ...subDraft, email: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                        <p className="text-[10px] text-amber-600 mt-0.5">⚠️ تغيير الإيميل سيُحدّث بيانات الدخول أيضاً</p>
                      </div>
                      <div><label className="text-xs text-gray-600 mb-1 block">الفرع</label>
                        <select value={subDraft.branch || ''} onChange={e => setSubDraft({ ...subDraft, branch: (e.target.value as BranchType) || undefined })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                          <option value="">— الفرع —</option>
                          {Object.entries(branchLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select></div>
                      <div><label className="text-xs text-gray-600 mb-1 block">🧑‍💼 السيلز / المبيعات</label>
                        <select value={subDraft.assignedSalesId} onChange={e => { const s = salesStaffList.find((x: StaffMember) => x.id === e.target.value); setSubDraft({ ...subDraft, assignedSalesId: e.target.value, assignedSalesName: s?.name || '' }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                          <option value="">— بدون تحديد —</option>
                          {salesStaffList.map((s: StaffMember) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select></div>
                      <div><label className="text-xs text-gray-600 mb-1 block">🎧 خدمة العملاء</label>
                        <select value={subDraft.assignedCsId} onChange={e => { const s = csStaffList.find((x: StaffMember) => x.id === e.target.value); setSubDraft({ ...subDraft, assignedCsId: e.target.value, assignedCsName: s?.name || '' }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                          <option value="">— بدون تحديد —</option>
                          {csStaffList.map((s: StaffMember) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select></div>
                      <div><label className="text-xs text-gray-600 mb-1 block">الخصم (ج.م)</label>
                        <input type="number" min="0" value={subDraft.discount} onChange={e => setSubDraft({ ...subDraft, discount: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                      <div className="sm:col-span-2">
                        <p className="text-xs font-bold text-gray-600 mb-2">💰 المبالغ المتوقعة</p>
                        <div className="grid grid-cols-3 gap-2">
                          {[['expectedEGP','ج.م'],['expectedSAR','ر.س'],['expectedUSD','$']].map(([f,l]) => (
                            <div key={f}><label className="text-[10px] text-gray-400 block mb-0.5">{l}</label>
                              <input type="number" min="0" value={(subDraft as Record<string,string>)[f]} onChange={e => setSubDraft({ ...subDraft, [f]: e.target.value })} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></div>
                          ))}
                        </div>
                      </div>
                      {/* ── Credentials Section (admin + online manager) ── */}
                      {(isAdmin || isOnlineManager) && (
                      <div className="sm:col-span-2 border border-dashed border-indigo-200 rounded-xl p-4 bg-indigo-50/40">
                        <p className="text-xs font-bold text-indigo-700 mb-3 flex items-center gap-1.5">🔐 بيانات الدخول</p>
                        <div className="grid grid-cols-1 gap-3">
                          {/* Current password display */}
                          <div>
                            <label className="text-xs text-gray-600 mb-1 block">كلمة المرور الحالية</label>
                            <div className="relative">
                              <input
                                type={showCurrentPassword ? 'text' : 'password'}
                                readOnly
                                value={currentPasswordLoading ? '...' : (currentPassword ?? '')}
                                placeholder={currentPasswordLoading ? 'جاري التحميل...' : 'لا توجد كلمة مرور مسجّلة'}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700 pr-10"
                              />
                              <button
                                type="button"
                                onClick={() => setShowCurrentPassword(p => !p)}
                                className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-indigo-600 p-1">
                                <Eye size={14} />
                              </button>
                            </div>
                          </div>
                          {/* New password input */}
                          <div>
                            <label className="text-xs text-gray-600 mb-1 block">كلمة المرور الجديدة</label>
                            <div className="relative">
                              <input
                                type={showNewPassword ? 'text' : 'password'}
                                placeholder="اتركه فارغاً إذا لا تريد تغييره"
                                value={credNewPassword}
                                onChange={e => setCredNewPassword(e.target.value)}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm pr-10"
                              />
                              <button
                                type="button"
                                onClick={() => setShowNewPassword(p => !p)}
                                className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-indigo-600 p-1">
                                <Eye size={14} />
                              </button>
                            </div>
                            <p className="text-[10px] text-gray-400 mt-0.5">6 أحرف على الأقل</p>
                          </div>
                        </div>
                        {credMsg && (
                          <div className={`mt-2 text-xs px-3 py-2 rounded-lg ${credMsg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                            {credMsg.text}
                          </div>
                        )}
                        {/* ── Account Diagnostic ── */}
                        {isAdmin && clientEmail && (
                          <div className="mt-3 border-t border-indigo-100 pt-3">
                            <button
                              onClick={async () => {
                                setAccountDiagLoading(true); setAccountDiag(null);
                                try { const r = await mysqlAdmin.checkAccount(clientEmail); setAccountDiag(r); }
                                catch (e: unknown) { setAccountDiag({ error: (e as Error).message }); }
                                finally { setAccountDiagLoading(false); }
                              }}
                              disabled={accountDiagLoading}
                              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 disabled:opacity-50">
                              🔍 {accountDiagLoading ? 'جاري الفحص...' : 'فحص حساب العميل'}
                            </button>
                            {accountDiag && (
                              <div className={`mt-2 text-xs rounded-lg p-3 space-y-1 ${(accountDiag as Record<string,unknown>).error ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-white border border-indigo-100'}`}>
                                {(accountDiag as Record<string,unknown>).error
                                  ? <p>{String((accountDiag as Record<string,unknown>).error)}</p>
                                  : <>
                                    <p className={`font-extrabold ${!(accountDiag as Record<string,unknown>).account ? 'text-red-600' : (accountDiag as Record<string,unknown>).diagnosis === 'الحساب يبدو سليماً' ? 'text-green-700' : 'text-amber-600'}`}>
                                      {String((accountDiag as Record<string,unknown>).diagnosis)}
                                    </p>
                                    {(accountDiag as Record<string,unknown>).account && <p className="text-gray-500">حالة الحساب: is_active = {String(((accountDiag as Record<string,unknown>).account as Record<string,unknown>).is_active)} · has_password = {String(((accountDiag as Record<string,unknown>).account as Record<string,unknown>).has_password)}</p>}
                                    {(accountDiag as Record<string,unknown>).lastOtp && <p className="text-gray-500">آخر OTP: نوع = {String(((accountDiag as Record<string,unknown>).lastOtp as Record<string,unknown>).type)} · مستخدم = {String(((accountDiag as Record<string,unknown>).lastOtp as Record<string,unknown>).used)}</p>}
                                    {(['لا يوجد حساب بهذا البريد', 'الحساب موجود لكن غير مفعّل (is_active=0)'].includes(String((accountDiag as Record<string,unknown>).diagnosis))) && (
                                      <div className="pt-1">
                                        {createAccMsg && (
                                          <p className={`mb-1 font-semibold ${createAccMsg.type === 'success' ? 'text-green-700' : 'text-red-600'}`}>{createAccMsg.text}</p>
                                        )}
                                        <button
                                          onClick={async () => {
                                            if (!clientEmail) return;
                                            setCreateAccLoading(true); setCreateAccMsg(null);
                                            try {
                                              const r = await mysqlAdmin.createAccount({ email: clientEmail, name: subscriber?.name || lead?.name });
                                              setCreateAccMsg({ type: 'success', text: `✅ تم ${(r as Record<string,unknown>).action === 'created' ? 'إنشاء' : 'تفعيل'} الحساب وإرسال كلمة المرور للبريد` });
                                              // Re-run diagnostic to show updated status
                                              const updated = await mysqlAdmin.checkAccount(clientEmail);
                                              setAccountDiag(updated);
                                            } catch (e: unknown) { setCreateAccMsg({ type: 'error', text: (e as Error).message }); }
                                            finally { setCreateAccLoading(false); }
                                          }}
                                          disabled={createAccLoading}
                                          className="px-3 py-1 bg-violet-600 text-white rounded text-xs font-bold hover:bg-violet-700 disabled:opacity-50">
                                          {createAccLoading ? 'جاري الإنشاء...' : (String((accountDiag as Record<string,unknown>).diagnosis).includes('غير مفعّل') ? '🔓 تفعيل الحساب وإرسال كلمة مرور جديدة' : '➕ إنشاء حساب وإرسال كلمة المرور')}
                                        </button>
                                      </div>
                                    )}
                                  </>
                                }
                              </div>
                            )}
                          </div>
                        )}
                        <p className="text-[10px] text-gray-400 mt-2">💡 إذا لم يكن للعميل حساب بعد، سيتم إنشاؤه تلقائياً عند تعيين كلمة مرور.</p>
                      </div>
                      )}
                      <div className="sm:col-span-2 flex gap-2 pt-2">
                        <button onClick={handleSaveSubEdit} disabled={isSaving} className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">{isSaving ? 'جاري الحفظ...' : 'حفظ التعديلات'}</button>
                        <button onClick={() => { setCredMsg(null); setCredNewPassword(''); setShowCurrentPassword(false); setShowNewPassword(false); window.scrollTo({top:0,behavior:'smooth'}); }} className="flex-1 py-2 bg-gray-200 rounded-lg text-sm">إلغاء</button>
                      </div>
                    </div>
                  ) : lead ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {[['name','الاسم','text'],['email','البريد الإلكتروني','email'],['phone','رقم الهاتف','tel'],['source','المصدر','text']].map(([f,l,t]) => (
                        <div key={f}><label className="text-xs text-gray-600 mb-1 block">{l}</label>
                          <input type={t} value={(leadDraft as unknown as Record<string,string>)[f] || ''} onChange={e => setLeadDraft({ ...leadDraft, [f]: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                      ))}
                      <div><label className="text-xs text-gray-600 mb-1 block">الفرع</label>
                        <select value={leadDraft.branch || ''} onChange={e => setLeadDraft({ ...leadDraft, branch: e.target.value as BranchType })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                          <option value="">اختر الفرع</option>
                          {Object.entries(branchLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select></div>
                      <div><label className="text-xs text-gray-600 mb-1 block">الحالة</label>
                        <select value={leadDraft.status} onChange={e => setLeadDraft({ ...leadDraft, status: e.target.value as LeadItem['status'] })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                          {Object.entries(statusLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                        </select></div>
                      <div><label className="text-xs text-gray-600 mb-1 block">درجة الاهتمام</label>
                        <select value={leadDraft.interestLevel || ''} onChange={e => setLeadDraft({ ...leadDraft, interestLevel: e.target.value as LeadItem['interestLevel'] })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                          <option value="">اختر</option><option value="low">منخفض</option><option value="medium">متوسط</option><option value="high">مرتفع</option>
                        </select></div>
                      <div><label className="text-xs text-gray-600 mb-1 block">🧑‍💼 السيلز المسئول</label>
                        <select value={leadDraft.assignedSalesId || ''} onChange={e => { const s = salesStaffList.find((x: StaffMember) => x.id === e.target.value); setLeadDraft({ ...leadDraft, assignedSalesId: e.target.value, assignedSalesName: s?.name || '' }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                          <option value="">بدون تحديد</option>
                          {salesStaffList.map((s: StaffMember) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select></div>
                      <div><label className="text-xs text-gray-600 mb-1 block">🎧 خدمة العملاء</label>
                        <select value={leadDraft.assignedCsId || ''} onChange={e => { const s = csStaffList.find((x: StaffMember) => x.id === e.target.value); setLeadDraft({ ...leadDraft, assignedCsId: e.target.value, assignedCsName: s?.name || '' }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                          <option value="">— بدون تحديد —</option>
                          {csStaffList.map((s: StaffMember) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select></div>
                      <div><label className="text-xs text-gray-600 mb-1 block">الكورس</label>
                        <select value={leadDraft.enrolledCourseId || ''} onChange={e => setLeadDraft({ ...leadDraft, enrolledCourseId: e.target.value || undefined })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                          <option value="">بدون تحديد</option>
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
                        </select></div>
                      <div><label className="text-xs text-gray-600 mb-1 block">موعد المتابعة</label>
                        <input type="date" value={leadDraft.nextFollowUpDate || ''} onChange={e => setLeadDraft({ ...leadDraft, nextFollowUpDate: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                      <div className="sm:col-span-2 flex gap-2 pt-2">
                        <button onClick={handleSaveLeadEdit} disabled={isSaving} className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">حفظ التعديلات</button>
                        <button onClick={() => window.scrollTo({top:0,behavior:'smooth'})} className="flex-1 py-2 bg-gray-200 rounded-lg text-sm">إلغاء</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

            </div>
          </div>
        </div>
      </div>

      {/* ══ Access Control Modal (صلاحية الفيديوهات) ══ */}
      {showAccessModal && isSub && canManageCourseAccess && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowAccessModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()} dir="rtl">
            {/* header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
                  <Shield size={18} className="text-violet-600" />
                </div>
                <div>
                  <h2 className="font-extrabold text-gray-900 text-base">صلاحية الفيديوهات</h2>
                  <p className="text-xs text-gray-400">{subscriber!.name} — {subscriber!.enrolledCourseIds.length} كورس مسجّل</p>
                </div>
              </div>
              <button onClick={() => setShowAccessModal(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition">
                <X size={16} />
              </button>
            </div>
            {/* body */}
            <div className="overflow-y-auto p-5 space-y-4">
              {subscriber!.enrolledCourseIds.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <BookOpen size={40} className="mx-auto mb-3 text-gray-200" />
                  <p className="text-sm">لا يوجد كورسات مسجّلة</p>
                </div>
              ) : subscriber!.enrolledCourseIds.map(courseId => {
                const course = courses.find(c => c.id === courseId);
                const access = normalizeAccess(subscriber!.courseAccess?.[courseId]);
                const totalLec = getCourseLectures(courseId).length;
                const watched = Number(subscriber!.lectureProgress?.[courseId]) || 0;
                const pct = totalLec > 0 ? Math.round((watched / totalLec) * 100) : 0;
                const saving = accessSaving[courseId] ?? false;
                const msg = accessMsg[courseId];
                const preset = getPreset(courseId);
                const curManual = manualLimitDraft[courseId] ?? String(access.lectureLimit || preset.p1);
                const accessBadge = access.mode === 'full'
                  ? { label: 'وصول كامل', cls: 'bg-green-100 text-green-700' }
                  : access.mode === 'preview'
                  ? { label: 'غير مفعّل', cls: 'bg-gray-100 text-gray-500' }
                  : { label: `محدود — ${access.lectureLimit || 1} فيديو`, cls: 'bg-blue-100 text-blue-700' };
                return (
                  <div key={courseId} className="border border-gray-200 rounded-2xl p-4 bg-gray-50/50">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <p className="font-bold text-gray-800 text-sm leading-tight flex-1">{course?.title || courseId}</p>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${accessBadge.cls}`}>{accessBadge.label}</span>
                    </div>
                    {/* Progress bar */}
                    {totalLec > 0 && (
                      <div className="mb-3">
                        <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                          <span>التقدم</span>
                          <span>{watched} / {totalLec} فيديو ({pct}%)</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div className={`h-1.5 rounded-full transition-all ${pct >= 80 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-blue-400'}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                    {/* Access controls */}
                    <div className="space-y-2">
                      <p className="text-[11px] text-gray-400 font-semibold">تغيير الصلاحية:</p>
                      <div className="flex flex-wrap gap-2 items-center">
                        {/* Preset مقدم */}
                        <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                          <button disabled={saving} onClick={() => applyAccessLevel(courseId, 'limited', preset.p1)}
                            className={`text-xs font-bold text-amber-700 hover:text-amber-900 transition disabled:opacity-50 ${access.mode === 'limited' && access.lectureLimit === preset.p1 ? 'underline' : ''}`}>
                            مقدم
                          </button>
                          <input type="number" min={1} value={preset.p1}
                            onChange={e => setAccessPresets(p => ({ ...p, [courseId]: { ...getPreset(courseId), p1: Number(e.target.value) || 1 } }))}
                            className="w-10 text-xs text-center border border-amber-200 rounded px-1 py-0.5 focus:outline-none bg-white" />
                          <span className="text-[10px] text-amber-500">فيديو</span>
                        </div>
                        {/* Preset قسط */}
                        <div className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5">
                          <button disabled={saving} onClick={() => applyAccessLevel(courseId, 'limited', preset.p2)}
                            className={`text-xs font-bold text-blue-700 hover:text-blue-900 transition disabled:opacity-50 ${access.mode === 'limited' && access.lectureLimit === preset.p2 ? 'underline' : ''}`}>
                            +قسط
                          </button>
                          <input type="number" min={1} value={preset.p2}
                            onChange={e => setAccessPresets(p => ({ ...p, [courseId]: { ...getPreset(courseId), p2: Number(e.target.value) || 1 } }))}
                            className="w-10 text-xs text-center border border-blue-200 rounded px-1 py-0.5 focus:outline-none bg-white" />
                          <span className="text-[10px] text-blue-500">فيديو</span>
                        </div>
                        {/* Full access */}
                        <button disabled={saving} onClick={() => applyAccessLevel(courseId, 'full')}
                          className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition disabled:opacity-50 ${access.mode === 'full' ? 'bg-green-600 text-white border-green-600' : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'}`}>
                          ✅ فتح كامل
                        </button>
                      </div>
                      {/* Manual input */}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-500">تحديد يدوي:</span>
                        <input type="number" min={1} value={curManual}
                          onChange={e => setManualLimitDraft(p => ({ ...p, [courseId]: e.target.value }))}
                          className="w-16 text-sm text-center border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-violet-300" />
                        <span className="text-[11px] text-gray-500">فيديو</span>
                        <button disabled={saving} onClick={() => applyAccessLevel(courseId, 'limited', Math.max(1, Number(curManual) || 1))}
                          className="px-3 py-1 text-xs font-bold bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition disabled:opacity-50">
                          حفظ
                        </button>
                      </div>
                      {saving && <span className="text-[11px] text-gray-400 animate-pulse">جارٍ الحفظ...</span>}
                      {msg?.text && <span className={`text-[11px] font-semibold ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

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

      {/* ══ Extra Certificate Request Modal ══ */}
      {showExtraCertForm && isSub && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowExtraCertForm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" dir="rtl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-lg shadow">🏆</div>
                <div>
                  <p className="font-extrabold text-gray-900 text-sm">طلب شهادة إضافية</p>
                  <p className="text-[11px] text-gray-400">{clientName}</p>
                </div>
              </div>
              <button onClick={() => setShowExtraCertForm(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs text-gray-600 mb-1.5 block font-medium">الكورس</label>
                <select value={extraCertDraft.courseId}
                  onChange={e => setExtraCertDraft({ ...extraCertDraft, courseId: e.target.value })}
                  className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm">
                  <option value="">— اختر الكورس —</option>
                  {subscriber!.enrolledCourseIds.map(cId => {
                    const ec = courses.find(x => x.id === cId);
                    return <option key={cId} value={cId}>{ec?.title || cId}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1.5 block font-medium">نوع الشهادة</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(Object.entries(EXTRA_TYPE_LABELS) as [ExtraCertificateType, string][]).map(([val, label]) => (
                    <button key={val} onClick={() => setExtraCertDraft({ ...extraCertDraft, type: val })}
                      className={`py-1.5 px-2 rounded-lg text-xs font-medium border transition text-right ${extraCertDraft.type === val ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-bold shadow-sm' : 'border-gray-200 bg-white text-gray-600 hover:border-emerald-200'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">سعر الشهادة (اختياري)</label>
                  <input type="number" min="0" placeholder="0 ج.م" value={extraCertDraft.certExpected}
                    onChange={e => setExtraCertDraft({ ...extraCertDraft, certExpected: e.target.value })}
                    className="w-full border border-gray-200 bg-white rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">مدفوع منها (اختياري)</label>
                  <input type="number" min="0" placeholder="0 ج.م" value={extraCertDraft.certPaid}
                    onChange={e => setExtraCertDraft({ ...extraCertDraft, certPaid: e.target.value })}
                    className="w-full border border-gray-200 bg-white rounded-lg px-2 py-1.5 text-sm" />
                </div>
              </div>
              {extraCertDraft.certExpected && Number(extraCertDraft.certExpected) > 0 && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs flex items-center justify-between">
                  <span className="text-blue-600">متبقي</span>
                  <span className="font-extrabold text-red-600">{Math.max(0, Number(extraCertDraft.certExpected) - Number(extraCertDraft.certPaid || 0)).toLocaleString()} ج.م</span>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={handleAddExtraCertRequest}
                  disabled={!extraCertDraft.courseId || !extraCertDraft.type}
                  className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-40">
                  💾 إضافة الطلب
                </button>
                <button onClick={() => setShowExtraCertForm(false)}
                  className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ Legacy Payment Modal (مدفوع قديم) ══ */}
      {showLegacyPayForm && isSub && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowLegacyPayForm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" dir="rtl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white shadow">
                  <Clock size={18} />
                </div>
                <div>
                  <p className="font-extrabold text-gray-900 text-sm">تسجيل مدفوع قديم</p>
                  <p className="text-[11px] text-gray-400">{clientName}</p>
                </div>
              </div>
              <button onClick={() => setShowLegacyPayForm(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
                لتسجيل عميل قديم سبق أن دفع قبل النظام الحالي
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">الكورس *</label>
                <select value={legacyPayDraft.courseId} onChange={e => setLegacyPayDraft({ ...legacyPayDraft, courseId: e.target.value })}
                  className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm">
                  <option value="">— اختر الكورس —</option>
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
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">سعر الكورس الكامل *</label>
                  <input type="number" min="0" placeholder="مثال: 3000" value={legacyPayDraft.courseExpected}
                    onChange={e => setLegacyPayDraft({ ...legacyPayDraft, courseExpected: e.target.value })}
                    className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">المبلغ المدفوع *</label>
                  <input type="number" min="0" placeholder="مثال: 2000" value={legacyPayDraft.amountPaid}
                    onChange={e => setLegacyPayDraft({ ...legacyPayDraft, amountPaid: e.target.value })}
                    className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              {legacyPayDraft.courseExpected && legacyPayDraft.amountPaid && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs flex items-center justify-between">
                  <span className="text-blue-600">متبقي</span>
                  <span className="font-extrabold text-red-600">
                    {Math.max(0, Number(legacyPayDraft.courseExpected) - Number(legacyPayDraft.amountPaid)).toLocaleString()} ج.م
                  </span>
                </div>
              )}
              <div>
                <label className="text-xs text-gray-600 mb-1 block">ملاحظة (اختياري)</label>
                <input value={legacyPayDraft.note} onChange={e => setLegacyPayDraft({ ...legacyPayDraft, note: e.target.value })}
                  placeholder="مثال: دفع نقدي قبل النظام"
                  className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={handleAddLegacyPayment}
                  disabled={!legacyPayDraft.courseId || !legacyPayDraft.courseExpected || !legacyPayDraft.amountPaid}
                  className="flex-1 py-2.5 bg-amber-600 text-white rounded-xl text-sm font-bold hover:bg-amber-700 disabled:opacity-40">
                  💾 تسجيل المدفوع
                </button>
                <button onClick={() => setShowLegacyPayForm(false)}
                  className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ Certificate View Modal ══ */}
      {viewCertId && isSub && (() => {
        const cert = subCerts.find(c => c.id === viewCertId);
        if (!cert) return null;
        const certCourse = courses.find(c => c.id === cert.courseId);
        return (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setViewCertId(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" dir="rtl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-lg shadow">🏆</div>
                  <div>
                    <p className="font-extrabold text-gray-900 text-sm">شهادة إتمام الكورس</p>
                    <p className="text-[11px] text-gray-400">{clientName}</p>
                  </div>
                </div>
                <button onClick={() => setViewCertId(null)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-4">
                <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-5 text-center space-y-3">
                  <div className="text-4xl">🏆</div>
                  <div>
                    <p className="font-extrabold text-gray-900 text-lg">{subscriber!.name}</p>
                    <p className="text-sm text-gray-500 mt-1">أتمّ بنجاح كورس</p>
                    <p className="font-bold text-amber-700 text-base mt-1">{certCourse?.title || cert.courseId}</p>
                  </div>
                  <div className="pt-2 border-t border-amber-200 space-y-1">
                    <p className="text-xs text-gray-500">رقم الشهادة</p>
                    <p className="font-mono font-bold text-gray-800 text-sm bg-white border border-amber-200 rounded-lg px-3 py-1.5 inline-block">{cert.certificateNumber}</p>
                  </div>
                  <p className="text-xs text-gray-400">صدرت في {cert.issuedAt}</p>
                </div>
                <button onClick={() => window.print()} className="w-full py-2.5 bg-gray-800 text-white rounded-xl text-sm font-bold hover:bg-gray-700 flex items-center justify-center gap-2">
                  <Printer size={16} /> طباعة الشهادة
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══ Payment Detail Modal ══ */}
      {showPayDetailModal && isSub && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowPayDetailModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" dir="rtl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow">
                  <CreditCard size={18} />
                </div>
                <div>
                  <p className="font-extrabold text-gray-900 text-sm">التفاصيل المالية</p>
                  <p className="text-[11px] text-gray-400">{clientName}</p>
                </div>
              </div>
              <button onClick={() => setShowPayDetailModal(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"><X size={16} /></button>
            </div>
            <div className="overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                {subPaidTotals.EGP > 0 && (
                  <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                    <p className="font-extrabold text-emerald-700 text-base">{subPaidTotals.EGP.toLocaleString()}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">مدفوع ج.م</p>
                  </div>
                )}
                {subRemainingEGP > 0 && (
                  <div className="bg-red-50 rounded-xl p-3 border border-red-100">
                    <p className="font-extrabold text-red-600 text-base">{subRemainingEGP.toLocaleString()}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">متبقي ج.م</p>
                  </div>
                )}
                {subPaidTotals.SAR > 0 && (
                  <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                    <p className="font-extrabold text-blue-700 text-base">{subPaidTotals.SAR.toLocaleString()}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">مدفوع ر.س</p>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-extrabold text-gray-500 uppercase tracking-wider">تفاصيل كل كورس</p>
                {subscriber!.enrolledCourseIds.map(cId => {
                  const course = courses.find(x => x.id === cId);
                  const bm = bookingMap[cId];
                  const remaining = bm?.expectedEGP != null ? Math.max(0, bm.expectedEGP - bm.paidEGP) : null;
                  return (
                    <div key={cId} className="bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                      <p className="font-bold text-gray-800 text-sm mb-2">{course?.title || cId}</p>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        {bm?.expectedEGP != null && (
                          <div>
                            <p className="text-gray-400">السعر</p>
                            <p className="font-bold text-gray-700">{bm.expectedEGP.toLocaleString()}</p>
                          </div>
                        )}
                        {bm && (
                          <div>
                            <p className="text-gray-400">مدفوع</p>
                            <p className="font-bold text-emerald-700">{bm.paidEGP.toLocaleString()}</p>
                          </div>
                        )}
                        {remaining !== null && (
                          <div>
                            <p className="text-gray-400">متبقي</p>
                            <p className={`font-bold ${remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>{remaining > 0 ? remaining.toLocaleString() : '✅'}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {confirmedHistory.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-extrabold text-gray-500 uppercase tracking-wider">سجل المدفوعات ({confirmedHistory.length})</p>
                  {confirmedHistory.slice().reverse().map((p, i) => (
                    <div key={i} className="flex items-center justify-between bg-white border border-gray-100 rounded-xl px-3 py-2.5">
                      <div>
                        <p className="text-xs font-bold text-gray-800">{p.amount.toLocaleString()} {p.currency === 'SAR' ? 'ر.س' : p.currency === 'USD' ? '$' : 'ج.م'}</p>
                        {p.note && <p className="text-[11px] text-gray-400 mt-0.5">{p.note}</p>}
                      </div>
                      <p className="text-[11px] text-gray-400">{p.at || ''}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default UnifiedClientPage;
