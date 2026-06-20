/**
 * DaqqiPayModal — thin wrapper around the unified PaymentModal.
 * Preserves the original DaqqiPayDraft / DaqqiPayModalTrigger API so that
 * DaqqiScheduleTab.tsx requires zero changes.
 *
 * DaqqiPayDraft.courseExpected  ↔  PaymentDraft.customExpected
 * DaqqiPayDraft.bookingDiscount ↔  PaymentDraft.discountPct
 */
import React from 'react';
import PaymentModal, { type PaymentDraft } from '../../../../components/PaymentModal';
import type { PaymentItemType, SubscriberItem } from '../../../../types';

// ── Types (unchanged external API) ────────────────────────────────────────────
export type DaqqiPayDraft = {
  bookingType: 'new_booking' | 'installment';
  paymentType: PaymentItemType;
  courseId: string;
  courseExpected: string;
  bookingDiscount: string;
  customExpected: string;
  discountPct: string;
  certType: string;
  certReqId: string;
  amount: string;
  currency: 'EGP' | 'SAR' | 'USD';
  paymentMethod: string;
  transactionId: string;
  fromAccountNumber: string;
  date: string;
  note: string;
  extraItems: {
    type: PaymentItemType; label: string; amount: string;
    courseId?: string; certType?: string; discountPct?: string; customExpected?: string;
  }[];
};

export type DaqqiPayModalTrigger = {
  subscriberId: string;
  subscriberName: string;
  roundId?: string;
  attendeeAmountPaid?: number;
};

// ── Field mapping helpers ─────────────────────────────────────────────────────

function toPay(d: DaqqiPayDraft): PaymentDraft {
  return {
    bookingType: d.bookingType,
    paymentType: d.paymentType,
    courseId: d.courseId,
    customExpected: d.courseExpected || d.customExpected,
    discountPct: d.bookingDiscount || d.discountPct,
    certType: d.certType,
    certReqId: d.certReqId,
    amount: d.amount,
    currency: d.currency,
    paymentMethod: d.paymentMethod,
    transactionId: d.transactionId,
    fromAccountNumber: d.fromAccountNumber,
    date: d.date,
    note: d.note,
    extraItems: d.extraItems,
  };
}

function fromPay(p: PaymentDraft, prev: DaqqiPayDraft): DaqqiPayDraft {
  return {
    ...p,
    courseExpected: p.customExpected,
    bookingDiscount: p.discountPct,
    // keep prev fields that PaymentDraft doesn't have
    fromAccountNumber: p.fromAccountNumber ?? prev.fromAccountNumber,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  modal: DaqqiPayModalTrigger | null;
  draft: DaqqiPayDraft;
  setDraft: (d: DaqqiPayDraft) => void;
  onClose: () => void;
  onSubmit: (shouldPrint: boolean) => void;
  subscribers: SubscriberItem[];
  // kept for API compatibility — PaymentModal uses useSiteData() internally
  courses?: unknown[];
  bundles?: unknown[];
  content?: Record<string, string>;
  requirePaymentApproval?: boolean;
}

export function DaqqiPayModal({
  modal, draft, setDraft, onClose, onSubmit, subscribers, requirePaymentApproval,
}: Props) {
  const sub = subscribers.find(s => s.id === modal?.subscriberId);
  if (!modal || !sub) return null;

  return (
    <PaymentModal
      mode="subscriber"
      subject={sub}
      draft={toPay(draft)}
      setDraft={p => setDraft(fromPay(p, draft))}
      onSubmit={(_p, shouldPrint) => onSubmit(shouldPrint)}
      onClose={onClose}
      requirePaymentApproval={requirePaymentApproval}
    />
  );
}
