import type { Currency, PaymentItemType } from '../../../../types';

export type FinancialSubTab =
  | 'boxes'
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

/**
 * A branch's books («حسابات الدقي»): its money in and out, what is waiting on
 * it and who owes it. The company screens — Paymob, the ledger, closing, the
 * budget, the P&L, the team's commissions and advances — are the main books'.
 */
export const BRANCH_SUB_TABS: FinancialSubTab[] = [
  'boxes', 'orders', 'expenses', 'review', 'proofs', 'refunds', 'installments', 'aging',
];

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
