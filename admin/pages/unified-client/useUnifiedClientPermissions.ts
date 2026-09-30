import type { StaffMember } from '../../types';
import { hasPermission, type PermissionKey, type RoleKey } from '../../constants/permissions';

/**
 * What this screen's viewer may do to a client's record.
 *
 * `currentStaff` comes from the context, which resolves it once: the staff list
 * first, and GET /api/staff/me when that list is empty — which it is for the
 * ten roles out of sixteen that do not hold view_staff. This hook used to fetch
 * /staff/me itself, one of three components doing so on the same page load.
 */
export function useUnifiedClientPermissions(params: {
  isAdmin: boolean;
  currentStaff: StaffMember | null;
}) {
  const { isAdmin, currentStaff } = params;

  const isOnlineManager = currentStaff?.role === 'online_manager';
  const isCollectionManager = currentStaff?.role === 'collection' || currentStaff?.role === 'manager';

  // Read the permission the server checks, not a list of role names. This was
  // three hardcoded roles against a route requiring manage_courses, so the
  // collection manager saw «كامل / محدود / عدد الفيديوهات» and every click came
  // back «Permission denied». Both sides say manage_financial now.
  //
  // Never collection, whatever its grid holds: «زر صلاحية الكورسات وتفاصيل
  // الكورسات مينفعش يظهر للتحصيل ابدا» — and the routes refuse the role.
  const canManageCourseAccess = isAdmin || (currentStaff?.role !== 'collection' && hasPermission(currentStaff ? {
    role: currentStaff.role as RoleKey,
    permissions: currentStaff.permissions as PermissionKey[] | undefined,
  } : null, 'manage_financial'));

  // «زر صلاحيه الكورسات وتفاصيل الكورسات لازم يكون مقفول عند موظفين التحصيل»:
  // the table hid the button, and the client page still opened the whole
  // courses tab — prices, access, locking — to collection.
  const canSeeCourses = String(currentStaff?.role || '').toLowerCase() !== 'collection';

  return {
    currentStaff,
    isOnlineManager,
    isCollectionManager,
    canManageCourseAccess,
    canSeeCourses,
  };
}
