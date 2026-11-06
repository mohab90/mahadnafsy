import FinancialTab from './FinancialTab';
import { useSiteData } from '../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

/** «الحسابات»: the books over the context's orders, clients (FinancialTab holds the screen and asks the server for the expenses a page at a time). */
export default function FinancialMainTab({ notify, branchFilter }: { notify: NotifyFn; branchFilter?: string }) {
  const { subscribers } = useSiteData();
  return <FinancialTab notify={notify} branchFilter={branchFilter} subscribers={subscribers} />;
}
