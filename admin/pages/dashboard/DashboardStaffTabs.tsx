import React, { Suspense } from 'react';

import { TabErrorBoundary } from '../../../shared/ui/TabErrorBoundary';
import type { LeadItem, StaffMember, SubscriberItem } from '../../types';
import { StaffHomeTab } from './lazyTabs';
import type { TabKey } from './navigation';

interface DashboardStaffTabsProps {
  activeTab: TabKey;
  currentStaff: StaffMember | null;
  leads: LeadItem[];
  subscribers: SubscriberItem[];
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
  onNavigate: (tab: TabKey) => void;
}

export const DashboardStaffTabs: React.FC<DashboardStaffTabsProps> = ({
  activeTab,
  currentStaff,
  leads,
  subscribers,
  notify,
  onNavigate,
}) => {
  if (activeTab !== 'staff_home' || !currentStaff) return null;

  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>}>
      <TabErrorBoundary>
        <StaffHomeTab
          staff={currentStaff}
          leads={leads}
          subscribers={subscribers}
          notify={notify}
          onNavigate={(tab) => onNavigate(tab as TabKey)}
        />
      </TabErrorBoundary>
    </Suspense>
  );
};
