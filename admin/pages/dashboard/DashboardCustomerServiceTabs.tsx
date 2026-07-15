import React, { Suspense } from 'react';

import {
  ContactsTab,
  JoinUsAdminTab,
} from './lazyTabs';
import FinancialRefundsPanel from './tabs/financial/FinancialRefundsPanel';
import type { TabKey } from './navigation';
import { TabErrorBoundary } from '../../../shared/ui/TabErrorBoundary';
import type { Bundle, Course, SubscriberItem } from '../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type Props = {
  activeTab: TabKey;
  isCollectionRole: boolean;
  isOnlineManager: boolean;
  isAdmin: boolean;
  subscribers: SubscriberItem[];
  salesOwnSubscribers: SubscriberItem[];
  setSalesOwnSubscribers: React.Dispatch<React.SetStateAction<SubscriberItem[]>>;
  courses: Course[];
  bundles: Bundle[];
  updateSubscriber: (subscriber: SubscriberItem) => void;
  notify: NotifyFn;
  refundActionSaving: string | null;
  setRefundActionSaving: React.Dispatch<React.SetStateAction<string | null>>;
};

const spinner = (color: string) => (
  <div className="flex items-center justify-center p-16">
    <span className={`w-6 h-6 border-2 ${color} border-t-transparent rounded-full animate-spin`} />
  </div>
);

export function DashboardCustomerServiceTabs({
  activeTab,
  isCollectionRole,
  isOnlineManager,
  isAdmin,
  notify,
}: Props) {
  if (activeTab === 'refund_requests' && (isCollectionRole || isOnlineManager || isAdmin)) {
    return (
      <FinancialRefundsPanel
        notify={(message, tone) => notify(tone === 'error' ? 'error' : 'success', message)}
      />
    );
  }

  if (activeTab === 'contacts') {
    return (
      <Suspense fallback={spinner('border-primary-500')}>
        <TabErrorBoundary>
          <ContactsTab />
        </TabErrorBoundary>
      </Suspense>
    );
  }

  if (activeTab === 'join_us') {
    return (
      <Suspense fallback={spinner('border-indigo-500')}>
        <TabErrorBoundary>
          <JoinUsAdminTab />
        </TabErrorBoundary>
      </Suspense>
    );
  }

  return null;
}
