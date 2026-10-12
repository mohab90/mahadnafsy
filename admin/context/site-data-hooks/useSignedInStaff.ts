import { useEffect, useMemo, useState } from 'react';
import type { StaffMember } from '../../types';
import { mysqlClient } from '../../lib/mysqlapi';
import { useAuth } from '../AuthContext';

/**
 * Who is signed in, as a staff record.
 *
 * Twelve screens answered this themselves with
 * `staffMembers.find(m => m.email === authUser.email)`, and eleven of them got
 * nobody for most of the institute. GET /api/admin/staff requires view_staff,
 * which four roles out of sixteen hold — online_manager, daqqi_manager,
 * sales_collection_manager, hr. For the other ten the request is a 403 and the
 * array stays at its empty seed, so `currentStaff` was undefined,
 * `hasPermission(undefined, …)` is false, and every permission-gated control on
 * those screens was hidden from the people entitled to use it. The accountant
 * could not act in الحسابات. A sales rep could not act on their own leads. An
 * employee opening «ملفي الوظيفي» saw an empty file.
 *
 * GET /api/staff/me is requireAuth only: it tells any signed-in employee who
 * they are. Resolved once, so no screen has to ask again and none can answer
 * differently.
 *
 * The list is preferred over /staff/me because it carries the full record —
 * commission rate, targets, department — that the self endpoint trims.
 */
export function useSignedInStaff(
  isAdmin: boolean,
  email: string | null | undefined,
  staffMembers: StaffMember[],
) {
  // From /api/auth/me, carried on the record so every
  // hasPermission(currentStaff, 'delete_…') asks it without knowing to —
  // «شيل من صلاحيات اي شخص غير المدير وليد وحازم ومهاب الحذف اي ما كان» (12 Oct 2026).
  const canDelete = useAuth().authUser?.canDelete;
  const [staffSelf, setStaffSelf] = useState<StaffMember | null>(null);
  const [staffSelfLoading, setStaffSelfLoading] = useState(true);

  useEffect(() => {
    if (isAdmin || !email) { setStaffSelf(null); setStaffSelfLoading(false); return undefined; }
    setStaffSelfLoading(true);
    let cancelled = false;
    (mysqlClient.getStaffSelf() as Promise<unknown>).then(record => {
      if (cancelled || !record) return;
      const wire = record as StaffMember & { is_active?: number | boolean };
      setStaffSelf({
        ...wire,
        role: String(wire.role || 'other').toLowerCase() as StaffMember['role'],
        status: wire.status === 'active' || wire.is_active === 1 || wire.is_active === true ? 'active' : 'inactive',
      });
    }).catch(() => { /* not a staff member */ })
      .finally(() => { if (!cancelled) setStaffSelfLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin, email]);

  // Trimmed and lower-cased on both sides: an address stored with a trailing
  // space would otherwise miss the list and fall through to the self record,
  // which carries fewer fields — a silent downgrade rather than a failure.
  const currentStaff = useMemo(() => {
    if (!email) return null;
    const key = String(email).toLowerCase().trim();
    const found = staffMembers.find(m => String(m.email || '').toLowerCase().trim() === key)
      ?? staffSelf ?? null;
    return found ? { ...found, canDelete } : null;
  }, [staffMembers, staffSelf, email, canDelete]);

  return { currentStaff, staffSelf, staffSelfLoading };
}
