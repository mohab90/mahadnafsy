import { useCallback, useEffect, useState } from 'react';
import { cairoDateOnly, cairoDaysAhead } from '../../../shared/cairoDate';
import type { PaymentDraft } from '../../components/PaymentModal';
import { currencyForBranch, currencyLabel } from '../../lib/branchCurrency';
import { createClientPaymentDraft } from '../../lib/clientActionDrafts';
import { mysqlAdmin } from '../../lib/mysqlapi';
import type {
  AuthUser, Bundle, Course, InstallmentPlan, LeadItem, PaymentHistoryEntry,
  PaymentItemType, StaffMember, SubscriberItem,
} from '../../types';
import { mapServerInstallmentPlan } from './installmentPlanMapper';
import { bookingTierFields } from '../../lib/bookingIdentity';
import { clientItems, isCoursePayment } from '../../lib/agreedPrice';

interface Params {
  lead?: LeadItem;
  subscriber?: SubscriberItem;
  subscribers: SubscriberItem[];
  staffMembers: StaffMember[];
  /** Resolved once in the context; staffMembers alone is empty for most roles. */
  currentStaff: StaffMember | null;
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

const today = () => cairoDateOnly();

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
    lead, subscriber, subscribers, staffMembers, currentStaff, authUser, courses, bundles,
    isSaving, setIsSaving, addSubscriber, recordSubscriberPayment,
    reloadLeads, reloadSubscribers,
  } = params;
  const settlementCurrency = currencyForBranch(subscriber?.branch || lead?.branch);
  const settlementLabel = currencyLabel(settlementCurrency);
  const [showLeadPayForm, setShowLeadPayForm] = useState(false);
  const [leadPayDraft, setLeadPayDraft] = useState<PaymentDraft>(() => createClientPaymentDraft({
    courseId: lead?.enrolledCourseId || '',
    currency: currencyForBranch(lead?.branch),
    branch: lead?.branch || '',
    email: lead?.email || '',
  }));
  const [showSubPayForm, setShowSubPayForm] = useState(false);
  const [payModalDraft, setPayModalDraft] = useState<PaymentDraft>(() => createClientPaymentDraft({
    branch: subscriber?.branch,
    email: subscriber?.email,
  }));
  const [showPayDetailModal, setShowPayDetailModal] = useState(false);
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
  // One figure for the client's money everywhere on this page (8 Oct 2026:
  // «شوية ظاهر ان المدفوع 700 وشوية 1400 … مينفعش نغلط ابدا في الفلوس»): what
  // each course or track was paid — its payments and «مدفوع قبل السيستم» — and
  // what it still owes, exactly as the online table reads it (clientItems). The
  // top line used to add up the payment rows alone, certificates and books
  // among them, against the courses' prices; the course lines below counted
  // «مدفوع قبل السيستم» too. Money for anything else is its own line.
  const items = subscriber ? clientItems(subscriber, courses, bundles, settlementCurrency) : [];
  const subPaidTotals = { EGP: 0, SAR: 0, USD: 0 };
  items.forEach(item => {
    if (item.currency in subPaidTotals) subPaidTotals[item.currency as keyof typeof subPaidTotals] += item.paid;
  });
  const otherPaidTotals = { EGP: 0, SAR: 0, USD: 0 };
  confirmedHistory.filter(payment => !isCoursePayment(payment)).forEach(payment => {
    if (payment.currency in otherPaidTotals) otherPaidTotals[payment.currency] += payment.amount;
  });

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
  const settled = items.filter(item => item.currency === settlementCurrency);
  const subExpectedEGP = settled.reduce((sum, item) => sum + item.expected, 0);
  const subRemainingEGP = settled.reduce((sum, item) => sum + item.remaining, 0);
  const todayStr = today();
  const soon3Str = cairoDaysAhead(3);
  const instOverdueCount = serverInstallmentPlans
    .flatMap(plan => plan.entries.filter(entry => !entry.paidAt && entry.dueDate < todayStr)).length;
  const instSoonCount = serverInstallmentPlans
    .flatMap(plan => plan.entries.filter(
      entry => !entry.paidAt && entry.dueDate >= todayStr && entry.dueDate <= soon3Str,
    )).length;

  const handleAddLeadPayment = async (draft: PaymentDraft = leadPayDraft) => {
    const amount = Number(draft.amount);
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
      // Who recorded it. staffMembers is empty for the ten roles that cannot
      // read the staff list — every payment they took was stamped with nobody.
      const recorder = currentStaff;
      await recordSubscriberPayment(subscriberId, {
        id: `pay-${Date.now()}`,
        amount,
        currency: draft.currency,
        paymentType: draft.paymentType || (draft.courseId ? 'course' : 'other'),
        courseId: draft.courseId?.startsWith('bundle:') ? undefined : (draft.courseId || undefined),
        note: draft.note || undefined,
        at: draft.date,
        status: 'paid',
        source: 'staff',
        staffId: recorder?.id,
        staffName: recorder?.name,
      });
      await Promise.all([reloadLeads(), reloadSubscribers()]);
      setShowLeadPayForm(false);
      setLeadPayDraft(createClientPaymentDraft({
        courseId: lead.enrolledCourseId || '',
        currency: currencyForBranch(lead.branch),
        branch: lead.branch || '',
        email: lead.email || '',
      }));
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
      itemTitle: draft.itemTitle || undefined,
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
    // The branch tier and the client's real name (lib/bookingIdentity.ts); the server prices it.
    const tierFields = draft.bookingType === 'new_booking' ? bookingTierFields(draft) : {};
    try {
      await recordSubscriberPayment(subscriber.id, { ...entry, ...tierFields } as unknown as Record<string, unknown>);
      setShowSubPayForm(false);
      setPayModalDraft(createClientPaymentDraft({
        branch: subscriber.branch,
        email: subscriber.email,
      }));
    } catch (error) {
      persistenceError('payment', error);
      // The payment dialog waits on this: swallowed, it printed a receipt for a refused payment.
      throw error;
    }
  };


  const openSubscriberPaymentForm = (opts?: { note?: string; draft?: Partial<PaymentDraft> }) => {
    setPayModalDraft({
      ...createClientPaymentDraft({
        branch: subscriber?.branch,
        email: subscriber?.email,
      }),
      ...(opts?.note ? { note: opts.note } : {}),
      ...(opts?.draft || {}),
    });
    setShowSubPayForm(true);
  };

  // «مدفوع قديم» — a payment made before this system existed. It is a
  // subscriber payment with an older date, so it is the same screen with the
  // note filled in. Its own dialog recorded no payment method at all and
  // stamped today as the date, for a payment that by definition was not made
  // today; the shared screen asks for both.
  const openLegacyPaymentForm = () => openSubscriberPaymentForm({ note: 'مدفوع قديماً' });

  const openLeadPaymentForm = () => {
    setLeadPayDraft(createClientPaymentDraft({
      courseId: lead?.enrolledCourseId || '',
      currency: currencyForBranch(lead?.branch),
      branch: lead?.branch || '',
      email: lead?.email || '',
    }));
    setShowLeadPayForm(true);
  };

  return {
    showLeadPayForm, setShowLeadPayForm, leadPayDraft, setLeadPayDraft,
    showSubPayForm, setShowSubPayForm, payModalDraft, setPayModalDraft,
    showPayDetailModal, setShowPayDetailModal,
    subInstallmentPlans: serverInstallmentPlans,
    todayStr, soon3Str, instOverdueCount, instSoonCount,
    leadPayments, leadPaidEGP, enrolledCourse, leadRemaining,
    subHistory, confirmedHistory, subPaidTotals, otherPaidTotals, bookingMap, bookedCourseIds,
    subExpectedEGP, subRemainingEGP,
    discountBase: subExpectedEGP || subPaidTotals[settlementCurrency],
    settlementCurrency, settlementLabel,
    handleAddLeadPayment, handlePayModalSubmit, openLegacyPaymentForm,
    openSubscriberPaymentForm,
    openLeadPaymentForm,
  };
}
