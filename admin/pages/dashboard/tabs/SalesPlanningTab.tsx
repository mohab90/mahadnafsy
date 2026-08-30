import { lazy } from 'react';
import { AlarmClock, Star, Target, TrendingUp } from 'lucide-react';
import type { NotifyFn } from '../../../types';
import { SectionedTab, type TabSection } from './SectionedTab';

/**
 * What the pipeline is expected to do, and what is being done to it.
 *
 * توقعات المبيعات، تحديد أهداف المبيعات، تذكيرات المتابعة، تقييم وترتيب الليدز
 * were four menu entries around one pipeline: two about where it is heading and
 * two about working it. A rep checking today's follow-ups and a manager setting
 * next month's target were in different corners of the menu from the forecast
 * that connects them.
 *
 * Unlike the other merges these carry four different permissions —
 * view_reports, manage_sales_team, view_leads, manage_leads — so the tab opens
 * for any of them and each section keeps its own, exactly as before.
 */

const ForecastTab = lazy(() => import('./ForecastTab'));
const SalesGoalsTab = lazy(() => import('./SalesGoalsTab'));
const FollowupRemindersTab = lazy(() => import('./FollowupRemindersTab'));
const LeadScoringTab = lazy(() => import('./LeadScoringTab'));

export const SALES_PLANNING_SECTIONS: TabSection[] = [
  { id: 'followups', label: 'تذكيرات المتابعة', icon: AlarmClock, permission: 'view_leads', Component: FollowupRemindersTab },
  { id: 'scoring', label: 'تقييم الليدز', icon: Star, permission: 'manage_leads', Component: LeadScoringTab },
  { id: 'forecast', label: 'توقعات المبيعات', icon: TrendingUp, permission: 'view_reports', Component: ForecastTab },
  { id: 'goals', label: 'أهداف المبيعات', icon: Target, permission: 'manage_sales_team', Component: SalesGoalsTab },
];

/** The retired menu keys, and the section each one now opens. */
export const RETIRED_SALES_TABS: Record<string, string> = {
  followup_reminders: 'followups',
  lead_scoring: 'scoring',
  forecast: 'forecast',
  sales_goals: 'goals',
};

export default function SalesPlanningTab({ notify }: { notify: NotifyFn }) {
  return (
    <SectionedTab
      sections={SALES_PLANNING_SECTIONS}
      notify={notify}
      basePath="sales_planning"
      emptyMessage="لا توجد أقسام مبيعات مسموح لك بالاطلاع عليها."
    />
  );
}
