import { useState } from 'react';
import type { CommunicationRecord, LeadItem } from '../../../../types';

const blankQuickCommunicationDraft = {
  leadSearch: '',
  selectedLeadId: '',
  type: 'call' as CommunicationRecord['type'],
  notes: '',
  outcome: '',
  nextFollowUp: '',
};

interface UseLeadQuickCommunicationArgs {
  effectiveLeads: LeadItem[];
  updateLead: (lead: LeadItem) => void | Promise<void>;
}

export function useLeadQuickCommunication({ effectiveLeads, updateLead }: UseLeadQuickCommunicationArgs) {
  const [showAddComm, setShowAddComm] = useState(false);
  const [addCommDraft, setAddCommDraft] = useState(blankQuickCommunicationDraft);
  const [addCommSearchResults, setAddCommSearchResults] = useState<LeadItem[]>([]);

  const handleLeadSearchChange = (value: string) => {
    setAddCommDraft((draft) => ({ ...draft, leadSearch: value, selectedLeadId: '' }));
    const query = value.toLowerCase();
    setAddCommSearchResults(
      query.length >= 2
        ? effectiveLeads.filter((lead) =>
            lead.name.toLowerCase().includes(query) || lead.phone.includes(query)
          ).slice(0, 6)
        : [],
    );
  };

  const selectLeadForCommunication = (lead: LeadItem) => {
    setAddCommDraft((draft) => ({ ...draft, leadSearch: lead.name, selectedLeadId: lead.id }));
    setAddCommSearchResults([]);
  };

  const resetQuickCommunication = () => {
    setAddCommDraft(blankQuickCommunicationDraft);
    setAddCommSearchResults([]);
  };

  const saveQuickCommunication = () => {
    const lead = effectiveLeads.find((item) => item.id === addCommDraft.selectedLeadId);
    if (!lead || !addCommDraft.notes.trim()) return;
    const rec: CommunicationRecord = {
      id: `comm-${Date.now()}`,
      type: addCommDraft.type,
      date: new Date().toISOString().slice(0, 16).replace('T', ' '),
      notes: addCommDraft.notes.trim(),
      outcome: addCommDraft.outcome.trim() || undefined,
      nextFollowUp: addCommDraft.nextFollowUp || undefined,
    };
    updateLead({
      ...lead,
      communications: [...(lead.communications || []), rec],
      nextFollowUpDate: addCommDraft.nextFollowUp || lead.nextFollowUpDate,
      status: lead.status === 'new' ? 'contacted' : lead.status,
    });
    resetQuickCommunication();
    setShowAddComm(false);
  };

  return {
    showAddComm,
    setShowAddComm,
    addCommDraft,
    setAddCommDraft,
    addCommSearchResults,
    handleLeadSearchChange,
    selectLeadForCommunication,
    saveQuickCommunication,
  };
}
