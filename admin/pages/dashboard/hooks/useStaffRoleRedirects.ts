import { useEffect } from 'react';
import type { StaffMember } from '../../../types';
import type { TabKey } from '../navigation';

type UseStaffRoleRedirectsArgs = {
  isAdmin: boolean;
  currentStaff: StaffMember | null;
  urlTab?: string;
  setActiveTabState: (tab: TabKey) => void;
};

export function useStaffRoleRedirects({
  isAdmin,
  currentStaff,
  urlTab,
  setActiveTabState,
}: UseStaffRoleRedirectsArgs) {
  const role = currentStaff?.role;

  useEffect(() => {
    if (isAdmin || !currentStaff || urlTab) return;
    if (role === 'reception_daqqi' || role === 'daqqi_manager') {
      setActiveTabState('daqqi_schedule');
      return;
    }
    if (role === 'online_manager') {
      setActiveTabState('online_clients');
      return;
    }
    if (role === 'sales_collection_manager') {
      setActiveTabState('leads');
      return;
    }
    setActiveTabState('staff_home');
  }, [isAdmin, currentStaff?.id, role, urlTab, setActiveTabState]);
}
