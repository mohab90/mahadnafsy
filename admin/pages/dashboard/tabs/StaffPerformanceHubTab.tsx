import { lazy } from 'react';
import { BarChart3, LayoutDashboard, TrendingUp } from 'lucide-react';
import type { NotifyFn } from '../../../types';
import { SectionedTab, type TabSection } from './SectionedTab';

/**
 * «أداء الموظفين» and «تقارير وتحليلات HR» were two menu entries over the same people (4 Nov 2026, «خلي صفحه اداء الموظفين وتحليلات تبقي صفحه واحدة»).
 * One page, two sections, each keeping the permission it had: the team's leads, conversions and revenue per person for view_hr or view_leads
 * (a rep's own figures too), and the HR figures — headcount, payroll over time, departments — for view_hr.
 */

const StaffOverviewSection = lazy(() => import('./staff-performance/StaffOverviewSection').then(module => ({ default: module.StaffOverviewSection })));
const StaffPerformanceTab = lazy(() => import('./StaffPerformanceTab'));
const HrAnalyticsTab = lazy(() => import('./HrAnalyticsTab'));

export const STAFF_PERFORMANCE_SECTIONS: TabSection[] = [
  { id: 'overview', label: 'نظرة عامة', icon: LayoutDashboard, permission: 'view_hr', alsoPermissions: ['manage_sales_team', 'view_perf_sales'], Component: StaffOverviewSection },
  { id: 'team', label: 'أداء الفريق', icon: TrendingUp, permission: 'view_hr', alsoPermissions: ['view_leads'], Component: StaffPerformanceTab as TabSection['Component'] },
  { id: 'hr', label: 'تحليلات الموارد البشرية', icon: BarChart3, permission: 'view_hr', Component: HrAnalyticsTab },
];

/** The retired menu key, and the section it now opens. */
export const RETIRED_STAFF_PERFORMANCE_TABS: Record<string, string> = {
  hr_analytics: 'hr',
};

export default function StaffPerformanceHubTab({ notify }: { notify: NotifyFn }) {
  return (
    <SectionedTab
      sections={STAFF_PERFORMANCE_SECTIONS}
      notify={notify}
      basePath="staff_performance"
      emptyMessage="لا توجد تقارير أداء مسموح لك بالاطلاع عليها."
    />
  );
}
