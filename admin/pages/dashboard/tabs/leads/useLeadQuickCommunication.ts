import { useState } from 'react';
import type { CommunicationRecord, LeadItem } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

const blankQuickCommunicationDraft = {
  leadSearch: '',
  selectedLeadId: '',
  type: 'call' as CommunicationRecord['type'],
  notes: '',
  outcome: '',
  nextFollowUp: '',
  /**
   * Actually send the note as a WhatsApp message, not just record that a
   * conversation happened. Off by default: this box is mostly used to log a
   * phone call after the fact, and silently messaging a customer because
   * someone wrote a note would be worse than the extra click.
   */
  alsoSend: false,
};

interface UseLeadQuickCommunicationArgs {
  effectiveLeads: LeadItem[];
  reloadLeads: () => Promise<void>;
}

export function useLeadQuickCommunication({ effectiveLeads, reloadLeads }: UseLeadQuickCommunicationArgs) {
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

  const saveQuickCommunication = async () => {
    const lead = effectiveLeads.find((item) => item.id === addCommDraft.selectedLeadId);
    if (!lead || !addCommDraft.notes.trim()) return;
    try {
      // Sending goes through the inbox reply path, which delivers from the rep's
      // own WhatsApp when they have one and records the message itself — so the
      // lead's timeline shows what the customer actually received, rather than a
      // note about it. Recording separately would double up the entry.
      if (addCommDraft.alsoSend && addCommDraft.type === 'whatsapp') {
        await mysqlAdmin.replyInThread({
          leadId: lead.id,
          message: addCommDraft.notes.trim(),
          via: 'whatsapp',
        });
        await reloadLeads();
        resetQuickCommunication();
        setShowAddComm(false);
        return;
      }
      await mysqlAdmin.addLeadInteraction(lead.id, {
      type: addCommDraft.type,
      date: new Date().toISOString().slice(0, 16).replace('T', ' '),
      notes: addCommDraft.notes.trim(),
      outcome: addCommDraft.outcome.trim() || undefined,
      nextFollowUp: addCommDraft.nextFollowUp || undefined,
      });
      await reloadLeads();
      resetQuickCommunication();
      setShowAddComm(false);
    } catch (error) {
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: {
          field: 'lead-interaction',
          name: error instanceof Error ? error.message : lead.id,
        },
      }));
    }
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
