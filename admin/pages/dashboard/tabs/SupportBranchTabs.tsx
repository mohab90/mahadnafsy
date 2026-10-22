import React from 'react';

/**
 * «الفرع» on the customer-service screen: every problem, the central queue, or
 * one branch's clients' problems. A Dokki (or Tagamoa) client's complaint goes
 * to that branch's own queue (api/lib/ticketBranchQueue.js); the administration
 * reads each queue from here. The value is GET /api/admin/cs/inbox's `branch`.
 */
export type SupportBranchQueue = '' | 'CENTRAL' | 'DAQQI' | 'TAGAMOA';

const TABS: Array<{ value: SupportBranchQueue; label: string }> = [
  { value: '', label: 'كل الفروع' },
  { value: 'CENTRAL', label: 'المركزي (أونلاين)' },
  { value: 'DAQQI', label: 'فرع الدقي' },
  { value: 'TAGAMOA', label: 'فرع التجمع' },
];

export function SupportBranchTabs({ value, onChange }: { value: SupportBranchQueue; onChange: (value: SupportBranchQueue) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="الفرع">
      {TABS.map(tab => (
        <button
          key={tab.value || 'all'}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${value === tab.value ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
