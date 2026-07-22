import React, { Suspense } from 'react';

import { TabErrorBoundary } from '../../../shared/ui/TabErrorBoundary';
import type { TabKey } from './navigation';
import {
  AnalyticsTab,
  AutomationDashboardTab,
  BalanceSheetTab,
  BranchWorkspacesTab,
  BudgetTrackerTab,
  CashFlowTab,
  ConsultationCalendarTab,
  CustomerInboxTab,
  DaqqiAttendanceTab,
  DaqqiTeamTab,
  DripCampaignsTab,
  EmailCampaignsTab,
  ExpenseAnalyticsTab,
  FinancialTab,
  FinancialReportsHub,
  FollowupRemindersTab,
  ForecastTab,
  HrTab,
  InstallmentPlansTab,
  IpWhitelistTab,
  JoinUsAdminTab,
  LeadScoringTab,
  LeadSourcesSettingsTab,
  MyHrTab,
  EnpsDashboardTab,
  OffboardingTab,
  FaqManagerTab,
  NpsDashboardTab,
  NotifInboxMgmtTab,
  OnlineTeamMgmtTab,
  OtpSettingsTab,
  PaymentSettingsTab,
  RecurringExpensesTab,
  RetentionTab,
  RevenueForecastTab,
  RevenueSourcesTab,
  SalesGoalsTab,
  SalesReportsTab,
  SalesTeamTab,
  SecurityDashboardTab,
  SmsCampaignsTab,
  SmsSettingsTab,
  SettingsHubTab,
  StaffPerformanceTab,
  SubscriptionsTab,
  SystemSettingsTab,
  TasksBoardTab,
  TicketsTab,
  WaitlistTab,
  WebhooksTab,
} from './lazyTabs';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type NotifyTab = React.ElementType<{ notify: NotifyFn }>;

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
  { key: 'tasks_board', Component: TasksBoardTab, spinner: 'primary' },
  { key: 'followup_reminders', Component: FollowupRemindersTab, spinner: 'primary' },
  { key: 'installment_plans', Component: InstallmentPlansTab, spinner: 'primary' },
  { key: 'tickets', Component: TicketsTab, spinner: 'primary' },
  { key: 'faq_manager', Component: FaqManagerTab, spinner: 'primary' },
  { key: 'nps_dashboard', Component: NpsDashboardTab, spinner: 'primary' },
  { key: 'daqqi_team', Component: DaqqiTeamTab, spinner: 'primary' },
  { key: 'daqqi_accounting', Component: FinancialTab, branchFilter: 'daqqi', spinner: 'emerald' },
  { key: 'daqqi_stats', Component: DaqqiStatsWithAttendance, spinner: 'blue' },
  { key: 'financial_reports', Component: FinancialReportsHub, spinner: 'amber' },
  { key: 'balance_sheet', Component: BalanceSheetTab, spinner: 'primary' },
  { key: 'cash_flow', Component: CashFlowTab, spinner: 'primary' },
  { key: 'recurring_expenses', Component: RecurringExpensesTab, spinner: 'primary' },
  { key: 'budget_tracker', Component: BudgetTrackerTab, spinner: 'primary' },
  { key: 'revenue_forecast', Component: RevenueForecastTab, spinner: 'primary' },
  { key: 'hr', Component: HrTab, spinner: 'primary' },
  { key: 'staff_management', Component: HrTab, spinner: 'primary' },
  { key: 'webhooks', Component: WebhooksTab, spinner: 'primary' },
  { key: 'security_dashboard', Component: SecurityDashboardTab, spinner: 'primary' },
  { key: 'staff_performance', Component: StaffPerformanceTab, spinner: 'indigo' },
  { key: 'retention', Component: RetentionTab, spinner: 'indigo' },
  { key: 'forecast', Component: ForecastTab, spinner: 'indigo' },
  { key: 'sales_team', Component: SalesTeamTab, spinner: 'indigo' },
  { key: 'sales_reports', Component: SalesReportsTab, spinner: 'indigo' },
  { key: 'sales_goals', Component: SalesGoalsTab, spinner: 'indigo' },
  { key: 'online_team', Component: OnlineTeamMgmtTab, spinner: 'indigo' },
  { key: 'subscriptions', Component: SubscriptionsTab, spinner: 'indigo' },
  { key: 'lead_scoring', Component: LeadScoringTab, spinner: 'indigo' },
  { key: 'consultation_calendar', Component: ConsultationCalendarTab, spinner: 'indigo' },
  { key: 'expense_analytics', Component: ExpenseAnalyticsTab, spinner: 'indigo' },
  { key: 'revenue_sources', Component: RevenueSourcesTab, spinner: 'indigo' },
  { key: 'my_hr', Component: MyHrTab, spinner: 'indigo' },
  { key: 'enps_dashboard', Component: EnpsDashboardTab, spinner: 'indigo' },
  { key: 'offboarding', Component: OffboardingTab, spinner: 'indigo' },
  { key: 'automation_dashboard', Component: AutomationDashboardTab, spinner: 'indigo' },
  { key: 'settings_hub', Component: SettingsHubTab, spinner: 'indigo' },
  { key: 'ip_whitelist', Component: IpWhitelistTab, spinner: 'indigo' },
  { key: 'payment_settings', Component: PaymentSettingsTab, spinner: 'emerald' },
  { key: 'lead_sources_settings', Component: LeadSourcesSettingsTab, spinner: 'blue' },
  { key: 'otp_settings', Component: OtpSettingsTab, spinner: 'indigo' },
  { key: 'branch_workspaces', Component: BranchWorkspacesTab, spinner: 'amber' },
  { key: 'sms_settings', Component: SmsSettingsTab, spinner: 'indigo' },
  { key: 'notif_inbox', Component: NotifInboxMgmtTab, spinner: 'indigo' },
  { key: 'email_campaigns', Component: EmailCampaignsTab, spinner: 'indigo' },
  { key: 'sms_campaigns', Component: SmsCampaignsTab, spinner: 'indigo' },
  { key: 'drip_campaigns', Component: DripCampaignsTab, spinner: 'indigo' },
  { key: 'waitlist', Component: WaitlistTab, spinner: 'amber' },
  { key: 'system_settings', Component: SystemSettingsTab, spinner: 'indigo' },
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

  if (activeTab === 'staff_applications' || activeTab === 'lecturer_applications') {
    return (
      <Suspense fallback={<LoadingSpinner tone="indigo" />}>
        <TabErrorBoundary>
          <JoinUsAdminTab initialType={activeTab === 'lecturer_applications' ? 'instructor' : 'all'} />
        </TabErrorBoundary>
      </Suspense>
    );
  }

  return null;
}
