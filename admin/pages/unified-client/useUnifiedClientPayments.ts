import { useCallback, useEffect, useState } from 'react';
import type { PaymentDraft } from '../../components/PaymentModal';
import { currencyForBranch, currencyLabel } from '../../lib/branchCurrency';
import { createClientPaymentDraft } from '../../lib/clientActionDrafts';
import { mysqlAdmin } from '../../lib/mysqlapi';
import type {
  AuthUser, Bundle, Course, InstallmentPlan, LeadItem, PaymentHistoryEntry,
  PaymentItemType, StaffMember, SubscriberItem,
} from '../../types';
import { mapServerInstallmentPlan } from './installmentPlanMapper';
import type { UnifiedClientLeadPaymentDraft } from './UnifiedClientLeadPaymentModal';

interface Params {
  lead?: LeadItem;
  subscriber?: SubscriberItem;
  subscribers: SubscriberItem[];
  staffMembers: StaffMember[];
  authUser?: AuthUser | null;
  courses: Course[];
  bundles: Bundle[];
  isSaving: boolean;
  setIsSaving: (saving: boolean) => void;
  addSubscriber: (subscriber: SubscriberItem) => Promise<boolean>;
  recordSubscriberPayment: (
    subscriberId: string,
    payment: Record<string, unknown>,
  ) => Promise<unknown>;
  reloadLeads: () => Promise<unknown>;
  reloadSubscribers: () => Promise<unknown>;
}

export interface UnifiedClientBooking {
  paidEGP: number;
  expectedEGP?: number;
  discount?: number;
}

const today = () => new Date().toISOString().slice(0, 10);

function persistenceError(field: string, error: unknown) {
  window.dispatchEvent(new CustomEvent('site-persist-error', {
    detail: {
      field,
      name: error instanceof Error ? error.message : 'تعذر حفظ العملية',
    },
  }));
}

