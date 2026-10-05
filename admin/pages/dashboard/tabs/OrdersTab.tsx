import { useOrderActions } from './orders/useOrderActions';
import { OrdersOnlineManagerView } from './orders/OrdersOnlineManagerView';
import { OrdersDaqqiView } from './orders/OrdersDaqqiView';
import { OrdersAdminView } from './orders/OrdersAdminView';
import type { OrdersTabProps } from './orders/ordersTypes';

/**
 * «الطلبات والمدفوعات». One screen, three views by who is looking: the online
 * manager and the Dokki manager each see their own clients' payments, everyone
 * else the full desk. The views are in tabs/orders/, the actions they share
 * (confirm, reject, link to a transfer) in tabs/orders/useOrderActions.ts.
 */
export default function OrdersTab(props: OrdersTabProps) {
  const actions = useOrderActions(props);
  if (props.isOnlineManager && !props.isAdmin) return <OrdersOnlineManagerView props={props} actions={actions} />;
  if (props.isDaqqiManager && !props.isAdmin) return <OrdersDaqqiView props={props} actions={actions} />;
  return <OrdersAdminView props={props} actions={actions} />;
}
