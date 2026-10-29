/**
 * What the signed-in account may open — one rule for the menu, the role bars, the tab gate and the
 * «ملخص الوصول» preview.
 *
 * Three answers to that question had grown apart (22 Oct 2026):
 *   - the menu filtered the browser's own copy of the role defaults with a bare `includes`, so it ignored the
 *     full-access roles, the branch managers' HR rule, the delete list and the inbox / «واتسابي» job rule — an
 *     admin-role employee off the delete list was offered «أرشيف العملاء» and refused it, a collection officer's
 *     grid offered the shared inbox the gate refuses them;
 *   - the tab gate asked constants/permissions.ts hasPermission, the same browser copy, which never applies the
 *     role overrides the owner saves in الإعدادات (the server does: api/lib/rbacOverrides.js);
 *   - the role bars and the access preview were hand-written lists nothing checked at render time — the online
 *     manager's «الأكاديمية» menu offered six screens their role cannot open.
 *
 * Now every one of them asks canOpenTab below, and the permissions it reads are the server's: /api/auth/me answers
 * the account's permission table resolved (role defaults, the owner's overrides, the account's own grid — api/
 * constants/permissions.js resolvePermissions). The browser's copy is only the fallback while that has not answered.
 * The server still refuses every request on its own; this decides what is offered.
 */
import { FULL_ACCESS_ROLES, resolvePermissions, type PermissionKey, type RoleKey } from '../constants/permissions';
import { TAB_PERMISSION_MAP } from '../pages/dashboard/dashboardShared';
import type { TabKey } from '../pages/dashboard/navigation';

export interface Viewer {
  /** The server's administrator (/api/auth/me isAdmin): every screen. */
  isAdmin: boolean;
  role: string;
  /** The account's permission table as the server resolved it: '*' or the list. */
  permissions: readonly string[] | '*';
  /** False for an account off the owner's delete list (/api/auth/me canDelete). */
  canDelete: boolean;
}

/** The viewer, from what /api/auth/me said and — until it has — the staff record's own grid and role. */
export function viewerOf({ isAdmin, role, serverPermissions, staffPermissions, canDelete }: {
  isAdmin: boolean;
  role?: string | null;
  serverPermissions?: readonly string[] | '*' | null;
  staffPermissions?: readonly string[] | null;
  canDelete?: boolean | null;
}): Viewer {
  const roleKey = String(role || '').toLowerCase();
  const permissions = serverPermissions === '*' || Array.isArray(serverPermissions)
    ? serverPermissions
    : roleKey
      ? resolvePermissions({ role: roleKey as RoleKey, permissions: staffPermissions as PermissionKey[] | null | undefined })
      : [];
  return { isAdmin, role: roleKey, permissions, canDelete: canDelete !== false };
}

const BRANCH_HR_ROLES = ['daqqi_manager', 'tagamoa_manager'];

/** Whether the viewer holds `permission` — api/constants/permissions.js hasPermission, with the owner's delete list. */
export function can(viewer: Viewer, permission: string): boolean {
  // «شيل من صلاحيات اي شخص غير المدير وليد وحازم ومهاب الحذف» (12 Oct 2026): before every other rule.
  if (permission.startsWith('delete_') && !viewer.canDelete) return false;
  if (viewer.isAdmin) return true;
  if (FULL_ACCESS_ROLES.includes(viewer.role as RoleKey)) return true;
  // A branch manager runs their branch's HR whatever their grid says, and only their branch's.
  if (BRANCH_HR_ROLES.includes(viewer.role)) {
    if (permission === 'branch_hr') return true;
    if (permission === 'view_hr' || permission === 'manage_hr') return false;
  }
  return viewer.permissions === '*' || viewer.permissions.includes(permission);
}

/** The inbox and «واتسابي» go by the job: every rep, collection for «واتسابي» only, anyone else on manage_inbox. */
function canUseChannel(viewer: Viewer, channel: 'inbox' | 'whatsapp'): boolean {
  if (viewer.role === 'sales') return true;
  if (viewer.role === 'collection') return channel === 'whatsapp';
  if (channel === 'whatsapp' && (viewer.role === 'reception_daqqi' || viewer.role === 'daqqi_manager')) return true;
  return can(viewer, 'manage_inbox');
}

/**
 * Whether the viewer may open `tab`: the job rule for the two message screens, else TAB_PERMISSION_MAP — null is
 * the person's own page, a list is any one of them, and a tab nobody mapped stays closed.
 */
export function canOpenTab(viewer: Viewer, tab: string): boolean {
  if (viewer.isAdmin) return true;
  if (tab === 'team_inbox' || tab === 'whatsapp_web') return canUseChannel(viewer, tab === 'team_inbox' ? 'inbox' : 'whatsapp');
  const required = TAB_PERMISSION_MAP[tab as TabKey];
  if (required === null) return true;
  if (Array.isArray(required)) return required.some(permission => can(viewer, permission));
  return required !== undefined && can(viewer, required);
}

/** The menu groups with only the screens the viewer may open, and no empty group. */
export function visibleMenu<G extends { items: Array<{ key: string }> }>(groups: readonly G[], viewer: Viewer): G[] {
  if (viewer.isAdmin) return [...groups];
  return groups
    .map(group => ({ ...group, items: group.items.filter(item => canOpenTab(viewer, item.key)) }))
    .filter(group => group.items.length > 0);
}
