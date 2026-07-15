import { create } from 'zustand';
import { SubscriberItem, LeadItem, StaffMember, ConsultationItem, DaqqiRound, JoinUsApplication, ContactMessage, InboxConversation } from '../types';
import { mysqlAdmin } from '../lib/mysqlapi';

const logPersistError = (what: string) => (err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[useCrmStore] failed to persist ${what}:`, err);
};

interface CrmState {
  subscribers: SubscriberItem[];
  leads: LeadItem[];
  staffMembers: StaffMember[];
  consultations: ConsultationItem[];
  daqqiRounds: DaqqiRound[];
  joinUsApplications: JoinUsApplication[];
  contactMessages: ContactMessage[];
  inboxConversations: InboxConversation[];
  mySubscriberLoaded: boolean;
  staffScopedSubscribers: SubscriberItem[];
  staffScopedLeads: LeadItem[];

  setSubscribers: (subscribers: SubscriberItem[]) => void;
  setLeads: (leads: LeadItem[]) => void;
  setStaffMembers: (staffMembers: StaffMember[]) => void;
  setConsultations: (consultations: ConsultationItem[]) => void;
  setDaqqiRounds: (daqqiRounds: DaqqiRound[]) => void;
  setJoinUsApplications: (joinUsApplications: JoinUsApplication[]) => void;
  setContactMessages: (contactMessages: ContactMessage[]) => void;
  setInboxConversations: (inboxConversations: InboxConversation[]) => void;
  setStaffScopedSubscribers: (staffScopedSubscribers: SubscriberItem[]) => void;
  setStaffScopedLeads: (staffScopedLeads: LeadItem[]) => void;
  setMySubscriberLoaded: (loaded: boolean) => void;
  _applySubscriberData: (sub: any) => void;

  addSubscriber: (item: SubscriberItem) => Promise<boolean>;
  updateSubscriber: (item: SubscriberItem) => void;
  deleteSubscriber: (id: string) => void;

  addLead: (item: LeadItem) => Promise<void>;
  addPublicLead: (item: Omit<LeadItem, 'clientCode'> & { clientCode?: string }) => Promise<void>;
  updateLead: (item: LeadItem) => void;
  markLeadsConverted: (ids: string[]) => void;
  deleteLead: (id: string) => void;
  bulkDeleteLeads: (ids: string[]) => void;
  bulkAssignClientCodes: (updatedSubs: SubscriberItem[], updatedLeads: LeadItem[]) => void;
  bulkRedistributeLeads: (mode: 'unassigned' | 'all') => Promise<number>;

  addStaffMember: (item: StaffMember) => void;
  updateStaffMember: (item: StaffMember) => void;
  deleteStaffMember: (id: string) => void;

  addConsultation: (item: ConsultationItem) => void;
  updateConsultation: (item: ConsultationItem) => void;
  deleteConsultation: (id: string) => void;

  addDaqqiRound: (item: DaqqiRound) => void;
  updateDaqqiRound: (item: DaqqiRound) => void;
  deleteDaqqiRound: (id: string) => void;
  bulkSetDaqqiRounds: (rounds: DaqqiRound[]) => void;

  addJoinUsApplication: (item: JoinUsApplication) => void;
  updateJoinUsApplication: (item: JoinUsApplication) => void;
  deleteJoinUsApplication: (id: string) => void;

  addContactMessage: (item: ContactMessage) => void;
  updateContactMessage: (item: ContactMessage) => void;
  deleteContactMessage: (id: string) => void;

  addInboxConversation: (conv: InboxConversation) => void;
  updateInboxConversation: (conv: InboxConversation) => void;
  deleteInboxConversation: (id: string) => void;
}

export const useCrmStore = create<CrmState>((set) => ({
  subscribers: [],
  leads: [],
  staffMembers: [],
  consultations: [],
  daqqiRounds: [],
  joinUsApplications: [],
  contactMessages: [],
  inboxConversations: [],
  mySubscriberLoaded: false,

  staffScopedSubscribers: [],
  staffScopedLeads: [],

  setSubscribers: (subscribers) => set({ subscribers }),
  setLeads: (leads) => set({ leads }),
  setStaffScopedSubscribers: (staffScopedSubscribers: SubscriberItem[]) => set({ staffScopedSubscribers }),
  setStaffScopedLeads: (staffScopedLeads: LeadItem[]) => set({ staffScopedLeads }),
  setStaffMembers: (staffMembers) => set({ staffMembers }),
  setConsultations: (consultations) => set({ consultations }),
  setDaqqiRounds: (daqqiRounds) => set({ daqqiRounds }),
  setJoinUsApplications: (joinUsApplications) => set({ joinUsApplications }),
  setContactMessages: (contactMessages) => set({ contactMessages }),
  setInboxConversations: (inboxConversations) => set({ inboxConversations }),
  setMySubscriberLoaded: (mySubscriberLoaded) => set({ mySubscriberLoaded }),
  _applySubscriberData: (sub) => {
    // Handle subscriber merge safely
  },

  addSubscriber: async (item) => {
    try {
      const saved = await mysqlAdmin.saveSubscriber(item as unknown as Record<string, unknown>);
      const persisted = { ...item, ...(saved && typeof saved === 'object' ? saved : {}) } as SubscriberItem;
      set((state) => ({ subscribers: [persisted, ...state.subscribers] }));
      return true;
    } catch (err) {
      logPersistError('subscriber')(err);
      return false;
    }
  },
  updateSubscriber: (item) => {
    set((state) => ({ subscribers: state.subscribers.map((s) => (s.id === item.id ? item : s)) }));
    void mysqlAdmin.saveSubscriber(item as unknown as Record<string, unknown>).catch(logPersistError('subscriber'));
  },
  deleteSubscriber: (id) => set((state) => ({ subscribers: state.subscribers.filter((s) => s.id !== id) })),

  addLead: async (item) => {
    set((state) => ({ leads: [item, ...state.leads] }));
    try { await mysqlAdmin.saveLead(item as unknown as Record<string, unknown>); } catch (err) { logPersistError('lead')(err); }
  },
  addPublicLead: async (item) => {
    set((state) => ({ leads: [item as LeadItem, ...state.leads] }));
    try { await mysqlAdmin.saveLead(item as unknown as Record<string, unknown>); } catch (err) { logPersistError('lead')(err); }
  },
  updateLead: (item) => {
    set((state) => ({ leads: state.leads.map((l) => (l.id === item.id ? item : l)) }));
    void mysqlAdmin.saveLead(item as unknown as Record<string, unknown>).catch(logPersistError('lead'));
  },
  markLeadsConverted: (ids) => set((state) => ({
    leads: state.leads.map((l) => (ids.includes(l.id) ? { ...l, convertedToSubscriber: true } : l)),
  })),
  deleteLead: (id) => set((state) => ({ leads: state.leads.filter((l) => l.id !== id) })),
  bulkDeleteLeads: (ids) => set((state) => ({ leads: state.leads.filter((l) => !ids.includes(l.id)) })),
  bulkAssignClientCodes: (updatedSubs, updatedLeads) => set((state) => ({
    subscribers: state.subscribers.map(s => updatedSubs.find(us => us.id === s.id) || s),
    leads: state.leads.map(l => updatedLeads.find(ul => ul.id === l.id) || l),
  })),
  bulkRedistributeLeads: async (mode) => 0,

  addStaffMember: (item) => {
    set((state) => ({ staffMembers: [...state.staffMembers, item] }));
    void mysqlAdmin.saveStaff(item as unknown as Record<string, unknown>).catch(logPersistError('staff member'));
  },
  updateStaffMember: (item) => {
    set((state) => ({ staffMembers: state.staffMembers.map((s) => (s.id === item.id ? item : s)) }));
    void mysqlAdmin.saveStaff(item as unknown as Record<string, unknown>).catch(logPersistError('staff member'));
  },
  deleteStaffMember: (id) => set((state) => ({ staffMembers: state.staffMembers.filter((s) => s.id !== id) })),

  addConsultation: (item) => {
    set((state) => ({ consultations: [item, ...state.consultations] }));
    void mysqlAdmin.saveConsultation(item as unknown as Record<string, unknown>).catch(logPersistError('consultation'));
  },
  updateConsultation: (item) => {
    set((state) => ({ consultations: state.consultations.map((c) => (c.id === item.id ? item : c)) }));
    void mysqlAdmin.saveConsultation(item as unknown as Record<string, unknown>).catch(logPersistError('consultation'));
  },
  deleteConsultation: (id) => set((state) => ({ consultations: state.consultations.filter((c) => c.id !== id) })),

  addDaqqiRound: (item) => {
    set((state) => ({ daqqiRounds: [...state.daqqiRounds, item] }));
    void mysqlAdmin.saveDaqqiRound(item as unknown as Record<string, unknown>).catch(logPersistError('daqqi round'));
  },
  updateDaqqiRound: (item) => {
    set((state) => ({ daqqiRounds: state.daqqiRounds.map((r) => (r.id === item.id ? item : r)) }));
    void mysqlAdmin.saveDaqqiRound(item as unknown as Record<string, unknown>).catch(logPersistError('daqqi round'));
  },
  deleteDaqqiRound: (id) => set((state) => ({ daqqiRounds: state.daqqiRounds.filter((r) => r.id !== id) })),
  bulkSetDaqqiRounds: (rounds) => set({ daqqiRounds: rounds }),

  addJoinUsApplication: (item) => set((state) => ({ joinUsApplications: [item, ...state.joinUsApplications] })),
  updateJoinUsApplication: (item) => {
    set((state) => ({ joinUsApplications: state.joinUsApplications.map((a) => (a.id === item.id ? item : a)) }));
    void mysqlAdmin.updateJoinUs(item.id, item.status, item.adminNote).catch(logPersistError('join-us application'));
  },
  deleteJoinUsApplication: (id) => set((state) => ({ joinUsApplications: state.joinUsApplications.filter((a) => a.id !== id) })),

  addContactMessage: (item) => set((state) => ({ contactMessages: [item, ...state.contactMessages] })),
  updateContactMessage: (item) => set((state) => ({ contactMessages: state.contactMessages.map((m) => (m.id === item.id ? item : m)) })),
  deleteContactMessage: (id) => set((state) => ({ contactMessages: state.contactMessages.filter((m) => m.id !== id) })),

  addInboxConversation: (conv) => {
    set((state) => ({ inboxConversations: [conv, ...state.inboxConversations] }));
    void mysqlAdmin.saveInboxConversation(conv as unknown as Record<string, unknown>).catch(logPersistError('inbox conversation'));
  },
  updateInboxConversation: (conv) => {
    set((state) => ({ inboxConversations: state.inboxConversations.map((c) => (c.id === conv.id ? conv : c)) }));
    void mysqlAdmin.saveInboxConversation(conv as unknown as Record<string, unknown>).catch(logPersistError('inbox conversation'));
  },
  deleteInboxConversation: (id) => set((state) => ({ inboxConversations: state.inboxConversations.filter((c) => c.id !== id) })),
}));
