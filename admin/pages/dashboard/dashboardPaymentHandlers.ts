import type {
  Bundle, BranchType, Course, CourseAccessSetting,
  ExtraCertificateRequest, ExtraCertificateType,
  LeadItem, PaymentHistoryEntry, StaffMember, SubscriberItem,
} from '../../types';
import type { PaymentDraft } from '../../components/PaymentModal';
import type { TabKey } from './navigation';
import { normBranchId } from './dashboardShared';
import { mysqlAdmin } from '../../lib/mysqlapi';
import { priceForCurrency } from './dashboardHelpers';

type Notify = (type: 'success' | 'error' | 'info', msg: string) => void;

function normalizeAccessEntry(entry?: CourseAccessSetting | 'preview' | 'full'): CourseAccessSetting {
  if (entry === 'full') return { mode: 'full' };
  if (entry === 'preview') return { mode: 'preview' };
  if (!entry) return { mode: 'preview' };
  if (entry.mode === 'limited') {
    const rawLimit = Number(entry.lectureLimit || 1);
    return { mode: 'limited', lectureLimit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 1 };
  }
  return { mode: entry.mode };
}

export function normalizeCourseAccess(
  enrolledCourseIds: string[],
  currentMap: Record<string, CourseAccessSetting | 'preview' | 'full'> = {},
): Record<string, CourseAccessSetting> {
  const nextMap: Record<string, CourseAccessSetting> = {};
  enrolledCourseIds.forEach((courseId) => {
    nextMap[courseId] = normalizeAccessEntry(currentMap[courseId]);
  });
  return nextMap;
}

export function normalizeLectureProgress(
  _enrolledCourseIds: string[],
  currentMap: Record<string, number> = {},
): Record<string, number> {
  return currentMap;
}

// ── handleSubPayment ─────────────────────────────────────────────────────────

interface HandleSubPaymentDeps {
  subPayRow: SubscriberItem | null;
  subscribers: SubscriberItem[];
  bundles: Bundle[];
  courses: Course[];
  content: Record<string, string>;
  recordSubscriberPayment: (
    subscriberId: string,
    payment: Record<string, unknown>,
  ) => Promise<{ status: string; approvalRequired?: boolean }>;
  reloadSubscribers: () => Promise<void>;
  notify: Notify;
  currentStaff: StaffMember | null;
}

