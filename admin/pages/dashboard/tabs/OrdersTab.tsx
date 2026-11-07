import { useOrderActions } from './orders/useOrderActions';
import { useOrdersDesk } from './orders/useOrdersDesk';
import { OrdersOnlineManagerView } from './orders/OrdersOnlineManagerView';
import { OrdersAdminView } from './orders/OrdersAdminView';
import type { OrdersTabProps } from './orders/ordersTypes';

/**
 * «الطلبات والمدفوعات». One screen, two views by who is looking: the online
 * manager sees his clients' payments, everyone else the full desk (the Dokki
 * manager's «مدفوعاتي» is StaffPaymentsTab, not this screen). The views are in tabs/orders/, the actions they share
 * (confirm, reject, link to a transfer) in tabs/orders/useOrderActions.ts. The full desk's rows, tabs, totals and head figures
 * are a page of the server's list (useOrdersDesk); after any action the screen asks that page again instead of downloading
 * the orders list.
 */
export default function OrdersTab(props: OrdersTabProps) {
  const onlineManagerDesk = props.isOnlineManager && !props.isAdmin;
  const desk = useOrdersDesk({
    tab: props.orderReviewTab,
    filters: { search: props.orderSearch, status: 'all', type: props.orderTypeFilter, method: props.orderMethodFilter, staff: props.orderStaffFilter, from: props.orderDateFrom, to: props.orderDateTo },
    branch: props.branchFilter,
    localRows: props.localOrders,
    enabled: !onlineManagerDesk,
  });
  const wired: OrdersTabProps = { ...props, reloadOrders: props.localOrders ? props.reloadOrders : async () => { desk.reload(); } };
  const actions = useOrderActions(wired);
  if (onlineManagerDesk) return <OrdersOnlineManagerView props={wired} actions={actions} />;
  return <OrdersAdminView props={wired} actions={actions} desk={desk} />;
}
