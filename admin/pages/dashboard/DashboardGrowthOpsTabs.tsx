import { Suspense } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  DaqqiScheduleTab,
  LeadsTab,
  MarketingHubTab,
  OnlineTeamTab,
  SalesPerformancePage,
} from './lazyTabs';
import type { TabKey } from './navigation';
import { TabErrorBoundary } from '../../../shared/ui/TabErrorBoundary';
import type { DaqqiRound, LeadItem, SalesTarget, StaffMember, SubscriberItem } from '../../types';
import { TeamReportPanel } from './tabs/reports/TeamReportPanel';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type Props = {
  activeTab: TabKey;
  notify: NotifyFn;
  staffSelf: StaffMember | null;
  salesOwnLeads: LeadItem[];
  salesOwnSubscribers: SubscriberItem[];
  salesDataLoading: boolean;
  fetchSalesData: () => void;
  // string, not TabKey: this is passed straight down to panels that build the
  // tab name from data. Dashboard supplies a navigator that checks the name
  // against the real menu before it moves, so an unknown one is refused rather
  // than blanking the screen.
  setActiveTab: (tab: string) => void;
  branchFilter: string;
  isNonAdminStaff: boolean;
  salesOwnDaqqiRounds: DaqqiRound[] | null;
  isReceptionDaqqi: boolean;
  isSupport: boolean;
  leadsSalesTargets: SalesTarget[];
};

const fallback = (color: string) => (
  <div className="flex items-center justify-center p-16">
    <span className={`w-6 h-6 border-2 ${color} border-t-transparent rounded-full animate-spin`} />
  </div>
);

export function DashboardGrowthOpsTabs({
  activeTab,
  notify,
  staffSelf,
  salesOwnLeads,
  salesOwnSubscribers,
  salesDataLoading,
  fetchSalesData,
  setActiveTab,
  branchFilter,
  isNonAdminStaff,
  salesOwnDaqqiRounds,
  isReceptionDaqqi,
  isSupport,
  leadsSalesTargets,
}: Props) {
  // «ملف» on a sales rep opens that employee's own staff page.
  const navigate = useNavigate();
  if (activeTab === 'leads') {
    return (
      <Suspense fallback={fallback('border-primary-500')}>
        <TabErrorBoundary>
          <LeadsTab
            notify={notify}
            staffSelf={staffSelf}
            salesOwnLeads={salesOwnLeads}
            salesOwnSubscribers={salesOwnSubscribers}
            salesDataLoading={salesDataLoading}
            fetchSalesData={fetchSalesData}
            setActiveTab={setActiveTab}
            branchFilter={branchFilter}
          />
        </TabErrorBoundary>
      </Suspense>
    );
  }

  if (activeTab === 'daqqi_schedule') {
    return (
      <Suspense fallback={fallback('border-amber-500')}>
        <TabErrorBoundary>
          <DaqqiScheduleTab
            notify={notify}
            subscribersOverride={isNonAdminStaff ? salesOwnSubscribers : undefined}
            // Rounds come from the context for everyone: the desk's copy is pushed into it
            // (useStaffOwnData), so a booking made on this screen shows at once instead of
            // after the next two-minute poll.
            hideCreateRound={isReceptionDaqqi || isSupport}
            requirePaymentApproval={isReceptionDaqqi || isSupport}
            branchFilter={branchFilter}
          />
        </TabErrorBoundary>
      </Suspense>
    );
  }

  // «أداء المبيعات»: the leads screen's team performance, «مركز المبيعات» and
  // «فريق المبيعات والتشغيل» on one page (tabs/SalesPerformancePage.tsx).
  if (activeTab === 'sales_hub') {
    return (
      <Suspense fallback={fallback('border-violet-500')}>
        <TabErrorBoundary>
          <SalesPerformancePage
            notify={notify}
            salesTargets={leadsSalesTargets}
            onOpenStaffProfile={(staffId: string) => navigate(`/staff/${staffId}`)}
            leadsTabProps={{
              staffSelf, salesOwnLeads, salesOwnSubscribers, salesDataLoading, fetchSalesData, setActiveTab, branchFilter,
            }}
          />
        </TabErrorBoundary>
      </Suspense>
    );
  }

  if (activeTab === 'marketing_hub') {
    return (
      <Suspense fallback={fallback('border-rose-500')}>
        <TabErrorBoundary>
          <MarketingHubTab notify={notify} />
        </TabErrorBoundary>
      </Suspense>
    );
  }

  // messaging_hub renders as a section of تبويب الحملات now, beside the email,
  // SMS and drip campaigns it shares a channel with. Its route redirects there.

  if (activeTab === 'online_hub') {
    return (
      <Suspense fallback={fallback('border-teal-500')}>
        <TabErrorBoundary>
          <div className="space-y-6">
            <TeamReportPanel team="online" notify={notify} />
            <OnlineTeamTab notify={notify} />
          </div>
        </TabErrorBoundary>
      </Suspense>
    );
  }

  return null;
}
