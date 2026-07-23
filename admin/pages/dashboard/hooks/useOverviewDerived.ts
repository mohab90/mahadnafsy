import { useMemo } from 'react';
import type { ConsultationItem, Course, LeadItem, OrderItem, StaffMember, SubscriberItem } from '../../../types';

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
) {
  const overviewStats = useMemo(() => {
    const sarRate = parseFloat(content['exchange.sar_to_egp'] || '13') || 13;
    const usdRate = parseFloat(content['exchange.usd_to_egp'] || '50') || 50;
    const toEGP = (o: { currency: string; amount: number }) =>
      o.currency === 'EGP' ? o.amount : o.currency === 'SAR' ? o.amount * sarRate : o.amount * usdRate;
    const paidOrders = orders.filter(o => o.status === 'paid');
    const totalRevenue = paidOrders.reduce((sum, o) => sum + toEGP(o), 0)
      + subscribers.reduce((s, sub) => s + (sub.paymentHistory ?? []).filter(p => !p.isInstallment).reduce((ps, p) => ps + toEGP(p), 0), 0);
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
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayRevenue = paidOrders
      .filter(o => (o.createdAt || '').slice(0, 10) === todayStr)
      .reduce((sum, o) => sum + toEGP(o), 0)
      + subscribers.reduce((s, sub) => s + (sub.paymentHistory ?? [])
        .filter(p => !p.isInstallment && (p.at || '').slice(0, 10) === todayStr)
        .reduce((ps, p) => ps + toEGP(p), 0), 0);
    const todayNewSubscribers = subscribers.filter(s => (s.createdAt || '').slice(0, 10) === todayStr).length;
    const todayNewLeads = leads.filter(l => (l.createdAt || '').slice(0, 10) === todayStr).length;
    const thisMonthStr = new Date().toISOString().slice(0, 7);
    const monthRevenue = paidOrders
      .filter(o => (o.createdAt || '').slice(0, 7) === thisMonthStr)
      .reduce((sum, o) => sum + toEGP(o), 0)
      + subscribers.reduce((s, sub) => s + (sub.paymentHistory ?? [])
        .filter(p => !p.isInstallment && (p.at || '').slice(0, 7) === thisMonthStr)
        .reduce((ps, p) => ps + toEGP(p), 0), 0);
    return { totalRevenue, leadsBySource, courseEnrollments, consultsByStatus, salesStats: salesStatsCalc, recentLeads, paidOrders, todayRevenue, todayNewSubscribers, todayNewLeads, monthRevenue };
  }, [orders, subscribers, leads, courses, staffMembers, consultations, content]);

  return { overviewStats };
}
