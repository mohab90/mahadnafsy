/**
 * «نظرة عامة»'s board: the shape the server answers (api/lib/overviewBoard.js) and the arithmetic the screen does on it.
 */
export type PeriodFigures = { day: string; leads: number; bookings: number; courseMoney: number; certificateMoney: number; expenses: number; net: number };
export type OverviewBoardData = {
  asOf: string; today: string;
  periods: { today: PeriodFigures; yesterday: PeriodFigures; lastWeek: PeriodFigures };
  alerts: {
    overdueInstallments: { count: number; clients: number };
    leadsWithoutFollowUp: { count: number };
    collection: { collected: number; target: number; expectedByToday: number; belowTarget: boolean; pctOfPace: number };
    slowEndpoints: { route: string; p95: number; count: number }[] | null;
  };
  live: { staffOnline: number; clientsOnline: number } | null;
  /** Out of the ordinary against each figure's own four-week baseline, worded by the server (api/lib/anomalies.js). */
  anomalies: { key: string; text: string; to: string; tone: 'rose' | 'amber' | 'sky' }[];
};

export type BoardRow = { key: keyof Omit<PeriodFigures, 'day'>; label: string; lowerIsBetter?: boolean };
export const BOARD_ROWS: BoardRow[] = [
  { key: 'leads', label: 'ليدات جديدة' },
  { key: 'bookings', label: 'حجوزات' },
  { key: 'courseMoney', label: 'تحصيل الكورسات (ج)' },
  { key: 'certificateMoney', label: 'تحصيل الشهادات (ج)' },
  { key: 'expenses', label: 'مصروفات (ج)', lowerIsBetter: true },
  { key: 'net', label: 'الصافي (ج)' },
];

/** The change from `before` to `now` in whole percent; null when there was nothing before to compare with. */
export function changePct(now: number, before: number): number | null {
  return before > 0 ? Math.round(((now - before) / before) * 100) : null;
}

/** An alert the owner should act on, as a sentence and the screen where it is acted on. */
export type BoardAlert = { key: string; text: string; to: string; tone: 'rose' | 'amber' | 'sky' };
export function alertsOf(board: OverviewBoardData): BoardAlert[] {
  const { overdueInstallments, leadsWithoutFollowUp, collection, slowEndpoints } = board.alerts;
  const alerts: BoardAlert[] = [];
  if (overdueInstallments.count > 0) alerts.push({ key: 'installments', text: `${overdueInstallments.count} قسط متأخر عند ${overdueInstallments.clients} عميل`, to: '/dashboard/online_clients', tone: 'rose' });
  if (leadsWithoutFollowUp.count > 0) alerts.push({ key: 'followup', text: `${leadsWithoutFollowUp.count} ليد مفتوح من غير موعد متابعة`, to: '/dashboard/leads', tone: 'amber' });
  if (collection.belowTarget) alerts.push({ key: 'collection', text: `التحصيل ${collection.pctOfPace}٪ من اللي المفروض يكون اتحصّل لحد النهارده`, to: '/dashboard/financial', tone: 'rose' });
  alerts.push(...board.anomalies);
  for (const slow of slowEndpoints || []) alerts.push({ key: `slow:${slow.route}`, text: `${slow.route} بطيء (p95 ${slow.p95} مللي ثانية)`, to: '/dashboard/security_center', tone: 'sky' });
  return alerts;
}
