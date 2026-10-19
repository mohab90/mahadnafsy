import FinancialTab from './FinancialTab';
import { useSiteData } from '../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

/** «الحسابات»: the books over the context's orders, clients and expenses (FinancialTab holds the screen). */
export default function FinancialMainTab({ notify, branchFilter }: { notify: NotifyFn; branchFilter?: string }) {
  const { orders, subscribers, expenses } = useSiteData();
  return <FinancialTab notify={notify} branchFilter={branchFilter} orders={orders} subscribers={subscribers} expenses={expenses} />;
}
