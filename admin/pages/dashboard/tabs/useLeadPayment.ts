import { useState } from 'react';
import { useSiteData } from '../../../context/SiteDataContext';
import type { LeadItem, SubscriberItem, PaymentHistoryEntry, PaymentItemType, BranchType, CourseAccessSetting } from '../../../types';
import { PaymentDraft, blankPaymentDraft } from '../../../components/PaymentModal';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { normBranchId } from './leads/LeadSubcomponents';
import type { NotifyFn } from './CrmSettingsModal';

interface UseLeadPaymentArgs {
  effectiveLeads: LeadItem[];
  effectiveSubs: SubscriberItem[];
  branchLabelMap: Record<string, string>;
  isSalesOnly: boolean;
  fetchSalesData?: () => void;
  setActiveDashboardTab?: (tab: string) => void;
  notify: NotifyFn;
}

// Lead → subscriber conversion + payment recording. The 220-line handler was moved
// verbatim out of LeadsTab. Complex context fns (addSubscriber/updateSubscriber/...)
// come from useSiteData here (auto-typed); the scoped/derived values are args.
export function useLeadPayment({ effectiveLeads, effectiveSubs, branchLabelMap, isSalesOnly, fetchSalesData, setActiveDashboardTab, notify }: UseLeadPaymentArgs) {
  const { bundles, courses, addSubscriber, updateSubscriber, updateLead, issueClientCodeAsync } = useSiteData();
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
          createdAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
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
          const added = await addSubscriber({ id: `sub-${Date.now()}`, clientCode: freshLead.clientCode || await issueClientCodeAsync(), leadId: freshLead.id, name: freshLead.name, email: leadPayDraft.email || freshLead.email, phone: freshLead.phone, enrolledCourseIds: singleEnrollIds, courseAccess: singleAccessPatch, paymentHistory: [{ ...payHistEntry, note: singleNote }], branch: ((leadPayDraft.branch || freshLead.branch) as BranchType) || undefined, status: 'active', assignedSalesId: freshLead.assignedSalesId, assignedSalesName: freshLead.assignedSalesName, createdAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) });
          if (!added) { notify('error', 'فشل إنشاء المشترك'); return; }
        }
        updatedLead = { ...updatedLead, status: 'converted', email: leadPayDraft.email || updatedLead.email };
      } else if (existingSub) {
        updateSubscriber({ ...existingSub, paymentHistory: [...(existingSub.paymentHistory || []), payHistEntry] });
      } else {
        await addSubscriber({ id: `sub-${Date.now()}`, clientCode: freshLead.clientCode || await issueClientCodeAsync(), leadId: freshLead.id, name: freshLead.name, email: freshLead.email, phone: freshLead.phone, enrolledCourseIds: [], paymentHistory: [payHistEntry], branch: ((leadPayDraft.branch || freshLead.branch) as BranchType) || undefined, status: 'active', assignedSalesId: freshLead.assignedSalesId, assignedSalesName: freshLead.assignedSalesName, createdAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) });
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

  return {
    leadPayRow, setLeadPayRow,
    leadPayDraft, setLeadPayDraft,
    showDiscountSection, setShowDiscountSection,
    leadPayPrintData, setLeadPayPrintData,
    handleLeadPayment,
  };
}