export async function handleSubPaymentFn(draft: PaymentDraft, deps: HandleSubPaymentDeps): Promise<void> {
  const {
    subPayRow, subscribers, bundles, courses, content,
    recordSubscriberPayment, reloadSubscribers, notify, currentStaff,
  } = deps;
  if (!subPayRow) return;
  const courseItemsComputed = draft.paymentType === 'course'
    ? [
        { courseId: draft.courseId, amount: draft.amount, customExpected: draft.customExpected, discountPct: draft.discountPct },
        ...draft.extraItems.filter(i => i.type === 'course').map(i => ({
          courseId: i.courseId || '', amount: i.amount, customExpected: i.customExpected || '', discountPct: i.discountPct || '',
        })),
      ].filter(item => item.courseId && item.amount)
    : [];
  const subPayDraft = {
    ...draft,
    courseItems: courseItemsComputed,
    transferRef: draft.fromAccountNumber,
    extraItems: draft.extraItems.filter(i => i.type !== 'course'),
  };
  const freshSub = subscribers.find(s => s.id === subPayRow.id) || subPayRow;
  const noteParts = [subPayDraft.note, subPayDraft.transactionId, subPayDraft.transferRef ? `تحويل: ${subPayDraft.transferRef}` : '', subPayDraft.nationalId ? `ر.ق: ${subPayDraft.nationalId}` : ''].filter(Boolean);
  const isMultiCourse = subPayDraft.paymentType === 'course' && subPayDraft.bookingType === 'new_booking';

  let updated = { ...freshSub };

  if (isMultiCourse) {
    const validItems = subPayDraft.courseItems.filter(item => item.courseId && item.amount);
    if (validItems.length === 0) return;
    const newEntries: PaymentHistoryEntry[] = [];
    for (const item of validItems) {
      const isBundleItem = item.courseId.startsWith('bundle:');
      const bId = isBundleItem ? item.courseId.replace('bundle:', '') : null;
      const bObj = bId ? bundles.find(b => b.id === bId) : null;
      const _bundleCatalog = isBundleItem && bObj ? priceForCurrency(bObj.price, subPayDraft.currency) : 0;
      const _courseCatalog = !isBundleItem && item.courseId ? (courses.find(c => c.id === item.courseId)?.price?.[subPayDraft.currency as 'EGP'|'SAR'|'USD'] || 0) : 0;
      const _catalogPx = isBundleItem ? _bundleCatalog : _courseCatalog;
      const _customExpSub = Number(item.customExpected) || 0;
      const _discPctSub = Number(item.discountPct) || 0;
      const _itemExpected = _customExpSub > 0 ? _customExpSub : (_discPctSub > 0 && _catalogPx > 0 ? Math.round(_catalogPx * (1 - _discPctSub / 100)) : _catalogPx);
      if (_itemExpected <= 0) {
        throw new Error(`سعر ${subPayDraft.currency} غير مُعرّف للكورس/الباقة؛ أدخل السعر النهائي قبل الحفظ.`);
      }
      const entry: PaymentHistoryEntry = {
        id: `pay-${Date.now()}-${item.courseId}`,
        amount: Number(item.amount),
        courseExpected: _itemExpected,
        currency: subPayDraft.currency,
        paymentType: subPayDraft.paymentType,
        isInstallment: false,
        courseId: isBundleItem ? undefined : (item.courseId || undefined),
        bundleId: isBundleItem ? (bId || undefined) : undefined,
        note: [noteParts.join(' | '), isBundleItem && bObj ? `مسار تعليمي: ${bObj.title}` : undefined].filter(Boolean).join(' | ') || undefined,
        paymentMethod: subPayDraft.paymentMethod || undefined,
        at: subPayDraft.date,
        staffId: currentStaff?.id || undefined,
        staffName: currentStaff?.name || undefined,
        status: 'paid',
      };
      newEntries.push(entry);
      if (isBundleItem && bObj) {
        const bundleCourseIds = bObj.courses.map((c: { id: string }) => c.id);
        const newIds = [...new Set([...(updated.enrolledCourseIds || []), ...bundleCourseIds])];
        updated = { ...updated, enrolledCourseIds: newIds };
      } else if (item.courseId && !(updated.enrolledCourseIds || []).includes(item.courseId)) {
        updated = { ...updated, enrolledCourseIds: [...(updated.enrolledCourseIds || []), item.courseId] };
      }
    }
    updated = { ...updated, paymentHistory: [...(updated.paymentHistory || []), ...newEntries] };
  } else {
    if (!subPayDraft.amount) return;
    const isBundleSelection = subPayDraft.courseId?.startsWith('bundle:');
    const bundleId = isBundleSelection ? subPayDraft.courseId.replace('bundle:', '') : null;
    const bundle = bundleId ? bundles.find(b => b.id === bundleId) : null;
    const _singleExpected = isBundleSelection && bundle
      ? ((bundle.price as any)?.[subPayDraft.currency] || 0)
      : (!isBundleSelection && subPayDraft.courseId ? (courses.find(c => c.id === subPayDraft.courseId)?.price?.[subPayDraft.currency as 'EGP'|'SAR'|'USD'] || 0) : 0);
    if (subPayDraft.bookingType === 'new_booking' && subPayDraft.paymentType === 'course' && _singleExpected <= 0) {
      throw new Error(`سعر ${subPayDraft.currency} غير مُعرّف للكورس/الباقة؛ عرّف السعر قبل الحفظ.`);
    }
    const entry: PaymentHistoryEntry = {
      id: `pay-${Date.now()}`,
      amount: Number(subPayDraft.amount),
      courseExpected: subPayDraft.bookingType !== 'installment' && _singleExpected > 0 ? _singleExpected : undefined,
      currency: subPayDraft.currency,
      paymentType: subPayDraft.paymentType,
      isInstallment: subPayDraft.bookingType === 'installment',
      courseId: isBundleSelection ? undefined : (subPayDraft.courseId || undefined),
      bundleId: bundleId || undefined,
      certId: subPayDraft.certReqId || undefined,
      certType: subPayDraft.certType || undefined,
      note: [noteParts.join(' | '), isBundleSelection && bundle ? `مسار تعليمي: ${bundle.title}` : undefined].filter(Boolean).join(' | ') || undefined,
      paymentMethod: subPayDraft.paymentMethod || undefined,
      at: subPayDraft.date,
      staffId: currentStaff?.id || undefined,
      staffName: currentStaff?.name || undefined,
      status: 'paid',
    };
    updated = { ...updated, paymentHistory: [...(updated.paymentHistory || []), entry] };

    if (subPayDraft.paymentType === 'course') {
      if (isBundleSelection && bundle) {
        const bundleCourseIds = bundle.courses.map((c: { id: string }) => c.id);
        const newIds = [...new Set([...(updated.enrolledCourseIds || []), ...bundleCourseIds])];
        updated = { ...updated, enrolledCourseIds: newIds };
      } else if (!isBundleSelection && subPayDraft.courseId && !(updated.enrolledCourseIds || []).includes(subPayDraft.courseId)) {
        updated = { ...updated, enrolledCourseIds: [...(updated.enrolledCourseIds || []), subPayDraft.courseId] };
      }
    }

    if (subPayDraft.paymentType === 'certificate' && subPayDraft.certReqId) {
      updated = {
        ...updated,
        extraCertificateRequests: (updated.extraCertificateRequests || []).map(req =>
          req.id === subPayDraft.certReqId
            ? { ...req, paidAmount: (req.paidAmount || 0) + Number(subPayDraft.amount) }
            : req
        ),
      };
    }

    if (subPayDraft.paymentType === 'certificate' && subPayDraft.bookingType === 'new_booking' && subPayDraft.certType) {
      const newCertReq: ExtraCertificateRequest = {
        id: `certreq-${Date.now()}`,
        type: subPayDraft.certType as ExtraCertificateType,
        courseId: subPayDraft.courseId || undefined,
        status: 'priced',
        price: Number(subPayDraft.amount),
        paidAmount: Number(subPayDraft.amount),
        currency: subPayDraft.currency,
        requestedAt: subPayDraft.date,
        note: noteParts.join(' | ') || undefined,
      };
      updated = {
        ...updated,
        extraCertificateRequests: [...(updated.extraCertificateRequests || []), newCertReq],
      };
    }
  }

  if (subPayDraft.paymentType === 'course') {
    const depositVids = Math.max(1, Number(content['access.videos_on_deposit'] || 20));
    const perPayVids = Math.max(1, Number(content['access.videos_per_payment'] || 15));

    const affectedCourseIds: string[] = [];
    if (isMultiCourse) {
      for (const item of subPayDraft.courseItems.filter(i => i.courseId && i.amount)) {
        if (item.courseId.startsWith('bundle:')) {
          const bId = item.courseId.replace('bundle:', '');
          const bObj = bundles.find(b => b.id === bId);
          if (bObj) bObj.courses.forEach((c: { id: string }) => affectedCourseIds.push(c.id));
        } else {
          affectedCourseIds.push(item.courseId);
        }
      }
    } else if (subPayDraft.courseId) {
      if (subPayDraft.courseId.startsWith('bundle:')) {
        const bId = subPayDraft.courseId.replace('bundle:', '');
        const bObj = bundles.find(b => b.id === bId);
        if (bObj) bObj.courses.forEach((c: { id: string }) => affectedCourseIds.push(c.id));
      } else {
        affectedCourseIds.push(subPayDraft.courseId);
      }
    }

    const isFirstPayment = subPayDraft.bookingType === 'new_booking';
    let newCourseAccess = { ...(updated.courseAccess ?? {}) };

    for (const cid of affectedCourseIds) {
      const curAccess = normalizeAccessEntry(newCourseAccess[cid]);
      if (curAccess.mode === 'full') continue;

      const plan = (updated.installmentPlans || []).find(p => p.courseId === cid);
      const totalPaid = (updated.paymentHistory || [])
        .filter(p =>
          p.courseId === cid
          && (p.paymentType === 'course' || !p.paymentType)
          && (!plan || p.currency === plan.currency)
        )
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const isFullyPaid = plan && plan.totalAmount > 0 && totalPaid >= plan.totalAmount;

      if (isFullyPaid) {
        newCourseAccess[cid] = { mode: 'full' };
      } else if (isFirstPayment) {
        const existingLimit = curAccess.mode === 'limited' ? (curAccess.lectureLimit || 0) : 0;
        newCourseAccess[cid] = { mode: 'limited', lectureLimit: Math.max(depositVids, existingLimit) };
      } else {
        const currentLimit = curAccess.mode === 'limited' ? (curAccess.lectureLimit || depositVids) : depositVids;
        newCourseAccess[cid] = { mode: 'limited', lectureLimit: currentLimit + perPayVids };
      }
    }
    updated = { ...updated, courseAccess: newCourseAccess };
  }

  const subExtraEntries: PaymentHistoryEntry[] = (subPayDraft.extraItems || [])
    .filter(i => i.amount && Number(i.amount) > 0)
    .map((i, ix) => ({
      id: `pay-${Date.now()}-xtra-${ix}`,
      amount: Number(i.amount),
      currency: subPayDraft.currency,
      paymentType: i.type,
      isInstallment: false,
      note: [i.label, ...noteParts].filter(Boolean).join(' | ') || undefined,
      paymentMethod: subPayDraft.paymentMethod || undefined,
      at: subPayDraft.date,
    }));
  if (subExtraEntries.length > 0) {
    updated = { ...updated, paymentHistory: [...(updated.paymentHistory || []), ...subExtraEntries] };
  }
  const existingIds = new Set((freshSub.paymentHistory || []).map(payment => payment.id));
  const newEntries = (updated.paymentHistory || []).filter(payment => !existingIds.has(payment.id));
  if (!newEntries.length) throw new Error('No valid payment entries were produced');
  try {
    const results: Array<{ status: string; approvalRequired?: boolean }> = [];
    for (const entry of newEntries) {
      results.push(await recordSubscriberPayment(
        freshSub.id,
        entry as unknown as Record<string, unknown>,
      ));
    }
    await reloadSubscribers();
    notify(
      'success',
      results.some(result => result.approvalRequired)
        ? 'تم تسجيل الدفعة كمعلّقة وتنتظر اعتماد الإدارة المالية.'
        : 'تم تسجيل الدفعة والقيد المحاسبي وتحديث الاشتراك بنجاح.',
    );
  } catch (error) {
    notify('error', error instanceof Error ? error.message : 'تعذر تسجيل الدفعة.');
    throw error;
  }
}

