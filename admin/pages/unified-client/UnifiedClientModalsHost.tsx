import React from 'react';

const UnifiedClientAccessModal = React.lazy(() => import('./UnifiedClientAccessModal').then(module => ({ default: module.UnifiedClientAccessModal })));
const UnifiedClientCertificateViewModal = React.lazy(() => import('./UnifiedClientCertificateViewModal').then(module => ({ default: module.UnifiedClientCertificateViewModal })));
const UnifiedClientCommunicationModal = React.lazy(() => import('./UnifiedClientCommunicationModal').then(module => ({ default: module.UnifiedClientCommunicationModal })));
const UnifiedClientConvertModal = React.lazy(() => import('./UnifiedClientConvertModal').then(module => ({ default: module.UnifiedClientConvertModal })));
const UnifiedClientExtraCertificateModal = React.lazy(() => import('./UnifiedClientExtraCertificateModal').then(module => ({ default: module.UnifiedClientExtraCertificateModal })));
const UnifiedClientLeadPaymentModal = React.lazy(() => import('./UnifiedClientLeadPaymentModal').then(module => ({ default: module.UnifiedClientLeadPaymentModal })));
const UnifiedClientLegacyPaymentModal = React.lazy(() => import('./UnifiedClientLegacyPaymentModal').then(module => ({ default: module.UnifiedClientLegacyPaymentModal })));
const UnifiedClientPaymentDetailModal = React.lazy(() => import('./UnifiedClientPaymentDetailModal').then(module => ({ default: module.UnifiedClientPaymentDetailModal })));

type ModalProps<T extends React.ElementType> = React.ComponentProps<T>;

export interface UnifiedClientModalsHostProps {
  access?: ModalProps<typeof UnifiedClientAccessModal>;
  certificateView?: ModalProps<typeof UnifiedClientCertificateViewModal>;
  communication?: ModalProps<typeof UnifiedClientCommunicationModal>;
  contact?: ModalProps<typeof UnifiedClientCommunicationModal>;
  convert?: ModalProps<typeof UnifiedClientConvertModal>;
  extraCertificate?: ModalProps<typeof UnifiedClientExtraCertificateModal>;
  leadPayment?: ModalProps<typeof UnifiedClientLeadPaymentModal>;
  legacyPayment?: ModalProps<typeof UnifiedClientLegacyPaymentModal>;
  paymentDetail?: ModalProps<typeof UnifiedClientPaymentDetailModal>;
}

export function UnifiedClientModalsHost(props: UnifiedClientModalsHostProps) {
  return (
    <React.Suspense fallback={null}>
      {props.access && <UnifiedClientAccessModal {...props.access} />}
      {props.contact && <UnifiedClientCommunicationModal {...props.contact} />}
      {props.convert && <UnifiedClientConvertModal {...props.convert} />}
      {props.communication && <UnifiedClientCommunicationModal {...props.communication} />}
      {props.leadPayment && <UnifiedClientLeadPaymentModal {...props.leadPayment} />}
      {props.extraCertificate && <UnifiedClientExtraCertificateModal {...props.extraCertificate} />}
      {props.legacyPayment && <UnifiedClientLegacyPaymentModal {...props.legacyPayment} />}
      {props.certificateView && <UnifiedClientCertificateViewModal {...props.certificateView} />}
      {props.paymentDetail && <UnifiedClientPaymentDetailModal {...props.paymentDetail} />}
    </React.Suspense>
  );
}
