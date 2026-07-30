import { blankPaymentDraft, type PaymentDraft } from '../components/PaymentModal';
import { currencyForBranch } from './branchCurrency';

export type ClientActionBookingType = 'new_booking' | 'installment';
export type ClientActionCurrency = 'EGP' | 'SAR' | 'USD';

export interface ClientPaymentDraftOptions {
  courseId?: string;
  branch?: string;
  currency?: ClientActionCurrency;
  email?: string;
  bookingType?: ClientActionBookingType;
}

export function createClientPaymentDraft(options: ClientPaymentDraftOptions = {}): PaymentDraft {
  return {
    ...blankPaymentDraft({
      courseId: options.courseId || '',
      branch: options.branch || '',
      currency: options.currency || currencyForBranch(options.branch),
      email: options.email || '',
    }),
    bookingType: options.bookingType || 'new_booking',
  };
}

export function createClientInstallmentDraft(options: Omit<ClientPaymentDraftOptions, 'bookingType'> = {}): PaymentDraft {
  return createClientPaymentDraft({ ...options, bookingType: 'installment' });
}
