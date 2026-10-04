import type { ElementType } from 'react';
import { AlarmClock, Archive, Columns, FileText, GitMerge, Globe, TrendingUp, UserX, Users } from 'lucide-react';

export type SubTabKey =
  | 'pipeline' | 'table' | 'communications' | 'reminders' | 'quotes'
  | 'performance' | 'duplicates' | 'localNew' | 'dawliNew' | 'dawliOld' | 'archive'
  | 'pipelineSettings';

interface LeadSubTabsProps {
  subTab: SubTabKey;
  isSalesOnly: boolean;
  canManageDuplicates: boolean;
  /** Follow-ups due today or earlier and not done — each lead once. */
  overdueCount: number;
  unassignedCount?: number;
  setSubTab: (tab: SubTabKey) => void;
}

export function LeadSubTabs({
  subTab,
  isSalesOnly,
  canManageDuplicates,
  overdueCount,
  unassignedCount = 0,
  setSubTab,
}: LeadSubTabsProps) {
  // What is waiting on the «المتابعات» screen: follow-ups due by today. It used
  // to add every stale lead (thousands of never-contacted ones, the pool
  // included) and today's follow-ups a second time on top of those already in
  // overdueCount, so the number answered nothing and did not fit its circle.
  const alertCount = overdueCount;
  const tabs: [SubTabKey, string, ElementType][] = [
    ['pipeline', 'البايبلاين', Columns],
    ['table', 'الجدول', Users],
    // 'الاتصالات' is now a view inside 'المتابعات' (LeadsTab renders both under
    // subTab='reminders'), not a tab of its own — same data, one less tab.
    ['reminders', 'المتابعات', AlarmClock],
    ['quotes', 'العروض', FileText],
    ...(!isSalesOnly ? [['performance', 'أداء الفريق', TrendingUp] as [SubTabKey, string, ElementType]] : []),
    ...(canManageDuplicates ? [['duplicates', 'مراجعة التكرار', GitMerge] as [SubTabKey, string, ElementType]] : []),
    ...(!isSalesOnly ? [['localNew', 'محلي جديد', UserX] as [SubTabKey, string, ElementType]] : []),
    // «داتا سعودي»: what were two tabs, «دولي جديد» (the international leads
    // waiting for a rep) and «دولي قديم» (imported international data), in one
    // — «اعمل دمج لصفحه دولي قديم مع دولي جديد خليها اسمها داتا سعودي».
    // The key stays 'dawliOld' so saved links keep working; ?tab=dawliNew
    // lands here too (useLeadSubTab).
    ['dawliOld', 'داتا سعودي', Globe],
    ['archive', 'محلي قديم', Archive],
    // 'إعداد المراحل' (pipelineSettings) moved into the الإعدادات menu
    // (LeadsTabHeader's actions dropdown) — one less top-level tab, same
    // canManageDuplicates gate, reached via setSubTab('pipelineSettings').
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
              <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] text-white">
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}
