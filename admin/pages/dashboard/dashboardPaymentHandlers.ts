import type {
  Bundle, BranchType, Course, CourseAccessSetting,
  ExtraCertificateRequest, ExtraCertificateType,
  InstallmentEntry, InstallmentPlan,
  LeadItem, PaymentHistoryEntry, StaffMember, SubscriberItem,
} from '../../types';
import type { PaymentDraft } from '../../components/PaymentModal';
import type { TabKey } from './navigation';
import { normBranchId } from './dashboardShared';
import { mysqlAdmin } from '../../lib/mysqlapi';

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

// ── handleSubPayment ─────────────────────────────────────────────────────────

interface HandleSubPaymentDeps {
  subPayRow: SubscriberItem | null;
  subscribers: SubscriberItem[];
  bundles: Bundle[];
  courses: Course[];
  content: Record<string, string>;
  updateSubscriber: (sub: SubscriberItem) => void;
  notify: Notify;
  currentStaff: StaffMember | null;
  isAdmin: boolean;
}

export function handleSubPaymentFn(draft: PaymentDraft, deps: HandleSubPaymentDeps): void {
  const { subPayRow, subscribers, bundles, courses, content, updateSubscriber, notify, currentStaff, isAdmin } = deps;
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
      const _bundleCatalog = isBundleItem && bObj ? ((bObj.price as any)?.[subPayDraft.currency] || (bObj.price as any)?.EGP || 0) : 0;
      const _courseCatalog = !isBundleItem && item.courseId ? (courses.find(c => c.id === item.courseId)?.price?.[subPayDraft.currency as 'EGP'|'SAR'|'USD'] || courses.find(c => c.id === item.courseId)?.price?.EGP || 0) : 0;
      const _catalogPx = isBundleItem ? _bundleCatalog : _courseCatalog;
      const _customExpSub = Number(item.customExpected) || 0;
      const _discPctSub = Number(item.discountPct) || 0;
      const _itemExpected = _customExpSub > 0 ? _customExpSub : (_discPctSub > 0 && _catalogPx > 0 ? Math.round(_catalogPx * (1 - _discPctSub / 100)) : _catalogPx);
      const entry: PaymentHistoryEntry = {
        id: `pay-${Date.now()}-${item.courseId}`,
        amount: Number(item.amount),
        courseExpected: _itemExpected > 0 ? _itemExpected : Number(item.amount),
        currency: subPayDraft.currency,
        paymentType: subPayDraft.paymentType,
        isInstallment: false,
        courseId: isBundleItem ? undefined : (item.courseId || undefined),
        note: [noteParts.join(' | '), isBundleItem && bObj ? `مسار تعليمي: ${bObj.title}` : undefined].filter(Boolean).join(' | ') || undefined,
        paymentMethod: subPayDraft.paymentMethod || undefined,
        at: subPayDraft.date,
        staffId: currentStaff?.id || undefined,
        staffName: currentStaff?.name || undefined,
        status: isAdmin ? 'paid' : 'pending',
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
      ? ((bundle.price as any)?.[subPayDraft.currency] || (bundle.price as any)?.EGP || 0)
      : (!isBundleSelection && subPayDraft.courseId ? (courses.find(c => c.id === subPayDraft.courseId)?.price?.[subPayDraft.currency as 'EGP'|'SAR'|'USD'] || courses.find(c => c.id === subPayDraft.courseId)?.price?.EGP || 0) : 0);
    const entry: PaymentHistoryEntry = {
      id: `pay-${Date.now()}`,
      amount: Number(subPayDraft.amount),
      courseExpected: subPayDraft.bookingType !== 'installment' && _singleExpected > 0 ? _singleExpected : undefined,
      currency: subPayDraft.currency,
      paymentType: subPayDraft.paymentType,
      isInstallment: subPayDraft.bookingType === 'installment',
      courseId: isBundleSelection ? undefined : (subPayDraft.courseId || undefined),
      note: [noteParts.join(' | '), isBundleSelection && bundle ? `مسار تعليمي: ${bundle.title}` : undefined].filter(Boolean).join(' | ') || undefined,
      paymentMethod: subPayDraft.paymentMethod || undefined,
      at: subPayDraft.date,
      staffId: currentStaff?.id || undefined,
      staffName: currentStaff?.name || undefined,
      status: isAdmin ? 'paid' : 'pending',
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
        .filter(p => p.courseId === cid && (p.paymentType === 'course' || !p.paymentType))
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
  updateSubscriber(updated);
  notify('success', 'تم تسجيل الدفعة بنجاح.');
}

// ── handleLeadPayment ────────────────────────────────────────────────────────

interface HandleLeadPaymentDeps {
  leadPayRow: LeadItem | null;
  leads: LeadItem[];
  subscribers: SubscriberItem[];
  bundles: Bundle[];
  courses: Course[];
  content: Record<string, string>;
  updateSubscriber: (sub: SubscriberItem) => void;
  updateLead: (lead: LeadItem) => void;
  addSubscriber: (sub: SubscriberItem) => Promise<boolean>;
  issueClientCodeAsync: () => Promise<string>;
  branchLabelMap: Record<string, string>;
  notify: Notify;
  isAdmin: boolean;
  isSalesOnly: boolean;
  isDaqqiManager: boolean;
  isReceptionDaqqi: boolean;
  fetchSalesData: () => Promise<void>;
  setActiveTab: (tab: TabKey) => void;
}

export async function handleLeadPaymentFn(draft: PaymentDraft, deps: HandleLeadPaymentDeps): Promise<void> {
  const { leadPayRow, leads, subscribers, bundles, courses, content, updateSubscriber, updateLead, addSubscriber, issueClientCodeAsync, branchLabelMap, notify, isAdmin, isSalesOnly, isDaqqiManager, isReceptionDaqqi, fetchSalesData, setActiveTab } = deps;
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
  const noteParts = [leadPayDraft.note, leadPayDraft.transactionId, leadPayDraft.transferRef ? `تحويل: ${leadPayDraft.transferRef}` : '', leadPayDraft.nationalId ? `ر.ق: ${leadPayDraft.nationalId}` : '', leadPayDraft.branch ? `فرع: ${branchLabelMap[leadPayDraft.branch] || leadPayDraft.branch}` : ''].filter(Boolean);
  const isMultiCourse = leadPayDraft.paymentType === 'course';

  const normPhone = (freshLead.phone || '').replace(/\D/g, '');
  const normEmail = (freshLead.email || '').toLowerCase().trim();
  const existingSub = subscribers.find(s =>
    s.leadId === freshLead.id ||
    (normPhone.length > 5 && (s.phone || '').replace(/\D/g, '') === normPhone) ||
    (normEmail.length > 3 && (s.email || '').toLowerCase().trim() === normEmail)
  );
  let updatedLead = { ...freshLead };

  if (isMultiCourse) {
    const validItems = leadPayDraft.courseItems.filter(item => item.courseId && item.amount);
    if (validItems.length === 0) return;

    const payEntries: PaymentHistoryEntry[] = [
      ...validItems.map(item => {
        const _isBndl = item.courseId.startsWith('bundle:');
        const _bId = _isBndl ? item.courseId.replace('bundle:', '') : null;
        const _bObj = _bId ? bundles.find(b => b.id === _bId) : null;
        const _catalogPxL = _isBndl && _bObj
          ? ((_bObj.price as unknown as Record<string,number>)?.[leadPayDraft.currency] || (_bObj.price as unknown as Record<string,number>)?.EGP || 0)
          : (courses.find(c => c.id === item.courseId)?.price?.[leadPayDraft.currency as 'EGP'|'SAR'|'USD'] || courses.find(c => c.id === item.courseId)?.price?.EGP || 0);
        const _customExpL = Number(item.customExpected) || 0;
        const _discPctL = Number(item.discountPct) || 0;
        const _itemExpectedL = _customExpL > 0 ? _customExpL : (_discPctL > 0 && _catalogPxL > 0 ? Math.round(_catalogPxL * (1 - _discPctL / 100)) : _catalogPxL);
        const _discNoteL = _discPctL > 0 ? `خصم ${_discPctL}%` : (_customExpL > 0 && _catalogPxL > 0 ? `سعر نهائي: ${_customExpL}` : '');
        return {
          id: `pay-${Date.now()}-${item.courseId}`,
          amount: Number(item.amount),
          courseExpected: _itemExpectedL > 0 ? _itemExpectedL : Number(item.amount),
          currency: leadPayDraft.currency,
          paymentType: leadPayDraft.paymentType,
          isInstallment: false,
          courseId: item.courseId || undefined,
          note: [noteParts.join(' | '), _discNoteL].filter(Boolean).join(' | ') || undefined,
          paymentMethod: leadPayDraft.paymentMethod || undefined,
          at: leadPayDraft.date,
        } as PaymentHistoryEntry;
      }),
      ...(leadPayDraft.extraItems || []).filter(i => i.amount && Number(i.amount) > 0).map((i, ix) => ({
        id: `pay-${Date.now()}-xtra-${ix}`,
        amount: Number(i.amount),
        currency: leadPayDraft.currency,
        paymentType: i.type,
        isInstallment: false,
        note: [i.label, ...noteParts].filter(Boolean).join(' | ') || undefined,
        paymentMethod: leadPayDraft.paymentMethod || undefined,
        at: leadPayDraft.date,
      } as PaymentHistoryEntry)),
    ];
    const enrollIds: string[] = [];
    for (const item of validItems) {
      if (item.courseId.startsWith('bundle:')) {
        const bId = item.courseId.replace('bundle:', '');
        const bObj = bundles.find(b => b.id === bId);
        if (bObj) enrollIds.push(...bObj.courses.map((c: { id: string }) => c.id));
        else enrollIds.push(item.courseId);
      } else {
        enrollIds.push(item.courseId);
      }
    }
    const enrollIds_unique = [...new Set(enrollIds)];
    const _leadDepositVids = Math.max(1, Number(content['access.videos_on_deposit'] || 20));
    const courseAccessPatch = Object.fromEntries(enrollIds_unique.map(id => [id, { mode: 'limited' as const, lectureLimit: _leadDepositVids }]));

    if (existingSub) {
      const allCourseIds = [...new Set([...(existingSub.enrolledCourseIds || []), ...enrollIds_unique])];
      updateSubscriber({
        ...existingSub,
        enrolledCourseIds: allCourseIds,
        courseAccess: { ...(existingSub.courseAccess ?? {}), ...courseAccessPatch },
        paymentHistory: [...(existingSub.paymentHistory || []), ...payEntries],
        leadId: existingSub.leadId || freshLead.id,
      });
    } else {
      const added = await addSubscriber({
        id: `sub-${Date.now()}`, clientCode: freshLead.clientCode || await issueClientCodeAsync(),
        leadId: freshLead.id, name: freshLead.name, email: freshLead.email, phone: freshLead.phone,
        enrolledCourseIds: enrollIds_unique, courseAccess: courseAccessPatch,
        paymentHistory: payEntries, branch: (freshLead.branch as BranchType) || undefined,
        status: 'active', assignedSalesId: freshLead.assignedSalesId, assignedSalesName: freshLead.assignedSalesName,
        createdAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      } as SubscriberItem);
      if (!added) { notify('error', 'فشل إنشاء المشترك'); return; }
    }
    updatedLead = { ...updatedLead, status: 'converted' };
  } else {
    if (!leadPayDraft.amount) return;
    const payHistEntry: PaymentHistoryEntry = {
      id: `pay-${Date.now()}`, amount: Number(leadPayDraft.amount),
      currency: leadPayDraft.currency, paymentType: leadPayDraft.paymentType,
      isInstallment: leadPayDraft.bookingType === 'installment',
      courseId: leadPayDraft.courseId || undefined,
      note: noteParts.join(' | ') || undefined,
      paymentMethod: leadPayDraft.paymentMethod || undefined,
      at: leadPayDraft.date,
    };
    const _subExtra = {
      ...(leadPayDraft.nationalId ? { nationalId: leadPayDraft.nationalId } : {}),
      ...(leadPayDraft.email && leadPayDraft.email.includes('@') ? { email: leadPayDraft.email } : {}),
    };
    if (leadPayDraft.bookingType === 'new_booking' && leadPayDraft.paymentType === 'course' && leadPayDraft.courseId) {
      const _singleDepVids = Math.max(1, Number(content['access.videos_on_deposit'] || 20));
      const _initAccess = { mode: 'limited' as const, lectureLimit: _singleDepVids };
      if (existingSub) {
        const newCourseIds = (existingSub.enrolledCourseIds || []).includes(leadPayDraft.courseId)
          ? (existingSub.enrolledCourseIds || [])
          : [...(existingSub.enrolledCourseIds || []), leadPayDraft.courseId];
        updateSubscriber({ ...existingSub, ..._subExtra, enrolledCourseIds: newCourseIds, courseAccess: { ...(existingSub.courseAccess ?? {}), [leadPayDraft.courseId]: _initAccess }, paymentHistory: [...(existingSub.paymentHistory || []), payHistEntry], leadId: existingSub.leadId || freshLead.id });
      } else {
        const added = await addSubscriber({ id: `sub-${Date.now()}`, clientCode: freshLead.clientCode || await issueClientCodeAsync(), leadId: freshLead.id, name: freshLead.name, email: leadPayDraft.email || freshLead.email, phone: freshLead.phone, enrolledCourseIds: [leadPayDraft.courseId], courseAccess: { [leadPayDraft.courseId]: _initAccess }, paymentHistory: [payHistEntry], branch: (freshLead.branch as BranchType) || undefined, status: 'active', assignedSalesId: freshLead.assignedSalesId, assignedSalesName: freshLead.assignedSalesName, createdAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), ..._subExtra } as SubscriberItem);
        if (!added) { notify('error', 'فشل إنشاء المشترك'); return; }
      }
      updatedLead = { ...updatedLead, status: 'converted' };
    } else if (existingSub) {
      updateSubscriber({ ...existingSub, ..._subExtra, paymentHistory: [...(existingSub.paymentHistory || []), payHistEntry] });
    } else {
      await addSubscriber({ id: `sub-${Date.now()}`, clientCode: freshLead.clientCode || await issueClientCodeAsync(), leadId: freshLead.id, name: freshLead.name, email: leadPayDraft.email || freshLead.email, phone: freshLead.phone, enrolledCourseIds: [], paymentHistory: [payHistEntry], branch: (freshLead.branch as BranchType) || undefined, status: 'active', assignedSalesId: freshLead.assignedSalesId, assignedSalesName: freshLead.assignedSalesName, createdAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), ..._subExtra } as SubscriberItem);
    }
  }

  updateLead(updatedLead);
  const _notifCourse = leadPayDraft.paymentType === 'course'
    ? leadPayDraft.courseItems.filter(i => i.courseId && i.amount).map(i => {
        if (i.courseId.startsWith('bundle:')) return bundles.find(b => b.id === i.courseId.replace('bundle:', ''))?.title || '';
        return courses.find(c => c.id === i.courseId)?.title || '';
      }).filter(Boolean).join(' + ')
    : '';
  const _notifAmt = leadPayDraft.paymentType === 'course'
    ? leadPayDraft.courseItems.reduce((s, i) => s + (Number(i.amount) || 0), 0)
    : Number(leadPayDraft.amount);
  notify('success', `✅ ${updatedLead.name}${_notifCourse ? ' — ' + _notifCourse : ''} | ${_notifAmt.toLocaleString()} ${leadPayDraft.currency}`);
  if (leadPayDraft.paymentType === 'course' && updatedLead.status === 'converted') {
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

// ── handleDashInstCreate ─────────────────────────────────────────────────────

type SubInstDraft = {
  courseId: string;
  currency: 'EGP' | 'SAR' | 'USD';
  amountPerInst: string;
  numInstallments: string;
  inputMode: 'count' | 'amount';
  startDate: string;
  intervalDays: string;
  notes: string;
  overrideExpected: string;
};

interface HandleDashInstCreateDeps {
  subInstRow: SubscriberItem | null;
  setSubInstRow: (r: SubscriberItem | null) => void;
  subInstDraft: SubInstDraft;
  setSubInstDraft: (d: SubInstDraft) => void;
  bundles: Bundle[];
  courses: Course[];
  updateSubscriber: (sub: SubscriberItem) => void;
  notify: Notify;
}

export function handleDashInstCreateFn(deps: HandleDashInstCreateDeps): void {
  const { subInstRow, setSubInstRow, subInstDraft, setSubInstDraft, bundles, courses, updateSubscriber, notify } = deps;
  if (!subInstRow || !subInstDraft.courseId || !subInstDraft.numInstallments) return;
  const row = subInstRow;
  const payments = row.paymentHistory || [];
  const isAllSel = subInstDraft.courseId === '__all__';
  const isBundleSel = !isAllSel && subInstDraft.courseId.startsWith('bundle:');
  let expectedAmount: number;
  let paidAmount: number;
  let resolvedCourseId: string | undefined;
  let resolvedTitle: string | undefined;
  if (isAllSel) {
    const rowBundles = bundles.filter(b => b.courses.length > 0 && b.courses.every(co => row.enrolledCourseIds.includes(co.id)));
    const bundledCids = new Set(rowBundles.flatMap(b => b.courses.map(c => c.id)));
    const partIds = (row.enrolledCourseIds || []).filter((cid: string) => !bundledCids.has(cid));
    if (subInstDraft.overrideExpected) {
      expectedAmount = Number(subInstDraft.overrideExpected);
    } else {
      expectedAmount = 0;
      rowBundles.forEach(b => {
        const bCids = b.courses.map(c => c.id);
        const bPays = payments.filter(p => bCids.includes(p.courseId || '') || p.courseId === `bundle:${b.id}`);
        const nb = bPays.find(p => !p.isInstallment);
        expectedAmount += nb?.courseExpected || (b.price as any)?.EGP || b.courses.reduce((s, c) => s + (c.price?.EGP || 0), 0) || 0;
      });
      partIds.forEach((cid: string) => {
        const c = courses.find(x => x.id === cid);
        const cPays = payments.filter(p => p.courseId === cid);
        const nb = cPays.find(p => !p.isInstallment);
        expectedAmount += nb?.courseExpected || c?.price?.EGP || 0;
      });
    }
    paidAmount = payments.filter(p => !p.isInstallment).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    resolvedCourseId = undefined;
    resolvedTitle = 'كل الكورسات';
  } else if (isBundleSel) {
    const bid = subInstDraft.courseId.replace('bundle:', '');
    const b = bundles.find(x => x.id === bid);
    const bCids = b?.courses.map(c => c.id) || [];
    const bPays = payments.filter(p => bCids.includes(p.courseId || '') || p.courseId === subInstDraft.courseId || (!p.courseId && !row.enrolledCourseIds.some((cid: string) => !bCids.includes(cid))));
    expectedAmount = subInstDraft.overrideExpected
      ? Number(subInstDraft.overrideExpected)
      : ((b?.price as any)?.EGP || b?.courses.reduce((s, c) => s + (c.price?.EGP || 0), 0) || 0);
    paidAmount = bPays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    resolvedCourseId = undefined;
    resolvedTitle = b?.title;
  } else {
    const cid = subInstDraft.courseId;
    const cPays = payments.filter(p => p.courseId === cid || (!p.courseId && payments.length === 1));
    const c = courses.find(x => x.id === cid);
    const bookingEntry = cPays.find(p => !p.isInstallment);
    expectedAmount = subInstDraft.overrideExpected
      ? Number(subInstDraft.overrideExpected)
      : (bookingEntry?.courseExpected || c?.price?.EGP || 0);
    paidAmount = cPays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    resolvedCourseId = cid;
    resolvedTitle = c?.title;
  }
  const remaining = Math.max(0, expectedAmount - paidAmount);
  if (remaining <= 0) { notify('info', 'المبلغ المتبقي صفر — لا يوجد أقساط للإنشاء.'); return; }
  const n = Math.max(1, Number(subInstDraft.numInstallments));
  const perInstRaw = subInstDraft.inputMode === 'amount' && subInstDraft.amountPerInst
    ? Number(subInstDraft.amountPerInst) : Math.floor(remaining / n);
  const perInst = Math.max(1, perInstRaw);
  const actualN = subInstDraft.inputMode === 'amount' && subInstDraft.amountPerInst
    ? Math.ceil(remaining / perInst) : n;
  const intervalDays = Number(subInstDraft.intervalDays || 30);
  const startDate = new Date(subInstDraft.startDate);
  const entries: InstallmentEntry[] = Array.from({ length: actualN }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i * intervalDays);
    const isLast = i === actualN - 1;
    return { id: `ie-${Date.now()}-${i}`, amount: isLast ? Math.max(1, remaining - perInst * (actualN - 1)) : perInst, currency: subInstDraft.currency, dueDate: d.toISOString().slice(0, 10) };
  });
  const plan: InstallmentPlan = {
    id: `ip-${Date.now()}`, courseId: resolvedCourseId, courseTitle: resolvedTitle,
    totalAmount: remaining, currency: subInstDraft.currency,
    downPayment: paidAmount > 0 ? paidAmount : undefined,
    entries, notes: subInstDraft.notes || undefined,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  updateSubscriber({ ...row, installmentPlans: [...(row.installmentPlans || []), plan] });
  notify('success', `تم إنشاء خطة الأقساط (${actualN} قسط) بنجاح.`);
  setSubInstRow(null);
  setSubInstDraft({ courseId: '', currency: 'EGP', amountPerInst: '', numInstallments: '3', inputMode: 'count', startDate: new Date().toISOString().slice(0, 10), intervalDays: '30', notes: '', overrideExpected: '' });
}
