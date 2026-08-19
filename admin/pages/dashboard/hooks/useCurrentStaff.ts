import { useEffect, useMemo, useState } from 'react';
import type { StaffMember } from '../../../types';
import { mysqlClient } from '../../../lib/mysqlapi';
import { staffStatusFromWire, type StaffWire } from '../dashboardHelpers';

interface CurrentStaffArgs {
  isAdmin: boolean;
  authUser: { uid?: string; email?: string | null } | null | undefined;
  staffMembers: StaffMember[];
}

export function useCurrentStaff({ isAdmin, authUser, staffMembers }: CurrentStaffArgs) {
  const [staffSelf, setStaffSelf] = useState<StaffMember | null>(null);
  const [staffSelfLoading, setStaffSelfLoading] = useState(true);

  useEffect(() => {
    if (isAdmin || !authUser?.email) return;
    setStaffSelfLoading(true);
    (mysqlClient.getStaffSelf() as Promise<unknown>).then((record) => {
      if (record) {
        const staff = record as StaffWire;
        setStaffSelf({ ...staff, role: (staff.role || '').toLowerCase() as StaffMember['role'], status: staffStatusFromWire(staff) });
      }
    }).catch(() => {/* not a staff member or not logged in */})
      .finally(() => setStaffSelfLoading(false));
    // Keyed on authUser?.uid. The email is only read to decide whether there is
    // an account to look up at all; which staff record to fetch follows the
    // signed-in identity, and the auth object is replaced on every token
    // refresh, so depending on it would re-hit /staff/me for the same person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, authUser?.uid]);

  const currentStaff = useMemo(() => {
    if (!authUser) return null;
    return staffMembers.find((staff) => staff.email.toLowerCase() === (authUser.email ?? '').toLowerCase())
      ?? staffSelf ?? null;
  }, [staffMembers, staffSelf, authUser]);

  return {
    staffSelf,
    staffSelfLoading,
    currentStaff,
    isSalesOnly: currentStaff?.role === 'sales',
    isCollectionRole: (currentStaff?.role || '').toLowerCase() === 'collection',
    isReceptionDaqqi: currentStaff?.role === 'reception_daqqi',
    isDaqqiManager: currentStaff?.role === 'daqqi_manager',
    isOnlineManager: (currentStaff?.role as string) === 'online_manager',
    isSalesCollectionManager: (currentStaff?.role as string) === 'sales_collection_manager',
  };
}
