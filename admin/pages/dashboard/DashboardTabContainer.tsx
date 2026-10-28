import React from 'react';
import { Settings2 } from 'lucide-react';

import { TabErrorBoundary } from '../../../shared/ui/TabErrorBoundary';
import { AccessDenied } from './DashboardGuards';
import type { TabKey } from './navigation';

type DashboardTabContainerProps = {
  activeTab: TabKey;
  isAdmin: boolean;
  /** Whether the viewer may open a tab — lib/access.ts canOpenTab, the rule the menu and the role bars use too. */
  canOpenTab: (tab: TabKey) => boolean;
  children: React.ReactNode;
  placeholderTabs?: TabKey[];
};

export function DashboardTabContainer({
  activeTab,
  isAdmin,
  canOpenTab,
  children,
  placeholderTabs = [],
}: DashboardTabContainerProps) {
  // The same decision that put the tab in the menu or the bar (lib/access.ts): a tab names one permission or
  // several (TAB_PERMISSION_MAP), null is the viewer's own page, the message screens go by the job, and a tab
  // nobody mapped stays denied.
  const allowed = canOpenTab(activeTab);

  if (!isAdmin && !allowed) {
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
