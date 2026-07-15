import React, { Suspense } from 'react';

import { TabErrorBoundary } from '../../../shared/ui/TabErrorBoundary';
import type { TabKey } from './navigation';
import { ClientDbTab, FinancialTab } from './lazyTabs';
import type OrdersTabComponent from './tabs/OrdersTab';

const OrdersTab = React.lazy(() => import('./tabs/OrdersTab'));

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type DashboardFinanceTabsProps = {
  activeTab: TabKey;
  notify: NotifyFn;
  branchFilter?: string;
  ordersProps: React.ComponentProps<typeof OrdersTabComponent>;
  onClientBook: React.ComponentProps<typeof ClientDbTab>['onBook'];
};

export function DashboardFinanceTabs({
  activeTab,
  notify,
  branchFilter,
  ordersProps,
  onClientBook,
}: DashboardFinanceTabsProps) {
  if (activeTab === 'orders') {
    return (
      <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" /></div>}>
        <OrdersTab {...ordersProps} />
      </Suspense>
    );
  }

  if (activeTab === 'financial') {
    return (
      <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" /></div>}>
        <FinancialTab notify={notify} branchFilter={branchFilter} />
      </Suspense>
    );
  }

  if (activeTab === 'client') {
    return (
      <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-emerald-600" /></div>}>
        <TabErrorBoundary>
          <ClientDbTab notify={notify} onBook={onClientBook} />
        </TabErrorBoundary>
      </Suspense>
    );
  }

  return null;
}
