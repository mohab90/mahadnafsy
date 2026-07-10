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
import { useSiteData } from '../context/SiteDataContext';
import { mysqlAdmin, mysqlClient } from '../lib/mysqlapi';
import { useCourseAccess } from './unifiedClient/useCourseAccess';
import { useClientProofs } from './unifiedClient/useClientProofs';
import { useInstallmentPlans } from './unifiedClient/useInstallmentPlans';
import { useSubscriberQuickActions } from './unifiedClient/useSubscriberQuickActions';
import { useCommunicationLog } from './unifiedClient/useCommunicationLog';
import PaymentModal, { PaymentDraft, blankPaymentDraft } from '../components/PaymentModal';
import {
  LeadItem, SubscriberItem, CommunicationRecord,
  PaymentRecord, BranchType, StaffMember,
  ExtraCertificateRequest, ExtraCertificateType,
  UserSessionData, PaymentHistoryEntry,
} from '../types';

// ─── Constants + pure helpers live in a colocated module ───────────────────────
import { generatePromoCode } from './unifiedClient.constants';
import { ClientHeroHeader } from './unified-client-sections/ClientHeroHeader';
import { ClientSidebar } from './unified-client-sections/ClientSidebar';
import { ClientTabsNav } from './unified-client-sections/ClientTabsNav';
import { ClientTabContent } from './unified-client-sections/ClientTabContent';
import { ClientModalsGroup } from './unified-client-sections/ClientModalsGroup';

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

  // ── communications + contact popup → ./unifiedClient/useCommunicationLog ────
  const {
    showAddComm, setShowAddComm, newComm, setNewComm,
    showContactPopup, setShowContactPopup, contactPopupDraft, setContactPopupDraft,
    handleSaveComm, handleSaveContactPopup, handleDeleteComm,
  } = useCommunicationLog({ lead, subscriber, isSaving, setIsSaving });

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

  // ── grant / extra-cert / legacy-payment forms → ./unifiedClient/useSubscriberQuickActions ──
  const {
    showGrantForm, setShowGrantForm, grantDraft, setGrantDraft, handleGrant,
    showExtraCertForm, setShowExtraCertForm, extraCertDraft, setExtraCertDraft, handleAddExtraCertRequest,
    showLegacyPayForm, setShowLegacyPayForm, legacyPayDraft, setLegacyPayDraft, handleAddLegacyPayment,
  } = useSubscriberQuickActions(subscriber);

  // ── convert to subscriber ──────────────────────────────────────────────────
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertCourseId, setConvertCourseId] = useState(lead?.enrolledCourseId || '');
  const [convertAccessMode, setConvertAccessMode] = useState<'full' | 'limited'>('full');
  const [convertPartialCount, setConvertPartialCount] = useState(1);

  // (contact-popup state moved into useCommunicationLog above)
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

  // ── course access level editing → ./unifiedClient/useCourseAccess (names unchanged) ──
  const {
    accessSaving, setAccessSaving, accessMsg, setAccessMsg,
    accessPresets, setAccessPresets, getPreset,
    manualLimitDraft, setManualLimitDraft, applyAccessLevel,
  } = useCourseAccess(subscriber);

  // ── show grant form from courses tab ────────────────────────────────────────
  const [showGrantFromCourses, setShowGrantFromCourses] = useState(false);
  const [grantFromCourseId, setGrantFromCourseId] = useState('');

  // ── promo code ────────────────────────────────────────────────────────────
  const [promoCopied, setPromoCopied] = useState(false);

  // ── cert view ─────────────────────────────────────────────────────────────
  const [viewCertId, setViewCertId] = useState<string | null>(null);

  // ── per-course pay detail popup ───────────────────────────────────────────
  const [showPayDetailModal, setShowPayDetailModal] = useState(false);

  // (extra-cert + legacy-payment form state moved into useSubscriberQuickActions above)

  // ── installment plans → ./unifiedClient/useInstallmentPlans (called below,
  //    after getInstBookingInfo is defined, since the hook needs it injected) ──

  // ── payment proofs → ./unifiedClient/useClientProofs (names unchanged) ──────
  const {
    clientProofs, setClientProofs, clientProofsLoaded, setClientProofsLoaded,
    reviewingProofId, setReviewingProofId, reviewerNote, setReviewerNote,
    proofImageUrl, setProofImageUrl, reviewLoading, setReviewLoading,
    loadClientProofs, loadProofImage, handleReviewProof,
  } = useClientProofs(subscriber, isSub);

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

  // handleSaveComm / handleSaveContactPopup / handleDeleteComm → useCommunicationLog

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

  // handleGrant / handleAddExtraCertRequest / handleAddLegacyPayment → useSubscriberQuickActions

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
        createdAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
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

  // Installment-plan state + handlers (needs getInstBookingInfo, defined above).
  const {
    showInstPlanForm, setShowInstPlanForm, instPlanDraft, setInstPlanDraft,
    payingEntryKey, setPayingEntryKey, payEntryAmount, setPayEntryAmount,
    payEntryDate, setPayEntryDate,
    handleCreateInstallmentPlan, handlePayInstallmentEntry,
    handleDeleteInstallmentPlan, handleDeleteInstallmentEntry,
  } = useInstallmentPlans(subscriber, getInstBookingInfo);

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

      <ClientHeroHeader
        navigate={navigate}
        isSub={isSub}
        subscriber={subscriber}
        lead={lead}
        clientName={clientName}
        clientPhone={clientPhone}
        clientEmail={clientEmail}
        clientCode={clientCode}
        clientBranch={clientBranch}
        codeCopied={codeCopied}
        setCodeCopied={setCodeCopied}
        allCommsCount={allComms.length}
        heroPaidEGP={heroPaidEGP}
        heroCourseCount={heroCourseCount}
        lastCommDate={lastCommDate}
        linkedSub={linkedSub}
        isAdmin={isAdmin}
        canManageCourseAccess={canManageCourseAccess}
        instOverdueCount={instOverdueCount}
        setShowConvertModal={setShowConvertModal}
        setShowAddComm={setShowAddComm}
        setShowInstPlanForm={setShowInstPlanForm}
        setShowExtraCertForm={setShowExtraCertForm}
        setExtraCertDraft={setExtraCertDraft}
        setShowAccessModal={setShowAccessModal}
        setEditing={setEditing}
        setActiveTab={setActiveTab}
        updateSubscriber={updateSubscriber}
        deleteSubscriber={deleteSubscriber}
        deleteLead={deleteLead}
      />

      {/* ══ Body: sidebar + main ══ */}
      <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col lg:flex-row gap-6">

        <ClientSidebar
          navigate={navigate}
          isSub={isSub}
          subscriber={subscriber}
          lead={lead}
          linkedLead={linkedLead}
          linkedSub={linkedSub}
          clientName={clientName}
          clientPhone={clientPhone}
          clientEmail={clientEmail}
          clientBranch={clientBranch}
          courses={courses}
          getCourseLectures={getCourseLectures}
          sessionData={sessionData}
          allComms={allComms}
          subPaidTotals={subPaidTotals}
          subRemainingEGP={subRemainingEGP}
          bookingMap={bookingMap}
          subInstallmentPlans={subInstallmentPlans}
          instOverdueCount={instOverdueCount}
          instSoonCount={instSoonCount}
          todayStr={_todayStr}
          subCerts={subCerts}
          extraReqs={extraReqs}
          enrolledCourse={enrolledCourse}
          leadPaidEGP={leadPaidEGP}
          leadRemaining={leadRemaining}
          discountBase={discountBase}
          quickNote={quickNote}
          saveQuickNote={saveQuickNote}
          promoCopied={promoCopied}
          setPromoCopied={setPromoCopied}
          handleGeneratePromo={handleGeneratePromo}
          isAdmin={isAdmin}
          editing={editing}
          setEditing={setEditing}
          setActiveTab={setActiveTab}
          setShowAddComm={setShowAddComm}
          setShowSubPayForm={setShowSubPayForm}
          setShowLeadPayForm={setShowLeadPayForm}
          setShowGrantForm={setShowGrantForm}
          setGrantDraft={setGrantDraft}
          setShowLegacyPayForm={setShowLegacyPayForm}
          setShowExtraCertForm={setShowExtraCertForm}
          setExtraCertDraft={setExtraCertDraft}
          setShowInstPlanForm={setShowInstPlanForm}
          setShowPayDetailModal={setShowPayDetailModal}
          updateSubscriber={updateSubscriber}
        />

        {/* ════════ MAIN CONTENT ════════ */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100">

            <ClientTabsNav tabs={tabs} activeTab={activeTab} setActiveTab={setActiveTab} />

            <ClientTabContent
              activeTab={activeTab}
              isSub={isSub}
              subConsultsCount={subConsults.length}
              subDaqqiRoundsCount={subDaqqiRounds.length}
              overview={{
                isSub, subscriber, lead,
                allComms: allComms as (CommunicationRecord & { _src?: string })[],
                getCourseLectures, subInstallmentPlans, todayStr: _todayStr,
                leadPayments, courses, bundles, leadPaidEGP, leadRemaining,
                bookingMap, subCerts, enrolledCourse, subConsults, subHistory,
                setActiveTab,
              }}
              communications={{
                allComms: allComms as (CommunicationRecord & { _src?: string })[],
                clientName, clientPhone, isSub,
                onAdd: () => setShowAddComm(true),
                onDelete: handleDeleteComm,
              }}
              payments={{
                isSub, subscriber, lead, subHistory, confirmedHistory, leadPayments,
                courses, clientName, isAdmin, subPaidTotals, subRemainingEGP,
                bookedCourseIds, bookingMap, clientProofs, clientProofsLoaded,
                proofImageUrl, reviewingProofId, setReviewingProofId, reviewerNote,
                setReviewerNote, reviewLoading, showSubPayForm, setShowSubPayForm,
                payModalDraft, setPayModalDraft, showLeadPayForm, setShowLeadPayForm,
                onPayModalSubmit: handlePayModalSubmit, updateSubscriber, updateLead,
                loadClientProofs, loadProofImage, onReviewProof: handleReviewProof,
              }}
              courses={{
                subscriber: subscriber!, courses, updateSubscriber,
                showGrantFromCourses, setShowGrantFromCourses, grantFromCourseId,
                setGrantFromCourseId, getCourseLectures, getPreset, accessSaving,
                accessMsg, manualLimitDraft, setManualLimitDraft, setAccessPresets,
                canManageCourseAccess, applyAccessLevel, isAdmin,
              }}
              certificates={{
                subscriber: subscriber!, subCerts, extraReqs, courses,
                onRequestExtra: () => { setShowExtraCertForm(true); setExtraCertDraft({ courseId: '', type: '', certExpected: '', certPaid: '' }); },
                onView: (certId) => setViewCertId(certId),
                onDeleteCert: (certId) => updateSubscriber({ ...subscriber!, certificates: subCerts.filter(c => c.id !== certId) }),
              }}
              installments={{
                subscriber: subscriber!, subInstallmentPlans, courses, todayStr: _todayStr,
                soon3Str: _soon3Str, instOverdueCount, instSoonCount, setShowInstPlanForm,
                payingEntryKey, setPayingEntryKey, payEntryAmount, setPayEntryAmount,
                payEntryDate, setPayEntryDate, updateSubscriber,
                onDeletePlan: handleDeleteInstallmentPlan,
                onDeleteEntry: handleDeleteInstallmentEntry,
                onPayEntry: handlePayInstallmentEntry,
              }}
              consultations={{ subConsults }}
              daqqi={{ subDaqqiRounds, courses, subscriber: subscriber! }}
              edit={{
                isSub, subscriber, lead, subDraft, setSubDraft, leadDraft, setLeadDraft,
                salesStaffList, csStaffList, courses, bundles, isAdmin, isOnlineManager,
                currentPassword, currentPasswordLoading, showCurrentPassword,
                setShowCurrentPassword, credNewPassword, setCredNewPassword,
                showNewPassword, setShowNewPassword, credMsg, setCredMsg, clientEmail,
                accountDiag, setAccountDiag, accountDiagLoading, setAccountDiagLoading,
                createAccMsg, setCreateAccMsg, createAccLoading, setCreateAccLoading,
                isSaving, onSaveSub: handleSaveSubEdit, onSaveLead: handleSaveLeadEdit,
              }}
            />
          </div>
        </div>
      </div>

      <ClientModalsGroup
        isSub={isSub}
        showAccessModal={showAccessModal}
        canManageCourseAccess={canManageCourseAccess}
        accessControlProps={subscriber ? {
          subscriber, courses, getCourseLectures, accessSaving, accessMsg,
          manualLimitDraft, setManualLimitDraft, getPreset, setAccessPresets,
          applyAccessLevel, onClose: () => setShowAccessModal(false),
        } : null}
        showContactPopup={showContactPopup}
        contactPopupProps={{
          draft: contactPopupDraft, setDraft: setContactPopupDraft,
          isLead: !isSub && !!lead, isSaving, onSave: handleSaveContactPopup,
          onClose: () => setShowContactPopup(false),
        }}
        showConvertModal={showConvertModal}
        hasLead={!!lead}
        convertProps={{
          courses, bundles, convertCourseId, setConvertCourseId,
          convertAccessMode, setConvertAccessMode, convertPartialCount,
          setConvertPartialCount, isSaving, onConvert: handleConvert,
          onClose: () => setShowConvertModal(false),
        }}
        showGrantForm={showGrantForm}
        grantProps={subscriber ? {
          subscriber, courses, bundles, grantDraft, setGrantDraft,
          onGrant: handleGrant, onClose: () => setShowGrantForm(false),
        } : null}
        showInstPlanForm={showInstPlanForm}
        instPlanProps={subscriber ? {
          subscriber, clientName, bundles, courses, instPlanDraft, setInstPlanDraft,
          getInstBookingInfo, onCreate: handleCreateInstallmentPlan,
          onClose: () => setShowInstPlanForm(false),
        } : null}
        showAddComm={showAddComm}
        addCommProps={{
          clientName, newComm, setNewComm, isSaving, onSave: handleSaveComm,
          onClose: () => setShowAddComm(false),
        }}
        showLeadPayForm={showLeadPayForm}
        leadPaymentProps={{
          clientName, leadPayDraft, setLeadPayDraft, courses, bundles,
          onSave: handleAddLeadPayment, onClose: () => setShowLeadPayForm(false),
        }}
        showExtraCertForm={showExtraCertForm}
        extraCertProps={subscriber ? {
          clientName, subscriber, courses, extraCertDraft, setExtraCertDraft,
          onSave: handleAddExtraCertRequest, onClose: () => setShowExtraCertForm(false),
        } : null}
        showLegacyPayForm={showLegacyPayForm}
        legacyPaymentProps={{
          clientName, legacyPayDraft, setLegacyPayDraft, courses, bundles,
          onSave: handleAddLegacyPayment, onClose: () => setShowLegacyPayForm(false),
        }}
        viewCertId={viewCertId}
        certificateViewProps={subscriber ? {
          viewCertId: viewCertId!, subCerts, courses, subscriberName: subscriber.name,
          clientName, onClose: () => setViewCertId(null),
        } : null}
        showPayDetailModal={showPayDetailModal}
        paymentDetailProps={subscriber ? {
          clientName, subscriber, courses, subPaidTotals, subRemainingEGP,
          bookingMap, confirmedHistory, onClose: () => setShowPayDetailModal(false),
        } : null}
      />

    </div>
  );
}

export default UnifiedClientPage;
