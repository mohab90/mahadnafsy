import { useMemo } from 'react';
import type { BranchOption } from '../../../../hooks/useBranches';
import type { LeadItem, LeadStatus, StaffMember } from '../../../../types';
import { DEFAULT_SOURCES, isOnlineSource } from '../crmConstants';
import {
  BRANCH_ENUM_LABELS,
  PIPELINE_COLS,
  calcLeadScore,
  getLeadBranchRaw,
  getRottenLevel,
} from '../leadUtils';
import { normBranchId } from './LeadSubcomponents';

type FollowupFilter =
  | 'all'
  | 'no_followup'
  | 'today'
  | 'overdue'
  | 'past3d'
  | 'past7d'
  | 'past30d'
  | 'next3d'
  | 'next7d';

type UseLeadFilteringDataArgs = {
  effectiveLeads: LeadItem[];
  leads: LeadItem[];
  salesReps: StaffMember[];
  selectedId: string | null;
  isSalesOnly: boolean;
  assignFilter: Set<string>;
  searchTerm: string;
  tagFilter: string | null;
  sourceFilter: Set<string>;
  courseFilter: string | null;
  branchFilter: string | null;
  singleStatus: LeadStatus | '';
  showHiddenLeads: boolean;
  rottenFilter: boolean;
  salesSourceFilter: string;
  leadsFollowupFilter: FollowupFilter;
  statusFilter: Set<LeadStatus>;
  instituteBranches: BranchOption[];
};

