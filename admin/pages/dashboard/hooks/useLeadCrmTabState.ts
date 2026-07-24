import { useRef, useState } from 'react';
import type { AccessMode, CommunicationRecord, ConsultationItem, LeadItem, LeadStatus, SalesTarget } from '../../../types';
import type { PaymentDraft } from '../../../components/PaymentModal';
import { createClientPaymentDraft } from '../../../lib/clientActionDrafts';
import { blankLead } from '../dashboardShared';

export type LeadSegment = { id: string; name: string; search: string; statuses: string[]; branch: string; sales: string; course: string; followup: string };
export type WaTemplate = { id: string; name: string; body: string };

// CRM/lead-tab modal/draft/filter state (lead edit-in-progress row, payment
// modal, convert-to-subscriber modal, client-DB filters, saved segments,
// WhatsApp templates), lifted out of the Dashboard god-hub. Pure UI state
// (no effects) — returns identical names so the component body is unchanged
// apart from the single destructure that replaces these useState lines.
export function useLeadCrmTabState() {
  const [editingLeadId, setEditingLeadId] = useState('');
  const [salesNotifOpen, setSalesNotifOpen] = useState(false);
  const [onlineMgrFollowupOpen, setOnlineMgrFollowupOpen] = useState(false);
  const [onlineMgrNewEventsOpen, setOnlineMgrNewEventsOpen] = useState(false);
  const [leadDraft, setLeadDraft] = useState<LeadItem>(blankLead());
  const [convertLeadModal, setConvertLeadModal] = useState<{ lead: LeadItem | null; courseId: string; accessMode: AccessMode }>({ lead: null, courseId: '', accessMode: 'full' });
  const bulkUploadRef = useRef<HTMLInputElement>(null);

  // -- Global Quick Booking FAB ---------------------------------------------
  const [quickBookOpen, setQuickBookOpen] = useState(false);
  const [quickBookSearch, setQuickBookSearch] = useState('');

  // -- Lead payment modal (unified — same design as subscriber payment modal) -
  const [leadPayRow, setLeadPayRow] = useState<LeadItem | null>(null);
  const [leadPayDraft, setLeadPayDraft] = useState<PaymentDraft>(createClientPaymentDraft());

  const [editingConsultationId, setEditingConsultationId] = useState('');
  const [consultationDraft, setConsultationDraft] = useState<ConsultationItem>({
    id: '',
    clientName: '',
    clientEmail: '',
    clientPhone: '',
    therapistId: '',
    therapistName: '',
    sessionType: 'individual' as 'individual' | 'couple' | 'family',
    sessionDate: '',
    slotId: '',
    slotLabel: '',
    timezone: 'Africa/Cairo',
    status: 'pending' as 'pending' | 'confirmed' | 'completed' | 'cancelled',
    notes: '',
    amount: 0,
    currency: 'EGP',
    sessionDurationMinutes: 50,
    meetingProvider: 'google_meet',
    meetingLink: '',
    createdAt: '',
  });

  const [clientDbSearch, setClientDbSearch] = useState('');
  const [clientDbTypeFilter, setClientDbTypeFilter] = useState<'all' | 'subscriber' | 'lead' | 'consultation'>('all');
  const [clientDbCourseFilter, setClientDbCourseFilter] = useState('');
  const [clientDbSalesFilter, setClientDbSalesFilter] = useState('');
  const [clientDbCollectionFilter, setClientDbCollectionFilter] = useState('');
  const [clientDbBranchFilter, setClientDbBranchFilter] = useState('');
  const [clientDbSort, setClientDbSort] = useState('date_desc');
  const [crmContactRow, setCrmContactRow] = useState<LeadItem | null>(null);
  const [crmContactDraft, setCrmContactDraft] = useState<{ type: CommunicationRecord['type']; date: string; notes: string; outcome: string; nextFollowUp: string; newStatus: LeadStatus | ''; }>({ type: 'whatsapp', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '', newStatus: '' });

  // -- Saved Segments --------------------------------------------------------
  const [showSaveSegment, setShowSaveSegment] = useState(false);
  const [savedSegments, setSavedSegments] = useState<LeadSegment[]>(() => {
    try { return JSON.parse(localStorage.getItem('crm.savedSegments') || '[]'); } catch { return []; }
  });
  const [segmentNameInput, setSegmentNameInput] = useState('');

  // -- WhatsApp Templates ----------------------------------------------------
  const [waTemplates, setWaTemplates] = useState<WaTemplate[]>(() => {
    try { return JSON.parse(localStorage.getItem('crm.waTemplates') || '[]'); } catch { return []; }
  });
  const [waTemplateEditId, setWaTemplateEditId] = useState('');
  const [waTemplateDraft, setWaTemplateDraft] = useState({ name: '', body: '' });

  const [leadsSalesTargets, setLeadsSalesTargets] = useState<SalesTarget[]>(() => {
    try {
      // Try content first (Firebase-persisted), fallback to localStorage for migration
      const fromContent = (window as unknown as Record<string, unknown>)['__crm_targets__'];
      if (fromContent) return fromContent as SalesTarget[];
      return JSON.parse(localStorage.getItem('crm.salesTargets') || '[]');
    } catch { return []; }
  });

  return {
    editingLeadId, setEditingLeadId,
    salesNotifOpen, setSalesNotifOpen,
    onlineMgrFollowupOpen, setOnlineMgrFollowupOpen,
    onlineMgrNewEventsOpen, setOnlineMgrNewEventsOpen,
    leadDraft, setLeadDraft,
    convertLeadModal, setConvertLeadModal,
    bulkUploadRef,
    quickBookOpen, setQuickBookOpen,
    quickBookSearch, setQuickBookSearch,
    leadPayRow, setLeadPayRow,
    leadPayDraft, setLeadPayDraft,
    editingConsultationId, setEditingConsultationId,
    consultationDraft, setConsultationDraft,
    clientDbSearch, setClientDbSearch,
    clientDbTypeFilter, setClientDbTypeFilter,
    clientDbCourseFilter, setClientDbCourseFilter,
    clientDbSalesFilter, setClientDbSalesFilter,
    clientDbCollectionFilter, setClientDbCollectionFilter,
    clientDbBranchFilter, setClientDbBranchFilter,
    clientDbSort, setClientDbSort,
    crmContactRow, setCrmContactRow,
    crmContactDraft, setCrmContactDraft,
    showSaveSegment, setShowSaveSegment,
    savedSegments, setSavedSegments,
    segmentNameInput, setSegmentNameInput,
    waTemplates, setWaTemplates,
    waTemplateEditId, setWaTemplateEditId,
    waTemplateDraft, setWaTemplateDraft,
    leadsSalesTargets, setLeadsSalesTargets,
  };
}
