/**
 * UnifiedClientPage — ONE page for ALL clients (leads + subscribers)
 * URL: /client/:code  (stable, never changes even after conversion)
 *
 * Layout:
 *   LEFT sidebar  → full client data + actions (edit / pay / grant / contact / convert)
 *   RIGHT main    → overview tab first, then contextual tabs
 */
import React, { useState } from 'react';
import { useBranches } from '../hooks/useBranches';
import { useNavigate } from 'react-router-dom';
import {
  
  CreditCard, 
} from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { useUnifiedClientActiveTab, type UnifiedClientTab } from './unified-client/useUnifiedClientActiveTab';
import { buildUnifiedClientTabs, UnifiedClientTabs } from './unified-client/UnifiedClientTabs';
import { useUnifiedClientPaymentProofs } from './unified-client/useUnifiedClientPaymentProofs';
import { useUnifiedClientPermissions } from './unified-client/useUnifiedClientPermissions';
import { useUnifiedClientEditState } from './unified-client/useUnifiedClientEditState';
import { useUnifiedClientCommunications } from './unified-client/useUnifiedClientCommunications';
import { useUnifiedClientCourseAccess } from './unified-client/useUnifiedClientCourseAccess';
import { useUnifiedClientPayments } from './unified-client/useUnifiedClientPayments';
import { useUnifiedClientLifecycleActions } from './unified-client/useUnifiedClientLifecycleActions';
import { UnifiedClientHeroHeader } from './unified-client/UnifiedClientHeroHeader';
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
  LeadItem, SubscriberItem, CommunicationRecord,
  UserSessionData,
} from '../types';
import { useToast } from '../../shared/ui/Toast';

const UnifiedClientCertificatesPanel = React.lazy(() => import('./unified-client/UnifiedClientCertificatesPanel').then(module => ({ default: module.UnifiedClientCertificatesPanel })));
const UnifiedClientCommunicationsPanel = React.lazy(() => import('./unified-client/UnifiedClientCommunicationsPanel').then(module => ({ default: module.UnifiedClientCommunicationsPanel })));
const UnifiedClientConsultationsPanel = React.lazy(() => import('./unified-client/UnifiedClientConsultationsPanel').then(module => ({ default: module.UnifiedClientConsultationsPanel })));
const UnifiedClientCoursesTab = React.lazy(() => import('./unified-client/UnifiedClientCoursesTab').then(module => ({ default: module.UnifiedClientCoursesTab })));
const UnifiedClientDaqqiPanel = React.lazy(() => import('./unified-client/UnifiedClientDaqqiPanel').then(module => ({ default: module.UnifiedClientDaqqiPanel })));
const UnifiedClientEditTab = React.lazy(() => import('./unified-client/UnifiedClientEditTab').then(module => ({ default: module.UnifiedClientEditTab })));
const UnifiedClientInstallmentsPanel = React.lazy(() => import('./unified-client/UnifiedClientInstallmentsPanel').then(module => ({ default: module.UnifiedClientInstallmentsPanel })));
const UnifiedClientLeadPaymentsPanel = React.lazy(() => import('./unified-client/UnifiedClientLeadPaymentsPanel').then(module => ({ default: module.UnifiedClientLeadPaymentsPanel })));
const UnifiedClientLoyaltyPanel = React.lazy(() => import('./unified-client/UnifiedClientLoyaltyPanel').then(module => ({ default: module.UnifiedClientLoyaltyPanel })));
const UnifiedClientOverviewTab = React.lazy(() => import('./unified-client/UnifiedClientOverviewTab').then(module => ({ default: module.UnifiedClientOverviewTab })));
const UnifiedClientSubscriberPaymentsPanel = React.lazy(() => import('./unified-client/UnifiedClientSubscriberPaymentsPanel').then(module => ({ default: module.UnifiedClientSubscriberPaymentsPanel })));
const UnifiedClientModalsHost = React.lazy(() => import('./unified-client/UnifiedClientModalsHost').then(module => ({ default: module.UnifiedClientModalsHost })));

// ─── Main Component ───────────────────────────────────────────────────────────

interface UnifiedClientPageProps {
  lead?: LeadItem;
  subscriber?: SubscriberItem;
}

