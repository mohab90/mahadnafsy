import { useState } from 'react';

// Lead-list filter state, lifted out of the Dashboard god-hub (pure UI state, no
// effects). Returns identical names so the component body is unchanged apart from
// the single destructure that replaces the useState lines.
export function useLeadFilters() {
  const [leadsSearch, setLeadsSearch] = useState('');
  const [leadsStatusFilter, setLeadsStatusFilter] = useState<string[]>([]); // empty = hide converted+hidden
  const [leadsFollowupFilter, setLeadsFollowupFilter] = useState<'all' | 'today' | 'overdue'>('all');
  const [leadsBranchFilter, setLeadsBranchFilter] = useState<'all' | string>('all');
  const [leadsSalesFilter, setLeadsSalesFilter] = useState<string>('all');
  const [leadsCourseFilter, setLeadsCourseFilter] = useState<string>('all');
  return {
    leadsSearch, setLeadsSearch,
    leadsStatusFilter, setLeadsStatusFilter,
    leadsFollowupFilter, setLeadsFollowupFilter,
    leadsBranchFilter, setLeadsBranchFilter,
    leadsSalesFilter, setLeadsSalesFilter,
    leadsCourseFilter, setLeadsCourseFilter,
  };
}
