import FinancialTab from './FinancialTab';
import { useSiteData } from '../../../context/SiteDataContext';
import type { OrderItem, SubscriberItem } from '../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

// A branch's books hold no orders (the online ones are the main books') and no list of clients: what they show of the
// clients — the instalment plans, the payments waiting for review, the person a payment is for — comes from the server.
const NO_ORDERS: OrderItem[] = [];
const NO_CLIENTS: SubscriberItem[] = [];

/** «حسابات الدقي» / «حسابات التجمع» (FinancialTab holds the screen). */
export default function FinancialBranchTab({ notify, branchFilter }: { notify: NotifyFn; branchFilter?: string }) {
  const { expenses } = useSiteData();
  return <FinancialTab notify={notify} branchFilter={branchFilter} orders={NO_ORDERS} subscribers={NO_CLIENTS} expenses={expenses} />;
}
