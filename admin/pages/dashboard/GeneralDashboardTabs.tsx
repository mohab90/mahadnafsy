import React, { Suspense } from 'react';
import IntegrationsTab from './tabs/IntegrationsTab';
import SecurityCenterTab from './tabs/SecurityCenterTab';
import AnalyticsHubTab from './tabs/AnalyticsHubTab';
import CampaignsTab from './tabs/CampaignsTab';
import SalesPlanningTab from './tabs/SalesPlanningTab';

import { TabErrorBoundary } from '../../../shared/ui/TabErrorBoundary';
import type { TabKey } from './navigation';
import type { NotifyFn } from '../../types';
import {
  AnalyticsTab,
  ArchivedClientsTab,
  BranchesSettingsTab,
  BranchWorkspacesTab,
  ConsultationCalendarTab,
  CustomerInboxTab,
  ServiceHubTab,
  DaqqiAttendanceTab,
  DaqqiTeamTab,
  CxTeamTab,
  FinancialTab,
  FinancialReportsHub,
  HrTab,
  HrAnalyticsTab,
  InstallmentPlansTab,
  InterviewsTab,
  JoinUsAdminTab,
  LeadSourcesSettingsTab,
  EnpsDashboardTab,
  OffboardingTab,
  FaqManagerTab,
  NpsDashboardTab,
  NotifInboxMgmtTab,
  OnlineTeamMgmtTab,
  RecurringExpensesTab,
  RegistrationsTab,
  SalesReportsTab,
  SalesTeamTab,
  SettingsHubTab,
  StaffPerformanceTab,
  SubscriptionsTab,
  SystemSettingsTab,
  TasksBoardTab,
  TicketsTab,
  WaitlistTab,
} from './lazyTabs';

// Imported, not redeclared: the local copy omitted 'warning', so every tab
// component that types its notify prop from types.ts was unassignable here.
// Some tabs in this table take an optional `initial` alongside notify (the
// financial reports hub opens on a named sub-report). The table only ever
// passes notify, but the type has to admit the wider prop shape or those
// components are not assignable to it at all.
type NotifyTab = React.ElementType<{ notify: NotifyFn; initial?: string }>;

type NotifyTabEntry = {
  key: TabKey;
  Component: NotifyTab;
  branchFilter?: string;
  spinner?: 'primary' | 'indigo' | 'emerald' | 'blue' | 'amber';
};

const spinnerClassByTone: Record<NonNullable<NotifyTabEntry['spinner']>, string> = {
  primary: 'border-primary-500',
  indigo: 'border-indigo-600',
  emerald: 'border-emerald-500',
  blue: 'border-blue-500',
  amber: 'border-amber-500',
};

function DaqqiStatsWithAttendance({ notify }: { notify: NotifyFn }) {
  return (
    <div className="space-y-6">
      <AnalyticsTab notify={notify} />
      <DaqqiAttendanceTab notify={(message, type) => notify(type || 'info', message)} />
    </div>
  );
}

