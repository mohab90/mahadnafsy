import { useMemo } from 'react';
import type { StaffMember, SubscriberItem } from '../../../../types';

type ToEGP = (amount: number, currency: string) => number;

export function useFinancialCommissionsData(
  staffMembers: StaffMember[],
  subscribers: SubscriberItem[],
  commissionMonth: string,
  commissionFrom: string,
  commissionTo: string,
  toEGP: ToEGP,
) {
  const commissionsData = useMemo(() =>
    staffMembers
      .filter((staff) => (staff.commissionRate || 0) > 0 && staff.status === 'active')
      .map((rep) => {
        const repSubs = subscribers.filter((subscriber) => subscriber.assignedSalesId === rep.id);
        const revenue = repSubs
          .flatMap((subscriber) => subscriber.paymentHistory || [])
          .filter((payment) => payment.at.startsWith(commissionMonth))
          .reduce((sum, payment) => sum + toEGP(payment.amount, payment.currency), 0);
        const commission = Math.round(revenue * (rep.commissionRate || 0) / 100);
        return { rep, revenue, commission };
      }),
  [staffMembers, subscribers, commissionMonth, toEGP]);

  const rangeMonths = useMemo(() => {
    const months: string[] = [];
    const [fromYear, fromMonth] = commissionFrom.split('-').map(Number);
    const [toYear, toMonth] = commissionTo.split('-').map(Number);
    let year = fromYear;
    let month = fromMonth;
    while (year < toYear || (year === toYear && month <= toMonth)) {
      months.push(`${year}-${String(month).padStart(2, '0')}`);
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      if (months.length > 24) break;
    }
    return months;
  }, [commissionFrom, commissionTo]);

  const rangeCommissionsData = useMemo(() => {
    const reps = staffMembers.filter((staff) => (staff.commissionRate || 0) > 0 && staff.status === 'active');
    return reps.map((rep) => {
      const repSubs = subscribers.filter((subscriber) => subscriber.assignedSalesId === rep.id);
      const allPayments = repSubs.flatMap((subscriber) => subscriber.paymentHistory || []);
      const byMonth = rangeMonths.map((month) => {
        const revenue = allPayments
          .filter((payment) => payment.at.startsWith(month))
          .reduce((sum, payment) => sum + toEGP(payment.amount, payment.currency), 0);
        return { month, revenue, commission: Math.round(revenue * (rep.commissionRate || 0) / 100) };
      });
      const totalRevenue = byMonth.reduce((sum, item) => sum + item.revenue, 0);
      const totalCommission = byMonth.reduce((sum, item) => sum + item.commission, 0);
      return { rep, byMonth, totalRevenue, totalCommission };
    });
  }, [staffMembers, subscribers, rangeMonths, toEGP]);

  return { commissionsData, rangeMonths, rangeCommissionsData };
}
