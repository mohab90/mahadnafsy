export type SettlementCurrency = 'EGP' | 'SAR' | 'USD';

const normalizeBranch = (value: string | null | undefined) =>
  String(value || '').trim().toUpperCase().replace(/[-\s]+/g, '_');

/** Canonical admin default; the payment API remains the final pricing authority. */
export const currencyForBranch = (branch: string | null | undefined): SettlementCurrency => {
  const normalized = normalizeBranch(branch);
  if (normalized === 'ONLINE_SAUDI') return 'SAR';
  if (normalized === 'ONLINE_ABROAD') return 'USD';
  return 'EGP';
};

export const currencyLabel = (currency: SettlementCurrency) =>
  currency === 'SAR' ? 'ر.س' : currency === 'USD' ? '$' : 'ج.م';
