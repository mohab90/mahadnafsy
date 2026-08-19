import { useMemo } from 'react';
import type { LeadItem, OrderItem, StaffMember, SubscriberItem, Therapist } from '../../../types';
import { normBranchId } from '../dashboardShared';

/**
 * Pure derived values for the Subscribers tab: the filtered subscriber list
 * (search + branch/course/sales/CS/installment/remaining/cert/payment filters),
 * the enabled-consultation therapist list, and a precomputed paid-totals map
 * (avoids an O(n×m) scan per row on every render). No state ownership, aside
 * from resetting pagination to page 1 whenever the filtered set changes — the
 * one side effect this memo already had before extraction, preserved as-is.
 */
export function useSubscribersDerived(
  branchFilteredEffectiveSubs: SubscriberItem[],
  effectiveSubs: SubscriberItem[],
  effectiveLeads: LeadItem[],
  effectiveOrders: OrderItem[],
  therapists: Therapist[],
  bundles: { id: string; courses: { id: string }[] }[],
  isSalesOnly: boolean,
  isAdmin: boolean,
  isDaqqiManager: boolean,
  isReceptionDaqqi: boolean,
  currentStaff: StaffMember | null,
  subscriberSubTab: 'local' | 'abroad' | 'all' | 'online25',
  subscriberSearch: string,
  subscriberCourseFilter: string,
  subscriberSalesFilter: string,
  subscriberCsFilter: string,
  subscriberInstFilter: string,
  subscriberRemainingFilter: string,
  subscriberCertFilter: string,
  subscriberPayFilter: string,
  setSubscriberPage: (page: number) => void,
) {
  const filteredSubscribers = useMemo(() => {
    setSubscriberPage(1);
    return branchFilteredEffectiveSubs.filter((row) => {
      if (!isSalesOnly && !isAdmin && !isDaqqiManager && !isReceptionDaqqi && normBranchId(row.branch) === 'DAQQI') return false;
      // Sales staff see only subscribers linked to their own leads
      if (isSalesOnly && currentStaff) {
        const myLeadIds = new Set(effectiveLeads.map(l => l.id));
        const myEmails = new Set(effectiveLeads.map(l => l.email).filter(Boolean));
        const linked = (row.leadId && myLeadIds.has(row.leadId)) || myEmails.has(row.email);
        if (!linked) return false;
      }
      const isAbroad = normBranchId(row.branch) === 'ONLINE_SAUDI' || normBranchId(row.branch) === 'ONLINE_ABROAD';
      if (subscriberSubTab === 'local' && isAbroad) return false;
      if (subscriberSubTab === 'abroad' && !isAbroad) return false;
      const sl = subscriberSearch.toLowerCase();
      const searchDigits = subscriberSearch.replace(/\D/g, '');
      const phoneDigitMatch = searchDigits.length >= 4
        ? (row.phone || '').replace(/\D/g, '').includes(searchDigits)
        : false;
      const ms = !subscriberSearch
        || row.name.toLowerCase().includes(sl)
        || phoneDigitMatch
        || (row.phone || '').includes(subscriberSearch)
        || (row.email || '').toLowerCase().includes(sl);
      const courseMatch = !subscriberCourseFilter || (() => {
        const cids = row.enrolledCourseIds || [];
        if (subscriberCourseFilter.startsWith('bundle:')) {
          const bndId = subscriberCourseFilter.slice(7);
          const bnd = bundles.find(b => b.id === bndId);
          if (!bnd) return false;
          return bnd.courses.every(co => cids.includes(co.id));
        }
        return cids.includes(subscriberCourseFilter);
      })();
      const salesMatch = isSalesOnly || subscriberSalesFilter === 'all' || (() => {
        if (row.assignedSalesId === subscriberSalesFilter) return true;
        if (!row.leadId) return false;
        const lnkLead = effectiveLeads.find(l => l.id === row.leadId);
        return lnkLead?.assignedSalesId === subscriberSalesFilter;
      })();
      // CS / collection filter
      const csMatch = subscriberCsFilter === 'all' || row.assignedCsId === subscriberCsFilter;
      // Installment due filter
      const todayStr2 = new Date().toISOString().slice(0, 10);
      const soon3Str = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      const instMatch = !subscriberInstFilter || (() => {
        const plans = row.installmentPlans || [];
        const unpaid = plans.flatMap(p => (p.entries || []).filter(e => !e.paidAt));
        if (subscriberInstFilter === 'overdue') return unpaid.some(e => e.dueDate < todayStr2);
        if (subscriberInstFilter === 'soon') return unpaid.some(e => e.dueDate >= todayStr2 && e.dueDate <= soon3Str);
        return true;
      })();
      // Remaining amount filter
      const remainingMatch = !subscriberRemainingFilter || (() => {
        const hist = row.paymentHistory || [];
        const totalExpected = hist.filter(p => !p.isInstallment && p.courseExpected).reduce((s, p) => s + (p.courseExpected || 0), 0);
        const totalPaid = hist.filter(p => !p.isInstallment && p.currency === 'EGP').reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const remaining = Math.max(0, totalExpected - totalPaid);
        return remaining >= Number(subscriberRemainingFilter);
      })();
      // Cert filter
      const certMatch = !subscriberCertFilter || (() => {
        const reqs = row.extraCertificateRequests || [];
        const certs = row.certificates || [];
        if (subscriberCertFilter === 'has') return reqs.length > 0 || certs.length > 0;
        if (subscriberCertFilter === 'pending') return reqs.some(r => r.status === 'pending' || r.status === 'priced');
        if (subscriberCertFilter === 'issued') return reqs.some(r => r.status === 'issued') || certs.length > 0;
        return true;
      })();
      // Payment filter
      const payMatch = !subscriberPayFilter || (() => {
        if (subscriberPayFilter === 'pending') return (row.paymentHistory || []).some(p => p.status === 'pending');
        return true;
      })();
      return ms && courseMatch && salesMatch && csMatch && instMatch && remainingMatch && certMatch && payMatch;
    });
    // Every filter this memo reads is listed. The four it omits are the role
    // booleans and setSubscriberPage, which are derived from currentStaff (already
    // a dependency) and a page-reset setter — adding the setter would reset the
    // user to page 1 on renders that changed nothing about the filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilteredEffectiveSubs, effectiveLeads, subscriberSearch, subscriberCourseFilter, subscriberSubTab, subscriberSalesFilter, isSalesOnly, currentStaff, bundles, subscriberCsFilter, subscriberInstFilter, subscriberRemainingFilter, subscriberCertFilter, subscriberPayFilter]);

  const enabledConsultationTherapists = useMemo(
    () => therapists.filter((row) => row.consultationSettings?.enabled),
    [therapists]
  );

  // Pre-computed map for subscriber paid totals (avoid O(n×m) in render)
  const subscriberPaidTotalsMap = useMemo(() => {
    const map = new Map<string, { EGP: number; SAR: number; USD: number }>();
    effectiveSubs.forEach(sub => {
      const totals = { EGP: 0, SAR: 0, USD: 0 };
      (sub.paymentHistory || []).forEach(p => { totals[p.currency] = (totals[p.currency] || 0) + (Number(p.amount) || 0); });
      const normalizedName = sub.name.trim().toLowerCase();
      effectiveOrders.forEach(order => {
        if (order.status !== 'paid') return;
        if (order.customerName.trim().toLowerCase() !== normalizedName) return;
        totals[order.currency] = (totals[order.currency] || 0) + (Number(order.amount) || 0);
      });
      map.set(sub.id, totals);
    });
    return map;
  }, [effectiveSubs, effectiveOrders]);

  const getSubscriberPaidTotals = (row: SubscriberItem) => {
    const precomputed = subscriberPaidTotalsMap.get(row.id);
    if (precomputed) return precomputed;
    // Fallback: compute directly from paymentHistory (for sales staff whose subs aren't in context)
    const totals: { EGP: number; SAR: number; USD: number } = { EGP: 0, SAR: 0, USD: 0 };
    (row.paymentHistory || []).forEach(p => {
      const cur = (p.currency || 'EGP') as 'EGP' | 'SAR' | 'USD';
      totals[cur] = (totals[cur] || 0) + (Number(p.amount) || 0);
    });
    return totals;
  };

  return { filteredSubscribers, enabledConsultationTherapists, subscriberPaidTotalsMap, getSubscriberPaidTotals };
}
