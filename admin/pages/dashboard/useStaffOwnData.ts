import { useCallback, useState } from 'react';
import type { LeadItem, SubscriberItem, OrderItem, DaqqiRound, StaffMember, Bundle, Course } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

interface StaffOwnDataArgs {
  isAdmin: boolean;
  isOnlineManager: boolean;
  staffSelf: StaffMember | null | undefined;
  currentStaff: StaffMember | null | undefined;
  bundles: Bundle[];
  courses: Course[];
  setStaffScopedSubscribers: (s: SubscriberItem[]) => void;
  setStaffScopedLeads: (l: LeadItem[]) => void;
  mergeContent: (c: Record<string, string>) => void;
}

/**
 * Own-data subscriptions for non-admin staff (sales/collection/daqqi/online-manager).
 * SiteDataContext only loads CRM data for admins, so these roles query MySQL directly.
 *
 * Extracted verbatim from Dashboard.tsx. It owns the 6 scoped-data state slices and
 * the fetchSalesData callback; the `useEffect` that *runs* fetchSalesData stays in
 * Dashboard at its original position so effect-execution order is unchanged.
 */
export function useStaffOwnData({
  isAdmin, isOnlineManager, staffSelf, currentStaff, bundles, courses,
  setStaffScopedSubscribers, setStaffScopedLeads, mergeContent,
}: StaffOwnDataArgs) {
  const [salesOwnLeads, setSalesOwnLeads] = useState<LeadItem[]>([]);
  const [salesOwnSubscribers, setSalesOwnSubscribers] = useState<SubscriberItem[]>([]);
  const [salesOwnOrders, setSalesOwnOrders] = useState<OrderItem[]>([]);
  const [salesOwnDaqqiRounds, setSalesOwnDaqqiRounds] = useState<DaqqiRound[] | null>(null);
  const [onlineTeamMembers, setOnlineTeamMembers] = useState<StaffMember[]>([]);
  const [salesDataLoading, setSalesDataLoading] = useState(false);

  const fetchSalesData = useCallback(async () => {
    // Online manager has isAdmin=true but still needs their own scoped data for the online_clients tab
    const staffRef = staffSelf || (isOnlineManager ? currentStaff : null);
    if (!staffRef) return;
    if (isAdmin && !isOnlineManager) return; // Real admins skip — they have full context data
    setSalesDataLoading(true);
    try {
      // mysqlAdmin: static import (top of file)

      // ONE unified call — server scopes data automatically based on role
      const [subsRaw, leadsRaw] = await Promise.allSettled([
        mysqlAdmin.listStaffSubscribers() as Promise<unknown>,
        mysqlAdmin.listStaffLeads()       as Promise<unknown>,
      ]);

      const mySubs:  SubscriberItem[] = subsRaw.status  === 'fulfilled' ? subsRaw.value  as SubscriberItem[]  : [];
      const myLeads: LeadItem[]       = leadsRaw.status === 'fulfilled' ? leadsRaw.value as LeadItem[] : [];

      setSalesOwnSubscribers(mySubs);
      setSalesOwnLeads(myLeads);
      // Sync to context so ClientDbTab (and any other tab) can access scoped data
      setStaffScopedSubscribers(mySubs);
      setStaffScopedLeads(myLeads);

      const resolveCourseTitle = (courseId: string | undefined) => {
        if (!courseId) return '';
        if (courseId.startsWith('bundle:')) {
          const bId = courseId.replace('bundle:', '');
          return bundles.find(b => b.id === bId)?.title || courseId;
        }
        return courses.find(c => c.id === courseId)?.title || bundles.find(b => b.id === courseId)?.title || courseId;
      };
      const syntheticOrders: OrderItem[] = mySubs.flatMap(sub =>
        (sub.paymentHistory || []).map(p => ({
          id: p.id, type: 'course' as const, itemId: p.courseId || '',
          subscriberId: sub.id,
          itemTitle: resolveCourseTitle(p.courseId) || p.paymentType || '',
          amount: Number(p.amount) || 0, currency: (p.currency || 'EGP') as 'EGP' | 'SAR' | 'USD',
          paymentMethod: (p.paymentMethod || 'other') as OrderItem['paymentMethod'],
          customerName: sub.name, customerEmail: sub.email,
          status: 'paid' as const, createdAt: p.at || sub.createdAt || new Date().toISOString(),
          transactionId: p.id,
          staffId: (p as { staffId?: string }).staffId || undefined,
          staffName: (p as { staffName?: string }).staffName || undefined,
        }))
      );
      setSalesOwnOrders(syntheticOrders);

      // Daqqi rounds — only for daqqi roles
      const isDaqqiRole = staffRef.role === 'daqqi_manager' || staffRef.role === 'reception_daqqi';
      if (isDaqqiRole) {
        try {
          const roundsRaw = (await mysqlAdmin.listAllDaqqiRounds()) as unknown as Record<string, unknown>[];
          const parsedRounds: DaqqiRound[] = roundsRaw.map((r) => ({
            id: String(r.id || ''),
            code: String(r.code || ''),
            courseId: String(r.course_id || r.courseId || ''),
            instructorId: String(r.instructor_id || r.instructorId || ''),
            instructorName: String(r.instructor_name || r.instructorName || ''),
            receptionId: String(r.reception_id || r.receptionId || ''),
            receptionName: String(r.reception_name || r.receptionName || ''),
            dayOfWeek: (r.day_of_week || r.dayOfWeek || '') as DaqqiRound['dayOfWeek'],
            startDate: String(r.start_date || r.startDate || '').slice(0, 10),
            timeSlot: (r.time_slot || r.timeSlot || 'مساءً') as DaqqiRound['timeSlot'],
            status: ((r.status || 'new') as string).toLowerCase() as DaqqiRound['status'],
            currentLecture: Number(r.current_lecture || r.currentLecture || 0),
            attendees: Array.isArray(r.attendees) ? (r.attendees as DaqqiRound['attendees']) : [],
            postponedWeeks: r.postponedWeeks
              ? (r.postponedWeeks as string[])
              : r.postponed_weeks_json
                ? (() => { try { return JSON.parse(String(r.postponed_weeks_json)); } catch { return []; } })()
                : [],
            createdAt: String(r.created_at || r.createdAt || ''),
          }));
          setSalesOwnDaqqiRounds(parsedRounds);
        } catch { setSalesOwnDaqqiRounds([]); }
      }

      // Team members — for manager/online_manager/sales_collection_manager
      const needsTeam = ['online_manager', 'sales_collection_manager', 'manager'].includes(staffRef.role);
      if (needsTeam) {
        try {
          const allStaffData = (await mysqlAdmin.listAllStaff()) as unknown as StaffMember[];
          setOnlineTeamMembers(allStaffData.map(s => ({
            ...s,
            role: (s.role || '').toLowerCase() as StaffMember['role'],
            status: (s.status === 'active' || (s as any).is_active === 1) ? 'active' as const : 'inactive' as const,
          })));
        } catch { setOnlineTeamMembers([]); }
      }

      // Content (branches, payment methods, etc.)
      try {
        const contentData = (await mysqlAdmin.getContent()) as Record<string, string>;
        if (contentData && typeof contentData === 'object' && Object.keys(contentData).length > 0) {
          mergeContent(contentData);
        }
      } catch { /* non-fatal */ }
    } catch (err) {
      console.error('[StaffData] fetch error:', err);
    } finally {
      setSalesDataLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, isOnlineManager, staffSelf?.id, staffSelf?.role, currentStaff?.id, currentStaff?.role]);

  return {
    salesOwnLeads, setSalesOwnLeads,
    salesOwnSubscribers, setSalesOwnSubscribers,
    salesOwnOrders, setSalesOwnOrders,
    salesOwnDaqqiRounds, setSalesOwnDaqqiRounds,
    onlineTeamMembers, setOnlineTeamMembers,
    salesDataLoading, setSalesDataLoading,
    fetchSalesData,
  };
}
