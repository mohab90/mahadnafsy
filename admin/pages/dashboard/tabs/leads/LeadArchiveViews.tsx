import { ArchiveTab, type ArchiveTabProps } from './ArchiveTab';
import { isArchiveSource, isInternationalLead } from './leadSourceGroups';

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
        customFilter={lead => !lead.hidden && !lead.assignedSalesId
          && !isInternationalLead(lead)
          && !isArchiveSource(lead.source)
          && !['converted', 'lost'].includes(lead.status)}
      />
    );
  }

  if (subTab === 'dawliNew') {
    return (
      <ArchiveTab
        key={subTab}
        {...archiveProps}
        title="دولي جديد — عملاء بلا مندوب مبيعات"
        hideImport
        customFilter={lead => !lead.hidden && !lead.assignedSalesId
          && isInternationalLead(lead)
          && !isArchiveSource(lead.source)
          && !['converted', 'lost'].includes(lead.status)}
      />
    );
  }

  // A rep gets a plain list — no import, no bulk assign — so the heading should
  // not advertise tooling they cannot see.
  const salesOnly = archiveProps.isSalesOnly;

  if (subTab === 'dawliOld') {
    return (
      <ArchiveTab
        key={subTab}
        {...archiveProps}
        title={salesOnly ? 'داتا دولي' : 'دولي قديم - الاستيراد والتعيين الجماعي'}
        defaultSource="دولي قديم"
        customFilter={lead => !lead.hidden && isArchiveSource(lead.source)
          && isInternationalLead(lead)}
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
