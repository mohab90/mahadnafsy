import type { Currency, PaymentItemType } from '../../../../types';

export type FinancialSubTab =
  | 'cockpit'
  | 'overview'
  | 'orders'
  | 'paymob'
  | 'expenses'
  | 'pl'
  | 'installments'
  | 'monthly'
  | 'commissions'
  | 'proofs'
  | 'aging'
  | 'outstanding'
  | 'reconciliation'
  | 'audit'
  | 'review'
  | 'period_closing'
  | 'budget'
  | 'refunds'
  | 'advances'
  | 'operations';

export const paymentTypeLabels: Record<PaymentItemType, string> = {
  course: 'كورس',
  certificate: 'شهادة',
  consultation: 'استشارة',
  book: 'كتاب',
  carneh: 'كارنيه',
  other: 'أخرى',
};


export const normalizeBranchId = (value?: string | null) =>
  String(value || '').trim().toUpperCase().replace(/[-\s]/g, '_');

export const branchMatches = (value: string | undefined | null, filter?: string) => {
  if (!filter) return true;
  const branch = normalizeBranchId(value);
  const wanted = normalizeBranchId(filter);
  if (wanted === 'DAQQI') return branch === 'DAQQI' || branch === 'DQI';
  return branch === wanted;
};
