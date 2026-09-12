import { useEffect, useMemo, useState } from 'react';
import { mysqlClient } from '../../lib/mysqlapi';
import type { StaffMember } from '../../types';
import { hasPermission, type PermissionKey, type RoleKey } from '../../constants/permissions';

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

  // Read the permission the server checks, not a list of role names. This was
  // three hardcoded roles against a route requiring manage_courses, so the
  // collection manager saw «كامل / محدود / عدد الفيديوهات» and every click came
  // back «Permission denied». Both sides say manage_financial now.
  const canManageCourseAccess = isAdmin || hasPermission(currentStaff ? {
    role: currentStaff.role as RoleKey,
    permissions: currentStaff.permissions as PermissionKey[] | undefined,
  } : null, 'manage_financial');

  return {
    currentStaff,
    isOnlineManager,
    isCollectionManager,
    canManageCourseAccess,
  };
}
