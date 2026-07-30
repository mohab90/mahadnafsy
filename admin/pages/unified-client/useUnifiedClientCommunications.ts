import { useEffect, useRef, useState } from 'react';
import type { CommunicationRecord, LeadItem, SubscriberItem } from '../../types';
import type { UnifiedClientCommunicationDraft } from './UnifiedClientCommunicationModal';

interface Params {
  lead?: LeadItem;
  subscriber?: SubscriberItem;
  clientCode: string;
  isSaving: boolean;
  setIsSaving: (saving: boolean) => void;
  updateLead: (lead: LeadItem) => Promise<boolean>;
  updateSubscriber: (subscriber: SubscriberItem) => Promise<boolean>;
}

function communicationDraft(withStatus = false): UnifiedClientCommunicationDraft {
  return {
    type: 'call',
    date: new Date().toISOString().slice(0, 16),
    notes: '',
    outcome: '',
    nextFollowUp: '',
    ...(withStatus ? { newStatus: '' } : {}),
  };
}

export function useUnifiedClientCommunications(params: Params) {
  const {
    lead, subscriber, clientCode, isSaving, setIsSaving, updateLead, updateSubscriber,
  } = params;
  const [showAddComm, setShowAddComm] = useState(false);
  const [newComm, setNewComm] = useState<UnifiedClientCommunicationDraft>(() => communicationDraft());
  const [showContactPopup, setShowContactPopup] = useState(false);
  const [contactPopupDraft, setContactPopupDraft] = useState<UnifiedClientCommunicationDraft>(() => communicationDraft(true));
  const persistedQuickNote = subscriber?.internalQuickNote ?? lead?.internalQuickNote ?? '';
  const [quickNote, setQuickNote] = useState(persistedQuickNote);
  const quickNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuickNote(persistedQuickNote);
    return () => {
      if (quickNoteTimer.current) clearTimeout(quickNoteTimer.current);
    };
  }, [clientCode, persistedQuickNote]);

  const saveQuickNote = (value: string) => {
    setQuickNote(value);
    if (quickNoteTimer.current) clearTimeout(quickNoteTimer.current);
    quickNoteTimer.current = setTimeout(async () => {
      const saved = subscriber
        ? await updateSubscriber({ ...subscriber, internalQuickNote: value })
        : lead ? await updateLead({ ...lead, internalQuickNote: value }) : false;
      if (!saved) setQuickNote(persistedQuickNote);
    }, 600);
  };

  const persistCommunication = async (
    draft: UnifiedClientCommunicationDraft,
    updateStatus: boolean,
  ) => {
    const record: CommunicationRecord = {
      id: `comm-${Date.now()}`,
      type: draft.type,
      date: draft.date.replace('T', ' '),
      notes: draft.notes,
      outcome: draft.outcome || undefined,
      nextFollowUp: draft.nextFollowUp || undefined,
    };
    if (subscriber) {
      return updateSubscriber({
        ...subscriber,
        communications: [...(subscriber.communications || []), record],
      });
    }
    if (!lead) return false;
    return updateLead({
      ...lead,
      communications: [...(lead.communications || []), record],
      status: updateStatus
        ? ((draft.newStatus as LeadItem['status']) || (lead.status === 'new' ? 'contacted' : lead.status))
        : (lead.status === 'new' ? 'contacted' : lead.status),
      lastFollowUp: record.date,
      nextFollowUpDate: draft.nextFollowUp || lead.nextFollowUpDate,
    });
  };

  const saveCommunication = async (
    draft: UnifiedClientCommunicationDraft,
    updateStatus: boolean,
    onSuccess: () => void,
  ) => {
    if (isSaving || !draft.notes.trim()) return;
    setIsSaving(true);
    try {
      if (await persistCommunication(draft, updateStatus)) onSuccess();
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveComm = () => saveCommunication(newComm, false, () => {
    setShowAddComm(false);
    setNewComm(communicationDraft());
  });

  const handleSaveContactPopup = () => saveCommunication(contactPopupDraft, true, () => {
    setShowContactPopup(false);
    setContactPopupDraft(communicationDraft(true));
  });

  const handleDeleteComm = async (communicationId: string, source: 'lead' | 'subscriber') => {
    if (source === 'subscriber' && subscriber) {
      await updateSubscriber({
        ...subscriber,
        communications: (subscriber.communications || []).filter(item => item.id !== communicationId),
      });
    } else if (source === 'lead' && lead) {
      await updateLead({
        ...lead,
        communications: (lead.communications || []).filter(item => item.id !== communicationId),
      });
    }
  };

  return {
    showAddComm, setShowAddComm, newComm, setNewComm,
    showContactPopup, setShowContactPopup, contactPopupDraft, setContactPopupDraft,
    quickNote, saveQuickNote, handleSaveComm, handleSaveContactPopup, handleDeleteComm,
  };
}
