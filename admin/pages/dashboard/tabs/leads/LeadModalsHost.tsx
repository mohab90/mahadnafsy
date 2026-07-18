import React, { Suspense } from 'react';
import type { Bundle, Course, LeadItem, StaffMember } from '../../../../types';
import type { PaymentDraft } from '../../../../components/PaymentModal';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { CrmSettingsModal } from '../CrmSettingsModal';
import type { CrmSettings, NotifyFn } from '../CrmSettingsModal';
import { ConvertLeadModal, type ConvertLeadModalState } from './ConvertLeadModal';
import { AddLeadModal, BulkWhatsAppModal, WhatsAppRepModal } from './LeadSubcomponents';
import { LeadSalesNotificationsPanel } from './LeadSalesNotificationsPanel';

const PaymentModal = React.lazy(() => import('../../../../components/PaymentModal'));

type BranchOption = { id: string; label: string };

interface LeadModalsHostProps {
  convertLeadModal: ConvertLeadModalState;
  setConvertLeadModal: React.Dispatch<React.SetStateAction<ConvertLeadModalState>>;
  convertLeadToSubscriber: () => void | Promise<void>;
  courses: Course[];
  bundles: Bundle[];
  leadPayRow: LeadItem | null;
  leadPayDraft: PaymentDraft;
  setLeadPayDraft: React.Dispatch<React.SetStateAction<PaymentDraft>>;
  handleLeadPayment: (draft: PaymentDraft) => void | Promise<void>;
  setLeadPayRow: (lead: LeadItem | null) => void;
  instituteBranches: BranchOption[];
  salesNotifOpen: boolean;
  leads: LeadItem[];
  isSalesOnly: boolean;
  currentStaff: StaffMember | null;
  setSalesNotifOpen: (open: boolean) => void;
  setLeadsFollowupFilter: (filter: 'all' | 'today' | 'overdue') => void;
  setActiveDashboardTab?: (tab: string) => void;
  showSettings: boolean;
  setShowSettings: (open: boolean) => void;
  notify: NotifyFn;
  salesReps: StaffMember[];
  reloadLeads: () => void | Promise<void>;
  setCrmSettings: React.Dispatch<React.SetStateAction<CrmSettings>>;
  showAddLead: boolean;
  setShowAddLead: (open: boolean) => void;
  sources: string[];
  handleAddLead: (...args: any[]) => Promise<void>;
  showBulkWA: boolean;
  selectedLeads: LeadItem[];
  closeBulkWhatsApp: () => void;
  waActiveRep: StaffMember | null;
  setWaRepId: (id: string | null) => void;
}

export function LeadModalsHost({
  convertLeadModal,
  setConvertLeadModal,
  convertLeadToSubscriber,
  courses,
  bundles,
  leadPayRow,
  leadPayDraft,
  setLeadPayDraft,
  handleLeadPayment,
  setLeadPayRow,
  instituteBranches,
  salesNotifOpen,
  leads,
  isSalesOnly,
  currentStaff,
  setSalesNotifOpen,
  setLeadsFollowupFilter,
  setActiveDashboardTab,
  showSettings,
  setShowSettings,
  notify,
  salesReps,
  reloadLeads,
  setCrmSettings,
  showAddLead,
  setShowAddLead,
  sources,
  handleAddLead,
  showBulkWA,
  selectedLeads,
  closeBulkWhatsApp,
  waActiveRep,
  setWaRepId,
}: LeadModalsHostProps) {
  return (
    <>
      <ConvertLeadModal
        state={convertLeadModal}
        courses={courses}
        setState={setConvertLeadModal}
        onConfirm={convertLeadToSubscriber}
      />

      {leadPayRow && (
        <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black/20" />}>
          <PaymentModal
            mode="lead"
            subject={{
              id: leadPayRow.id,
              name: leadPayRow.name,
              phone: leadPayRow.phone,
              branch: leadPayRow.branch,
              email: leadPayRow.email,
            }}
            draft={leadPayDraft}
            setDraft={setLeadPayDraft}
            onSubmit={(draft) => { void handleLeadPayment(draft); }}
            onClose={() => setLeadPayRow(null)}
            branchOptions={instituteBranches.map((branch) => ({ id: branch.id, label: branch.label }))}
            instituteName="مهاد نفسي"
          />
        </Suspense>
      )}

      <LeadSalesNotificationsPanel
        open={salesNotifOpen}
        leads={leads}
        isSalesOnly={isSalesOnly}
        currentStaff={currentStaff}
        onClose={() => setSalesNotifOpen(false)}
        onShowOverdue={() => { setLeadsFollowupFilter('overdue'); setSalesNotifOpen(false); setActiveDashboardTab?.('leads'); }}
        onShowToday={() => { setLeadsFollowupFilter('today'); setSalesNotifOpen(false); setActiveDashboardTab?.('leads'); }}
      />

      {showSettings && (
        <CrmSettingsModal
          onClose={() => setShowSettings(false)}
          notify={notify}
          salesReps={salesReps}
          onSynced={async () => {
            setShowSettings(false);
            await reloadLeads();
            mysqlAdmin.getCrmSettings().then((data) => {
              if (data && (data as Partial<CrmSettings>).leadSources?.length) {
                setCrmSettings((current) => ({ ...current, ...(data as Partial<CrmSettings>) }));
              }
            }).catch(() => {});
          }}
        />
      )}

      {showAddLead && (
        <AddLeadModal
          courses={courses}
          bundles={bundles}
          salesReps={salesReps}
          leads={leads}
          sources={sources}
          branches={instituteBranches}
          onClose={() => setShowAddLead(false)}
          onSave={handleAddLead}
        />
      )}

      {showBulkWA && (
        <BulkWhatsAppModal
          selectedLeads={selectedLeads}
          onClose={closeBulkWhatsApp}
          notify={notify}
        />
      )}

      {waActiveRep && (
        <WhatsAppRepModal
          rep={waActiveRep}
          leads={leads}
          onClose={() => setWaRepId(null)}
          notify={notify}
        />
      )}
    </>
  );
}
