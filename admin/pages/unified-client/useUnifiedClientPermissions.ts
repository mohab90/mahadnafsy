import { useEffect, useMemo, useState } from 'react';
import { mysqlClient } from '../../lib/mysqlapi';
import type { StaffMember } from '../../types';

type AuthUser = { email?: string | null } | null | undefined;

export function useUnifiedClientPermissions(params: {
  isAdmin: boolean;
  authUser: AuthUser;
  staffMembers: StaffMember[];
}) {
  const { isAdmin, authUser, staffMembers } = params;
  const [staffSelfRecord, setStaffSelfRecord] = useState<StaffMember | null>(null);

  useEffect(() => {
    if (isAdmin || !authUser?.email) return;
    mysqlClient.getStaffSelf()
      .then((record: unknown) => {
        if (record && typeof record === 'object') setStaffSelfRecord(record as StaffMember);
      })
      .catch(() => {});
  }, [isAdmin, authUser?.email]);

  const currentStaff = useMemo(
    () => staffMembers.find(s => s.email?.toLowerCase() === (authUser?.email ?? '').toLowerCase())
      ?? staffSelfRecord
      ?? null,
    [staffMembers, staffSelfRecord, authUser?.email],
  );

  const isOnlineManager = currentStaff?.role === 'online_manager';
  const isCollectionManager = currentStaff?.role === 'collection' || currentStaff?.role === 'manager';

  return {
    currentStaff,
    isOnlineManager,
    isCollectionManager,
    canManageCourseAccess: isAdmin || isOnlineManager || isCollectionManager,
  };
}
