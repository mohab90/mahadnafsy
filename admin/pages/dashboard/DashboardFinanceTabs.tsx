import React, { Suspense } from 'react';

import { TabErrorBoundary } from '../../../shared/ui/TabErrorBoundary';
import type { TabKey } from './navigation';
import { ClientDbTab, FinancialTab } from './lazyTabs';
import type OrdersTabComponent from './tabs/OrdersTab';
import { CollectionBookingsReview } from './tabs/orders/CollectionBookingsReview';
import { hasPermission } from '../../constants/permissions';
import type { PermissionKey, RoleKey } from '../../constants/permissions';

const OrdersTab = React.lazy(() => import('./tabs/OrdersTab'));
const StaffPaymentsTab = React.lazy(() => import('./tabs/staff-payments/StaffPaymentsTab'));

/**
 * The accounts screen is for whoever keeps the accounts — «يفضل التصميم
 * الحالي للادارة والمحاسب والمسئول للاونلاين فقط». Everybody else who takes
 * money (sales, collection, the Daqqi desk) gets «مدفوعاتي» in their own design.
 */
// Customer service is here too: they answer callers about any payment, not
// about payments they took themselves — «مدفوعاتي» would show them nothing.
const keepsTheAccounts = (props: React.ComponentProps<typeof OrdersTabComponent>) =>
  props.isAdmin || props.isOnlineManager
  || ['accountant', 'support'].includes(String(props.currentStaff?.role || '').toLowerCase());

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
    const staff = ordersProps.currentStaff;
    const may = (permission: PermissionKey) => Boolean(staff && hasPermission({
      role: staff.role as RoleKey, permissions: staff.permissions as PermissionKey[] | undefined,
    }, permission));
    return (
      <Suspense fallback={<div className="flex items-center justify-center p-16"><span className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" /></div>}>
        {keepsTheAccounts(ordersProps) ? (
          <div className="space-y-4">
            {/* Whoever confirms money sees, first, what is waiting to be confirmed. */}
            {ordersProps.canManageFinancial && <CollectionBookingsReview notify={notify} onChanged={() => { void ordersProps.reloadSubscribers(); }} />}
            <OrdersTab {...ordersProps} />
          </div>
        ) : (
          <TabErrorBoundary>
            <StaffPaymentsTab
              staff={staff}
              subscribers={ordersProps.salesOwnSubscribers}
              notify={notify}
              canReview={ordersProps.canManageFinancial && String(staff?.role || '').toLowerCase() !== 'collection'}
              canSeeRefunds={may('view_financial')}
            />
          </TabErrorBoundary>
        )}
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
