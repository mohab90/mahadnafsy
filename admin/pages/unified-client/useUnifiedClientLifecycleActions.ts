import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { arabicReason } from '../../lib/apiErrorText';
import { mysqlAdmin } from '../../lib/mysqlapi';
import type { LeadItem, SubscriberCertificate, SubscriberItem } from '../../types';
import { generatePromoCode } from './constants';
import { useUnifiedClientCertificateState } from './useUnifiedClientCertificateState';
import { alertDialog, promptDialog } from '../../../shared/ui/promptDialog';
import { confirmDialog } from '../../../shared/ui/confirmDialog';

interface Params {
  lead?: LeadItem;
  subscriber?: SubscriberItem;
  isSaving: boolean;
  setIsSaving: (saving: boolean) => void;
  setLeadDraft: Dispatch<SetStateAction<LeadItem>>;
  updateLead: (lead: LeadItem) => Promise<boolean>;
  reloadLeads: () => Promise<unknown>;
  reloadSubscribers: () => Promise<unknown>;
  /** «بيانات الشهادة»: whether this viewer may open it, and how it tells them what happened. */
  certificateData?: { allowed: boolean; notify: (type: 'success' | 'error' | 'info', text: string) => void };
}

function persistenceError(field: string, error: unknown) {
  window.dispatchEvent(new CustomEvent('site-persist-error', {
    detail: {
      field,
      name: error instanceof Error ? error.message : 'تعذر حفظ العملية',
      reason: arabicReason(error),
    },
  }));
}

export function useUnifiedClientLifecycleActions(params: Params) {
  const {
    lead, subscriber, isSaving, setIsSaving, setLeadDraft,
    updateLead, reloadLeads, reloadSubscribers,
  } = params;
  const certificateState = useUnifiedClientCertificateState(params.certificateData && {
    ...params.certificateData, subscriberId: subscriber?.id, onSaved: reloadSubscribers,
  });
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertCourseId, setConvertCourseId] = useState(lead?.enrolledCourseId || '');
  const [convertAccessMode, setConvertAccessMode] = useState<'full' | 'limited'>('full');
  const [convertPartialCount, setConvertPartialCount] = useState(1);
  const [promoCopied, setPromoCopied] = useState(false);
  const [subCerts, setSubCerts] = useState<SubscriberCertificate[]>(subscriber?.certificates ?? []);

  useEffect(() => {
    setSubCerts(subscriber?.certificates ?? []);
  }, [subscriber?.id, subscriber?.certificates]);
  useEffect(() => {
    setConvertCourseId(lead?.enrolledCourseId || '');
  }, [lead?.id, lead?.enrolledCourseId]);

  const handleConvert = async () => {
    if (isSaving || !convertCourseId || !lead) return;
    setIsSaving(true);
    try {
      await mysqlAdmin.convertLead(lead.id, {
        courseId: convertCourseId,
        accessMode: convertAccessMode,
      });
      await Promise.all([reloadLeads(), reloadSubscribers()]);
      setShowConvertModal(false);
    } catch (error) {
      persistenceError('leadConversion', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleGeneratePromo = async () => {
    if (!lead) return;
    const code = generatePromoCode(lead.name);
    if (await updateLead({ ...lead, promoCode: code })) {
      setLeadDraft(current => ({ ...current, promoCode: code }));
    }
  };

  const handleCertificateLifecycle = async (
    certificateId: string,
    action: 'revoke' | 'reissue' | 'delete',
  ) => {
    if (action === 'delete') {
      // «في شهادات غلط محتاج يبقى جنبها زر حذف»: a revoked certificate comes off the client's page for good.
      if (!await confirmDialog('تحذف الشهادة الغلط دي من صفحة العميل؟')) return;
      try {
        await mysqlAdmin.adminDelete(`/admin/completions/${encodeURIComponent(certificateId)}`);
        setSubCerts(current => current.filter(certificate => certificate.id !== certificateId));
        await reloadSubscribers();
      } catch (error) {
        await alertDialog(error instanceof Error ? error.message : 'تعذر حذف الشهادة');
      }
      return;
    }
    const reason = await promptDialog(
      action === 'revoke' ? 'سبب إلغاء الشهادة:' : 'سبب إعادة إصدار الشهادة:',
    );
    if (!reason?.trim()) return;
    try {
      const result = action === 'revoke'
        ? await mysqlAdmin.revokeCourseCompletion(certificateId, reason.trim())
        : await mysqlAdmin.reissueCourseCompletion(certificateId, reason.trim());
      setSubCerts(current => current.map(certificate => certificate.id === certificateId ? {
        ...certificate,
        status: String(result.status || (action === 'revoke' ? 'revoked' : 'active')) as 'active' | 'revoked',
        certificateNumber: String(result.certificate_code || certificate.certificateNumber),
        version: Number(result.version || certificate.version || 1),
        revokeReason: action === 'revoke' ? reason.trim() : undefined,
      } : certificate));
      await reloadSubscribers();
    } catch (error) {
      await alertDialog(error instanceof Error ? error.message : 'تعذر تحديث حالة الشهادة');
    }
  };

  return {
    ...certificateState,
    showConvertModal, setShowConvertModal,
    convertCourseId, setConvertCourseId, convertAccessMode, setConvertAccessMode,
    convertPartialCount, setConvertPartialCount,
    promoCopied, setPromoCopied,
    subCerts,
    activeSubCerts: subCerts.filter(certificate => certificate.status !== 'revoked'),
    extraReqs: subscriber?.extraCertificateRequests ?? [],
    handleConvert, handleGeneratePromo, handleCertificateLifecycle,
  };
}
