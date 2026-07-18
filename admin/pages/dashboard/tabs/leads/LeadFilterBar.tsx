import type { Dispatch, SetStateAction } from 'react';

import type { Bundle, Course, LeadItem, LeadStatus, StaffMember } from '../../../../types';
import { BRANCH_ENUM_LABELS, STATUS_CFG } from '../leadUtils';
import { normBranchId } from './LeadSubcomponents';

type BranchOption = {
  id: string;
  label: string;
};

type FollowupFilter =
  | 'all'
  | 'today'
  | 'overdue'
  | 'past3d'
  | 'past7d'
  | 'past30d'
  | 'next3d'
  | 'next7d'
  | 'no_followup';

type Props = {
  visible: boolean;
  searchTerm: string;
  setSearchTerm: Dispatch<SetStateAction<string>>;
  isSalesOnly: boolean;
  assignedReps: Pick<StaffMember, 'id' | 'name'>[];
  assignFilter: Set<string>;
  setAssignFilter: Dispatch<SetStateAction<Set<string>>>;
  singleStatus: LeadStatus | '';
  setSingleStatus: Dispatch<SetStateAction<LeadStatus | ''>>;
  courses: Course[];
  bundles: Bundle[];
  courseFilter: string | null;
  setCourseFilter: Dispatch<SetStateAction<string | null>>;
  branchFilter: string | null;
  setBranchFilter: Dispatch<SetStateAction<string | null>>;
  instituteBranches: BranchOption[];
  effectiveLeads: LeadItem[];
  salesSourceFilter: string;
  setSalesSourceFilter: Dispatch<SetStateAction<string>>;
  leadsFollowupFilter: FollowupFilter;
  setLeadsFollowupFilter: Dispatch<SetStateAction<FollowupFilter>>;
  showHiddenLeads: boolean;
  setShowHiddenLeads: Dispatch<SetStateAction<boolean>>;
  totalConverted: number;
  totalLost: number;
  visibleLeadsCount: number;
};

