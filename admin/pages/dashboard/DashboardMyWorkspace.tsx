import React, { Suspense } from 'react';
import { Home, UserCog, Briefcase } from 'lucide-react';

import { TabErrorBoundary } from '../../../shared/ui/TabErrorBoundary';
import { DashboardStaffSettingsPanel } from './lazyDashboardComponents';
import { MyHrTab, StaffHomeTab } from './lazyTabs';
import type { TabKey } from './navigation';

/** The three tab keys this page answers for. Kept as keys, not merged away:
 *  they are in people's bookmarks, in the sales and collection nav bars, and
 *  in the login redirect, and a key that stops resolving is a blank screen. */
export const WORKSPACE_TABS = ['staff_home', 'staff_settings', 'my_hr'] as const;
export type WorkspaceTab = typeof WORKSPACE_TABS[number];

export const isWorkspaceTab = (tab: string): tab is WorkspaceTab =>
  (WORKSPACE_TABS as readonly string[]).includes(tab);

const SECTIONS: { key: WorkspaceTab; label: string; icon: React.ElementType }[] = [
  { key: 'staff_home', label: 'الرئيسية', icon: Home },
  { key: 'staff_settings', label: 'ملفي الشخصي', icon: UserCog },
  { key: 'my_hr', label: 'ملفي الوظيفي', icon: Briefcase },
];

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
 * الرئيسية, ملفي الشخصي and ملفي الوظيفي were three separate icons in the top
 * bar opening three separate pages, all of them about the signed-in employee
 * and nothing else. Three icons for one subject reads as three unrelated
 * places; this is one place with three sections, behind one icon.
 *
 * The sections are the existing panels untouched — the merge is navigation, not
 * a rewrite, so nothing any employee relies on changes behaviour.
 */
export const DashboardMyWorkspace: React.FC<DashboardMyWorkspaceProps> = ({
  activeTab,
  setActiveTab,
  staffSettingsProps,
  staffHomeProps,
}) => {
  if (!isWorkspaceTab(activeTab)) return null;
  const currentStaff = staffSettingsProps.currentStaff || staffHomeProps.currentStaff;
  if (!currentStaff) return null;

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap items-center gap-1 bg-gray-100 rounded-xl p-1" aria-label="مساحتي">
        {SECTIONS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            aria-current={activeTab === key ? 'page' : undefined}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition ${
              activeTab === key
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-gray-600 hover:bg-white hover:text-indigo-700'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>

      <TabErrorBoundary>
        <Suspense fallback={<Spinner />}>
          {activeTab === 'staff_home' && <StaffHomeTab {...(staffHomeProps as any)} />}
          {activeTab === 'staff_settings' && <DashboardStaffSettingsPanel {...(staffSettingsProps as any)} />}
          {activeTab === 'my_hr' && <MyHrTab {...({ notify: staffSettingsProps.notify } as any)} />}
        </Suspense>
      </TabErrorBoundary>
    </div>
  );
};

export default DashboardMyWorkspace;
