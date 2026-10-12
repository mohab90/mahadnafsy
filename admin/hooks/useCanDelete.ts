import { useAuth } from '../context/AuthContext';

/**
 * May the signed-in account delete anything?
 *
 * The owner, 12 Oct 2026: «شيل من صلاحيات اي شخص غير المدير وليد وحازم ومهاب
 * الحذف اي ما كان سواء نشوى او خلود حذف عميل او حذف موظف او حذف حتي شخص منضم».
 * The answer comes from /api/auth/me (api/lib/deleteRights.js): the owner and
 * whoever is ticked in «صلاحية الحذف», nobody else, whatever their role or grid.
 *
 * Many delete buttons are gated on isAdmin or on a manage_ permission rather
 * than a delete_ one, so hasPermission alone does not reach them; this is what
 * they ask as well. It only hides the button — the server refuses the deletion
 * regardless. Undefined (an older API that does not say) leaves them as they were.
 */
export function useCanDelete(): boolean {
  const { authUser } = useAuth();
  return authUser?.canDelete !== false;
}
