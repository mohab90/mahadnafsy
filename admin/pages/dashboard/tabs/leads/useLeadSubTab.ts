import { useSearchParams } from 'react-router-dom';
import type { SubTabKey } from './LeadSubTabs';

export function useLeadSubTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const subTab = (searchParams.get('tab') as SubTabKey) || 'table';
  const setSubTab = (tab: SubTabKey) =>
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      next.set('tab', tab);
      return next;
    }, { replace: true });

  return { subTab, setSubTab };
}
