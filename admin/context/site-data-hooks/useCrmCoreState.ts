import { useState } from 'react';
import type { MutableRefObject } from 'react';
import type { ConsultationItem, JoinUsApplication, LeadItem, LeadStatus, NewLeadDraft, OrderItem, SubscriberItem } from '../../types';
import { mysqlAdmin, mysqlForms } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

// subscribers/leads/staffScoped*/consultations/orders/joinUsApplications are kept
// together as one "CRM core" domain rather than split further — they're read and
// written from almost every tab (Sales/Collection/Financial/HR/CRM all touch
// overlapping fields), and addSubscriber/addLead/addConsultation/addJoinUsApplication
// all cross-write into `leads` directly (dedup-on-convert, auto-create-lead-from-X),
// so a clean single-domain split would just relocate the coupling rather than
// remove it. Automation execution is exclusively server-owned; browser CRUD
// never mutates CRM projections as a substitute for the backend engine.
export function useCrmCoreState(
  initialSubscribers: SubscriberItem[],
  initialLeads: LeadItem[],
  initialConsultations: ConsultationItem[],
  initialOrders: OrderItem[],
  initialJoinUsApplications: JoinUsApplication[],
  subscribersRef: MutableRefObject<SubscriberItem[]>,
  leadsRef: MutableRefObject<LeadItem[]>,
  lastCRMWriteRef: MutableRefObject<number>,
  track: Track,
  issueClientCodeAsync: () => Promise<string>,
  isValidClientCodeFormat: (code: string) => boolean,
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

  // MySQL-only: subscriber/lead/consultation/order/joinUs data lives in MySQL.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistSubscriberToCollection = (_sub: SubscriberItem) => { /* MySQL */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistPaymentHistoryToCollection = (_subscriberId: string, _entries: SubscriberItem['paymentHistory']) => { /* PG-only */ };

  const reloadLeads = async () => {
    try {
      const fresh = await mysqlAdmin.listAllLeads();
      const normalized = (fresh as unknown as LeadItem[]).map(l => ({
        ...l,
        status: (l.status || 'new').toLowerCase() as LeadStatus,
      }));
      leadsRef.current = normalized;
      setLeads(normalized);
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

  const recordSubscriberPayment = async (
    subscriberId: string,
    payment: Record<string, unknown>,
  ): Promise<{ ok: boolean; id: string; status: string; approvalRequired?: boolean }> => {
    const result = await mysqlAdmin.saveSubscriberPayment(subscriberId, payment) as {
      ok: boolean; id: string; status?: string; approvalRequired?: boolean;
    };
    // Money and entitlements are committed together by the API. Always reload
    // the server projection instead of granting access through crm_json locally.
    await reloadSubscribers();
    return {
      ok: result.ok,
      id: result.id,
      status: result.status || 'pending',
      approvalRequired: result.approvalRequired,
    };
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
    // The API links and converts the matching lead in the same subscriber
    // transaction. Keep the lead as CRM history instead of deleting it.
    await Promise.all([reloadLeads(), reloadSubscribers()]);
    // Sync initial enrollments handled via crm_json in saveSubscriber
    void 0;
    track('create', 'subscriber', finalItem.name);
    return true;
  };

  const updateSubscriber = async (item: SubscriberItem): Promise<boolean> => {
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
    // The API strips table-owned projections such as paymentHistory and certificate
    // requests; financial changes must use their dedicated transactional endpoints.
    // Pass updatedAt for OCC — server rejects with 409 if another write happened since last load
    const payload = { ...item, updatedAt: oldSub?.updatedAt ?? item.updatedAt };
    try {
      await mysqlAdmin.saveSubscriber(payload as unknown as Record<string,unknown>);
    } catch (err: unknown) {
      subscribersRef.current = exists
        ? subscribersRef.current.map((row) => (row.id === item.id ? oldSub! : row))
        : subscribersRef.current.filter((row) => row.id !== item.id);
      setSubscribers(subscribersRef.current);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('تعارض') || msg.includes('conflict') || msg.includes('409')) {
        await Promise.all([reloadLeads(), reloadSubscribers()]).catch(() => {});
      }
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: { field: 'subscriber', name: item.name },
      }));
      return false;
    }
    persistSubscriberToCollection(item);
    persistPaymentHistoryToCollection(item.id, item.paymentHistory ?? []);
    track('update', 'subscriber', item.name);
    return true;
  };

  // Subscriber removal is confirmed by the canonical API before it remains hidden.
  const deleteSubscriber = async (id: string): Promise<boolean> => {
    const removed = subscribersRef.current.find((row) => row.id === id);
    const nextSubscribers = subscribersRef.current.filter((row) => row.id !== id);
    subscribersRef.current = nextSubscribers;
    lastCRMWriteRef.current = Date.now();
    setSubscribers(nextSubscribers);
    // This had no .catch() at all: a 403 (e.g. a role like reception_daqqi that isn't
    // allowed to delete) silently left the row removed from the UI while it still
    // existed in the DB — it just reappeared on the next reload with zero explanation.
    // Revert the optimistic removal on failure and surface the existing error toast.
    try {
      await mysqlAdmin.deleteSubscriber(id);
    } catch {
      if (removed) {
        subscribersRef.current = [removed, ...subscribersRef.current];
        setSubscribers(subscribersRef.current);
      }
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'subscriber', name: removed?.name } }));
      return false;
    }
    track('delete', 'subscriber', id);
    return true;
  };

  /**
   * `skipReload` is for bulk importers. reloadLeads() re-fetches the entire
   * lead table (paged, 5k at a time — 16k rows today), so reloading after every
   * single row turned a 2,000-row import into ~2,000 full table reads: it ran
   * for the best part of an hour and the grid showed stale, half-imported state
   * the whole time. The caller reloads once when the batch is done.
   */
  const addLead = async (item: NewLeadDraft, opts?: { skipReload?: boolean }): Promise<void> => {
    lastCRMWriteRef.current = Date.now();
    await mysqlAdmin.saveLead(item as unknown as Record<string, unknown>);
    if (!opts?.skipReload) await reloadLeads();
    track('create', 'lead', item.name);
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

  const updateLead = async (item: LeadItem): Promise<boolean> => {
    lastCRMWriteRef.current = Date.now();
    const prevLeads = leadsRef.current;
    const nextLeads = leadsRef.current.map((row) => (row.id === item.id ? item : row));
    leadsRef.current = nextLeads;
    setLeads(nextLeads);
    try {
      await mysqlAdmin.saveLead(item as unknown as Record<string,unknown>);
    } catch {
      leadsRef.current = prevLeads;
      setLeads(prevLeads);
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: { field: 'lead', name: item.name },
      }));
      return false;
    }
    track('update', 'lead', item.name);
    return true;
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

  const deleteLead = async (id: string): Promise<boolean> => {
    lastCRMWriteRef.current = Date.now();
    const prevLeads = leadsRef.current;
    const nextLeads = leadsRef.current.filter((row) => row.id !== id);
    leadsRef.current = nextLeads;
    setLeads(nextLeads);
    try {
      await mysqlAdmin.deleteLead(id);
    } catch {
      leadsRef.current = prevLeads;
      setLeads(prevLeads);
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'lead', name: id } }));
      return false;
    }
    track('delete', 'lead', id);
    return true;
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

  const bulkRedistributeLeads = async (mode: 'unassigned' | 'all', dailyCap = 0): Promise<number> => {
    // Delegate distribution entirely to the server — avoids N parallel saveLead calls
    const result = await mysqlAdmin.distributeLeads(mode, dailyCap);
    const assigned = result.assigned ?? 0;
    if (assigned === 0) return 0;
    // Reload leads from server so the UI reflects the new assignments
    const freshLeads = await mysqlAdmin.listAllLeads();
    const normalizedLeads = (freshLeads as unknown as LeadItem[]).map(l => ({
      ...l,
      status: (l.status || 'new').toLowerCase() as LeadStatus,
    }));
    leadsRef.current = normalizedLeads;
    setLeads(normalizedLeads);
    track('update', 'lead', `bulkRedistribute:${assigned}`);
    return assigned;
  };

  const addOrder = async (item: OrderItem): Promise<boolean> => {
    lastCRMWriteRef.current = Date.now();
    try {
      await mysqlAdmin.saveOrder(item as unknown as Record<string,unknown>);
      await reloadOrders();
    } catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'order', name: item.itemTitle } }));
      return false;
    }
    track('create', 'order', item.itemTitle);
    return true;
  };

  const updateOrderStatus = async (id: string, status: OrderItem['status']): Promise<boolean> => {
    lastCRMWriteRef.current = Date.now();
    try {
      await mysqlAdmin.updateOrderStatus(id, status);
      await reloadOrders();
    } catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'order', name: id } }));
      return false;
    }
    track('update', 'order', `${id} -> ${status}`);
    return true;
  };

  const deleteOrder = async (id: string): Promise<boolean> => {
    lastCRMWriteRef.current = Date.now();
    try {
      await mysqlAdmin.deleteOrder(id);
      await reloadOrders();
    } catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'order', name: id } }));
      return false;
    }
    track('delete', 'order', id);
    return true;
  };

  // Nothing refreshed join-us applications after the initial page load — not
  // the 2-minute silent-refresh (it never listed join-us) and no manual
  // control existed on the tab. A submission made after the admin's own
  // session had already bootstrapped just never showed up short of a full
  // page reload, which is what the owner's report of freshly-submitted
  // applications "not appearing" traced back to.
  const reloadJoinUsApplications = async (): Promise<void> => {
    try {
      const fresh = await mysqlAdmin.listAllJoinUs();
      const normalized = (fresh as unknown as Array<Record<string, unknown>>).map(row => ({
        ...row,
        status: String(row.status || 'NEW').toLowerCase(),
        createdAt: String(row.createdAt ?? row.created_at ?? ''),
        adminNote: (row.adminNote ?? row.admin_note) as string | undefined,
        convertedApplicantId: (row.convertedApplicantId ?? row.converted_applicant_id) as string | undefined,
        applicantStage: (row.applicantStage ?? row.applicant_stage) as JoinUsApplication['applicantStage'],
        hiredStaffId: (row.hiredStaffId ?? row.hired_staff_id) as string | undefined,
      })) as unknown as JoinUsApplication[];
      setJoinUsApplications(normalized);
    } catch {
      // Best-effort — the last successfully loaded state stays visible.
    }
  };

  const addJoinUsApplication = async (item: JoinUsApplication): Promise<boolean> => {
    try {
      await mysqlForms.submitJoinUs(item as unknown as Record<string, unknown>);
    } catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'joinUs', name: item.name } }));
      return false;
    }
    track('create', 'joinUs', item.name);
    return true;
  };
  const updateJoinUsApplication = async (item: JoinUsApplication): Promise<boolean> => {
    try {
      await mysqlAdmin.updateJoinUs(item.id, item.status, item.adminNote);
      setJoinUsApplications((prev) => prev.map((x) => (x.id === item.id ? item : x)));
    } catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'joinUs', name: item.name } }));
      return false;
    }
    track('update', 'joinUs', item.name);
    return true;
  };
  const deleteJoinUsApplication = async (id: string): Promise<boolean> => {
    try {
      await mysqlAdmin.deleteJoinUs(id);
      setJoinUsApplications((prev) => prev.filter((x) => x.id !== id));
    } catch {
      window.dispatchEvent(new CustomEvent('site-persist-error', { detail: { field: 'joinUs', name: id } }));
      return false;
    }
    track('delete', 'joinUs', id);
    return true;
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
    addLead, addPublicLead, updateLead, markLeadsConverted, deleteLead, bulkAssignClientCodes, bulkRedistributeLeads,
    addOrder, updateOrderStatus, deleteOrder,
    addJoinUsApplication, updateJoinUsApplication, deleteJoinUsApplication, reloadJoinUsApplications,
    reloadLeads, reloadSubscribers, reloadOrders, recordSubscriberPayment,
  };
}
