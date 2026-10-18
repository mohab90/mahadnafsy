import { useEffect, useRef, useState } from 'react';
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
  reloadLeads: () => Promise<void>;
  /** After a contact is saved — the follow-ups lists are asked for again. */
  onSaved?: () => void;
}

export function useLeadQuickCommunication({ reloadLeads, onSaved }: UseLeadQuickCommunicationArgs) {
  const [showAddComm, setShowAddComm] = useState(false);
  // The lead chosen, as it was handed over. One opened from the follow-ups list
  // comes from the server's queue and is often not among the leads loaded, and
  // the save looked only there — so it did nothing at all.
  const [chosenLead, setChosenLead] = useState<LeadItem | null>(null);
  const [addCommDraft, setAddCommDraft] = useState(blankQuickCommunicationDraft);
  const [addCommSearchResults, setAddCommSearchResults] = useState<LeadItem[]>([]);

  // The lead is searched on the server while the person types (GET /admin/leads/table?q=, the table's own search),
  // six at a time — not in a list of every lead the browser holds. A slow answer never replaces a newer one.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);
  const handleLeadSearchChange = (value: string) => {
    setAddCommDraft((draft) => ({ ...draft, leadSearch: value, selectedLeadId: '' }));
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = value.trim();
    const ticket = ++searchSeq.current;
    if (term.length < 2) {
      setAddCommSearchResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      mysqlAdmin.adminGet<{ rows: LeadItem[] }>(`/admin/leads/table?q=${encodeURIComponent(term)}&page=0&pageSize=6&withTotal=0`).then(
        result => { if (ticket === searchSeq.current) setAddCommSearchResults(result.rows); },
        () => { if (ticket === searchSeq.current) setAddCommSearchResults([]); },
      );
    }, 300);
  };

  const selectLeadForCommunication = (lead: LeadItem) => {
    setChosenLead(lead);
    setAddCommDraft((draft) => ({ ...draft, leadSearch: lead.name, selectedLeadId: lead.id }));
    setAddCommSearchResults([]);
  };

  const resetQuickCommunication = () => {
    setAddCommDraft(blankQuickCommunicationDraft);
    setAddCommSearchResults([]);
  };

  const saveQuickCommunication = async () => {
    const lead = chosenLead?.id === addCommDraft.selectedLeadId ? chosenLead : null;
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
        onSaved?.();
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
      onSaved?.();
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
