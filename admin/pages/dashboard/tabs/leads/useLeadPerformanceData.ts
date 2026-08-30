import { useMemo } from 'react';
import type { LeadItem, LeadStats, SalesTarget, StaffMember, SubscriberItem } from '../../../../types';
import { calcLeadScore } from '../leadUtils';
import { toEgp } from '../../../../lib/money';

// These figures decide what a rep is shown to have sold, so a rate that does
// not match the ledger's misstates their performance. It was 13 and 50 written
// here; the API converts through exchange.sar_to_egp / exchange.usd_to_egp and
// falls back to 48 for USD.
const toEGP = (amount: number, currency: string) => toEgp(amount, currency);

/**
 * Per-rep performance figures.
 *
 * Everything derived from leads is read from `leadStats.byOwner` when the server
 * has sent it, and recomputed from the array only when it has not. The array
 * path is not dead code — it is what runs before the stats request resolves, and
 * it is the fallback if that request fails — but it is no longer the reason the
 * screen has to hold all 26,878 leads, because the aggregate answers the same
 * question in one row per rep.
 *
 * The two paths are kept side by side on purpose: they were checked against each
 * other on production, rep by rep, and they agree. If they ever stop agreeing the
 * fallback is what makes that visible rather than silently wrong.
 *
 * Revenue still comes from subscribers — a different, far smaller population that
 * the screen needs in full anyway for its payment history.
 */
export function useLeadPerformanceData(
  salesReps: StaffMember[],
  leads: LeadItem[],
  subscribers: SubscriberItem[],
  salesTargets: SalesTarget[],
  targetMonth: string,
  leadStats?: LeadStats | null,
) {
  const salesPerformance = useMemo(() => salesReps.map((rep) => {
    const agg = leadStats?.byOwner?.[rep.id];

    let leadCount: number;
    let converted: number;
    let avgScore: number;
    if (agg) {
      leadCount = agg.total;
      converted = agg.converted;
      avgScore = agg.avgScore;
    } else {
      const repLeads = leads.filter((lead) => lead.assignedSalesId === rep.id);
      leadCount = repLeads.length;
      converted = repLeads.filter((lead) => lead.status === 'converted').length;
      avgScore = repLeads.length > 0
        ? Math.round(repLeads.reduce((sum, lead) => sum + calcLeadScore(lead), 0) / repLeads.length)
        : 0;
    }

    const convPct = leadCount > 0 ? Math.round((converted / leadCount) * 100) : 0;
    const repSubs = subscribers.filter((subscriber) => subscriber.assignedSalesId === rep.id);
    const revenue = repSubs
      .flatMap((subscriber) => subscriber.paymentHistory || [])
      .filter((payment) => payment.at.startsWith(targetMonth))
      .reduce((sum, payment) => sum + toEGP(payment.amount, payment.currency), 0);
    const target = salesTargets.find((item) => item.staffId === rep.id && item.month === targetMonth);
    return { rep, leads: leadCount, converted, convPct, revenue, avgScore, targetEGP: target?.targetEGP || 0 };
  }), [salesReps, leads, subscribers, salesTargets, targetMonth, leadStats]);

  const commsByRep = useMemo(() => salesReps.map((rep) => {
    const agg = leadStats?.byOwner?.[rep.id];
    // The server groups by the channel as stored (upper case on this database)
    // and lowercases it on the way out, which is the spelling the array path has
    // always compared against.
    const counts = agg
      ? agg.comms
      : leads
        .filter((lead) => lead.assignedSalesId === rep.id)
        .flatMap((lead) => lead.communications || [])
        .reduce<Record<string, number>>((acc, comm) => {
          const type = String(comm.type || '').toLowerCase();
          if (type) acc[type] = (acc[type] || 0) + 1;
          return acc;
        }, {});
    return {
      name: rep.name.split(' ')[0],
      'مكالمة': counts.call || 0,
      'واتساب': counts.whatsapp || 0,
      'اجتماع': counts.meeting || 0,
    };
  }), [salesReps, leads, leadStats]);

  return { salesPerformance, commsByRep };
}
