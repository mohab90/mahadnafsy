import { useState } from 'react';
import { useSiteData } from '../../../context/SiteDataContext';
import type { CommunicationRecord, LeadItem, LeadStatus } from '../../../types';
import type { NotifyFn } from './CrmSettingsModal';

/**
 * "Log a CRM contact" feature: a modal that records a communication on a lead and
 * advances its status. Self-contained state + handler, extracted verbatim from
 * LeadsTab; returns everything with identical names so the render JSX is unchanged.
 */
export function useLeadCrmContact(notify: NotifyFn) {
  const { leads, updateLead } = useSiteData();
  const [crmContactRow, setCrmContactRow] = useState<LeadItem | null>(null);
  const [crmContactDraft, setCrmContactDraft] = useState<{
    type: CommunicationRecord['type']; date: string; notes: string;
    outcome: string; nextFollowUp: string; newStatus: LeadStatus | '';
  }>({ type: 'whatsapp', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '', newStatus: '' });

  const handleSaveCrmContact = () => {
    if (!crmContactRow || !crmContactDraft.notes.trim()) return;
    const freshLead = leads.find(l => l.id === crmContactRow.id) || crmContactRow;
    const rec: CommunicationRecord = { id: `comm-${Date.now()}`, type: crmContactDraft.type, date: crmContactDraft.date.replace('T', ' '), notes: crmContactDraft.notes, outcome: crmContactDraft.outcome || undefined, nextFollowUp: crmContactDraft.nextFollowUp || undefined };
    const updatedComms = [...(freshLead.communications || []), rec];
    const newStatus: LeadStatus = (crmContactDraft.newStatus as LeadStatus) || (freshLead.status === 'new' ? 'contacted' : freshLead.status);
    updateLead({ ...freshLead, communications: updatedComms, status: newStatus, lastFollowUp: rec.date, lastContactNote: crmContactDraft.notes, nextFollowUpDate: crmContactDraft.nextFollowUp || freshLead.nextFollowUpDate });
    setCrmContactRow(null);
    setCrmContactDraft({ type: 'whatsapp', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '', newStatus: '' });
    notify('success', 'تم تسجيل التواصل بنجاح.');
  };

  return { crmContactRow, setCrmContactRow, crmContactDraft, setCrmContactDraft, handleSaveCrmContact };
}