const UnifiedClientPage: React.FC<UnifiedClientPageProps> = ({ lead, subscriber }) => {
  const navigate = useNavigate();
  // Same list every other screen shows — see hooks/useBranches.
  const branchOptions = useBranches();
  const {
    courses, bundles, staffMembers, subscribers, leads, isAdmin, authUser,
    updateLead, deleteLead, addSubscriber, updateSubscriber, deleteSubscriber,
    recordSubscriberPayment, reloadLeads, reloadSubscribers,
    getCourseLectures, daqqiRounds, consultations, content,
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
  const { show: toastShow } = useToast();
  const notify = React.useCallback(
    (type: 'success' | 'error' | 'info', text: string) => toastShow(text, type), [toastShow]);
  const [codeCopied, setCodeCopied] = useState(false);

  // ── session / activity stats — no longer tracked from Firestore ──────────
  const sessionData: UserSessionData | null = null;
  const {
    editing, setEditing, isSaving, setIsSaving, leadDraft, setLeadDraft,
    subDraft, setSubDraft, credNewPassword, setCredNewPassword, credMsg, setCredMsg,
    currentPassword, currentPasswordLoading, showCurrentPassword, setShowCurrentPassword,
    showNewPassword, setShowNewPassword, accountDiag, setAccountDiag,
    accountDiagLoading, setAccountDiagLoading, createAccLoading, setCreateAccLoading,
    createAccMsg, setCreateAccMsg, salesStaffList, csStaffList,
    handleSaveLeadEdit, handleSaveSubEdit,
  } = useUnifiedClientEditState({
    activeTab, lead, subscriber, staffMembers, isAdmin, isOnlineManager,
    updateLead, updateSubscriber, reloadSubscribers,
  });

  const {
    showAddComm, setShowAddComm, newComm, setNewComm,
    showContactPopup, setShowContactPopup, contactPopupDraft, setContactPopupDraft,
    quickNote, saveQuickNote, handleSaveComm, handleSaveContactPopup, handleDeleteComm,
  } = useUnifiedClientCommunications({
    lead, subscriber, clientCode, isSaving, setIsSaving, updateLead, updateSubscriber,
  });

  const paymentState = useUnifiedClientPayments({
    lead, subscriber, subscribers, staffMembers, authUser, courses, bundles,
    isSaving, setIsSaving, addSubscriber, recordSubscriberPayment,
    reloadLeads, reloadSubscribers,
  });
  const {
    showLeadPayForm, setShowLeadPayForm, leadPayDraft, setLeadPayDraft,
    showSubPayForm, setShowSubPayForm, payModalDraft, setPayModalDraft,
    showPayDetailModal, setShowPayDetailModal,
    showLegacyPayForm, setShowLegacyPayForm, legacyPayDraft, setLegacyPayDraft,
    subInstallmentPlans,
    todayStr: _todayStr, soon3Str: _soon3Str, instOverdueCount, instSoonCount,
    leadPayments, leadPaidEGP, enrolledCourse, leadRemaining,
    subHistory, confirmedHistory, subPaidTotals, bookingMap, bookedCourseIds,
    subRemainingEGP, discountBase,
    settlementCurrency, settlementLabel,
    handleAddLeadPayment, handlePayModalSubmit, handleAddLegacyPayment,
    openSubscriberPaymentForm,
    openLeadPaymentForm,
  } = paymentState;

  const {
    showAccessModal, setShowAccessModal, showGrantFromCourses, setShowGrantFromCourses,
    grantFromCourseId, setGrantFromCourseId, accessSaving, accessMsg,
    accessPresets, setAccessPresets, manualLimitDraft, setManualLimitDraft,
    getPreset, applyAccessLevel,
  } = useUnifiedClientCourseAccess({ subscriber, content, reloadSubscribers });

  const {
    viewCertId, setViewCertId, showExtraCertForm, setShowExtraCertForm,
    extraCertDraft, setExtraCertDraft, resetExtraCertDraft,
    showConvertModal, setShowConvertModal, convertCourseId, setConvertCourseId,
    convertAccessMode, setConvertAccessMode, convertPartialCount, setConvertPartialCount,
    promoCopied, setPromoCopied, subCerts, activeSubCerts, extraReqs,
    handleAddExtraCertRequest, handleConvert, handleGeneratePromo, handleCertificateLifecycle,
  } = useUnifiedClientLifecycleActions({
    lead, subscriber, isSaving, setIsSaving, setLeadDraft,
    updateLead, reloadLeads, reloadSubscribers,
  });

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
    reloadSubscribers,
  });

  const allComms: CommunicationRecord[] = [
    ...((lead?.communications       || []).map(c => ({ ...c, _src: 'lead'       as const }))),
    ...((subscriber?.communications || []).map(c => ({ ...c, _src: 'subscriber' as const }))),
  ].sort((a, b) => b.date.localeCompare(a.date));

  // consultations
  const nm = clientName.trim().toLowerCase();
  const ph = clientPhone.trim();
  const subConsults = consultations.filter(c =>
    c.clientName.trim().toLowerCase() === nm || (ph && c.clientPhone?.trim() === ph)
  );

  // daqqi
  const subDaqqiRounds = subscriber ? (daqqiRounds || []).filter(r => r.attendees.some(a => a.subscriberId === subscriber.id)) : [];

  // ─────────────────────────────── JSX ──────────────────────────────────────
  const tabs = buildUnifiedClientTabs({
    isSubscriber: isSub,
    communicationsCount: allComms.length,
    paymentCount: isSub ? subHistory.length : leadPayments.length,
    courseCount: subscriber?.enrolledCourseIds.length ?? 0,
    certificateCount: activeSubCerts.length + extraReqs.length,
    installmentPlanCount: subInstallmentPlans.length,
    overdueInstallmentCount: instOverdueCount,
    soonInstallmentCount: instSoonCount,
    daqqiRoundCount: subDaqqiRounds.length,
    consultationCount: subConsults.length,
  });

  // ── hero KPI calculations ─────────────────────────────────────────────────
  const lastCommDate = allComms[0]?.date?.slice(0, 10) ?? null;
  const heroPaidEGP = isSub ? subPaidTotals[settlementCurrency] : leadPaidEGP;
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
        settlementLabel={settlementLabel}
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
        // حجز opens the booking dialog — the same one تسجيل دفعة opens and the
        // same one the leads page uses. It used to open the convert-lead dialog
        // instead, a different form with different fields.
        onConvertLead={() => setShowLeadPayForm(true)}
        onOpenLinkedSubscriber={() => linkedSub && navigate(`/client/${linkedSub.clientCode || linkedSub.id}`)}
        onAddCommunication={() => setShowAddComm(true)}
        onOpenInstallmentPlan={() => setActiveTab('installments')}
        onOpenExtraCertificate={() => { setShowExtraCertForm(true); resetExtraCertDraft(); }}
        onOpenAccess={() => setShowAccessModal(true)}
        onEdit={() => { setEditing(true); setActiveTab('edit'); }}
        onToggleSubscriberStatus={() => updateSubscriber({ ...subscriber!, status: subscriber!.status === 'active' ? 'paused' : 'active' })}
        onDeleteClient={async () => {
          if (!window.confirm(`هل تريد حذف ${clientName}؟`)) return;
          if (subscriber && await deleteSubscriber(subscriber.id)) navigate('/dashboard/subscribers');
          else if (lead && await deleteLead(lead.id)) navigate('/dashboard');
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
              settlementLabel={settlementLabel}
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
              settlementLabel={settlementLabel}
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
            certificates={activeSubCerts}
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
            settlementCurrency={settlementCurrency}
            settlementLabel={settlementLabel}
          />

          <UnifiedClientSidebarQuickActions
            isSub={isSub}
            onAddCommunication={() => { setActiveTab('communications'); setShowAddComm(true); }}
            onSubscriberPayment={() => { setActiveTab('payments'); openSubscriberPaymentForm(); }}
            onLeadPayment={openLeadPaymentForm}
            onLegacyPayment={() => setShowLegacyPayForm(true)}
            onExtraCertificate={() => { setActiveTab('certificates'); setShowExtraCertForm(true); resetExtraCertDraft(); }}
            onInstallmentPlan={() => setActiveTab('installments')}
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
              settlementLabel={settlementLabel}
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

            <React.Suspense fallback={<div className="p-8 text-center text-sm text-gray-400">جاري تحميل القسم...</div>}>
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
                  subCerts={activeSubCerts}
                  bookingMap={bookingMap}
                  enrolledCourse={enrolledCourse ?? undefined}
                  leadRemaining={leadRemaining}
                  settlementCurrency={settlementCurrency}
                  settlementLabel={settlementLabel}
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
                      showSubPayForm={showSubPayForm}
                      payModalDraft={payModalDraft}
                      setPayModalDraft={setPayModalDraft}
                      onShowPaymentForm={openSubscriberPaymentForm}
                      onClosePaymentForm={() => setShowSubPayForm(false)}
                      onPaymentSubmit={handlePayModalSubmit}
                      subPaidTotals={subPaidTotals}
                      subRemainingEGP={subRemainingEGP}
                      settlementCurrency={settlementCurrency}
                      settlementLabel={settlementLabel}
                      bookedCourseIds={bookedCourseIds}
                      bookingMap={bookingMap}
                      confirmedHistory={confirmedHistory}
                      subHistory={subHistory}
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
                      payments={leadPayments}
                      showForm={showLeadPayForm}
                      onShowForm={openLeadPaymentForm}
                    />
                  )}
                </div>
              )}

              {/* ══ 🎓 الكورسات ══ */}
              {isSub && activeTab === 'courses' && subscriber && (
                <UnifiedClientCoursesTab
                  notify={notify}
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
                  onRevokeCertificate={(certificateId) => void handleCertificateLifecycle(certificateId, 'revoke')}
                  onReissueCertificate={(certificateId) => void handleCertificateLifecycle(certificateId, 'reissue')}
                />
              )}

              {isSub && activeTab === 'loyalty' && subscriber && (
                <UnifiedClientLoyaltyPanel subscriberId={subscriber.id} />
              )}

              {/* ══ 📅 الأقساط ══ */}
              {isSub && activeTab === 'installments' && subscriber && (
                <UnifiedClientInstallmentsPanel
                  plans={subInstallmentPlans}
                  courses={courses}
                  todayStr={_todayStr}
                  soon3Str={_soon3Str}
                  overdueCount={instOverdueCount}
                  soonCount={instSoonCount}
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
            </React.Suspense>
          </div>
        </div>
      </div>

      {(showAccessModal || showContactPopup || showConvertModal
        || showAddComm || showLeadPayForm || showExtraCertForm || showLegacyPayForm
        || Boolean(viewCertId) || showPayDetailModal) && (
        <React.Suspense fallback={null}>
          <UnifiedClientModalsHost
            access={showAccessModal && isSub ? {
              open: true, subscriber, canManageCourseAccess, courses, getCourseLectures,
              accessSaving, accessMsg, accessPresets, setAccessPresets, manualLimitDraft,
              setManualLimitDraft, getPreset, applyAccessLevel,
              onClose: () => setShowAccessModal(false),
            } : undefined}
            contact={showContactPopup ? {
              open: true, clientName, draft: contactPopupDraft, setDraft: setContactPopupDraft,
              saving: isSaving, allowLeadStatus: !isSub && !!lead,
              onSubmit: handleSaveContactPopup, onClose: () => setShowContactPopup(false),
            } : undefined}
            convert={showConvertModal && lead ? {
              open: true, bundles, courses, courseId: convertCourseId, accessMode: convertAccessMode,
              partialCount: convertPartialCount, saving: isSaving, setCourseId: setConvertCourseId,
              setAccessMode: setConvertAccessMode, setPartialCount: setConvertPartialCount,
              onSubmit: handleConvert, onClose: () => setShowConvertModal(false),
            } : undefined}
            communication={showAddComm ? {
              open: true, clientName, draft: newComm, setDraft: setNewComm, saving: isSaving,
              onSubmit: handleSaveComm, onClose: () => setShowAddComm(false),
            } : undefined}
            leadPayment={showLeadPayForm && !isSub && lead ? {
              mode: 'lead' as const,
              subject: {
                id: lead.id, name: lead.name, phone: lead.phone,
                enrolledCourseIds: lead.interestedCourseIds || [],
                paymentHistory: [],
                extraCertificateRequests: [],
              },
              draft: leadPayDraft,
              setDraft: setLeadPayDraft,
              branchOptions,
              branchLabel: lead.branch,
              onSubmit: handleAddLeadPayment,
              onClose: () => setShowLeadPayForm(false),
            } : undefined}
            extraCertificate={showExtraCertForm && isSub ? {
              open: true, subscriber, clientName, courses, draft: extraCertDraft,
              settlementLabel,
              setDraft: setExtraCertDraft, onSubmit: handleAddExtraCertRequest,
              onClose: () => setShowExtraCertForm(false),
            } : undefined}
            legacyPayment={showLegacyPayForm && isSub ? {
              open: true, clientName, courses, bundles, legacyPayDraft, setLegacyPayDraft,
              settlementLabel,
              onSubmit: handleAddLegacyPayment, onClose: () => setShowLegacyPayForm(false),
            } : undefined}
            certificateView={viewCertId ? {
              certificateId: viewCertId, certificates: activeSubCerts, subscriber,
              clientName, courses, onClose: () => setViewCertId(null),
            } : undefined}
            paymentDetail={showPayDetailModal && isSub ? {
              open: true, subscriber, clientName, courses, paidTotals: subPaidTotals,
              remainingEGP: subRemainingEGP, bookingMap, confirmedHistory,
              settlementLabel,
              onClose: () => setShowPayDetailModal(false),
            } : undefined}
          />
        </React.Suspense>
      )}
    </div>
  );
}

export default UnifiedClientPage;
