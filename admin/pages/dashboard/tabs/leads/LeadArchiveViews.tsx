import { Globe } from 'lucide-react';
import { LeadTable } from '../LeadTable';
import type { Bundle, Course, StaffMember, SubscriberItem } from '../../../../types';
import { ArchiveTab, type ArchiveTabProps } from './ArchiveTab';
import { isArchiveSource } from './leadSourceGroups';

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
          && !isArchiveSource(lead.source)
          && !['converted', 'lost'].includes(lead.status)}
      />
    );
  }

  if (subTab === 'dawliNew') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Globe size={20} className="text-blue-500" />
            دولي جديد
          </h3>
        </div>
        <LeadTable
          rows={[]}
          showCourseCol={true}
          courses={archiveProps.courses as Course[]}
          bundles={archiveProps.bundles as Bundle[]}
          navigate={archiveProps.navigate}
          updateLead={archiveProps.updateLead}
          reloadLeads={archiveProps.reloadLeads}
          deleteLead={archiveProps.deleteLead}
          addSubscriber={archiveProps.addSubscriber}
          updateSubscriber={archiveProps.updateSubscriber}
          subscribers={archiveProps.subscribers as SubscriberItem[]}
          salesStaff={archiveProps.salesReps as StaffMember[]}
          isSalesOnly={archiveProps.isSalesOnly}
          canManageLeads={archiveProps.canManageLeads}
          onBook={archiveProps.onBook}
          branchOptions={archiveProps.branchOptions}
          sources={archiveProps.sources}
        />
      </div>
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
      />
    );
  }

  if (subTab === 'archive') {
    return (
      <ArchiveTab
        key={subTab}
        {...archiveProps}
        title={salesOnly ? 'محلي قديم' : undefined}
      />
    );
  }

  return null;
}
