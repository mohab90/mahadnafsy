import { useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { AutomationTrigger, ConsultationItem, InboxConversation, JoinUsApplication, LeadItem, LeadStatus, MessagingChannel, OrderItem, StaffMember, SubscriberItem } from '../../types';
import { mysqlAdmin, mysqlForms } from '../../lib/mysqlapi';
import { nowLabel } from './useActivityLogState';

type Track = (action: string, entity: string, label: string) => void;
type PersistOrRevert = (apiCall: Promise<unknown>, revert: () => void, detail: { field: string; name?: string }) => void;
type TriggerAutomation = (trigger: AutomationTrigger, data?: Record<string, unknown>) => void;

// subscribers/leads/staffScoped*/consultations/orders/joinUsApplications are kept
// together as one "CRM core" domain rather than split further — they're read and
// written from almost every tab (Sales/Collection/Financial/HR/CRM all touch
// overlapping fields), and addSubscriber/addLead/addConsultation/addJoinUsApplication
// all cross-write into `leads` directly (dedup-on-convert, auto-create-lead-from-X),
// so a clean single-domain split would just relocate the coupling rather than
// remove it. triggerAutomation (owned by useAutomationState) needs this hook's
// setLeads as an input, while this hook's own functions need triggerAutomation —
// resolved via a ref the provider points at the real triggerAutomation once
// useAutomationState has been called, same "forward ref" shape used for
// subscribersRef/leadsRef/issueClientCodeAsync below.
export function useCrmCoreState(
  initialSubscribers: SubscriberItem[],
  initialLeads: LeadItem[],
  initialConsultations: ConsultationItem[],
  initialOrders: OrderItem[],
  initialJoinUsApplications: JoinUsApplication[],
  subscribersRef: MutableRefObject<SubscriberItem[]>,
  leadsRef: MutableRefObject<LeadItem[]>,
  lastCRMWriteRef: MutableRefObject<number>,
  persistOrRevert: PersistOrRevert,
  track: Track,
  staffMembers: StaffMember[],
  issueClientCodeAsync: () => Promise<string>,
  isValidClientCodeFormat: (code: string) => boolean,
  setInboxConversations: React.Dispatch<React.SetStateAction<InboxConversation[]>>,
  triggerAutomationRef: MutableRefObject<TriggerAutomation>,
) {
  const [subscribers, setSubscribers] = useState<SubscriberItem[]>(initialSubscribers);
  subscribersRef.current = subscribers;
  const [leads, setLeads] = useState<LeadItem[]>(initialLeads);
  leadsRef.current = leads;
  // Scoped data for non-admin staff — set by Dashboard after fetchSalesData
  const [staffScopedSubscribers, setStaffScopedSubscribers] = useState<SubscriberItem[]>([]);
  const [staffScopedLeads, setStaffScopedLeads] = useState<LeadItem[]>([]);
  const [consultations, setConsultations] = useState<ConsultationItem[]>(initialConsultations);
  const [orders, setOrders] = useState<OrderItem[]>(initialOrders);
  const [joinUsApplications, setJoinUsApplications] = useState<JoinUsApplication[]>(initialJoinUsApplications);
  // Round-robin counter for auto-assigning new leads to sales staff
  const roundRobinIndexRef = useRef(0);

  // MySQL-only: subscriber/lead/consultation/order/joinUs data lives in MySQL.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistSubscriberToCollection = (_sub: SubscriberItem) => { /* MySQL */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistLeadToCollection = (_lead: LeadItem) => { /* MySQL */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistConsultationToCollection = (_item: ConsultationItem) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistOrderToCollection = (_item: OrderItem) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistJoinUsToCollection = (_item: JoinUsApplication) => { /* PG-only */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistPaymentHistoryToCollection = (_subscriberId: string, _entries: SubscriberItem['paymentHistory']) => { /* PG-only */ };

  const reloadLeads = async () => {
    try {
      const fresh = await mysqlAdmin.listAllLeads();
      if ((fresh as unknown as LeadItem[]).length > 0) {
        const normalized = (fresh as unknown as LeadItem[]).map(l => ({
          ...l,
          status: (l.status || 'new').toLowerCase() as LeadStatus,
        }));
        leadsRef.current = normalized;
        setLeads(normalized);
      }
    } catch { /* silent */ }
  };

  const reloadSubscribers = async () => {
    try {
      const fresh = await mysqlAdmin.listAllSubscribers();
      const normalized = (fresh as unknown as SubscriberItem[]).map(s => ({
        ...s,
        enrolledCourseIds: Array.isArray(s.enrolledCourseIds) ? s.enrolledCourseIds : [],
      }));
      subscribersRef.current = normalized;
      setSubscribers(normalized);
    } catch { /* caller keeps current state on a transient refresh failure */ }
  };

  // Used after POST /api/admin/orders/:id/confirm-payment — that endpoint
  // mutates status/linked_transfer_id server-side, so the client refetches
  // rather than trying to hand-roll the same normalization as an optimistic
  // update for a moderately complex financial state change.
  const reloadOrders = async () => {
    try {
      const fresh = await mysqlAdmin.listAllOrders();
      const normalized = (fresh as unknown as Record<string, unknown>[]).map(r => ({
        id: r.id as string,
        subscriberId: (r.subscriberId ?? r.subscriber_id ?? undefined) as string | undefined,
        type: (r.type as string || 'course') as 'course' | 'bundle' | 'consultation' | 'transfer',
        itemId: (r.itemId ?? r.item_id ?? '') as string,
        itemTitle: (r.itemTitle ?? r.item_title ?? '') as string,
        amount: Number(r.amount) || 0,
        currency: (r.currency || 'EGP') as 'EGP' | 'SAR' | 'USD',
        paymentMethod: (r.paymentMethod ?? r.payment_method ?? 'wallet') as string,
        customerName: (r.customerName ?? r.customer_name ?? '') as string,
        customerEmail: (r.customerEmail ?? r.customer_email ?? '') as string,
        status: (r.status || 'paid') as 'paid' | 'failed' | 'refunded' | 'pending',
        createdAt: (r.createdAt ?? r.created_at ?? '') as string,
        transactionId: (r.transactionId ?? r.transaction_id) as string | undefined,
        staffId: (r.staffId ?? r.staff_id ?? undefined) as string | undefined,
        staffName: (r.staffName ?? r.staff_name ?? undefined) as string | undefined,
        linkedTransferId: (r.linkedTransferId ?? r.linked_transfer_id ?? undefined) as string | undefined,
      }));
      setOrders(normalized as unknown as OrderItem[]);
    } catch { /* caller keeps current state on a transient refresh failure */ }
  };

  const addSubscriber = async (item: SubscriberItem): Promise<boolean> => {
    const currentSubs = subscribersRef.current;
    const normPhone = (item.phone || '').replace(/\D/g, '');
    const normEmail = (item.email || '').toLowerCase().trim();
    const alreadyExists = currentSubs.some((s) => {
      const sp = (s.phone || '').replace(/\D/g, '');
      const se = (s.email || '').toLowerCase().trim();
      return (normPhone.length >= 7 && sp === normPhone) || (normEmail && se === normEmail);
    });
    if (alreadyExists) return false;

    let finalItem = item;
    if (!item.clientCode) {
      // No code provided — issue fresh atomic code
      finalItem = { ...item, clientCode: await issueClientCodeAsync() };
    } else {
      // Code was provided (e.g. inherited from lead) — MUST verify it is not already
      // used by another subscriber OR any lead. If taken, issue a fresh code.
      const isValidFmt = isValidClientCodeFormat(item.clientCode);
      const codeUsedBySub = currentSubs.some(s => s.id !== item.id && s.clientCode === item.clientCode);
      const codeUsedByLead = leadsRef.current.some(l => l.clientCode === item.clientCode);
      if (!isValidFmt || codeUsedBySub || codeUsedByLead) {
        finalItem = { ...item, clientCode: await issueClientCodeAsync() };
      }
    }
    const nextSubscribers = [finalItem, ...currentSubs];
    subscribersRef.current = nextSubscribers;
    lastCRMWriteRef.current = Date.now();
    setSubscribers(nextSubscribers);
    persistSubscriberToCollection(finalItem);
    // Await DB save so we can rollback if server rejects (e.g. duplicate phone already in DB)
    try {
      await mysqlAdmin.saveSubscriber(finalItem as unknown as Record<string,unknown>);
    } catch (saveErr) {
      // Rollback local state — the DB rejected the subscriber
      subscribersRef.current = currentSubs;
      lastCRMWriteRef.current = Date.now();
      setSubscribers(currentSubs);
      const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
      throw new Error(msg); // propagate real error so UI shows correct message
    }
    // Auto-delete any leads with matching phone or email
    // NOTE: payment sync to payments table is handled server-side in POST /api/admin/subscribers
    const np = (finalItem.phone || '').replace(/\D/g, '');
    const ne = (finalItem.email || '').toLowerCase().trim();
    setLeads((prev) => {
      const toRemove = prev.filter((l) => {
        const lp = (l.phone || '').replace(/\D/g, '');
        const le = (l.email || '').toLowerCase().trim();
        return (np.length >= 7 && lp === np) || (ne && le === ne);
      });
      toRemove.forEach(l => {
        persistOrRevert(
          mysqlAdmin.deleteLead(l.id),
          () => setLeads((cur) => (cur.some(x => x.id === l.id) ? cur : [l, ...cur])),
          { field: 'lead', name: l.name }
        );
      });
      return prev.filter((l) => {
        const lp = (l.phone || '').replace(/\D/g, '');
        const le = (l.email || '').toLowerCase().trim();
        return !((np.length >= 7 && lp === np) || (ne && le === ne));
      });
    });
    if (finalItem.leadId) {
      const prevLead = leadsRef.current.find(l => l.id === finalItem.leadId);
      setLeads((prev) => prev.map((l) => {
        if (l.id !== finalItem.leadId) return l;
        const updated = { ...l, status: 'converted' as LeadStatus };
        persistLeadToCollection(updated);
        persistOrRevert(
          mysqlAdmin.saveLead(updated as unknown as Record<string,unknown>), // mark lead as 'converted'
          () => { if (prevLead) setLeads((cur) => cur.map((x) => (x.id === finalItem.leadId ? prevLead : x))); },
          { field: 'lead', name: updated.name }
        );
        return updated;
      }));
    }
    // Sync initial enrollments handled via crm_json in saveSubscriber
    void 0;
    triggerAutomationRef.current('new_subscriber', { subscriberId: finalItem.id, name: finalItem.name });
    track('create', 'subscriber', finalItem.name);
    return true;
  };

  const updateSubscriber = (item: SubscriberItem) => {
    // Snapshot the old record BEFORE updating so we can diff.
    const oldSub = subscribersRef.current.find(r => r.id === item.id);
    // Upsert: add if not found (handles non-admin staff whose context subscribers are initially empty)
    const exists = !!oldSub;
    const nextSubscribers = exists
      ? subscribersRef.current.map((row) => (row.id === item.id ? item : row))
      : [...subscribersRef.current, item];
    subscribersRef.current = nextSubscribers;
    lastCRMWriteRef.current = Date.now();
    setSubscribers(nextSubscribers);
    persistSubscriberToCollection(item);
    // saveSubscriber sends the full crm_json to server — server auto-syncs paymentHistory → payments table
    // Pass updatedAt for OCC — server rejects with 409 if another write happened since last load
    const payload = { ...item, updatedAt: oldSub?.updatedAt ?? item.updatedAt };
    void mysqlAdmin.saveSubscriber(payload as unknown as Record<string,unknown>).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('تعارض') || msg.includes('conflict') || msg.includes('409')) {
        // OCC conflict: reload the latest version from server then re-apply non-payment changes
        void reloadLeads();
        mysqlAdmin.listAllSubscribers().then((fresh) => {
          const subs = (fresh as unknown as SubscriberItem[]).map(s => ({
            ...s,
            enrolledCourseIds: Array.isArray(s.enrolledCourseIds) ? s.enrolledCourseIds : [],
          }));
          if (subs.length > 0) { subscribersRef.current = subs; setSubscribers(subs); }
        }).catch(() => {});
        console.warn('[OCC] Subscriber conflict — reloaded fresh data from server');
      }
    });
    persistPaymentHistoryToCollection(item.id, item.paymentHistory ?? []);

    track('update', 'subscriber', item.name);
  };

  // Helpers: add to blocked set AND persist to localStorage so deletions survive page refresh
  const deleteSubscriber = (id: string) => {
    const removed = subscribersRef.current.find((row) => row.id === id);
    const nextSubscribers = subscribersRef.current.filter((row) => row.id !== id);
    subscribersRef.current = nextSubscribers;
    lastCRMWriteRef.current = Date.now();
    setSubscribers(nextSubscribers);
    // This had no .catch() at all: a 403 (e.g. a role like reception_daqqi that isn't
    // allowed to delete) silently left the row removed from the UI while it still
    // existed in the DB — it just reappeared on the next reload with zero explanation.
    // Revert the optimistic removal on failure and surface the existing error toast.
    mysqlAdmin.deleteSubscriber(id).catch(() => {
      if (removed) {
        subscribersRef.current = [removed, ...subscribersRef.current];
        setSubscribers(subscribersRef.current);
      }
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'subscriber', name: removed?.name } }));
    });
    track('delete', 'subscriber', id);
  };

  const addLead = async (item: LeadItem): Promise<void> => {
    lastCRMWriteRef.current = Date.now();
    // Auto round-robin assignment if no sales person assigned yet
    let resolvedItem = item;
    if (!item.assignedSalesId) {
      const activeSales = staffMembers.filter((s) => s.role === 'sales' && s.status !== 'inactive');
      if (activeSales.length > 0) {
        const idx = roundRobinIndexRef.current % activeSales.length;
        const assigned = activeSales[idx];
        roundRobinIndexRef.current = idx + 1;
        resolvedItem = { ...item, assignedSalesId: assigned.id, assignedSalesName: assigned.name };
      }
    }
    // Assign clientCode upfront using atomic transaction so cross-session duplicates are impossible
    if (!resolvedItem.clientCode) {
      resolvedItem = { ...resolvedItem, clientCode: await issueClientCodeAsync() };
    }
    const normalizePhone = (value?: string | null) => (value || '').replace(/\D/g, '');
    const normPhone = normalizePhone(resolvedItem.phone);
    const normEmail = (resolvedItem.email || '').toLowerCase().trim();
    // Block if a subscriber already exists with same phone/email
    const isSubscriber = subscribersRef.current.some((s) => {
      const sp = normalizePhone(s.phone);
      const se = (s.email || '').toLowerCase().trim();
      return (normPhone.length >= 7 && sp === normPhone) || (normEmail && se === normEmail);
    });
    if (isSubscriber) return;
    const prevLeadsSnapshot = leadsRef.current;
    // If lead already exists with same phone/email → merge instead of duplicate
    const existingIdx = leadsRef.current.findIndex((l) => {
      const lp = normalizePhone(l.phone);
      const le = (l.email || '').toLowerCase().trim();
      return (normPhone.length >= 7 && lp === normPhone) || (normEmail && le === normEmail);
    });
    let leadToWrite: LeadItem;
    if (existingIdx !== -1) {
      const existing = leadsRef.current[existingIdx];
      leadToWrite = {
        ...existing,
        name: resolvedItem.name || existing.name,
        interestedCourseIds: [...new Set([...(existing.interestedCourseIds || []), ...(resolvedItem.interestedCourseIds || []), resolvedItem.enrolledCourseId || ''].filter(Boolean))],
        source: resolvedItem.source || existing.source,
      };
      const nextLeads = leadsRef.current.map((l, i) => i === existingIdx ? leadToWrite : l);
      leadsRef.current = nextLeads;
      setLeads(nextLeads);
    } else {
      leadToWrite = resolvedItem;
      const nextLeads = [resolvedItem, ...leadsRef.current];
      leadsRef.current = nextLeads;
      setLeads(nextLeads);
    }
    persistLeadToCollection(leadToWrite);
    persistOrRevert(
      mysqlAdmin.saveLead(resolvedItem as unknown as Record<string,unknown>),
      () => { leadsRef.current = prevLeadsSnapshot; setLeads(prevLeadsSnapshot); },
      { field: 'lead', name: resolvedItem.name }
    );
    track('create', 'lead', resolvedItem.name);
    // Auto-create inbox conversation for messaging channels
    const src = (item.source || '').toLowerCase();
    const isMessaging = item.phone && (
      src.includes('واتساب') || src.includes('whatsapp') ||
      src.includes('ماسنجر') || src.includes('messenger') ||
      src.includes('انستجرام') || src.includes('instagram')
    );
    if (isMessaging) {
      const channel: MessagingChannel =
        src.includes('ماسنجر') || src.includes('messenger') ? 'messenger'
        : src.includes('انستجرام') || src.includes('instagram') ? 'instagram'
        : 'whatsapp';
      const newConv: InboxConversation = {
        id: `conv-lead-${Date.now()}`,
        channel,
        contactName: item.name,
        contactId: item.phone || '',
        contactAvatar: '',
        lastMessage: `ليد جديد: ${item.name}`,
        lastMessageAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        unreadCount: 1,
        status: 'open',
        assignedToStaffId: item.assignedSalesId || '',
        assignedToStaffName: item.assignedSalesName || '',
        tags: [],
        messages: [],
        linkedLeadId: item.id,
        linkedSubscriberId: '',
        createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      };
      setInboxConversations((prev) => [newConv, ...prev]);
    }
    triggerAutomationRef.current('new_lead', { leadId: item.id, name: item.name, source: item.source || '' });
  };

  // addPublicLead: for public registration forms — uses MySQL /api/registrations (no auth needed).
  const addPublicLead = async (item: Omit<LeadItem, 'clientCode'> & { clientCode?: string }): Promise<void> => {
    try {
      const { clientCode, id } = await mysqlForms.submitRegistration(item as unknown as Record<string,unknown>);
      const leadWithCode: LeadItem = { ...(item as LeadItem), id: id || (item as LeadItem).id, clientCode };
      // Update local state for instant UI feedback
      leadsRef.current = [leadWithCode, ...leadsRef.current];
      setLeads(prev => [leadWithCode, ...prev.filter(l => l.id !== leadWithCode.id)]);
      track('create', 'lead', leadWithCode.name);
    } catch (error) {
      throw error instanceof Error ? error : new Error('تعذر حفظ طلب العميل.');
    }
  };

  const updateLead = (item: LeadItem) => {
    lastCRMWriteRef.current = Date.now();
    const prevLeads = leadsRef.current;
    const nextLeads = leadsRef.current.map((row) => (row.id === item.id ? item : row));
    leadsRef.current = nextLeads;
    setLeads(nextLeads);
    persistLeadToCollection(item);
    persistOrRevert(
      mysqlAdmin.saveLead(item as unknown as Record<string,unknown>),
      () => { leadsRef.current = prevLeads; setLeads(prevLeads); },
      { field: 'lead', name: item.name }
    );
    triggerAutomationRef.current('lead_status_changed', { leadId: item.id, name: item.name, status: item.status || '' });
    track('update', 'lead', item.name);
  };

  // Updates local state only — no API call. Use for bulk auto-convert on mount.
  const markLeadsConverted = (ids: string[]) => {
    const idSet = new Set(ids);
    const nextLeads = leadsRef.current.map((l) =>
      idSet.has(l.id) ? { ...l, status: 'converted' as const, hidden: true } : l
    );
    leadsRef.current = nextLeads;
    setLeads(nextLeads);
  };

  const deleteLead = (id: string) => {
    lastCRMWriteRef.current = Date.now();
    const prevLeads = leadsRef.current;
    const nextLeads = leadsRef.current.filter((row) => row.id !== id);
    leadsRef.current = nextLeads;
    setLeads(nextLeads);
    persistOrRevert(
      mysqlAdmin.deleteLead(id),
      () => { leadsRef.current = prevLeads; setLeads(prevLeads); },
      { field: 'lead', name: id }
    );
    track('delete', 'lead', id);
  };

  const bulkDeleteLeads = (ids: string[]) => {
    lastCRMWriteRef.current = Date.now();
    const prevLeads = leadsRef.current;
    const idSet = new Set(ids);
    const nextLeads = leadsRef.current.filter((row) => !idSet.has(row.id));
    leadsRef.current = nextLeads;
    setLeads(nextLeads);
    Promise.allSettled(ids.map(id => mysqlAdmin.deleteLead(id))).then((results) => {
      const anyFailed = results.some(r => r.status === 'rejected');
      if (anyFailed) {
        console.error('[lead] Bulk delete: one or more deletions failed — rolling back the whole batch');
        leadsRef.current = prevLeads;
        setLeads(prevLeads);
        window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'lead', name: `bulk:${ids.length}` } }));
      }
    });
    track('delete', 'lead', `bulk:${ids.length}`);
  };

  // Batch-assign client codes — write only the changed documents to their collections.
  const bulkAssignClientCodes = (updatedSubs: SubscriberItem[], updatedLeads: LeadItem[]) => {
    lastCRMWriteRef.current = Date.now();
    if (updatedSubs.length > 0) {
      const prevSubs = subscribersRef.current;
      const subsMap = new Map(updatedSubs.map(s => [s.id, s]));
      const nextSubs = subscribersRef.current.map(s => subsMap.get(s.id) ?? s);
      subscribersRef.current = nextSubs;
      setSubscribers(nextSubs);
      // Write to BOTH Firestore and PostgreSQL so codes survive PG bootstrap on next reload
      updatedSubs.forEach(s => persistSubscriberToCollection(s));
      Promise.allSettled(updatedSubs.map(s => mysqlAdmin.saveSubscriber(s as unknown as Record<string,unknown>))).then((results) => {
        if (results.some(r => r.status === 'rejected')) {
          console.error('[clientCode] Bulk subscriber code assignment: one or more saves failed — rolling back the whole batch');
          subscribersRef.current = prevSubs;
          setSubscribers(prevSubs);
          window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'subscriber', name: `bulk:${updatedSubs.length}` } }));
        }
      });
    }
    if (updatedLeads.length > 0) {
      const prevLeads = leadsRef.current;
      const leadsMap = new Map(updatedLeads.map(l => [l.id, l]));
      const nextLeads = leadsRef.current.map(l => leadsMap.get(l.id) ?? l);
      leadsRef.current = nextLeads;
      setLeads(nextLeads);
      updatedLeads.forEach(l => persistLeadToCollection(l));
      Promise.allSettled(updatedLeads.map(l => mysqlAdmin.saveLead(l as unknown as Record<string,unknown>))).then((results) => {
        if (results.some(r => r.status === 'rejected')) {
          console.error('[clientCode] Bulk lead code assignment: one or more saves failed — rolling back the whole batch');
          leadsRef.current = prevLeads;
          setLeads(prevLeads);
          window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'lead', name: `bulk:${updatedLeads.length}` } }));
        }
      });
    }
    track('update', 'clientCode', `bulk:${updatedSubs.length + updatedLeads.length}`);
  };

  const bulkRedistributeLeads = async (mode: 'unassigned' | 'all'): Promise<number> => {
    // Delegate distribution entirely to the server — avoids N parallel saveLead calls
    const result = await mysqlAdmin.distributeLeads(mode);
    const assigned = result.assigned ?? 0;
    if (assigned === 0) return 0;
    // Reload leads from server so the UI reflects the new assignments
    const freshLeads = await mysqlAdmin.listAllLeads();
    if ((freshLeads as unknown as LeadItem[]).length > 0) {
      const normalizedLeads = (freshLeads as unknown as LeadItem[]).map(l => ({
        ...l,
        status: (l.status || 'new').toLowerCase() as LeadStatus,
      }));
      leadsRef.current = normalizedLeads;
      setLeads(normalizedLeads);
    }
    track('update', 'lead', `bulkRedistribute:${assigned}`);
    return assigned;
  };

  const addConsultation = (item: ConsultationItem) => {
    lastCRMWriteRef.current = Date.now();
    // Auto-create a lead if this consultation client is not already in the system
    const normalizePhone = (value?: string | null) => (value || '').replace(/\D/g, '');
    const inPhone = normalizePhone(item.clientPhone);
    const inEmail = (item.clientEmail || '').toLowerCase().trim();
    const alreadyExists =
      subscribers.some(s =>
        (inPhone && normalizePhone(s.phone) === inPhone) ||
        (inEmail && s.email?.toLowerCase().trim() === inEmail)
      ) ||
      leads.some(l =>
        (inPhone && normalizePhone(l.phone) === inPhone) ||
        (inEmail && l.email?.toLowerCase().trim() === inEmail)
      );
    if (!alreadyExists && (item.clientPhone || item.clientEmail)) {
      // Issue the code BEFORE setState so we can await the async transaction
      void issueClientCodeAsync().then(newCode => {
        const newLead: LeadItem = {
          id: `lead-consult-${item.id}`,
          clientCode: newCode,
          name: item.clientName,
          email: item.clientEmail || '',
          phone: item.clientPhone || '',
          source: 'استشارة',
          status: 'new',
          leadType: 'consultation',
          branch: 'other',
          interestLevel: 'medium',
          assignedSalesId: '',
          assignedSalesName: '',
          communications: [],
          notes: `حجز استشارة مع ${item.therapistName}`,
          createdAt: item.createdAt || nowLabel(),
        };
        const nextLeads = [newLead, ...leadsRef.current];
        leadsRef.current = nextLeads;
        setLeads(nextLeads);
        persistLeadToCollection(newLead);
      });
    }
    setConsultations((prev) => [item, ...prev]);
    persistConsultationToCollection(item);
    persistOrRevert(
      mysqlAdmin.saveConsultation(item as unknown as Record<string,unknown>),
      () => setConsultations((prev) => prev.filter((row) => row.id !== item.id)),
      { field: 'consultation', name: item.clientName }
    );
    triggerAutomationRef.current('new_consultation', { consultationId: item.id, therapistName: item.therapistName, clientName: item.clientName });
    track('create', 'consultation', item.clientName);
  };

  const updateConsultation = (item: ConsultationItem) => {
    lastCRMWriteRef.current = Date.now();
    const prevConsultation = consultations.find((row) => row.id === item.id);
    setConsultations((prev) => prev.map((row) => (row.id === item.id ? item : row)));
    persistConsultationToCollection(item);
    persistOrRevert(
      mysqlAdmin.updateConsultationStatus(item.id, item.status, item.notes, item.meetingLink),
      () => { if (prevConsultation) setConsultations((prev) => prev.map((row) => (row.id === item.id ? prevConsultation : row))); },
      { field: 'consultation', name: item.clientName }
    );
    const consultTrigger: AutomationTrigger = item.status === 'confirmed' ? 'consultation_confirmed'
      : item.status === 'completed' ? 'consultation_completed'
      : item.status === 'cancelled' ? 'consultation_cancelled'
      : 'new_consultation';
    triggerAutomationRef.current(consultTrigger, { consultationId: item.id, therapistName: item.therapistName });
    track('update', 'consultation', item.clientName);
  };

  const deleteConsultation = (id: string) => {
    lastCRMWriteRef.current = Date.now();
    const removed = consultations.find((row) => row.id === id);
    setConsultations((prev) => prev.filter((row) => row.id !== id));
    persistOrRevert(
      mysqlAdmin.deleteConsultation(id),
      () => { if (removed) setConsultations((prev) => [removed, ...prev]); },
      { field: 'consultation', name: removed?.clientName }
    );
    track('delete', 'consultation', id);
  };

  const addOrder = (item: OrderItem) => {
    lastCRMWriteRef.current = Date.now();
    setOrders((prev) => [item, ...prev]);
    persistOrderToCollection(item);
    persistOrRevert(
      mysqlAdmin.saveOrder(item as unknown as Record<string,unknown>),
      () => setOrders((prev) => prev.filter((row) => row.id !== item.id)),
      { field: 'order', name: item.itemTitle }
    );
    triggerAutomationRef.current('new_payment', { orderId: item.id, type: item.type, itemId: item.itemId, amount: String(item.amount) });
    track('create', 'order', item.itemTitle);
  };

  const updateOrderStatus = (id: string, status: OrderItem['status']) => {
    lastCRMWriteRef.current = Date.now();
    const prevStatus = orders.find((row) => row.id === id)?.status;
    setOrders((prev) => prev.map((row) => {
      if (row.id !== id) return row;
      const updated = { ...row, status };
      persistOrderToCollection(updated);
      persistOrRevert(
        mysqlAdmin.updateOrderStatus(id, status),
        () => { if (prevStatus) setOrders((p) => p.map((r) => (r.id === id ? { ...r, status: prevStatus } : r))); },
        { field: 'order', name: id }
      );
      return updated;
    }));
    track('update', 'order', `${id} -> ${status}`);
  };

  const deleteOrder = (id: string) => {
    lastCRMWriteRef.current = Date.now();
    const prevOrders = orders;
    const prevSubscribers = subscribersRef.current;
    setOrders((prev) => prev.filter((row) => row.id !== id));
    // Also remove from subscriber's paymentHistory if present
    setSubscribers((prev) => prev.map((sub) => {
      if (!sub.paymentHistory?.some((p) => p.id === id)) return sub;
      const updated = { ...sub, paymentHistory: sub.paymentHistory.filter((p) => p.id !== id) };
      persistOrRevert(
        mysqlAdmin.saveSubscriber(updated), // persist removal
        () => { subscribersRef.current = prevSubscribers; setSubscribers(prevSubscribers); },
        { field: 'subscriber', name: sub.name }
      );
      return updated;
    }));
    persistOrRevert(
      mysqlAdmin.deleteOrder(id),
      () => setOrders(prevOrders),
      { field: 'order', name: id }
    );
    track('delete', 'order', id);
  };

  const addJoinUsApplication = (item: JoinUsApplication) => {
    setJoinUsApplications((prev) => [item, ...prev]);
    persistJoinUsToCollection(item);
    // Auto-create a lead for the applicant if not already in system
    const normalizePhone = (value?: string | null) => (value || '').replace(/\D/g, '');
    const inPhone = normalizePhone(item.phone);
    const inEmail = (item.email || '').toLowerCase().trim();
    const alreadyExists =
      subscribers.some(s =>
        (inPhone && normalizePhone(s.phone) === inPhone) ||
        (inEmail && s.email?.toLowerCase().trim() === inEmail)
      ) ||
      leads.some(l =>
        (inPhone && normalizePhone(l.phone) === inPhone) ||
        (inEmail && l.email?.toLowerCase().trim() === inEmail)
      );
    if (!alreadyExists && (item.phone || item.email)) {
      // Issue the code BEFORE setState so we can await the async transaction
      void issueClientCodeAsync().then(newCode => {
        const newLead: LeadItem = {
          id: `lead-joinus-${item.id}`,
          clientCode: newCode,
          name: item.name,
          email: item.email || '',
          phone: item.phone || '',
          source: 'طلب انضمام',
          status: 'new',
          leadType: 'general',
          branch: 'other',
          interestLevel: 'medium',
          assignedSalesId: '',
          assignedSalesName: '',
          communications: [],
          notes: `طلب انضمام${item.specialty ? ` - تخصص: ${item.specialty}` : ''}`,
          createdAt: nowLabel(),
        };
        const nextLeads = [newLead, ...leadsRef.current];
        leadsRef.current = nextLeads;
        setLeads(nextLeads);
        persistLeadToCollection(newLead);
      });
    }
    track('create', 'joinUs', item.name);
  };
  const updateJoinUsApplication = (item: JoinUsApplication) => {
    setJoinUsApplications((prev) => prev.map((x) => (x.id === item.id ? item : x)));
    persistJoinUsToCollection(item);
    track('update', 'joinUs', item.name);
  };
  const deleteJoinUsApplication = (id: string) => {
    setJoinUsApplications((prev) => prev.filter((x) => x.id !== id));
    track('delete', 'joinUs', id);
  };

  return {
    subscribers, setSubscribers,
    staffScopedSubscribers, setStaffScopedSubscribers,
    staffScopedLeads, setStaffScopedLeads,
    leads, setLeads,
    consultations, setConsultations,
    orders, setOrders,
    joinUsApplications, setJoinUsApplications,
    addSubscriber, updateSubscriber, deleteSubscriber,
    addLead, addPublicLead, updateLead, markLeadsConverted, deleteLead, bulkDeleteLeads, bulkAssignClientCodes, bulkRedistributeLeads,
    addConsultation, updateConsultation, deleteConsultation,
    addOrder, updateOrderStatus, deleteOrder,
    addJoinUsApplication, updateJoinUsApplication, deleteJoinUsApplication,
    reloadLeads, reloadSubscribers, reloadOrders,
  };
}
