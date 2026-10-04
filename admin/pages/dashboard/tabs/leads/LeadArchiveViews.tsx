import { ArchiveTab, type ArchiveTabProps } from './ArchiveTab';
import { isArchiveSource, isDawliNewLead, isInternationalLead, isLocalNewLead } from './leadSourceGroups';

type LeadArchiveViewsProps = ArchiveTabProps & {
  subTab: string;
};

/**
 * key={subTab} on every ArchiveTab below, and it is load-bearing.
 *
 * Three of these sub-tabs render the same component from the same position in
 * the tree, so React reconciles them as one element and keeps its state. That
 * state includes `archiveSource`, seeded once with `useState(defaultSource)` —
 * so moving from "محلي قديم" to "دولي قديم" left the filter reading the source
 * it was mounted with, and the دولي tab listed محلي rows. Reported from the desk
 * as "ليه تاب دولي قديم بيظهر داتا محلي؟".
 *
 * The key makes each sub-tab its own element, so switching tabs remounts and
 * the source is seeded from the tab actually being shown.
 */
export function LeadArchiveViews({ subTab, ...archiveProps }: LeadArchiveViewsProps) {
  if (subTab === 'localNew') {
    return (
      <ArchiveTab
        key={subTab}
        {...archiveProps}
        title="محلي جديد — عملاء بلا مندوب مبيعات"
        hideImport
        customFilter={isLocalNewLead}
      />
    );
  }

  // A rep gets a plain list — no import, no bulk assign — so the heading should
  // not advertise tooling they cannot see.
  const salesOnly = archiveProps.isSalesOnly;

  // «داتا سعودي»: the international leads waiting for a rep (was «دولي جديد»)
  // and the imported international data (was «دولي قديم»), in one list.
  if (subTab === 'dawliOld' || subTab === 'dawliNew') {
    return (
      <ArchiveTab
        key="dawliOld"
        {...archiveProps}
        title={salesOnly ? 'داتا سعودي' : 'داتا سعودي — الاستيراد والتعيين الجماعي'}
        defaultSource="دولي قديم"
        tabLabel="داتا سعودي"
        customFilter={lead => isDawliNewLead(lead)
          || (!lead.hidden && isArchiveSource(lead.source) && isInternationalLead(lead))}
      />
    );
  }

  if (subTab === 'archive') {
    return (
      <ArchiveTab
        key={subTab}
        {...archiveProps}
        title={salesOnly ? 'محلي قديم' : undefined}
        customFilter={lead => !lead.hidden && isArchiveSource(lead.source)
          && !isInternationalLead(lead)}
      />
    );
  }

  return null;
}
