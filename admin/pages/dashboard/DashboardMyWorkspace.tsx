import React, { Suspense, useState } from 'react';
import { Award, LayoutDashboard, Settings2, TrendingUp } from 'lucide-react';

import { TabErrorBoundary } from '../../../shared/ui/TabErrorBoundary';
import { DashboardStaffSettingsPanel } from './lazyDashboardComponents';
import { MyHrTab, StaffHomeTab } from './lazyTabs';
import { ROLE_LABELS } from '../../constants/permissions';
import type { RoleKey } from '../../constants/permissions';
import type { TabKey } from './navigation';

/**
 * The tab keys this page answers for.
 *
 * `staff_home` and `staff_settings` are one page — الرئيسية was the employee's
 * own numbers and follow-ups, ملفي الشخصي was their own details, and splitting
 * one person's page in two meant checking today's follow-ups and fixing your
 * phone number were different destinations. Both keys still resolve so
 * bookmarks, the sales and collection bars and the login redirect keep landing
 * somewhere.
 *
 * `my_hr` is no longer one of them: ملفي الوظيفي is contract, leave and payroll
 * — a different subject with a different audience — and it is its own
 * top-level tab with its own URL.
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

/**
 * Roles that carry a monthly conversion target.
 *
 * The performance half of this page — تحويلات الشهر, إيرادات الشهر, تقدمك نحو
 * الهدف, نشاطك الأسبوعي, a motivational banner — is about clients somebody
 * closes. The HR manager was shown all of it, reading «0 من 10 تحويلات» and
 * «0% من الهدف» about work that is not hers, beside a target she was never
 * given. Everyone else keeps their own page: their record, their file, their
 * settings.
 */
const ROLES_WITH_TARGETS: RoleKey[] = [
  'sales', 'collection', 'consultant', 'support',
  'sales_collection_manager', 'online_manager', 'reception_daqqi', 'daqqi_manager',
];

type PageTab = 'overview' | 'performance' | 'record' | 'settings';

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
 * It used to stack two whole panels: «شغل النهاردة» with its greeting, and the
 * profile panel with a second greeting, a second avatar and its own tab bar
 * halfway down the page. Two pages on top of each other, the same links twice,
 * and the tabs somewhere below the fold.
 *
 * Now the page owns the heading and the tabs, and asks each panel for one
 * section at a time. Which tabs exist depends on the person: performance is
 * for the roles that carry a target.
 */
export const DashboardMyWorkspace: React.FC<DashboardMyWorkspaceProps> = ({
  activeTab,
  staffSettingsProps,
  staffHomeProps,
}) => {
  const [tab, setTab] = useState<PageTab>('overview');
  if (!isWorkspaceTab(activeTab)) return null;
  const currentStaff = staffSettingsProps.currentStaff || staffHomeProps.currentStaff;
  if (!currentStaff) return null;

  const role = String(currentStaff.role || '').toLowerCase() as RoleKey;
  const hasTargets = ROLES_WITH_TARGETS.includes(role);
  const tabs: [PageTab, string, typeof Settings2][] = [
    ['overview', 'شغل النهاردة', LayoutDashboard],
    ...(hasTargets ? ([['performance', 'أدائي', TrendingUp]] as [PageTab, string, typeof Settings2][]) : []),
    ['record', 'سجلي ومراسلاتي', Award],
    ['settings', 'الإعدادات', Settings2],
  ];
  const showing: PageTab = tabs.some(([key]) => key === tab) ? tab : 'overview';

  const initials = String(currentStaff.name || '؟').split(' ').slice(0, 2).map((w: string) => w[0]).join('');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'صباح الخير' : hour < 17 ? 'مساء الخير' : 'مساء النور';

  return (
    <div className="space-y-5" dir="rtl">
      {/* One heading for the page: who is signed in, and what they are. */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-800 p-5 text-white shadow-lg">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
        <div className="relative flex items-center gap-4">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full border-4 border-white/30 bg-white/20 grid place-items-center">
            {currentStaff.image
              ? <img src={currentStaff.image} alt="" className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              : <span className="text-xl font-extrabold">{initials}</span>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-white/70">{greeting} 👋</div>
            <div className="truncate text-xl font-extrabold">{currentStaff.name}</div>
            <div className="mt-0.5 truncate text-xs text-white/70">
              {ROLE_LABELS[role] || currentStaff.role}{currentStaff.email ? ` · ${currentStaff.email}` : ''}
            </div>
          </div>
        </div>
      </div>

      {/* One tab bar, at the top, where the page begins. */}
      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-sm">
        {tabs.map(([key, label, Icon]) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition ${
              showing === key ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {showing === 'overview' && (
        <TabErrorBoundary>
          <Suspense fallback={<Spinner />}>
            <StaffHomeTab {...(staffHomeProps as any)} hideHeader />
          </Suspense>
        </TabErrorBoundary>
      )}

      {showing !== 'overview' && (
        <TabErrorBoundary>
          <Suspense fallback={<Spinner />}>
            <DashboardStaffSettingsPanel
              {...(staffSettingsProps as any)}
              section={showing === 'performance' ? 'overview' : showing}
            />
          </Suspense>
        </TabErrorBoundary>
      )}
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
