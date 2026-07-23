import { useMemo } from 'react';
import type { Bundle, LeadItem, StaffMember } from '../../../types';
import { _normalizeAr, normBranchId } from '../dashboardShared';

// Does an online25 lead have meaningful course data in notes? (they live in the
// online25 tab instead of the general course-leads list once they do)
function _online25HasCourse(l: LeadItem) {
  if (l.source !== 'أونلاين 2025') return false;
  const m = (l.notes || '').match(/(?:السعر|price)[:\s]+([^\n|]+)/);
  const hasCourse = m && m[1].trim().length > 0;
  const hasPrice = /(?:السعر|price)[:\s]+[\d.]+/.test(l.notes || '');
  return hasCourse || hasPrice;
}

/**
 * Pure derived values for the Leads/CRM tabs and staff-assignment displays:
 * the filtered course-lead and consultation-lead lists, the leads summary
 * stats card, and the filtered/role-derived staff lists used across those
 * tabs. No state ownership.
 */
export function useLeadsDerived(
  effectiveLeads: LeadItem[],
  isSalesOnly: boolean,
  leadsSearch: string,
  leadsStatusFilter: string[],
  leadsFollowupFilter: 'all' | 'today' | 'overdue',
  leadsBranchFilter: string,
  leadsSalesFilter: string,
  leadsCourseFilter: string,
  bundles: Bundle[],
  staffMembers: StaffMember[],
  staffSearch: string,
  staffRoleFilter: string,
) {
  const filteredCourseLeads = useMemo(() => {
    // Sales staff see ALL their assigned leads regardless of leadType or converted status
    const base = isSalesOnly
      ? effectiveLeads
      : effectiveLeads
          // Exclude online25 clients that already have course data (they live in the online25 tab)
          .filter((l) => !_online25HasCourse(l))
          .filter((l) => l.leadType === 'course' || l.leadType === 'general' || !l.leadType);
    const filterStatuses = leadsStatusFilter.filter(s => s !== '__hidden__');
    const showHidden = leadsStatusFilter.includes('__hidden__');
    const result = base.filter((l) => {
      const sl = _normalizeAr(leadsSearch);
      const normPhone = leadsSearch.replace(/\D/g, '');
      const ms = !leadsSearch
        || _normalizeAr(l.name).includes(sl)
        || (normPhone && (l.phone || '').replace(/\D/g, '').includes(normPhone))
        || (l.phone || '').includes(leadsSearch)
        || _normalizeAr(l.email).includes(sl)
        || (l.clientCode || '').includes(leadsSearch);
      const courseMatch = leadsCourseFilter === 'all' || (() => {
        if (leadsCourseFilter.startsWith('bundle:')) {
          const bid = leadsCourseFilter.slice(7);
          const bndCourseIds = bundles.find(b => b.id === bid)?.courses.map((c: { id: string }) => c.id) || [];
          return (l.interestedCourseIds || (l.enrolledCourseId ? [l.enrolledCourseId] : [])).some(id => bndCourseIds.includes(id));
        }
        return (l.interestedCourseIds || [l.enrolledCourseId]).filter(Boolean).includes(leadsCourseFilter);
      })();
      const fToday = new Date().toISOString().slice(0, 10);
      const matchFollowup = leadsFollowupFilter === 'all'
        ? true
        : leadsFollowupFilter === 'today'
          ? l.nextFollowUpDate === fToday
          : !!(l.nextFollowUpDate && l.nextFollowUpDate < fToday && !['converted', 'lost'].includes(l.status));
      // Status/hidden filter logic
      let statusMatch: boolean;
      if (isSalesOnly) {
        statusMatch = filterStatuses.length === 0 ? true : (showHidden ? l.hidden === true : false) || filterStatuses.includes(l.status);
      } else if (leadsStatusFilter.length === 0) {
        // Default: hide converted + hidden
        statusMatch = !l.hidden && l.status !== 'converted';
      } else if (showHidden && filterStatuses.length === 0) {
        statusMatch = l.hidden === true;
      } else if (showHidden) {
        statusMatch = l.hidden === true || (!l.hidden && filterStatuses.includes(l.status));
      } else {
        statusMatch = !l.hidden && filterStatuses.includes(l.status);
      }
      return ms && statusMatch
        && (leadsBranchFilter === 'all' || normBranchId(l.branch) === normBranchId(leadsBranchFilter))
        && (leadsSalesFilter === 'all' || l.assignedSalesId === leadsSalesFilter)
        && courseMatch && matchFollowup;
    });
    // Newest first
    return result.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [effectiveLeads, isSalesOnly, leadsSearch, leadsStatusFilter, leadsFollowupFilter, leadsBranchFilter, leadsSalesFilter, leadsCourseFilter, bundles]);

  const filteredConsultLeads = useMemo(() => {
    const base = effectiveLeads.filter((l) => l.leadType === 'consultation');
    const result = base.filter((l) => {
      const sl = _normalizeAr(leadsSearch);
      const normPhone = leadsSearch.replace(/\D/g, '');
      const ms = !leadsSearch
        || _normalizeAr(l.name).includes(sl)
        || (normPhone && (l.phone || '').replace(/\D/g, '').includes(normPhone))
        || (l.phone || '').includes(leadsSearch)
        || _normalizeAr(l.email).includes(sl)
        || (l.clientCode || '').includes(leadsSearch);
      const filterStatuses2 = leadsStatusFilter.filter(s => s !== '__hidden__');
      const showHidden2 = leadsStatusFilter.includes('__hidden__');
      let statusMatch2: boolean;
      if (leadsStatusFilter.length === 0) {
        statusMatch2 = !l.hidden && l.status !== 'converted';
      } else if (showHidden2 && filterStatuses2.length === 0) {
        statusMatch2 = l.hidden === true;
      } else if (showHidden2) {
        statusMatch2 = l.hidden === true || (!l.hidden && filterStatuses2.includes(l.status));
      } else {
        statusMatch2 = !l.hidden && filterStatuses2.includes(l.status);
      }
      return ms && statusMatch2
        && (leadsBranchFilter === 'all' || normBranchId(l.branch) === normBranchId(leadsBranchFilter))
        && (leadsSalesFilter === 'all' || l.assignedSalesId === leadsSalesFilter);
    });
    // Newest first
    return result.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [effectiveLeads, leadsSearch, leadsStatusFilter, leadsBranchFilter, leadsSalesFilter]);

  const leadsStats = useMemo(() => {
    const base = effectiveLeads;
    const total = base.length;
    const newC = base.filter((l) => l.status === 'new').length;
    const contacted = base.filter((l) => l.status === 'interested' || l.status === 'contacted').length;
    const converted = base.filter((l) => l.status === 'converted').length;
    return { total, newC, contacted, converted, rate: total > 0 ? Math.round((converted / total) * 100) : 0, courseCount: base.filter((l) => l.leadType === 'course').length };
  }, [effectiveLeads]);

  const filteredStaffList = useMemo(() =>
    staffMembers.filter((s) => {
      const sl = staffSearch.toLowerCase();
      const ms = !staffSearch || s.name.toLowerCase().includes(sl) || (s.email || '').toLowerCase().includes(sl) || (s.phone || '').includes(staffSearch);
      return ms && (staffRoleFilter === 'all' || s.role === staffRoleFilter);
    }),
  [staffMembers, staffSearch, staffRoleFilter]);

  const salesStaff = useMemo(() => staffMembers.filter((s) => s.role === 'sales'), [staffMembers]);
  const csStaff = useMemo(() => staffMembers.filter((s) => { const r = (s.role||'').toLowerCase(); return r === 'support' || r === 'collection'; }), [staffMembers]);

  return { filteredCourseLeads, filteredConsultLeads, leadsStats, filteredStaffList, salesStaff, csStaff };
}