export function useUnifiedClientPayments(params: Params) {
  const {
    lead, subscriber, subscribers, staffMembers, authUser, courses, bundles,
    isSaving, setIsSaving, addSubscriber, recordSubscriberPayment,
    reloadLeads, reloadSubscribers,
  } = params;
  const settlementCurrency = currencyForBranch(subscriber?.branch || lead?.branch);
  const settlementLabel = currencyLabel(settlementCurrency);
  const [showLeadPayForm, setShowLeadPayForm] = useState(false);
  const [leadPayDraft, setLeadPayDraft] = useState<UnifiedClientLeadPaymentDraft>({
    amount: 0,
    currency: currencyForBranch(lead?.branch),
    courseId: lead?.enrolledCourseId || '',
    date: today(),
    note: '',
    paymentType: 'course',
  });
  const [showSubPayForm, setShowSubPayForm] = useState(false);
  const [payModalDraft, setPayModalDraft] = useState<PaymentDraft>(() => createClientPaymentDraft({
    branch: subscriber?.branch,
    email: subscriber?.email,
  }));
  const [showPayDetailModal, setShowPayDetailModal] = useState(false);
  const [showLegacyPayForm, setShowLegacyPayForm] = useState(false);
  const [legacyPayDraft, setLegacyPayDraft] = useState({
    courseId: '', courseExpected: '', amountPaid: '', note: '',
  });
  const [serverInstallmentPlans, setServerInstallmentPlans] = useState<InstallmentPlan[]>([]);

  useEffect(() => {
    setLeadPayDraft(current => ({
      ...current,
      currency: currencyForBranch(lead?.branch),
      courseId: lead?.enrolledCourseId || '',
    }));
  }, [lead?.id, lead?.branch, lead?.enrolledCourseId]);

  useEffect(() => {
    setPayModalDraft(createClientPaymentDraft({
      branch: subscriber?.branch,
      email: subscriber?.email,
    }));
  }, [subscriber?.id, subscriber?.branch, subscriber?.email]);

  const refreshInstallmentPlans = useCallback(async () => {
    if (!subscriber?.id) {
      setServerInstallmentPlans([]);
      return;
    }
    try {
      const rows = await mysqlAdmin.adminGet<unknown[]>(
        `/admin/subscribers/${subscriber.id}/installment-plans`,
      );
      setServerInstallmentPlans((rows || []).map(mapServerInstallmentPlan));
    } catch {
      setServerInstallmentPlans([]);
    }
  }, [subscriber?.id]);
  useEffect(() => { void refreshInstallmentPlans(); }, [refreshInstallmentPlans]);

  const leadPayments = lead?.paymentRecords ?? [];
  const leadPaidEGP = leadPayments.reduce(
    (sum, payment) => payment.currency === settlementCurrency ? sum + payment.amount : sum,
    0,
  );
  const enrolledCourse = lead?.enrolledCourseId
    ? courses.find(course => course.id === lead.enrolledCourseId)
    : undefined;
  const leadRemaining = Math.max(
    0,
    (enrolledCourse?.price?.[settlementCurrency] ?? 0) - leadPaidEGP,
  );
  const subHistory = subscriber?.paymentHistory ?? [];
  const confirmedHistory = subHistory.filter(payment => !payment.status || payment.status === 'paid');
  const subPaidTotals = { EGP: 0, SAR: 0, USD: 0 };
  confirmedHistory.forEach(payment => { subPaidTotals[payment.currency] += payment.amount; });

  const bookingMap: Record<string, UnifiedClientBooking> = {};
  confirmedHistory.forEach(payment => {
    if (!payment.courseId || payment.currency !== settlementCurrency) return;
    const booking = bookingMap[payment.courseId] ?? (bookingMap[payment.courseId] = { paidEGP: 0 });
    booking.paidEGP += payment.amount;
    if (payment.isInstallment === false && payment.courseExpected) booking.expectedEGP = payment.courseExpected;
    if (payment.isInstallment === false && payment.discount) booking.discount = payment.discount;
  });
  const bookedCourseIds = subscriber
    ? [...new Set([
        ...subHistory
          .filter(payment => payment.courseId && payment.isInstallment === false)
          .map(payment => payment.courseId as string),
        ...subscriber.enrolledCourseIds,
      ])]
    : [];
  const subExpectedEGP = subscriber?.expectedTotals?.[settlementCurrency]
    || Object.values(bookingMap).reduce(
      (sum, booking) => booking.expectedEGP ? sum + booking.expectedEGP : sum,
      0,
    );
  const subRemainingEGP = subExpectedEGP > 0
    ? Math.max(0, subExpectedEGP - subPaidTotals[settlementCurrency] - (subscriber?.discount || 0))
    : 0;
  const todayStr = today();
  const soon3Str = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const instOverdueCount = serverInstallmentPlans
    .flatMap(plan => plan.entries.filter(entry => !entry.paidAt && entry.dueDate < todayStr)).length;
  const instSoonCount = serverInstallmentPlans
    .flatMap(plan => plan.entries.filter(
      entry => !entry.paidAt && entry.dueDate >= todayStr && entry.dueDate <= soon3Str,
    )).length;

  const handleAddLeadPayment = async () => {
    const amount = Number(leadPayDraft.amount);
    if (!lead || !Number.isFinite(amount) || amount <= 0 || isSaving) return;
    setIsSaving(true);
    try {
      const existingSubscriber = subscribers.find(item =>
        item.leadId === lead.id
        || (lead.phone && item.phone === lead.phone)
        || (lead.email && item.email?.toLowerCase() === lead.email.toLowerCase())
      );
      const subscriberId = existingSubscriber?.id || `sub-${Date.now()}`;
      if (!existingSubscriber) {
        const added = await addSubscriber({
          id: subscriberId,
          clientCode: lead.clientCode,
          leadId: lead.id,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          branch: lead.branch,
          enrolledCourseIds: [],
          courseAccess: {},
          paymentHistory: [],
          status: 'active',
          createdAt: new Date().toISOString(),
        });
        if (!added) throw new Error('يوجد مشترك بنفس الهاتف أو البريد. حدّث الصفحة ثم أعد المحاولة.');
      }
      const recorder = staffMembers.find(member =>
        member.email?.toLowerCase() === (authUser?.email || '').toLowerCase()
      );
      await recordSubscriberPayment(subscriberId, {
        id: `pay-${Date.now()}`,
        amount,
        currency: leadPayDraft.currency,
        paymentType: leadPayDraft.courseId ? 'course' : 'other',
        courseId: leadPayDraft.courseId || undefined,
        note: leadPayDraft.note || undefined,
        at: leadPayDraft.date,
        status: 'paid',
        source: 'staff',
        staffId: recorder?.id,
        staffName: recorder?.name,
      });
      await Promise.all([reloadLeads(), reloadSubscribers()]);
      setShowLeadPayForm(false);
      setLeadPayDraft({
        amount: 0,
        currency: currencyForBranch(lead.branch),
        courseId: lead.enrolledCourseId || '',
        date: today(),
        note: '',
        paymentType: 'course',
      });
    } catch (error) {
      persistenceError('payment', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePayModalSubmit = async (draft: PaymentDraft) => {
    const amount = Number(draft.amount);
    if (!amount || amount <= 0 || !subscriber) return;
    const isBundle = draft.courseId?.startsWith('bundle:');
    const bundleId = isBundle ? draft.courseId.replace('bundle:', '') : undefined;
    const bundle = bundleId ? bundles.find(item => item.id === bundleId) : undefined;
    const course = !isBundle && draft.courseId
      ? courses.find(item => item.id === draft.courseId)
      : undefined;
    const catalogPrice = bundle
      ? (bundle.price[draft.currency] || 0)
      : course ? (course.price[draft.currency] || 0) : 0;
    const customExpected = Number(draft.customExpected) || 0;
    const discount = draft.discountPct && catalogPrice
      ? Math.round(catalogPrice * Number(draft.discountPct) / 100)
      : 0;
    const expected = customExpected > 0 ? customExpected : Math.max(0, catalogPrice - discount);
    if (draft.bookingType === 'new_booking' && draft.paymentType === 'course' && expected <= 0) {
      persistenceError('payment', new Error(`سعر ${draft.currency} غير مُعرّف للكورس/الباقة؛ عرّف السعر قبل الحفظ.`));
      return;
    }
    const entry: PaymentHistoryEntry = {
      id: `pay-${Date.now()}`,
      amount,
      currency: draft.currency,
      paymentType: draft.paymentType,
      isInstallment: draft.bookingType === 'installment',
      courseId: isBundle ? undefined : (draft.courseId || undefined),
      bundleId,
      courseExpected: draft.bookingType !== 'installment' && expected > 0 ? expected : undefined,
      discount: discount || undefined,
      certId: draft.certReqId || undefined,
      certType: draft.certType || undefined,
      paymentMethod: draft.paymentMethod || undefined,
      fromAccountNumber: draft.fromAccountNumber || undefined,
      source: 'staff',
      note: [
        draft.note || undefined,
        draft.transactionId || undefined,
        bundle ? `مسار تعليمي: ${bundle.title}` : undefined,
        draft.certType || undefined,
      ].filter(Boolean).join(' | ') || undefined,
      at: draft.date,
    };
    try {
      await recordSubscriberPayment(subscriber.id, entry as unknown as Record<string, unknown>);
      setShowSubPayForm(false);
      setPayModalDraft(createClientPaymentDraft({
        branch: subscriber.branch,
        email: subscriber.email,
      }));
    } catch (error) {
      persistenceError('payment', error);
    }
  };

  const handleAddLegacyPayment = async () => {
    const expected = Number(legacyPayDraft.courseExpected);
    const paid = Number(legacyPayDraft.amountPaid);
    if (!legacyPayDraft.courseId || !expected || paid <= 0 || !subscriber) return;
    try {
      await recordSubscriberPayment(subscriber.id, {
        id: `pay-${Date.now()}`,
        amount: paid,
        currency: settlementCurrency,
        paymentType: 'course' as PaymentItemType,
        isInstallment: false,
        courseId: legacyPayDraft.courseId,
        courseExpected: expected,
        note: ['مدفوع قديماً', legacyPayDraft.note].filter(Boolean).join(' — '),
        at: today(),
      });
      setShowLegacyPayForm(false);
      setLegacyPayDraft({ courseId: '', courseExpected: '', amountPaid: '', note: '' });
    } catch (error) {
      persistenceError('legacyPayment', error);
    }
  };

  const openSubscriberPaymentForm = () => {
    setPayModalDraft(createClientPaymentDraft({
      branch: subscriber?.branch,
      email: subscriber?.email,
    }));
    setShowSubPayForm(true);
  };

  const openLeadPaymentForm = () => {
    setLeadPayDraft({
      amount: 0,
      currency: currencyForBranch(lead?.branch),
      courseId: lead?.enrolledCourseId || '',
      date: today(),
      note: '',
      paymentType: 'course',
    });
    setShowLeadPayForm(true);
  };

  return {
    showLeadPayForm, setShowLeadPayForm, leadPayDraft, setLeadPayDraft,
    showSubPayForm, setShowSubPayForm, payModalDraft, setPayModalDraft,
    showPayDetailModal, setShowPayDetailModal,
    showLegacyPayForm, setShowLegacyPayForm, legacyPayDraft, setLegacyPayDraft,
    subInstallmentPlans: serverInstallmentPlans,
    todayStr, soon3Str, instOverdueCount, instSoonCount,
    leadPayments, leadPaidEGP, enrolledCourse, leadRemaining,
    subHistory, confirmedHistory, subPaidTotals, bookingMap, bookedCourseIds,
    subExpectedEGP, subRemainingEGP,
    discountBase: subExpectedEGP || subPaidTotals[settlementCurrency],
    settlementCurrency, settlementLabel,
    handleAddLeadPayment, handlePayModalSubmit, handleAddLegacyPayment,
    openSubscriberPaymentForm,
    openLeadPaymentForm,
  };
}
