/**
 * One conversion to EGP for the whole admin.
 *
 * There were three. `dashboardHelpers.ts` and `onlineClientsUtils.ts` each
 * declared a `paymentAmountInEGP` — same hardcoded 13 and 50, different
 * signatures — and `useOverviewDerived.ts` read the configured rate but fell
 * back to 50. The API converts through `exchange.sar_to_egp` /
 * `exchange.usd_to_egp` and falls back to 48, so the dashboard could show a
 * revenue figure the ledger disagreed with, and updating the rate in settings
 * moved some tiles and not others.
 *
 * The fallbacks here match api/lib/finance.js. They are what shows when the
 * setting has never been written; once it has, the configured rate wins.
 */

/** Mirrors _FX_FALLBACK in api/lib/finance.js. */
export const FX_FALLBACK: Record<string, number> = { EGP: 1, SAR: 13, USD: 48 };

export type FxRates = Record<string, number>;

/** The configured rates, or the fallbacks where a setting is missing or unusable. */
export function fxRates(content?: Record<string, string> | null): FxRates {
  const read = (key: string, fallback: number) => {
    const parsed = parseFloat(String(content?.[key] ?? ''));
    return parsed > 0 ? parsed : fallback;
  };
  return {
    EGP: 1,
    SAR: read('exchange.sar_to_egp', FX_FALLBACK.SAR),
    USD: read('exchange.usd_to_egp', FX_FALLBACK.USD),
  };
}

/** Convert one amount to EGP. An unknown currency is left as it is, not zeroed. */
export function toEgp(
  amount: number | string | null | undefined,
  currency?: string | null,
  rates: FxRates = FX_FALLBACK,
): number {
  const value = Number(amount) || 0;
  if (!currency || currency === 'EGP') return value;
  const rate = rates[currency];
  return rate > 0 ? value * rate : value;
}

/** The same, for the payment-shaped objects most callers already hold. */
export function paymentAmountInEGP(
  payment: { amount?: number | string | null; currency?: string | null } | null | undefined,
  rates: FxRates = FX_FALLBACK,
): number {
  return toEgp(payment?.amount, payment?.currency, rates);
}
