import { useMemo } from 'react';
import type { LeadItem, SalesTarget, StaffMember, SubscriberItem } from '../../../../types';
import { calcLeadScore } from '../leadUtils';

function toEGP(amount: number, currency: string) {
  if (currency === 'EGP') return amount;
  if (currency === 'SAR') return amount * 13;
  return amount * 50;
}

export function useLeadPerformanceData(
  salesReps: StaffMember[],
  leads: LeadItem[],
  subscribers: SubscriberItem[],
  salesTargets: SalesTarget[],
  targetMonth: string,
) {
  const salesPerformance = useMemo(() => salesReps.map((rep) => {
    const repLeads = leads.filter((lead) => lead.assignedSalesId === rep.id);
    const converted = repLeads.filter((lead) => lead.status === 'converted').length;
    const convPct = repLeads.length > 0 ? Math.round((converted / repLeads.length) * 100) : 0;
    const repSubs = subscribers.filter((subscriber) => subscriber.assignedSalesId === rep.id);
    const revenue = repSubs
      .flatMap((subscriber) => subscriber.paymentHistory || [])
      .filter((payment) => payment.at.startsWith(targetMonth))
      .reduce((sum, payment) => sum + toEGP(payment.amount, payment.currency), 0);
    const avgScore = repLeads.length > 0
      ? Math.round(repLeads.reduce((sum, lead) => sum + calcLeadScore(lead), 0) / repLeads.length)
      : 0;
    const target = salesTargets.find((item) => item.staffId === rep.id && item.month === targetMonth);
    return { rep, leads: repLeads.length, converted, convPct, revenue, avgScore, targetEGP: target?.targetEGP || 0 };
  }), [salesReps, leads, subscribers, salesTargets, targetMonth]);

  const commsByRep = useMemo(() => salesReps.map((rep) => {
    const comms = leads.filter((lead) => lead.assignedSalesId === rep.id).flatMap((lead) => lead.communications || []);
    return {
      name: rep.name.split(' ')[0],
      'مكالمة': comms.filter((comm) => comm.type === 'call').length,
      'واتساب': comms.filter((comm) => comm.type === 'whatsapp').length,
      'اجتماع': comms.filter((comm) => comm.type === 'meeting').length,
    };
  }), [salesReps, leads]);

  return { salesPerformance, commsByRep };
}
