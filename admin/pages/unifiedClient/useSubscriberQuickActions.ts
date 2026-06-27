import { useState } from 'react';
import { useSiteData } from '../../context/SiteDataContext';
import { mysqlAdmin } from '../../lib/mysqlapi';
import type {
  SubscriberItem, ExtraCertificateRequest, ExtraCertificateType, PaymentItemType,
} from '../../types';

/**
 * Three small "add X to this subscriber" forms that share the same dependencies
 * (subscriber + updateSubscriber + a belt-and-suspenders enrollments write):
 *   - grant a course (free access)
 *   - request an extra certificate
 *   - record a legacy payment (old clients with custom prices)
 *
 * Extracted verbatim from UnifiedClientPage; returns identical names so the
 * render JSX is unchanged.
 */
export function useSubscriberQuickActions(subscriber: SubscriberItem | undefined) {
  const { updateSubscriber } = useSiteData();

  // grant (subscriber)
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [grantDraft, setGrantDraft] = useState({ courseId: '', note: '' });

  // extra certificate request form
  const [showExtraCertForm, setShowExtraCertForm] = useState(false);
  const [extraCertDraft, setExtraCertDraft] = useState<{ courseId: string; type: ExtraCertificateType | ''; certExpected: string; certPaid: string }>({ courseId: '', type: '', certExpected: '', certPaid: '' });

  // legacy payment (old clients with custom prices)
  const [showLegacyPayForm, setShowLegacyPayForm] = useState(false);
  const [legacyPayDraft, setLegacyPayDraft] = useState({ courseId: '', courseExpected: '', amountPaid: '', note: '' });

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
      requestedAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false }),
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
    const subHistory = subscriber.paymentHistory ?? [];
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

  return {
    showGrantForm, setShowGrantForm, grantDraft, setGrantDraft, handleGrant,
    showExtraCertForm, setShowExtraCertForm, extraCertDraft, setExtraCertDraft, handleAddExtraCertRequest,
    showLegacyPayForm, setShowLegacyPayForm, legacyPayDraft, setLegacyPayDraft, handleAddLegacyPayment,
  };
}
