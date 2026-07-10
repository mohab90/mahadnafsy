import React from 'react';
import AccessControlModal from '../unifiedClient/AccessControlModal';
import ContactPopupModal from '../unifiedClient/ContactPopupModal';
import ConvertModal from '../unifiedClient/ConvertModal';
import GrantCourseModal from '../unifiedClient/GrantCourseModal';
import InstallmentPlanModal from '../unifiedClient/InstallmentPlanModal';
import AddCommModal from '../unifiedClient/AddCommModal';
import LeadPaymentModal from '../unifiedClient/LeadPaymentModal';
import ExtraCertRequestModal from '../unifiedClient/ExtraCertRequestModal';
import LegacyPaymentModal from '../unifiedClient/LegacyPaymentModal';
import CertificateViewModal from '../unifiedClient/CertificateViewModal';
import PaymentDetailModal from '../unifiedClient/PaymentDetailModal';

interface Props {
  isSub: boolean;
  showAccessModal: boolean;
  canManageCourseAccess: boolean;
  accessControlProps: React.ComponentProps<typeof AccessControlModal> | null;
  showContactPopup: boolean;
  contactPopupProps: React.ComponentProps<typeof ContactPopupModal>;
  showConvertModal: boolean;
  hasLead: boolean;
  convertProps: React.ComponentProps<typeof ConvertModal>;
  showGrantForm: boolean;
  grantProps: React.ComponentProps<typeof GrantCourseModal> | null;
  showInstPlanForm: boolean;
  instPlanProps: React.ComponentProps<typeof InstallmentPlanModal> | null;
  showAddComm: boolean;
  addCommProps: React.ComponentProps<typeof AddCommModal>;
  showLeadPayForm: boolean;
  leadPaymentProps: React.ComponentProps<typeof LeadPaymentModal>;
  showExtraCertForm: boolean;
  extraCertProps: React.ComponentProps<typeof ExtraCertRequestModal> | null;
  showLegacyPayForm: boolean;
  legacyPaymentProps: React.ComponentProps<typeof LegacyPaymentModal>;
  viewCertId: string | null;
  certificateViewProps: React.ComponentProps<typeof CertificateViewModal> | null;
  showPayDetailModal: boolean;
  paymentDetailProps: React.ComponentProps<typeof PaymentDetailModal> | null;
}

export function ClientModalsGroup({
  isSub, showAccessModal, canManageCourseAccess, accessControlProps,
  showContactPopup, contactPopupProps,
  showConvertModal, hasLead, convertProps,
  showGrantForm, grantProps,
  showInstPlanForm, instPlanProps,
  showAddComm, addCommProps,
  showLeadPayForm, leadPaymentProps,
  showExtraCertForm, extraCertProps,
  showLegacyPayForm, legacyPaymentProps,
  viewCertId, certificateViewProps,
  showPayDetailModal, paymentDetailProps,
}: Props) {
  return (
    <>
      {/* ══ Access Control Modal (صلاحية الفيديوهات) ══ */}
      {showAccessModal && isSub && canManageCourseAccess && accessControlProps && (
        <AccessControlModal {...accessControlProps} />
      )}

      {/* ══ Contact Popup Modal ══ */}
      {showContactPopup && (
        <ContactPopupModal {...contactPopupProps} />
      )}

      {/* ══ Convert Modal ══ */}
      {showConvertModal && hasLead && (
        <ConvertModal {...convertProps} />
      )}

      {/* ══ Grant Course Modal ══ */}
      {showGrantForm && isSub && grantProps && (
        <GrantCourseModal {...grantProps} />
      )}

      {/* ══ Installment Plan Modal ══ */}
      {showInstPlanForm && isSub && instPlanProps && (
        <InstallmentPlanModal {...instPlanProps} />
      )}

      {/* ══ Add Communication Modal ══ */}
      {showAddComm && (
        <AddCommModal {...addCommProps} />
      )}

      {/* ══ Lead Payment Modal ══ */}
      {showLeadPayForm && !isSub && (
        <LeadPaymentModal {...leadPaymentProps} />
      )}

      {/* ══ Extra Certificate Request Modal ══ */}
      {showExtraCertForm && isSub && extraCertProps && (
        <ExtraCertRequestModal {...extraCertProps} />
      )}

      {/* ══ Legacy Payment Modal (مدفوع قديم) ══ */}
      {showLegacyPayForm && isSub && (
        <LegacyPaymentModal {...legacyPaymentProps} />
      )}

      {/* ══ Certificate View Modal ══ */}
      {viewCertId && isSub && certificateViewProps && (
        <CertificateViewModal {...certificateViewProps} />
      )}

      {/* ══ Payment Detail Modal ══ */}
      {showPayDetailModal && isSub && paymentDetailProps && (
        <PaymentDetailModal {...paymentDetailProps} />
      )}
    </>
  );
}