export function useLeadFilteringData({
  effectiveLeads,
  leads,
  salesReps,
  selectedId,
  isSalesOnly,
  assignFilter,
  searchTerm,
  tagFilter,
  sourceFilter,
  courseFilter,
  branchFilter,
  singleStatus,
  showHiddenLeads,
  rottenFilter,
  salesSourceFilter,
  leadsFollowupFilter,
  statusFilter,
  instituteBranches,
}: UseLeadFilteringDataArgs) {
  const today = new Date().toISOString().slice(0, 10);
  const activeLead = selectedId ? (leads.find((lead) => lead.id === selectedId) ?? null) : null;

  const assignedReps = useMemo(() => salesReps
    .map((staff) => ({ id: staff.id, name: staff.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar')), [salesReps]);

  const visibleLeads = useMemo(() => effectiveLeads.filter((lead) =>
    (showHiddenLeads ? lead.hidden === true : !lead.hidden) &&
    (isSalesOnly || !isOnlineSource(lead.source)) &&
    !['converted', 'lost'].includes((lead.status || '').toLowerCase()) &&
    (isSalesOnly || sourceFilter.size === 0 || sourceFilter.has(lead.source || '')) &&
    (isSalesOnly || assignFilter.size === 0 || (() => {
      if (assignFilter.has('__none__')) return !lead.assignedSalesId && !lead.assignedSalesName;
      return assignFilter.has(lead.assignedSalesId || '') || (!lead.assignedSalesId && assignFilter.has(lead.assignedSalesName || ''));
    })()) &&
    (!tagFilter || (lead.tags || []).includes(tagFilter)) &&
    (courseFilter === null || (courseFilter === '__none__'
      ? !(lead.interestedCourseIds || []).length
      : (lead.interestedCourseIds || []).includes(courseFilter)
    )) &&
    (branchFilter === null || (branchFilter === '__none__'
      ? !getLeadBranchRaw(lead)
      : (() => {
          const raw = getLeadBranchRaw(lead);
          if (!raw) return false;
          if (raw === branchFilter) return true;
          const normRaw = normBranchId(raw);
          const normFilter = normBranchId(branchFilter);
          if (normRaw === normFilter) return true;
          const filterLabel = instituteBranches.find((branch) => branch.id === branchFilter)?.label
            || BRANCH_ENUM_LABELS[branchFilter] || BRANCH_ENUM_LABELS[normFilter];
          return !!filterLabel && (raw === filterLabel || normBranchId(raw) === normBranchId(filterLabel));
        })()
    )) &&
    (singleStatus === '' || lead.status === singleStatus) &&
    (!rottenFilter || getRottenLevel(lead) >= 2) &&
    !!(lead.name?.trim() || lead.phone?.trim()) &&
    (!salesSourceFilter || (salesSourceFilter === '__none__' ? !lead.source?.trim() : (lead.source || '') === salesSourceFilter)) &&
    (leadsFollowupFilter === 'all' || (() => {
      const todayDate = new Date().toISOString().slice(0, 10);
      const nextFollowupDate = lead.nextFollowUpDate || '';
      if (leadsFollowupFilter === 'no_followup') return !nextFollowupDate;
      if (!nextFollowupDate) return false;
      const past3 = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      const past7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const past30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const next3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      const next7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      if (leadsFollowupFilter === 'today') return nextFollowupDate === todayDate;
      if (leadsFollowupFilter === 'overdue') return nextFollowupDate < todayDate;
      if (leadsFollowupFilter === 'past3d') return nextFollowupDate >= past3 && nextFollowupDate < todayDate;
      if (leadsFollowupFilter === 'past7d') return nextFollowupDate >= past7 && nextFollowupDate < todayDate;
      if (leadsFollowupFilter === 'past30d') return nextFollowupDate >= past30 && nextFollowupDate < todayDate;
      if (leadsFollowupFilter === 'next3d') return nextFollowupDate > todayDate && nextFollowupDate <= next3;
      if (leadsFollowupFilter === 'next7d') return nextFollowupDate > todayDate && nextFollowupDate <= next7;
      return true;
    })()) &&
    (searchTerm === '' || (() => {
      const query = searchTerm.trim().toLowerCase();
      const queryDigits = query.replace(/\D/g, '');
      const phoneMatch = queryDigits.length >= 4
        ? (lead.phone || '').replace(/\D/g, '').includes(queryDigits)
        : (lead.phone || '').includes(searchTerm);
      return lead.name.toLowerCase().includes(query) || phoneMatch || (lead.email || '').toLowerCase().includes(query)
        || (lead.notes || '').toLowerCase().includes(query);
    })())
  ), [effectiveLeads, isSalesOnly, assignFilter, searchTerm, tagFilter, sourceFilter, courseFilter, branchFilter, singleStatus, showHiddenLeads, rottenFilter, salesSourceFilter, leadsFollowupFilter, instituteBranches]);

  const scoredLeads = useMemo(() =>
    [...visibleLeads]
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .map((lead) => ({ ...lead, _score: calcLeadScore(lead) })),
    [visibleLeads]
  );

  const activeStatusCols = useMemo(() => {
    const alwaysOn: LeadStatus[] = ['new', 'interested_booking', 'interested_followup', 'no_answer_wa', 'no_answer_nowa', 'not_interested'];
    const inUse = new Set(visibleLeads.map((lead) => lead.status));
    const baseCols = PIPELINE_COLS.filter((status) => alwaysOn.includes(status) || inUse.has(status));
    return statusFilter.size === 0 ? baseCols : baseCols.filter((status) => statusFilter.has(status));
  }, [visibleLeads, statusFilter]);

  const overdueLeads = useMemo(() =>
    leads
      .filter((lead) => !lead.hidden && lead.nextFollowUpDate && lead.nextFollowUpDate <= today && !['converted', 'lost'].includes(lead.status))
      .sort((a, b) => (a.nextFollowUpDate || '').localeCompare(b.nextFollowUpDate || '')),
    [leads, today]
  );

  const sourceOptions = useMemo(() => {
    const fromLeads = Array.from(new Set(effectiveLeads.map((lead) => lead.source).filter(Boolean))) as string[];
    return Array.from(new Set([...DEFAULT_SOURCES, ...fromLeads]));
  }, [effectiveLeads]);

  return { activeLead, assignedReps, visibleLeads, scoredLeads, activeStatusCols, overdueLeads, sourceOptions, today };
}
