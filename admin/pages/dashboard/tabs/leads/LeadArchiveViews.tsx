import { Globe } from 'lucide-react';
import { LeadTable } from '../LeadTable';
import type { Bundle, Course, StaffMember, SubscriberItem } from '../../../../types';
import { ArchiveTab, type ArchiveTabProps } from './ArchiveTab';

type LeadArchiveViewsProps = ArchiveTabProps & {
  subTab: string;
};

export function LeadArchiveViews({ subTab, ...archiveProps }: LeadArchiveViewsProps) {
  if (subTab === 'localNew') {
    return (
      <ArchiveTab
        {...archiveProps}
        title="محلي جديد — عملاء بلا مندوب مبيعات"
        hideImport
        customFilter={lead => !lead.hidden && !lead.assignedSalesId && !['converted', 'lost'].includes(lead.status)}
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

  if (subTab === 'dawliOld') {
    return (
      <ArchiveTab
        {...archiveProps}
        title="دولي قديم - الاستيراد والتعيين الجماعي"
        defaultSource="دولي قديم"
      />
    );
  }

  if (subTab === 'archive') {
    return <ArchiveTab {...archiveProps} />;
  }

  return null;
}
