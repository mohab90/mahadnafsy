import { Suspense } from 'react';
import type { LeadItem, SubscriberItem } from '../../types';
import type { PaymentDraft } from '../../components/PaymentModal';
import { PaymentModal } from './lazyDashboardComponents';

type BranchOption = { id: string; label: string };

interface DashboardPaymentOverlaysProps {
  lead: LeadItem | null;
  leadDraft: PaymentDraft;
  setLeadDraft: (draft: PaymentDraft) => void;
  submitLeadPayment: (draft: PaymentDraft) => void | Promise<void>;
  closeLeadPayment: () => void;
  subscriber: SubscriberItem | null;
  subscriberDraft: PaymentDraft;
  setSubscriberDraft: (draft: PaymentDraft) => void;
  submitSubscriberPayment: (draft: PaymentDraft) => void;
  closeSubscriberPayment: () => void;
  branchOptions: BranchOption[];
  instituteName: string;
  requireSubscriberApproval: boolean;
}

/** Global payment dialogs shared by client search, lead CRM, and quick booking. */
export function DashboardPaymentOverlays({
  lead,
  leadDraft,
  setLeadDraft,
  submitLeadPayment,
  closeLeadPayment,
  subscriber,
  subscriberDraft,
  setSubscriberDraft,
  submitSubscriberPayment,
  closeSubscriberPayment,
  branchOptions,
  instituteName,
  requireSubscriberApproval,
}: DashboardPaymentOverlaysProps) {
  return (
    <>
      {lead && (
        <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black/20" />}>
          <PaymentModal
            mode="lead"
            subject={{
              id: lead.id,
              name: lead.name,
              phone: lead.phone,
              branch: lead.branch,
              email: lead.email,
            }}
            draft={leadDraft}
            setDraft={setLeadDraft}
            onSubmit={(draft) => { void submitLeadPayment(draft); }}
            onClose={closeLeadPayment}
            branchOptions={branchOptions}
            instituteName={instituteName}
          />
        </Suspense>
      )}

      {subscriber && (
        <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black/20" />}>
          <PaymentModal
            mode="subscriber"
            subject={{
              id: subscriber.id,
              name: subscriber.name,
              phone: subscriber.phone,
              enrolledCourseIds: subscriber.enrolledCourseIds,
              paymentHistory: subscriber.paymentHistory,
              extraCertificateRequests: subscriber.extraCertificateRequests,
              branch: subscriber.branch,
              email: subscriber.email,
            }}
            draft={subscriberDraft}
            setDraft={setSubscriberDraft}
            onSubmit={(draft) => { submitSubscriberPayment(draft); }}
            onClose={closeSubscriberPayment}
            instituteName={instituteName}
            requirePaymentApproval={requireSubscriberApproval}
          />
        </Suspense>
      )}
    </>
  );
}
