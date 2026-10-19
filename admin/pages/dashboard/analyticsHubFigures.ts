/**
 * What «الاستبقاء», «مصادر الإيراد», «تحليل المصروفات» and «الميزانية مقابل الفعلي» draw, finished in the browser from
 * the server's figures (api/lib/analyticsScreens.js, GET /api/admin/analytics-hub/*). The server groups the whole tables;
 * money comes back per currency and is converted here with the rates the institute configured, then ranked and cut
 * the way each screen always did. No imports: api/tests/analyticsScreens.test.js loads this file as it is.
 */

export type Money = { currency: string; amount: number };
export type ToEgp = (amount: number, currency: string) => number;

export interface RevenueSourcesData {
  from: string; months: string[];
  bySource: Array<{ source: string; currency: string; amount: number; count: number }>;
  byProduct: Array<{ courseId: string; bundleId: string; type: string; currency: string; amount: number; count: number }>;
  monthly: Array<{ month: string; source: string; currency: string; amount: number }>;
}
export interface ExpenseAnalysisData {
  from: string; months: string[];
  expenses: {
    count: number;
    byCategory: Array<{ category: string; currency: string; amount: number }>;
    monthly: Array<{ month: string; amounts: Money[] }>;
  };
  revenue: { inRange: Money[]; monthly: Array<{ month: string; amounts: Money[] }> };
  list: Array<{ id: string; description: string; category: string; amount: number; currency: string; date: string }>;
}
export interface RetentionData {
  months: string[]; total: number; byStatus: Record<string, number>;
  monthly: Array<{ month: string; created: number; finished: number }>;
  perCourse: Record<string, number>; paidEgp: number;
}

const sum = (amounts: Money[], toEgp: ToEgp) => amounts.reduce((total, money) => total + toEgp(money.amount, money.currency), 0);

/** Amounts per name, converted and added, largest first. */
function ranked(entries: Array<{ name: string; currency: string; amount: number }>, toEgp: ToEgp) {
  const map: Record<string, number> = {};
  for (const entry of entries) map[entry.name] = (map[entry.name] || 0) + toEgp(entry.amount, entry.currency);
  return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

/** `nameOf`: the title of a course or track, or the type, for one product's group. */
export function revenueSourceFigures(
  data: RevenueSourcesData | null, toEgp: ToEgp, nameOf: (product: { courseId: string; bundleId: string; type: string }) => string,
) {
  const sources = data?.bySource ?? [];
  const products = data?.byProduct ?? [];
  const totalRevenue = sources.reduce((total, row) => total + toEgp(row.amount, row.currency), 0);
  const orderCount = sources.reduce((total, row) => total + row.count, 0);
  const byLeadSource = ranked(sources.map(row => ({ name: row.source, currency: row.currency, amount: row.amount })), toEgp);

  const typeTotals: Record<string, number> = { 'كورس': 0, 'باندل': 0, 'استشارة': 0, 'أخرى': 0 };
  const courses: Record<string, { name: string; revenue: number; count: number }> = {};
  for (const row of products) {
    const value = toEgp(row.amount, row.currency);
    if (row.bundleId) typeTotals['باندل'] += value;
    else if (row.courseId) typeTotals['كورس'] += value;
    else if (row.type === 'consultation') typeTotals['استشارة'] += value;
    else typeTotals['أخرى'] += value;
    const key = row.courseId || row.bundleId || row.type || 'other';
    if (!courses[key]) courses[key] = { name: nameOf(row), revenue: 0, count: 0 };
    courses[key].revenue += value;
    courses[key].count += row.count;
  }
  const topSources = byLeadSource.slice(0, 3).map(source => source.name);
  const monthlyBySource = (data?.months ?? []).map(month => {
    const entry: Record<string, number | string> = { month: month.slice(5) };
    for (const source of topSources) {
      entry[source] = (data?.monthly ?? [])
        .filter(row => row.month === month && row.source === source)
        .reduce((total, row) => total + toEgp(row.amount, row.currency), 0);
    }
    return entry;
  });
  return {
    totalRevenue, orderCount, byLeadSource, topSources, monthlyBySource,
    byProductType: Object.entries(typeTotals).filter(([, value]) => value > 0).map(([name, value]) => ({ name, value })),
    byCourse: Object.values(courses).sort((a, b) => b.revenue - a.revenue).slice(0, 8),
  };
}

export function expenseFigures(data: ExpenseAnalysisData | null, toEgp: ToEgp) {
  const totalExpenses = (data?.expenses.byCategory ?? []).reduce((total, row) => total + toEgp(row.amount, row.currency), 0);
  const totalRevenue = sum(data?.revenue.inRange ?? [], toEgp);
  const netProfit = totalRevenue - totalExpenses;
  const revenueOf = (month: string) => sum((data?.revenue.monthly ?? []).find(row => row.month === month)?.amounts ?? [], toEgp);
  const expensesOf = (month: string) => sum((data?.expenses.monthly ?? []).find(row => row.month === month)?.amounts ?? [], toEgp);
  return {
    totalExpenses, totalRevenue, netProfit,
    profitMargin: totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0,
    byCategory: ranked((data?.expenses.byCategory ?? []).map(row => ({ name: row.category, currency: row.currency, amount: row.amount })), toEgp),
    monthlyData: (data?.months ?? []).map(month => ({ month: month.slice(5), 'مصروفات': expensesOf(month), 'إيراد': revenueOf(month) })),
  };
}

const LEFT = ['finished', 'paused', 'refunded', 'leads'];
const STATUS_LABELS: Record<string, string> = { active: 'نشط', finished: 'منتهي', paused: 'متوقف', refunded: 'مسترد', leads: 'محول لليدات' };

/** `nameOf`: a course's title for its id. */
export function retentionView(data: RetentionData | null, nameOf: (courseId: string) => string) {
  const total = data?.total ?? 0;
  const active = Object.entries(data?.byStatus ?? {}).filter(([status]) => !LEFT.includes(status)).reduce((count, [, n]) => count + n, 0);
  return {
    total, active,
    retentionRate: total > 0 ? Math.round((active / total) * 100) : 0,
    avgRevenue: total > 0 ? Math.round((data?.paidEgp ?? 0) / total) : 0,
    monthlyNew: (data?.monthly ?? []).map(row => ({ month: row.month.slice(5), 'جديد': row.created, 'منتهي': row.finished })),
    statusBreakdown: Object.entries(data?.byStatus ?? {}).sort((a, b) => b[1] - a[1]).map(([status, value]) => ({ name: STATUS_LABELS[status] || status, value })),
    courseStats: Object.entries(data?.perCourse ?? {}).map(([id, count]) => ({ name: nameOf(id), count })).sort((a, b) => b.count - a.count).slice(0, 8),
  };
}

/** A month's revenue in EGP. */
export const monthRevenueEgp = (amounts: Money[] | undefined, toEgp: ToEgp) => sum(amounts ?? [], toEgp);
