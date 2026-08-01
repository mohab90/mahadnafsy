import type { ElementType } from 'react';
import { AlarmClock, Archive, Columns, FileText, GitMerge, Globe, Phone, Settings, TrendingUp, UserX, Users } from 'lucide-react';

export type SubTabKey =
  | 'pipeline' | 'table' | 'communications' | 'reminders' | 'quotes'
  | 'performance' | 'duplicates' | 'localNew' | 'dawliNew' | 'dawliOld' | 'archive'
  | 'pipelineSettings';

interface LeadSubTabsProps {
  subTab: SubTabKey;
  isSalesOnly: boolean;
  canManageDuplicates: boolean;
  rottenCount: number;
  overdueCount: number;
  dueTodayCount: number;
  unassignedCount?: number;
  setSubTab: (tab: SubTabKey) => void;
}

export function LeadSubTabs({
  subTab,
  isSalesOnly,
  canManageDuplicates,
  rottenCount,
  overdueCount,
  dueTodayCount,
  unassignedCount = 0,
  setSubTab,
}: LeadSubTabsProps) {
  const alertCount = rottenCount + overdueCount + dueTodayCount;
  const tabs: [SubTabKey, string, ElementType][] = [
    ['pipeline', 'البايبلاين', Columns],
    ['table', 'الجدول', Users],
    ['communications', 'الاتصالات', Phone],
    ['reminders', 'المتابعات', AlarmClock],
    ['quotes', 'العروض السعرية', FileText],
    ...(!isSalesOnly ? [['performance', 'أداء الفريق', TrendingUp] as [SubTabKey, string, ElementType]] : []),
    ...(canManageDuplicates ? [['duplicates', 'مراجعة التكرار', GitMerge] as [SubTabKey, string, ElementType]] : []),
    ...(!isSalesOnly ? [['localNew', 'محلي جديد', UserX] as [SubTabKey, string, ElementType]] : []),
    ['dawliNew', 'دولي جديد', Globe],
    ['dawliOld', 'دولي قديم', Globe],
    ...(!isSalesOnly ? [['archive', 'محلي قديم', Archive] as [SubTabKey, string, ElementType]] : []),
    // Editing the stage rules changes what every status transition allows, so it
    // sits behind the same gate as duplicate merging rather than being visible
    // to every rep.
    ...(canManageDuplicates ? [['pipelineSettings', 'إعداد المراحل', Settings] as [SubTabKey, string, ElementType]] : []),
  ];

  return (
    <>
      {tabs.map(([tab, label, Icon]) => {
        const badge = tab === 'reminders' ? alertCount : tab === 'localNew' ? unassignedCount : 0;
        return (
          <button type="button" key={tab} onClick={() => setSubTab(tab)}
            className={`relative flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
              subTab === tab
                ? 'bg-primary-600 text-white shadow-sm shadow-primary-500/30'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            <Icon size={13} />
            {label}
            {badge > 0 && (
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] text-white">
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}
