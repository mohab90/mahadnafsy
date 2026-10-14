import { useEffect, useState } from 'react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { Course, LeadItem, LeadStats, LeadStatus, StaffMember, SubscriberStats } from '../../../../types';

/**
 * الرئيسية's figures from the database.
 *
 * The screen counted its sources, its sales table, its course chart and the
 * lead statuses out of the 500 newest leads and clients it loaded at sign-in —
 * 1.2 MB a sign-in, and wrong past the 500th row (19,956 leads, a source chart
 * summing to 500). Those rows are not loaded for it any more (admin
 * siteLists.ts, 11 Oct 2026). The aggregates it already fetched answer every
 * one of them, over the whole table: leads/stats, subscribers/stats?overview=1.
 */

export type ModalRow = { label: string; sub?: string };

/** «توزيع العملاء حسب المصدر»: the six biggest sources. */
export function sourcesFromStats(bySource: Record<string, number>): [string, number][] {
  return Object.entries(bySource)
    .map(([source, count]): [string, number] => [source || 'غير محدد', Number(count) || 0])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
}

/** «أداء فريق المبيعات»: each rep's leads and how many converted, whole table. */
export function salesFromStats(staff: StaffMember[], byOwner: LeadStats['byOwner']) {
  return staff.filter(member => member.role === 'sales').map(member => {
    const own = byOwner[member.id] || { total: 0, converted: 0 };
    return {
      name: member.name, total: own.total, converted: own.converted,
      rate: own.total > 0 ? Math.round((own.converted / own.total) * 100) : 0,
    };
  });
}

/** «أكثر الكورسات تسجيلاً»: the six courses with the most clients. */
export function enrollmentsFromStats(courses: Course[], byCourse: Record<string, number>) {
  return courses.map(course => ({
    id: course.id,
    title: course.title.length > 26 ? `${course.title.slice(0, 26)}…` : course.title,
    count: byCourse[course.id] || 0,
  })).sort((a, b) => b.count - a.count).slice(0, 6);
}

/** The status counts under «حالة العملاء المحتملين». */
export function statusCounts(stats: LeadStats | null, leads: LeadItem[]) {
  const count = (status: string) => stats ? (stats.byStatus[status] || 0) : leads.filter(lead => lead.status === status).length;
  return { newLeads: count('new'), contactedLeads: count('contacted'), convertedLeads: count('converted') };
}

/**
 * «آخر العملاء المحتملين»: the five newest, asked for alone — five rows, not
 * five hundred — while no screen has loaded the leads. Null means "use the
 * loaded leads", which are newer than this answer once they arrive.
 */
export function useNewestLeads(loaded: LeadItem[], active: boolean): LeadItem[] | null {
  const [rows, setRows] = useState<LeadItem[]>([]);
  const empty = loaded.length === 0;
  useEffect(() => {
    if (!active || !empty) return;
    let cancelled = false;
    mysqlAdmin.listLeadsPage(5, 0)
      .then(page => {
        if (cancelled) return;
        setRows((page as unknown as LeadItem[]).map(lead => ({ ...lead, status: (lead.status || 'new').toLowerCase() as LeadStatus })));
      })
      .catch(() => { /* the card says «لا توجد بيانات بعد» */ });
    return () => { cancelled = true; };
  }, [active, empty]);
  return empty ? rows : null;
}

/** Fetched when a card is clicked: the list behind it, from the server's own pages. */
export const cardRows = {
  async subscribers(branch?: string): Promise<ModalRow[]> {
    const rows = await mysqlAdmin.listSubscribersPage(50, 0, branch ? { branch } : undefined) as Array<{
      name?: string; email?: string; phone?: string; branch?: string; enrolledCourseIds?: string[];
    }>;
    return rows.map(row => (branch
      ? { label: row.name || row.email || '', sub: row.phone || row.email || '' }
      : { label: row.name || row.email || '', sub: `${row.branch || '—'} · ${(row.enrolledCourseIds || []).length} كورس` }));
  },
  async leads(): Promise<ModalRow[]> {
    const rows = await mysqlAdmin.listLeadsPage(50, 0) as Array<{ name?: string; email?: string; source?: string; status?: string }>;
    return rows.map(row => ({ label: row.name || row.email || '', sub: `${row.source || ''} · ${String(row.status || '').toLowerCase()}` }));
  },
  async paidOrders(): Promise<ModalRow[]> {
    const rows = await mysqlAdmin.listAllOrders(100) as Array<{
      status?: string; amount?: number; currency?: string; subscriberName?: string; subscriber_name?: string;
      name?: string; customerName?: string; customer_name?: string;
    }>;
    return rows.filter(row => String(row.status || '').toLowerCase() === 'paid').slice(0, 50).map(row => ({
      label: row.subscriberName || row.subscriber_name || row.name || row.customerName || row.customer_name || '',
      sub: `${Number(row.amount || 0).toLocaleString('ar-EG-u-nu-latn')} ${row.currency || 'EGP'}`,
    }));
  },
};

export type OverviewSubscriberStats = SubscriberStats | null;
