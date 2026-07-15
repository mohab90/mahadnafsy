import type { Price, StaffMember, SubscriberItem } from '../../types';

export type StaffWire = StaffMember & { is_active?: number | boolean };

export const staffStatusFromWire = (staff: StaffWire): StaffMember['status'] =>
  staff.status === 'active' || staff.is_active === 1 || staff.is_active === true ? 'active' : 'inactive';

export const priceForCurrency = (price: Price | undefined, currency: keyof Price): number =>
  Number(price?.[currency] ?? price?.EGP ?? 0) || 0;

export const translatePayMethod = (method: string | undefined): string => {
  if (!method) return 'غير محدد';
  const labels: Record<string, string> = {
    card: 'بطاقة بنكية',
    wallet: 'محفظة إلكترونية',
    cash: 'نقدي',
    transfer: 'تحويل بنكي',
    vodafone_cash: 'فودافون كاش',
    instapay: 'انستا باي',
    online_paymob: 'أونلاين / بطاقة',
    manual: 'يدوي',
  };
  return labels[method.toLowerCase()] || method;
};

const paymentAmountInEGP = (amount: number, currency: string): number => {
  if (currency === 'SAR') return amount * 13;
  if (currency === 'USD') return amount * 50;
  return amount;
};

export const buildStaffSettingsMetrics = (
  subscribers: SubscriberItem[],
  monthlyTargetInput: string,
  now = new Date(),
) => {
  const monthlyTarget = Math.max(1, Number(monthlyTargetInput) || 10);
  const currentMonth = now.toISOString().slice(0, 7);
  const thisMonthSubs = subscribers.filter((subscriber) => (subscriber.createdAt || '').slice(0, 7) === currentMonth);
  const achieved = thisMonthSubs.length;
  const pct = Math.min(100, Math.round((achieved / monthlyTarget) * 100));
  const sumPayments = (items: SubscriberItem[], monthOnly: boolean) => items.reduce((total, subscriber) => {
    const paid = (subscriber.paymentHistory || [])
      .filter((payment) => !monthOnly || (payment.at || '').slice(0, 7) === currentMonth)
      .reduce((sum, payment) => sum + paymentAmountInEGP(Number(payment.amount) || 0, payment.currency), 0);
    return total + paid;
  }, 0);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const daysLeft = daysInMonth - dayOfMonth;
  const dailyTargetPace = achieved / Math.max(1, dayOfMonth);
  const projectedEnd = Math.round(dailyTargetPace * daysInMonth);
  const weeksData = Array.from({ length: 4 }, (_, index) => {
    const weekStart = index * 7 + 1;
    const weekEnd = Math.min((index + 1) * 7, daysInMonth);
    const count = subscribers.filter((subscriber) => {
      const date = subscriber.createdAt ? new Date(subscriber.createdAt) : null;
      if (!date) return false;
      return date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() >= weekStart
        && date.getDate() <= weekEnd;
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
