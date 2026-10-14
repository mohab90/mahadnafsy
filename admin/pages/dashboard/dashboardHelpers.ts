import type { Price, StaffMember, SubscriberItem } from '../../types';
import { isCollected, toEgp } from '../../lib/money';
import { cairoDay, cairoMonthOnly, cairoMonthProgress } from '../../../shared/cairoDate';

export type StaffWire = StaffMember & { is_active?: number | boolean };

export const staffStatusFromWire = (staff: StaffWire): StaffMember['status'] =>
  staff.status === 'active' || staff.is_active === 1 || staff.is_active === true ? 'active' : 'inactive';

export const priceForCurrency = (price: Price | undefined, currency: keyof Price): number =>
  Number(price?.[currency] ?? 0) || 0;

export const buildStaffSettingsMetrics = (
  subscribers: SubscriberItem[],
  monthlyTargetInput: string,
  now = new Date(),
) => {
  const monthlyTarget = Math.max(1, Number(monthlyTargetInput) || 10);
  const currentMonth = cairoMonthOnly(now);
  const thisMonthSubs = subscribers.filter((subscriber) => cairoDay(subscriber.createdAt).slice(0, 7) === currentMonth);
  const achieved = thisMonthSubs.length;
  const pct = Math.min(100, Math.round((achieved / monthlyTarget) * 100));
  const sumPayments = (items: SubscriberItem[], monthOnly: boolean) => items.reduce((total, subscriber) => {
    const paid = (subscriber.paymentHistory || [])
      .filter((payment) => isCollected(payment) && (!monthOnly || cairoDay(payment.at).slice(0, 7) === currentMonth))
      .reduce((sum, payment) => sum + toEgp(payment.amount, payment.currency), 0);
    return total + paid;
  }, 0);
  // Cairo's day of the month, not the browser's.
  const { dayOfMonth, daysInMonth } = cairoMonthProgress(now);
  const daysLeft = daysInMonth - dayOfMonth;
  const dailyTargetPace = achieved / Math.max(1, dayOfMonth);
  const projectedEnd = Math.round(dailyTargetPace * daysInMonth);
  const weeksData = Array.from({ length: 4 }, (_, index) => {
    const weekStart = index * 7 + 1;
    const weekEnd = Math.min((index + 1) * 7, daysInMonth);
    const count = subscribers.filter((subscriber) => {
      const day = cairoDay(subscriber.createdAt);
      if (!day || day.slice(0, 7) !== currentMonth) return false;
      const date = Number(day.slice(8, 10));
      return date >= weekStart && date <= weekEnd;
    }).length;
    return { label: `أسبوع ${index + 1}`, count };
  });

  return {
    monthlyTarget,
    currentMonth,
    thisMonthSubs,
    achieved,
    pct,
    monthRevenue: sumPayments(thisMonthSubs, true),
    totalRevenue: sumPayments(subscribers, false),
    daysInMonth,
    dayOfMonth,
    daysLeft,
    dailyTargetPace,
    projectedEnd,
    weeksData,
    maxWeekCount: Math.max(...weeksData.map((week) => week.count), 1),
  };
};
