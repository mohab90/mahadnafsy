import { useCallback, useMemo } from 'react';
import { useSiteData } from '../context/SiteDataContext';
import { can, canOpenTab, viewerOf, type Viewer } from '../lib/access';

/**
 * The signed-in account's access, by the one rule in lib/access.ts over the permissions /api/auth/me resolved on the
 * server. The menu, the role bars, the tab gate and every screen that asks «may they» read it from here.
 */
export function useAccess(): { viewer: Viewer; can: (permission: string) => boolean; canOpenTab: (tab: string) => boolean } {
  const { authUser, isAdmin, currentStaff } = useSiteData();
  const viewer = useMemo(() => viewerOf({
    isAdmin,
    role: currentStaff?.role,
    serverPermissions: authUser?.permissions,
    staffPermissions: currentStaff?.permissions,
    canDelete: authUser?.canDelete,
  }), [isAdmin, currentStaff?.role, currentStaff?.permissions, authUser?.permissions, authUser?.canDelete]);
  return {
    viewer,
    can: useCallback((permission: string) => can(viewer, permission), [viewer]),
    canOpenTab: useCallback((tab: string) => canOpenTab(viewer, tab), [viewer]),
  };
}
