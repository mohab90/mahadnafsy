import React from 'react';
import { Settings2 } from 'lucide-react';

import { TabErrorBoundary } from '../../../shared/ui/TabErrorBoundary';
import type { StaffPermission } from '../../types';
import { AccessDenied } from './DashboardGuards';
import type { TabKey } from './navigation';
import { TAB_PERMISSION_MAP } from './dashboardShared';

type DashboardTabContainerProps = {
  activeTab: TabKey;
  isAdmin: boolean;
  hasPermission: (permission: StaffPermission) => boolean;
  children: React.ReactNode;
  placeholderTabs?: TabKey[];
};

export function DashboardTabContainer({
  activeTab,
  isAdmin,
  hasPermission,
  children,
  placeholderTabs = [],
}: DashboardTabContainerProps) {
  const requiredPermission = TAB_PERMISSION_MAP[activeTab];

  if (!isAdmin && (!requiredPermission || !hasPermission(requiredPermission))) {
    return <AccessDenied />;
  }

  return (
    <TabErrorBoundary key={activeTab} tabName={activeTab}>
      <>
        {children}

        {placeholderTabs.includes(activeTab) && (
          <div className="bg-white border border-gray-200 rounded-2xl p-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 grid place-items-center mx-auto mb-4">
              <Settings2 size={28} className="text-gray-300" />
            </div>
            <h3 className="text-lg font-extrabold text-gray-700 mb-2">قيد الإنشاء</h3>
            <p className="text-gray-400 text-sm">هذا القسم سيكون متاحا قريبا</p>
          </div>
        )}
      </>
    </TabErrorBoundary>
  );
}
