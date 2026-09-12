import { useState } from 'react';

import { blankPaymentDraft, type PaymentDraft } from '../../../../components/PaymentModal';

export type DaqqiPayModalState = {
  subscriberId: string;
  subscriberName: string;
  roundId?: string;
  attendeeAmountPaid?: number;
} | null;


// The Daqqi desk had its own draft shape and its own 623-line modal, a copy of
// components/PaymentModal made when the shared one was extracted *from* this
// screen. The two then drifted, so a booking taken at Daqqi opened a different
// form from the same booking taken online.
//
// The two fields that were only here are gone with it: bookingDiscount was
// never read anywhere, and courseExpected is not a draft field at all — it is
// computed at submit from the price, the discount and any override, exactly as
// PaymentModal already computes it.
export const createDaqqiPayDraft = (overrides: Partial<PaymentDraft> = {}): PaymentDraft => ({
  ...blankPaymentDraft(),
  ...overrides,
});

export const useDaqqiPaymentState = () => {
  const [daqqiPayModal, setDaqqiPayModal] = useState<DaqqiPayModalState>(null);
  const [daqqiPayDraft, setDaqqiPayDraft] = useState<PaymentDraft>(createDaqqiPayDraft());

  const resetDaqqiPayDraft = (overrides: Partial<PaymentDraft> = {}) => {
    setDaqqiPayDraft(createDaqqiPayDraft(overrides));
  };

  return {
    daqqiPayModal,
    setDaqqiPayModal,
    daqqiPayDraft,
    setDaqqiPayDraft,
    resetDaqqiPayDraft,
  };
};