// ── handleLeadPayment ────────────────────────────────────────────────────────

interface HandleLeadPaymentDeps {
  leadPayRow: LeadItem | null;
  leads: LeadItem[];
  subscribers: SubscriberItem[];
  bundles: Bundle[];
  courses: Course[];
  branchLabelMap: Record<string, string>;
  recordSubscriberPayment: (
    subscriberId: string,
    payment: Record<string, unknown>,
  ) => Promise<{ status: string; approvalRequired?: boolean }>;
  reloadLeads: () => Promise<void>;
  reloadSubscribers: () => Promise<void>;
  notify: Notify;
  currentStaff: StaffMember | null;
  isAdmin: boolean;
  isSalesOnly: boolean;
  isDaqqiManager: boolean;
  isReceptionDaqqi: boolean;
  fetchSalesData: () => Promise<void>;
  setActiveTab: (tab: TabKey) => void;
}
export async function handleLeadPaymentFn(draft: PaymentDraft, deps: HandleLeadPaymentDeps): Promise<void> {
  const {
    leadPayRow, leads, subscribers, bundles, courses,
    branchLabelMap, recordSubscriberPayment,
    reloadLeads, reloadSubscribers, notify, currentStaff, isAdmin,
    isSalesOnly, isDaqqiManager, isReceptionDaqqi, fetchSalesData, setActiveTab,
  } = deps;
  if (!leadPayRow) return;
  const courseItemsComputed = draft.paymentType === 'course'
    ? [
        { courseId: draft.courseId, amount: draft.amount, customExpected: draft.customExpected, discountPct: draft.discountPct },
        ...draft.extraItems.filter(i => i.type === 'course').map(i => ({
          courseId: i.courseId || '', amount: i.amount, customExpected: i.customExpected || '', discountPct: i.discountPct || '',
        })),
      ].filter(item => item.courseId && item.amount)
    : [];
  const leadPayDraft = {
    ...draft,
    courseItems: courseItemsComputed,
    transferRef: draft.fromAccountNumber,
    extraItems: draft.extraItems.filter(i => i.type !== 'course'),
    discountPct: draft.discountPct,
    discountCustom: draft.customExpected,
  };
  const freshLead = leads.find(l => l.id === leadPayRow.id) || leadPayRow;
  const noteParts = [
    leadPayDraft.note,
    leadPayDraft.transactionId,
    leadPayDraft.transferRef ? `تحويل: ${leadPayDraft.transferRef}` : '',
    leadPayDraft.nationalId ? `ر.ق: ${leadPayDraft.nationalId}` : '',
    leadPayDraft.branch ? `فرع: ${branchLabelMap[leadPayDraft.branch] || leadPayDraft.branch}` : '',
  ].filter(Boolean);

  const normPhone = (freshLead.phone || '').replace(/\D/g, '');
  const normEmail = (freshLead.email || '').toLowerCase().trim();
  const existingSub = subscribers.find(s =>
    s.leadId === freshLead.id ||
    (normPhone.length > 5 && (s.phone || '').replace(/\D/g, '') === normPhone) ||
    (normEmail.length > 3 && (s.email || '').toLowerCase().trim() === normEmail)
  );
  const now = Date.now();
  const payEntries: Array<Record<string, unknown>> = [];
  if (leadPayDraft.paymentType === 'course') {
    const validItems = leadPayDraft.courseItems.filter(item => item.courseId && Number(item.amount) > 0);
    if (!validItems.length) throw new Error('اختر كورسًا أو باقة وأدخل مبلغًا صحيحًا.');
    validItems.forEach((item, index) => {
      const isBundle = item.courseId.startsWith('bundle:');
      const bundleId = isBundle ? item.courseId.replace('bundle:', '') : '';
      const bundle = bundleId ? bundles.find(row => row.id === bundleId) : null;
      const course = !isBundle ? courses.find(row => row.id === item.courseId) : null;
      const catalogPrice = bundle
        ? ((bundle.price as unknown as Record<string, number>)?.[leadPayDraft.currency] || 0)
        : (course?.price?.[leadPayDraft.currency as 'EGP' | 'SAR' | 'USD'] || 0);
      const customExpected = Number(item.customExpected) || 0;
      const discountPct = Number(item.discountPct) || 0;
      const expected = customExpected > 0
        ? customExpected
        : (discountPct > 0 && catalogPrice > 0 ? Math.round(catalogPrice * (1 - discountPct / 100)) : catalogPrice);
      if (expected <= 0) {
        throw new Error(`سعر ${leadPayDraft.currency} غير مُعرّف للكورس/الباقة؛ أدخل السعر النهائي قبل الحفظ.`);
      }
      const discountNote = discountPct > 0
        ? `خصم ${discountPct}%`
        : (customExpected > 0 && catalogPrice > 0 ? `سعر نهائي: ${customExpected}` : '');
      payEntries.push({
        id: `pay-${now}-${index}`,
        amount: Number(item.amount),
        currency: leadPayDraft.currency,
        paymentType: 'course',
        courseId: isBundle ? undefined : item.courseId,
        bundleId: isBundle ? bundleId : undefined,
        courseExpected: expected,
        isInstallment: leadPayDraft.bookingType === 'installment',
        note: [noteParts.join(' | '), discountNote].filter(Boolean).join(' | ') || undefined,
        paymentMethod: leadPayDraft.paymentMethod || undefined,
        transactionId: leadPayDraft.transactionId || undefined,
        fromAccountNumber: leadPayDraft.transferRef || undefined,
        at: leadPayDraft.date,
        status: 'paid',
        source: isReceptionDaqqi ? 'reception' : 'staff',
        staffId: currentStaff?.id,
        staffName: currentStaff?.name,
      });
    });
  } else {
    const amount = Number(leadPayDraft.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('أدخل مبلغًا صحيحًا أكبر من صفر.');
    payEntries.push({
      id: `pay-${now}`,
      amount,
      currency: leadPayDraft.currency,
      paymentType: leadPayDraft.paymentType,
      courseId: leadPayDraft.courseId || undefined,
      isInstallment: leadPayDraft.bookingType === 'installment',
      note: noteParts.join(' | ') || undefined,
      paymentMethod: leadPayDraft.paymentMethod || undefined,
      transactionId: leadPayDraft.transactionId || undefined,
      fromAccountNumber: leadPayDraft.transferRef || undefined,
      at: leadPayDraft.date,
      status: 'paid',
      source: isReceptionDaqqi ? 'reception' : 'staff',
      staffId: currentStaff?.id,
      staffName: currentStaff?.name,
    });
  }
  (leadPayDraft.extraItems || [])
    .filter(item => Number(item.amount) > 0)
    .forEach((item, index) => payEntries.push({
      id: `pay-${now}-extra-${index}`,
      amount: Number(item.amount),
      currency: leadPayDraft.currency,
      paymentType: item.type,
      note: [item.label, ...noteParts].filter(Boolean).join(' | ') || undefined,
      paymentMethod: leadPayDraft.paymentMethod || undefined,
      transactionId: leadPayDraft.transactionId || undefined,
      fromAccountNumber: leadPayDraft.transferRef || undefined,
      at: leadPayDraft.date,
      status: 'paid',
      source: isReceptionDaqqi ? 'reception' : 'staff',
      staffId: currentStaff?.id,
      staffName: currentStaff?.name,
    }));

  if (payEntries.length !== 1) {
    throw new Error('تسجيل أكثر من بند دفع في عملية واحدة متوقف مؤقتًا لحين اعتماد مسار تجزئة الدفع.');
  }
  const results: Array<{ status: string; approvalRequired?: boolean }> = [];
  try {
    const result = existingSub
      ? await recordSubscriberPayment(existingSub.id, payEntries[0])
      : await mysqlAdmin.saveLeadPayment(
          freshLead.id,
          payEntries[0],
          {
            email: leadPayDraft.email || freshLead.email,
            nationalId: leadPayDraft.nationalId || undefined,
          },
        ) as { status: string; approvalRequired?: boolean };
    results.push(result);
    await Promise.all([reloadSubscribers(), reloadLeads()]);
  } catch (error) {
    await Promise.allSettled([reloadSubscribers(), reloadLeads()]);
    notify('error', error instanceof Error ? error.message : 'تعذر تسجيل الدفعة.');
    throw error;
  }

  const _notifCourse = leadPayDraft.paymentType === 'course'
    ? leadPayDraft.courseItems.filter(i => i.courseId && i.amount).map(i => {
        if (i.courseId.startsWith('bundle:')) return bundles.find(b => b.id === i.courseId.replace('bundle:', ''))?.title || '';
        return courses.find(c => c.id === i.courseId)?.title || '';
      }).filter(Boolean).join(' + ')
    : '';
  const _notifAmt = leadPayDraft.paymentType === 'course'
    ? leadPayDraft.courseItems.reduce((s, i) => s + (Number(i.amount) || 0), 0)
    : Number(leadPayDraft.amount);
  const isPendingApproval = results.some(result => result.approvalRequired || result.status === 'pending');
  notify(
    'success',
    isPendingApproval
      ? `تم تسجيل دفعة ${freshLead.name} كمعلّقة وتنتظر اعتماد الإدارة المالية.`
      : `تم تسجيل دفعة ${freshLead.name}${_notifCourse ? ' — ' + _notifCourse : ''} | ${_notifAmt.toLocaleString()} ${leadPayDraft.currency}`,
  );
  if (leadPayDraft.paymentType === 'course' && !isPendingApproval) {
    const _welcomeEmail = leadPayDraft.email || freshLead.email;
    if (_welcomeEmail && _welcomeEmail.includes('@')) {
      const _courseTitles = leadPayDraft.courseItems
        .filter(i => i.courseId)
        .map(i => {
          if (i.courseId.startsWith('bundle:')) return bundles.find(b => b.id === i.courseId.replace('bundle:', ''))?.title || i.courseId;
          return courses.find(c => c.id === i.courseId)?.title || i.courseId;
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
  if (isSalesOnly || isDaqqiManager || isReceptionDaqqi) void fetchSalesData();
  if (normBranchId(leadPayDraft.branch || freshLead.branch || '') === 'DAQQI' && (isDaqqiManager || isReceptionDaqqi || isAdmin)) {
    setActiveTab('daqqi_clients');
  }
}
