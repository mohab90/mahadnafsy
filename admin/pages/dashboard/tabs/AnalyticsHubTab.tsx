import { lazy } from 'react';
import { Layers, PieChart, TrendingDown, Users } from 'lucide-react';
import type { NotifyFn } from '../../../types';
import { SectionedTab, type TabSection } from './SectionedTab';

/**
 * The four analyses of where the money and the customers went.
 *
 * تحليل الاستبقاء، تحليل Cohort، مصادر الإيراد، تحليل المصروفات were four menu
 * entries, all reading the same months and all gated on view_reports. Reading
 * one against another meant navigating between them and holding the numbers in
 * your head.
 *
 * All four are gated on view_financial now, tab and sections together: they are
 * the institute's revenue and expenses, and view_reports is what lets an HR
 * manager read HR reports and a consultant read their own.
 *
 * Named AnalyticsHubTab because AnalyticsTab is already a screen of its own.
 */

const RetentionTab = lazy(() => import('./RetentionTab'));
const CohortAnalysisTab = lazy(() => import('./CohortAnalysisTab'));
const RevenueSourcesTab = lazy(() => import('./RevenueSourcesTab'));
const ExpenseAnalyticsTab = lazy(() => import('./ExpenseAnalyticsTab'));

export const ANALYTICS_SECTIONS: TabSection[] = [
  { id: 'retention', label: 'الاستبقاء', icon: Users, permission: 'view_financial', Component: RetentionTab },
  { id: 'cohort', label: 'تحليل Cohort', icon: Layers, permission: 'view_financial', Component: CohortAnalysisTab },
  { id: 'revenue', label: 'مصادر الإيراد', icon: PieChart, permission: 'view_financial', Component: RevenueSourcesTab },
  { id: 'expenses', label: 'تحليل المصروفات', icon: TrendingDown, permission: 'view_financial', Component: ExpenseAnalyticsTab },
];

/** The retired menu keys, and the section each one now opens. */
export const RETIRED_ANALYTICS_TABS: Record<string, string> = {
  retention: 'retention',
  cohort_analysis: 'cohort',
  revenue_sources: 'revenue',
  expense_analytics: 'expenses',
};

export default function AnalyticsHubTab({ notify }: { notify: NotifyFn }) {
  return (
    <SectionedTab
      sections={ANALYTICS_SECTIONS}
      notify={notify}
      basePath="analytics_hub"
      emptyMessage="لا توجد تحليلات مسموح لك بالاطلاع عليها."
    />
  );
}
