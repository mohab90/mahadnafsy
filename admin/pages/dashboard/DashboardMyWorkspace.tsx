import React, { Suspense } from 'react';

import { TabErrorBoundary } from '../../../shared/ui/TabErrorBoundary';
import { DashboardStaffSettingsPanel } from './lazyDashboardComponents';
import { MyHrTab, StaffHomeTab } from './lazyTabs';
import type { TabKey } from './navigation';

/**
 * The tab keys this page answers for.
 *
 * `staff_home` and `staff_settings` are now one page — الرئيسية was the
 * employee's own numbers and follow-ups, ملفي الشخصي was their own details, and
 * splitting one person's page in two meant checking today's follow-ups and
 * fixing your phone number were different destinations. Both keys still resolve
 * so bookmarks, the sales and collection bars and the login redirect keep
 * landing somewhere.
 *
 * `my_hr` is no longer one of them: ملفي الوظيفي is contract, leave and payroll
 * — a different subject with a different audience — and it is its own top-level
 * tab with its own URL.
 */
export const WORKSPACE_TABS = ['staff_home', 'staff_settings'] as const;
export type WorkspaceTab = typeof WORKSPACE_TABS[number];

export const isWorkspaceTab = (tab: string): tab is WorkspaceTab =>
  (WORKSPACE_TABS as readonly string[]).includes(tab);

const Spinner = () => (
  <div className="flex items-center justify-center p-16">
    <span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
  </div>
);

/* eslint-disable @typescript-eslint/no-explicit-any */
interface DashboardMyWorkspaceProps {
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  /** Everything DashboardStaffSettingsPanel needs, passed through unchanged. */
  staffSettingsProps: Record<string, any>;
  staffHomeProps: Record<string, any>;
}

/**
 * ملفي الشخصي — one page for the person signed in.
 *
 * The two panels are the existing ones untouched, stacked: their own numbers
 * and follow-ups first, then their own details. The merge is navigation, not a
 * rewrite, so nothing any employee relies on changes behaviour.
 */
export const DashboardMyWorkspace: React.FC<DashboardMyWorkspaceProps> = ({
  activeTab,
  staffSettingsProps,
  staffHomeProps,
}) => {
  if (!isWorkspaceTab(activeTab)) return null;
  const currentStaff = staffSettingsProps.currentStaff || staffHomeProps.currentStaff;
  if (!currentStaff) return null;

  return (
    <div className="space-y-6">
      <TabErrorBoundary>
        <Suspense fallback={<Spinner />}>
          <StaffHomeTab {...(staffHomeProps as any)} />
        </Suspense>
      </TabErrorBoundary>

      <TabErrorBoundary>
        <Suspense fallback={<Spinner />}>
          <DashboardStaffSettingsPanel {...(staffSettingsProps as any)} />
        </Suspense>
      </TabErrorBoundary>
    </div>
  );
};

/** ملفي الوظيفي, on its own now — see WORKSPACE_TABS above. */
export const DashboardMyHr: React.FC<{ notify: unknown }> = ({ notify }) => (
  <TabErrorBoundary>
    <Suspense fallback={<Spinner />}>
      <MyHrTab {...({ notify } as any)} />
    </Suspense>
  </TabErrorBoundary>
);

export default DashboardMyWorkspace;
