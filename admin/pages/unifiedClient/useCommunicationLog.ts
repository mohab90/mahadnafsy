import { useState } from 'react';
import { useSiteData } from '../../context/SiteDataContext';
import type { CommunicationRecord, LeadItem, SubscriberItem } from '../../types';

/**
 * Communication logging for a lead/subscriber: the inline "add communication"
 * form, the quick "contact popup" (which can also advance a lead's status), and
 * deleting a logged communication. Extracted verbatim from UnifiedClientPage;
 * returns identical names so the render JSX is unchanged.
 *
 * `isSaving`/`setIsSaving` is the page-wide save lock shared with the other save
 * handlers, so it's injected rather than owned here.
 */
export function useCommunicationLog(opts: {
  lead?: LeadItem;
  subscriber?: SubscriberItem;
  isSaving: boolean;
  setIsSaving: (v: boolean) => void;
}) {
  const { lead, subscriber, isSaving, setIsSaving } = opts;
  const { updateLead, updateSubscriber } = useSiteData();

  // communications
  const [showAddComm, setShowAddComm] = useState(false);
  const [newComm, setNewComm] = useState({
    type: 'call' as CommunicationRecord['type'],
    date: new Date().toISOString().slice(0, 16),
    notes: '', outcome: '', nextFollowUp: '',
  });

  // contact popup
  const [showContactPopup, setShowContactPopup] = useState(false);
  const [contactPopupDraft, setContactPopupDraft] = useState({
    type: 'call' as CommunicationRecord['type'],
    date: new Date().toISOString().slice(0, 16),
    notes: '', outcome: '', nextFollowUp: '', newStatus: '',
  });

  const handleSaveComm = () => {
    if (isSaving || !newComm.notes.trim()) return;
    setIsSaving(true);
    const rec: CommunicationRecord = {
      id: `comm-${Date.now()}`,
      type: newComm.type,
      date: newComm.date.replace('T', ' '),
      notes: newComm.notes,
      outcome: newComm.outcome || undefined,
      nextFollowUp: newComm.nextFollowUp || undefined,
    };
    if (subscriber) {
      updateSubscriber({ ...subscriber, communications: [...(subscriber.communications || []), rec] });
    } else if (lead) {
      updateLead({
        ...lead,
        communications: [...(lead.communications || []), rec],
        status: lead.status === 'new' ? 'contacted' : lead.status,
        lastFollowUp: rec.date,
        nextFollowUpDate: newComm.nextFollowUp || lead.nextFollowUpDate,
      });
    }
    setShowAddComm(false);
    setNewComm({ type: 'call', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '' });
    setIsSaving(false);
  };

  const handleSaveContactPopup = () => {
    if (isSaving || !contactPopupDraft.notes.trim()) return;
    setIsSaving(true);
    const rec: CommunicationRecord = {
      id: `comm-${Date.now()}`,
      type: contactPopupDraft.type,
      date: contactPopupDraft.date.replace('T', ' '),
      notes: contactPopupDraft.notes,
      outcome: contactPopupDraft.outcome || undefined,
      nextFollowUp: contactPopupDraft.nextFollowUp || undefined,
    };
    if (subscriber) {
      updateSubscriber({ ...subscriber, communications: [...(subscriber.communications || []), rec] });
    } else if (lead) {
      const newStatus = (contactPopupDraft.newStatus as LeadItem['status']) || (lead.status === 'new' ? 'contacted' : lead.status);
      updateLead({
        ...lead,
        communications: [...(lead.communications || []), rec],
        status: newStatus,
        lastFollowUp: rec.date,
        nextFollowUpDate: contactPopupDraft.nextFollowUp || lead.nextFollowUpDate,
      });
    }
    setShowContactPopup(false);
    setContactPopupDraft({ type: 'call', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '', newStatus: '' });
    setIsSaving(false);
  };

  const handleDeleteComm = (commId: string, src: 'lead' | 'subscriber') => {
    if (src === 'subscriber' && subscriber) {
      updateSubscriber({ ...subscriber, communications: (subscriber.communications || []).filter(c => c.id !== commId) });
    } else if (src === 'lead' && lead) {
      updateLead({ ...lead, communications: (lead.communications || []).filter(c => c.id !== commId) });
    }
  };

  return {
    showAddComm, setShowAddComm, newComm, setNewComm,
    showContactPopup, setShowContactPopup, contactPopupDraft, setContactPopupDraft,
    handleSaveComm, handleSaveContactPopup, handleDeleteComm,
  };
}
