import { useSearchParams } from 'react-router-dom';
import type { SubTabKey } from './LeadSubTabs';

export function useLeadSubTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = (searchParams.get('tab') as SubTabKey) || 'table';
  // «دولي جديد» was merged into «داتا سعودي» (dawliOld); an old link opens the merged tab.
  // «أداء الفريق» left for its own page: an old link opens the table.
  const subTab: SubTabKey = requested === 'dawliNew' ? 'dawliOld' : requested === 'performance' ? 'table' : requested;
  const setSubTab = (tab: SubTabKey) =>
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      next.set('tab', tab);
      return next;
    }, { replace: true });

  return { subTab, setSubTab };
}