const notifyTabs: NotifyTabEntry[] = [
  { key: 'customer_inbox', Component: CustomerInboxTab, spinner: 'primary' },
  { key: 'service_hub', Component: ServiceHubTab, spinner: 'primary' },
  { key: 'tasks_board', Component: TasksBoardTab, spinner: 'primary' },
  { key: 'installment_plans', Component: InstallmentPlansTab, spinner: 'primary' },
  { key: 'interviews', Component: InterviewsTab, spinner: 'primary' },
  { key: 'registrations', Component: RegistrationsTab, spinner: 'primary' },
  { key: 'tickets', Component: TicketsTab, spinner: 'primary' },
  { key: 'faq_manager', Component: FaqManagerTab, spinner: 'primary' },
  { key: 'nps_dashboard', Component: NpsDashboardTab, spinner: 'primary' },
  { key: 'daqqi_team', Component: DaqqiTeamTab, spinner: 'primary' },
  { key: 'cx_team', Component: CxTeamTab, spinner: 'primary' },
  { key: 'daqqi_accounting', Component: FinancialTab, branchFilter: 'daqqi', spinner: 'emerald' },
  { key: 'daqqi_stats', Component: DaqqiStatsWithAttendance, spinner: 'blue' },
  { key: 'financial_reports', Component: FinancialReportsHub, spinner: 'amber' },
  { key: 'recurring_expenses', Component: RecurringExpensesTab, spinner: 'primary' },
  { key: 'hr', Component: HrTab, spinner: 'primary' },
  { key: 'hr_analytics', Component: HrAnalyticsTab, spinner: 'primary' },
  { key: 'staff_performance', Component: StaffPerformanceTab, spinner: 'indigo' },
  { key: 'sales_team', Component: SalesTeamTab, spinner: 'indigo' },
  { key: 'sales_reports', Component: SalesReportsTab, spinner: 'indigo' },
  { key: 'online_team', Component: OnlineTeamMgmtTab, spinner: 'indigo' },
  { key: 'subscriptions', Component: SubscriptionsTab, spinner: 'indigo' },
  { key: 'consultation_calendar', Component: ConsultationCalendarTab, spinner: 'indigo' },
  { key: 'branches_settings', Component: BranchesSettingsTab, spinner: 'indigo' },
  { key: 'archived_clients', Component: ArchivedClientsTab, spinner: 'indigo' },
  { key: 'enps_dashboard', Component: EnpsDashboardTab, spinner: 'indigo' },
  { key: 'offboarding', Component: OffboardingTab, spinner: 'indigo' },
  { key: 'settings_hub', Component: SettingsHubTab, spinner: 'indigo' },
  { key: 'lead_sources_settings', Component: LeadSourcesSettingsTab, spinner: 'blue' },
  { key: 'branch_workspaces', Component: BranchWorkspacesTab, spinner: 'amber' },
  { key: 'notif_inbox', Component: NotifInboxMgmtTab, spinner: 'indigo' },
  { key: 'waitlist', Component: WaitlistTab, spinner: 'amber' },
  { key: 'system_settings', Component: SystemSettingsTab, spinner: 'indigo' },
  { key: 'integrations', Component: IntegrationsTab, spinner: 'indigo' },
  { key: 'security_center', Component: SecurityCenterTab, spinner: 'indigo' },
  { key: 'analytics_hub', Component: AnalyticsHubTab, spinner: 'indigo' },
  { key: 'campaigns', Component: CampaignsTab, spinner: 'indigo' },
  { key: 'sales_planning', Component: SalesPlanningTab, spinner: 'indigo' },
];

function LoadingSpinner({ tone = 'indigo' }: { tone?: NotifyTabEntry['spinner'] }) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className={`h-8 w-8 animate-spin rounded-full border-b-2 ${spinnerClassByTone[tone || 'indigo']}`} />
    </div>
  );
}

export function GeneralDashboardTabs({ activeTab, notify }: { activeTab: TabKey; notify: NotifyFn }) {
  const match = notifyTabs.find(tab => tab.key === activeTab);

  if (match) {
    const { Component, branchFilter, spinner } = match;
    return (
      <Suspense fallback={<LoadingSpinner tone={spinner} />}>
        <TabErrorBoundary>
          <Component notify={notify} {...(branchFilter ? { branchFilter } : {})} />
        </TabErrorBoundary>
      </Suspense>
    );
  }

  // 'staff_applications' rendered this with initialType 'all', which is what
  // 'join_us' already does. Only the instructor-filtered view is its own screen.
  if (activeTab === 'lecturer_applications') {
    return (
      <Suspense fallback={<LoadingSpinner tone="indigo" />}>
        <TabErrorBoundary>
          <JoinUsAdminTab initialType="instructor" />
        </TabErrorBoundary>
      </Suspense>
    );
  }

  return null;
}
