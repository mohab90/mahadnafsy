/**
 * What «الميزانية مقابل الفعلي» (BudgetTrackerTab) draws from the server's month revenue (api/lib/analyticsScreens.js,
 * GET /api/admin/analytics-hub/month-revenue). Money comes back per currency and is converted here with the rates the institute configured.
 * The analyses of retention, revenue sources and expenses went with their pages (5 Nov 2026).
 */

export type Money = { currency: string; amount: number };
type ToEgp = (amount: number, currency: string) => number;

export const monthRevenueEgp = (amounts: Money[] | undefined, toEgp: ToEgp) =>
  (amounts ?? []).reduce((total, money) => total + toEgp(money.amount, money.currency), 0);
