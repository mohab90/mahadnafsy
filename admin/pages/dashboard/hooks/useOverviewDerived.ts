import { useMemo } from 'react';
import { cairoDateOnly, cairoMonthOnly, cairoDay } from '../../../../shared/cairoDate';
import { fxRates, toEgp } from '../../../lib/money';
import type { ConsultationItem, Course, LeadItem, LeadStats, OrderItem, StaffMember, SubscriberItem } from '../../../types';

/**
 * Pure derived values for the Overview tab: revenue totals (converted to EGP
 * via configured exchange rates), lead-source/course-enrollment breakdowns,
 * per-staff sales stats, recent leads, and today/this-month rollups. No state
 * ownership — the single most expensive memo in Dashboard.tsx (O(n×m) across
 * orders/subscribers), only recomputes when one of its data sources changes.
 */
export function useOverviewDerived(
  orders: OrderItem[],
  subscribers: SubscriberItem[],
  leads: LeadItem[],
  courses: Course[],
  staffMembers: StaffMember[],
  consultations: ConsultationItem[],
  content: Record<string, string>,
  /** Whole-table lead figures. Optional so a caller that has not been updated
   *  still compiles and falls back to counting the array. */
  leadStats?: LeadStats | null,
) {
  const overviewStats = useMemo(() => {
    // Rates and fallbacks from lib/money, which mirrors the API's. This read
    // the setting but fell back to 50 for USD where the API falls back to 48,
    // and the two other copies of this conversion ignored the setting entirely.
    const rates = fxRates(content);
    const toEGP = (o: { currency: string; amount: number }) => toEgp(o.amount, o.currency, rates);
    const paidOrders = orders.filter(o => o.status === 'paid');
    // «الإيراد التقريبي» added two lists that overlap. /api/admin/orders is not
    // just the orders table: it synthesises an entry from every payments row and
    // appends it, keeping the payment's own id — and subscribers[].paymentHistory
    // is built from those same rows. So one 4,000 EGP cash payment recorded at
    // reception was counted twice, and متوسط قيمة الطلب was doubled with it. The
    // ids are the same on both sides, which is what makes them subtractable. The
    // second term also had no status filter, so a refunded payment counted too.
    const countedOrderIds = new Set(paidOrders.map(o => o.id));
    const totalRevenue = paidOrders.reduce((sum, o) => sum + toEGP(o), 0)
      + subscribers.reduce((s, sub) => s + (sub.paymentHistory ?? [])
        .filter(p => !p.isInstallment && (!p.status || p.status === 'paid') && !countedOrderIds.has(p.id))
        .reduce((ps, p) => ps + toEGP(p), 0), 0);
    const leadsBySource: [string, number][] = (Object.entries(
      leads.reduce((acc: Record<string, number>, l) => { const src = l.source || 'غير محدد'; acc[src] = (acc[src] || 0) + 1; return acc; }, {})
    ) as [string, number][]).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const courseEnrollments = courses.map(c => ({
      id: c.id,
      title: c.title.length > 26 ? c.title.slice(0, 26) + '…' : c.title,
      count: subscribers.filter(s => (s.enrolledCourseIds || []).includes(c.id)).length,
    })).sort((a, b) => b.count - a.count).slice(0, 6);
    const consultsByStatus = consultations.reduce((acc: Record<string, number>, c) => { acc[c.status] = (acc[c.status] || 0) + 1; return acc; }, {});
    const salesStatsCalc = staffMembers.filter(s => s.role === 'sales').map(s => {
      const myLeads = leads.filter(l => l.assignedSalesId === s.id);
      const converted = myLeads.filter(l => l.status === 'converted').length;
      return { name: s.name, total: myLeads.length, converted, rate: myLeads.length > 0 ? Math.round((converted / myLeads.length) * 100) : 0 };
    });
    const seenIds = new Set<string>();
    const recentLeads = [...leads]
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .filter(l => { if (seenIds.has(l.id)) return false; seenIds.add(l.id); return true; })
      .slice(0, 5);
    // Today stats
    const todayStr = cairoDateOnly();
    const todayRevenue = paidOrders
      .filter(o => cairoDay(o.createdAt) === todayStr)
      .reduce((sum, o) => sum + toEGP(o), 0)
      + subscribers.reduce((s, sub) => s + (sub.paymentHistory ?? [])
        .filter(p => !p.isInstallment && cairoDay(p.at) === todayStr)
        .reduce((ps, p) => ps + toEGP(p), 0), 0);
    const todayNewSubscribers = subscribers.filter(s => cairoDay(s.createdAt) === todayStr).length;
    // The database's own CURDATE(), not a string prefix of whatever shape
    // created_at arrived in.
    const todayNewLeads = leadStats?.createdToday ?? leads.filter(l => cairoDay(l.createdAt) === todayStr).length;
    const thisMonthStr = cairoMonthOnly();
    const monthRevenue = paidOrders
      .filter(o => cairoDay(o.createdAt).slice(0, 7) === thisMonthStr)
      .reduce((sum, o) => sum + toEGP(o), 0)
      + subscribers.reduce((s, sub) => s + (sub.paymentHistory ?? [])
        .filter(p => !p.isInstallment && cairoDay(p.at).slice(0, 7) === thisMonthStr)
        .reduce((ps, p) => ps + toEGP(p), 0), 0);
    return { totalRevenue, leadsBySource, courseEnrollments, consultsByStatus, salesStats: salesStatsCalc, recentLeads, paidOrders, todayRevenue, todayNewSubscribers, todayNewLeads, monthRevenue };
  }, [orders, subscribers, leads, courses, staffMembers, consultations, content, leadStats]);

  return { overviewStats };
}
