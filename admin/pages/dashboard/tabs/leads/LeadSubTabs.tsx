import React from 'react';
import { Archive, Columns, Globe, Phone, TrendingUp, Users } from 'lucide-react';

export type SubTabKey = 'pipeline' | 'table' | 'communications' | 'performance' | 'dawliNew' | 'dawliOld' | 'archive' | 'reminders';

interface LeadSubTabsProps {
  subTab: SubTabKey;
  isSalesOnly: boolean;
  rottenCount: number;
  overdueCount: number;
  dueTodayCount: number;
  setSubTab: (tab: SubTabKey) => void;
}

export function LeadSubTabs({
  subTab,
  isSalesOnly,
  rottenCount,
  overdueCount,
  dueTodayCount,
  setSubTab,
}: LeadSubTabsProps) {
  const alertCount = rottenCount + overdueCount + dueTodayCount;
  const tabs: [SubTabKey, string, React.ElementType][] = [
    ['pipeline', 'البايبلاين', Columns],
    ['table', 'الجدول', Users],
    ['communications', 'الاتصالات', Phone],
    ...(!isSalesOnly ? ([['performance', 'أداء الفريق', TrendingUp]] as [SubTabKey, string, React.ElementType][]) : []),
    ['dawliNew', 'دولي جديد', Globe],
    ['dawliOld', 'دولي قديم', Globe],
    ...(!isSalesOnly ? ([['archive', 'محلي قديم', Archive]] as [SubTabKey, string, React.ElementType][]) : []),
  ];

  return (
    <>
      {tabs.map(([tab, label, Icon]) => (
        <button
          key={tab}
          onClick={() => setSubTab(tab)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition relative ${
            subTab === tab ? 'bg-primary-600 text-white shadow-sm shadow-primary-500/30' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <Icon size={13} />
          {label}
          {tab === 'communications' && alertCount > 0 && (
            <span className="w-3.5 h-3.5 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center">
              {alertCount}
            </span>
          )}
        </button>
      ))}
    </>
  );
}
