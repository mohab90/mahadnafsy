import { useEffect } from 'react';
import type { StaffMember } from '../../types';
import type { TabKey } from './navigation';

interface RoleDefaultTabArgs {
  isAdmin: boolean;
  currentStaff: StaffMember | null | undefined;
  urlTab: string | undefined;
  setActiveTabState: (t: TabKey) => void;
  isReceptionDaqqi: boolean;
  isDaqqiManager: boolean;
  isOnlineManager: boolean;
  isSalesCollectionManager: boolean;
}

/**
 * Sets the default landing tab per staff role on first load (each effect is a
 * no-op once urlTab is present / the user has navigated). Extracted verbatim from
 * Dashboard.tsx — the five effects keep their original order and dependency arrays.
 */
export function useRoleDefaultTab({
  isAdmin, currentStaff, urlTab, setActiveTabState,
  isReceptionDaqqi, isDaqqiManager, isOnlineManager, isSalesCollectionManager,
}: RoleDefaultTabArgs) {
  // Non-admin staff: default to staff_home portal (universal starting point)
  useEffect(() => {
    if (!isAdmin && currentStaff && !urlTab) setActiveTabState('staff_home');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, currentStaff?.id]);

  // Reception Daqqi staff — sees only DAQQI branch subscribers
  useEffect(() => {
    if (isReceptionDaqqi && !urlTab) setActiveTabState('daqqi_schedule');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReceptionDaqqi]);

  // Daqqi Manager — manages the whole Daqqi branch
  useEffect(() => {
    if (isDaqqiManager && !urlTab) setActiveTabState('daqqi_schedule');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDaqqiManager]);

  // Online Manager — manages all online-branch subscribers + financial view
  useEffect(() => {
    if (isOnlineManager && !urlTab) setActiveTabState('online_clients');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnlineManager]);

  // Sales & Collection Manager — manages both sales team and online/collection team
  useEffect(() => {
    if (isSalesCollectionManager && !urlTab) setActiveTabState('leads');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSalesCollectionManager]);
}