export function LeadFilterBar({
  visible,
  searchTerm,
  setSearchTerm,
  isSalesOnly,
  assignedReps,
  assignFilter,
  setAssignFilter,
  singleStatus,
  setSingleStatus,
  courses,
  bundles,
  courseFilter,
  setCourseFilter,
  branchFilter,
  setBranchFilter,
  instituteBranches,
  effectiveLeads,
  salesSourceFilter,
  setSalesSourceFilter,
  leadsFollowupFilter,
  setLeadsFollowupFilter,
  showHiddenLeads,
  setShowHiddenLeads,
  totalConverted,
  totalLost,
  visibleLeadsCount,
}: Props) {
  if (!visible) return null;

  const enumEntries = Object.entries(BRANCH_ENUM_LABELS).map(([id, label]) => ({ id, label }));
  const masterBranchOptions = instituteBranches.length > 0
    ? [
        ...instituteBranches,
        ...enumEntries.filter(e => !instituteBranches.some(b => normBranchId(b.id) === normBranchId(e.id))),
      ]
    : enumEntries;
  const sourceOptions = [...new Map(
    effectiveLeads.map(l => l.source?.trim() || '').filter(Boolean)
      .map(s => [s.toLowerCase(), s] as [string, string])
  ).values()].sort((a, b) => a.localeCompare(b, 'ar'));
  const hasActiveFilters = assignFilter.size > 0 || singleStatus || courseFilter || branchFilter || searchTerm || showHiddenLeads || salesSourceFilter || leadsFollowupFilter !== 'all';

  return (
    <div className="flex items-center gap-1.5 bg-gray-50 rounded-xl border border-gray-100 px-2.5 py-1.5 overflow-x-auto flex-nowrap">
      <input
        value={searchTerm}
        onChange={e => setSearchTerm(e.target.value)}
        placeholder="بحث بالاسم أو الهاتف..."
        className="border border-gray-200 rounded-lg px-2.5 py-1 text-xs flex-shrink-0 w-48 bg-white"
      />
      {!isSalesOnly && assignedReps.length > 0 && (
        <select
          value={assignFilter.size === 1 ? [...assignFilter][0] : ''}
          onChange={e => setAssignFilter(e.target.value ? new Set([e.target.value]) : new Set())}
          className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none flex-shrink-0">
          <option value="">👤 كل المندوبين</option>
          <option value="__none__">⬜ بدون مندوب</option>
          {assignedReps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      )}
      <select
        value={singleStatus}
        onChange={e => setSingleStatus(e.target.value as LeadStatus | '')}
        className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none flex-shrink-0">
        <option value="">كل الحالات</option>
        {(Object.keys(STATUS_CFG) as LeadStatus[]).filter(s =>
          !['not_interested_hidden'].includes(s) &&
          (isSalesOnly || !['converted', 'lost'].includes(s))
        ).map(s => (
          <option key={s} value={s}>{STATUS_CFG[s].label}</option>
        ))}
      </select>
      {(courses.length > 0 || bundles.length > 0) && (
        <select
          value={courseFilter ?? ''}
          onChange={e => setCourseFilter(e.target.value || null)}
          className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none max-w-[130px] flex-shrink-0">
          <option value="">🎓 كل الكورسات</option>
          <option value="__none__">⬜ بدون كورس</option>
          {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          {bundles.map(b => <option key={b.id} value={b.id}>📚 {b.title}</option>)}
        </select>
      )}
      {masterBranchOptions.length > 0 && (
        <select
          value={branchFilter ?? ''}
          onChange={e => setBranchFilter(e.target.value || null)}
          className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none font-sans flex-shrink-0">
          <option value="">🏢 كل الفروع</option>
          <option value="__none__">⬜ بدون فرع</option>
          {masterBranchOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
        </select>
      )}
      {sourceOptions.length > 0 && (
        <select
          value={salesSourceFilter}
          onChange={e => setSalesSourceFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-1.5 py-1 text-xs bg-white focus:outline-none flex-shrink-0 max-w-[110px]">
          <option value="">📡 مصادر</option>
          <option value="__none__">⬜ بدون مصدر</option>
          {sourceOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      <select
        value={leadsFollowupFilter}
        onChange={e => setLeadsFollowupFilter(e.target.value as FollowupFilter)}
        className={`border rounded-lg px-2 py-1 text-xs bg-white focus:outline-none flex-shrink-0 ${
          leadsFollowupFilter !== 'all' ? 'border-blue-400 bg-blue-50 text-blue-800 font-bold' : 'border-gray-200'
        }`}>
        <option value="all">📅 كل المتابعات</option>
        <option value="today">🔴 متابعة اليوم</option>
        <option value="overdue">⚠️ متأخرة</option>
        <option value="past3d">🕐 فاتت 3 أيام</option>
        <option value="past7d">🕐 فاتت أسبوع</option>
        <option value="past30d">🕐 فاتت شهر</option>
        <option value="next3d">🟢 خلال 3 أيام</option>
        <option value="next7d">🟢 خلال أسبوع</option>
        <option value="no_followup">❓ بدون متابعة</option>
      </select>
      <button
        onClick={() => setShowHiddenLeads(v => !v)}
        title={showHiddenLeads ? 'عرض الكل' : 'عرض المخفيين فقط'}
        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold border transition flex-shrink-0 ${showHiddenLeads ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}>
        {showHiddenLeads ? '👁 الكل' : '🙈 مخفيون'}
      </button>
      {hasActiveFilters && (
        <button
          onClick={() => { setAssignFilter(new Set()); setSingleStatus(''); setCourseFilter(null); setBranchFilter(null); setSearchTerm(''); setShowHiddenLeads(false); setSalesSourceFilter(''); setLeadsFollowupFilter('all'); }}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition font-bold flex-shrink-0">
          ✕ مسح
        </button>
      )}
      {!isSalesOnly && (
        <div className="mr-auto flex gap-2 text-[11px] text-gray-500 items-center flex-shrink-0">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-green-500 rounded-full" /> {totalConverted}</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-red-400 rounded-full" /> {totalLost}</span>
          <span className="text-gray-400">{visibleLeadsCount}</span>
        </div>
      )}
    </div>
  );
}
