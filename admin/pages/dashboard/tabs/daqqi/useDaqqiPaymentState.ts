import { useState } from 'react';

import type { PaymentItemType } from '../../../../types';
import type { DaqqiPayDraft } from './DaqqiPayModal';

export type DaqqiPayModalState = {
  subscriberId: string;
  subscriberName: string;
  roundId?: string;
  attendeeAmountPaid?: number;
} | null;

export type DaqqiPayPrintData = {
  subName: string;
  phone: string;
  courseName: string;
  items: Array<{ label: string; amount: number; currency: string }>;
  total: number;
  currency: string;
  method: string;
  date: string;
  note?: string;
  bookingType: string;
  courseExpected: number;
  prevPaid: number;
  remaining: number;
  staffName: string;
  transactionId?: string;
};

export const createDaqqiPayDraft = (overrides: Partial<DaqqiPayDraft> = {}): DaqqiPayDraft => ({
  bookingType: 'new_booking',
  paymentType: 'course',
  courseId: '',
  courseExpected: '',
  bookingDiscount: '',
  customExpected: '',
  discountPct: '',
  certType: '',
  certReqId: '',
  amount: '',
  currency: 'EGP',
  paymentMethod: '',
  transactionId: '',
  fromAccountNumber: '',
  date: new Date().toISOString().slice(0, 10),
  note: '',
  extraItems: [] as { type: PaymentItemType; label: string; amount: string }[],
  ...overrides,
});

export const useDaqqiPaymentState = () => {
  const [daqqiPayModal, setDaqqiPayModal] = useState<DaqqiPayModalState>(null);
  const [daqqiPayDraft, setDaqqiPayDraft] = useState<DaqqiPayDraft>(createDaqqiPayDraft());
  const [daqqiPayPrintData, setDaqqiPayPrintData] = useState<DaqqiPayPrintData | null>(null);

  const resetDaqqiPayDraft = (overrides: Partial<DaqqiPayDraft> = {}) => {
    setDaqqiPayDraft(createDaqqiPayDraft(overrides));
  };

  return {
    daqqiPayModal,
    setDaqqiPayModal,
    daqqiPayDraft,
    setDaqqiPayDraft,
    resetDaqqiPayDraft,
    daqqiPayPrintData,
    setDaqqiPayPrintData,
  };
};
