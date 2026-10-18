import { useCallback, useRef, useState } from 'react';
import type { DaqqiRound, StaffMember } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';
import { staffStatusFromWire, type StaffWire } from './dashboardHelpers';

interface StaffOwnDataArgs {
  isAdmin: boolean;
  isOnlineManager: boolean;
  staffSelf: StaffMember | null | undefined;
  currentStaff: StaffMember | null | undefined;
  /** The rounds into the context too, so the schedule and the clients screen read one copy. */
  setStaffScopedRounds?: (r: DaqqiRound[]) => void;
  mergeContent: (c: Record<string, string>) => void;
}

/**
 * What an employee's panel needs beyond the context's: the Dokki rounds (for the Dokki roles), the team (for the
 * managers) and the public content. The employee's clients and leads are no longer downloaded — every screen that
 * showed them pages, filters and counts on the server (GET /api/staff/subscribers?paged=1, /api/staff/leads-kpis,
 * /api/staff/payments, /api/staff/overview-summary, …).
 */
export function useStaffOwnData({
  isAdmin, isOnlineManager, staffSelf, currentStaff, setStaffScopedRounds, mergeContent,
}: StaffOwnDataArgs) {
  const [salesOwnDaqqiRounds, setSalesOwnDaqqiRounds] = useState<DaqqiRound[] | null>(null);
  const [onlineTeamMembers, setOnlineTeamMembers] = useState<StaffMember[]>([]);
  const [salesDataLoading, setSalesDataLoading] = useState(false);
  const loadSalesData = useCallback(async () => {
    // Staff only. The online manager counted as an admin here once, from a list
    // /api/auth/me kept apart from requireAdmin; it follows requireAdmin now.
    const staffRef = staffSelf || (isOnlineManager ? currentStaff : null);
    if (!staffRef) return;
    if (isAdmin) return; // admins have the full context data
    setSalesDataLoading(true);
    try {
      // Daqqi rounds — only for daqqi roles
      const isDaqqiRole = staffRef.role === 'daqqi_manager' || staffRef.role === 'reception_daqqi'
        || staffRef.role === 'tagamoa_manager' || staffRef.role === 'reception_tagamoa' || staffRef.role === 'manager';
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
            // Carried, or the next save of the round sent none and the server
            // cleared the hall the round was booked in.
            room: String(r.room || ''),
            heldWeeks: Array.isArray(r.heldWeeks) ? (r.heldWeeks as string[]) : [],
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
          setStaffScopedRounds?.(parsedRounds);
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
            status: staffStatusFromWire(s as StaffWire),
          })));
        } catch { setOnlineTeamMembers([]); }
      }

      // Content (branches, payment methods, etc.)
      try {
        // Never an admin here, so straight to the public copy the admin route
        // would have fallen back to after its 403.
        const contentData = (await mysqlAdmin.getContent(false)) as Record<string, string>;
        if (contentData && typeof contentData === 'object' && Object.keys(contentData).length > 0) {
          mergeContent(contentData);
        }
      } catch { /* non-fatal */ }
    } catch {
      // Keep dashboard usable if optional staff/content bootstrap data is unavailable.
    } finally {
      setSalesDataLoading(false);
    }
    // Keyed on who the staff member is and what role they hold — the two things
    // that change which scoped data to fetch. staffSelf/currentStaff objects and
    // the catalogue arrays are replaced on every context refresh, so depending on
    // them would re-run this whole bootstrap fetch each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, isOnlineManager, staffSelf?.id, staffSelf?.role, currentStaff?.id, currentStaff?.role]);

  // One refresh at a time. A call made while one is running joins it, and asks for one more run afterwards (the
  // running one may have read before the change that asked), however many asked meanwhile.
  const runningRef = useRef<Promise<void> | null>(null);
  const queuedRef = useRef(false);
  const lastDoneRef = useRef(0);
  const fetchSalesData = useCallback((): Promise<void> => {
    if (runningRef.current) { queuedRef.current = true; return runningRef.current; }
    const run = (): Promise<void> => {
      const promise = loadSalesData().finally(() => {
        lastDoneRef.current = Date.now();
        runningRef.current = null;
        if (queuedRef.current) { queuedRef.current = false; runningRef.current = run(); }
      });
      runningRef.current = promise;
      return promise;
    };
    return run();
  }, [loadSalesData]);
  /** For the timer and the return to the tab: skipped when a refresh ran less than `maxAgeMs` ago. */
  const fetchSalesDataIfStale = useCallback((maxAgeMs: number): Promise<void> => {
    if (runningRef.current || Date.now() - lastDoneRef.current < maxAgeMs) return runningRef.current ?? Promise.resolve();
    return fetchSalesData();
  }, [fetchSalesData]);

  return {
    salesOwnDaqqiRounds, setSalesOwnDaqqiRounds,
    onlineTeamMembers, setOnlineTeamMembers,
    salesDataLoading, setSalesDataLoading,
    fetchSalesData, fetchSalesDataIfStale,
  };
}
