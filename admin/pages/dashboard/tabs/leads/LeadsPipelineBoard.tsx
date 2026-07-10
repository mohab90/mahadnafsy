import React from 'react';
import type { CommunicationRecord, LeadItem, LeadStatus, Course, Bundle } from '../../../../types';
import type { BranchOption } from '../../../../hooks/useBranches';
import { STATUS_CFG } from '../leadUtils';
import { LeadCard } from './LeadSubcomponents';

type CrmContactDraft = {
  type: CommunicationRecord['type']; date: string; notes: string;
  outcome: string; nextFollowUp: string; newStatus: LeadStatus | '';
};

interface LeadsPipelineBoardProps {
  activeStatusCols: LeadStatus[];
  scoredLeads: (LeadItem & { _score: number })[];
  colLimit: Record<LeadStatus, number>;
  setColLimit: React.Dispatch<React.SetStateAction<Record<LeadStatus, number>>>;
  dragOverCol: LeadStatus | null;
  setDragOverCol: React.Dispatch<React.SetStateAction<LeadStatus | null>>;
  draggedLeadRef: React.MutableRefObject<LeadItem | null>;
  handleStatusChange: (lead: LeadItem, status: LeadStatus) => void;
  bulkMode: boolean;
  selectedLeadIds: Set<string>;
  setSelectedLeadIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectedId: (id: string | null) => void;
  openLeadBook: (row: LeadItem) => void;
  setCrmContactRow: (lead: LeadItem) => void;
  setCrmContactDraft: (draft: CrmContactDraft) => void;
  instituteBranches: BranchOption[];
  courses: Course[];
  bundles: Bundle[];
}

// Kanban board for the "pipeline" sub-tab. Extracted verbatim from LeadsTab.
export function LeadsPipelineBoard({
  activeStatusCols, scoredLeads, colLimit, setColLimit, dragOverCol, setDragOverCol,
  draggedLeadRef, handleStatusChange, bulkMode, selectedLeadIds, setSelectedLeadIds,
  setSelectedId, openLeadBook, setCrmContactRow, setCrmContactDraft,
  instituteBranches, courses, bundles,
}: LeadsPipelineBoardProps) {
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto pb-4 -mx-1 px-1" dir="rtl">
        <div className="flex gap-3 min-w-max">
          {activeStatusCols.length === 0 && (
            <div className="flex items-center justify-center w-full py-16 text-gray-400 text-sm">
              لا توجد ليدز تطابق الفلاتر المختارة
            </div>
          )}
          {activeStatusCols.map(status => {
            const colLeads = scoredLeads.filter(l => l.status === status);
            const limit = colLimit[status];
            const visible = colLeads.slice(0, limit);
            const remaining = colLeads.length - visible.length;
            const cfg = STATUS_CFG[status];
            const isDropTarget = dragOverCol === status;
            return (
              <div key={status}
                className={`w-60 flex-shrink-0 rounded-xl border-t-4 transition ${cfg.colColor} ${isDropTarget ? 'bg-primary-50 ring-2 ring-primary-300' : 'bg-gray-50'}`}
                dir="rtl"
                onDragOver={e => { e.preventDefault(); setDragOverCol(status); }}
                onDragLeave={() => setDragOverCol(null)}
                onDrop={e => {
                  e.preventDefault();
                  setDragOverCol(null);
                  if (draggedLeadRef.current && draggedLeadRef.current.status !== status) {
                    handleStatusChange(draggedLeadRef.current, status);
                  }
                  draggedLeadRef.current = null;
                }}
              >
                <div className="px-3 py-2.5 flex items-center justify-between border-b border-gray-100">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${cfg.color}`}>{cfg.label}</span>
                  <span className="text-xs text-gray-400 font-bold bg-white border border-gray-200 rounded-full w-5 h-5 flex items-center justify-center">
                    {colLeads.length}
                  </span>
                </div>
                <div className="p-2 space-y-2 overflow-y-visible">
                  {visible.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-8">لا يوجد</p>
                  )}
                  {visible.map(lead => (
                    <div key={lead.id} className="relative"
                      draggable
                      onDragStart={() => { draggedLeadRef.current = lead; }}
                      onDragEnd={() => { draggedLeadRef.current = null; setDragOverCol(null); }}
                    >
                      {bulkMode && (
                        <input type="checkbox"
                          checked={selectedLeadIds.has(lead.id)}
                          onChange={e => {
                            e.stopPropagation();
                            setSelectedLeadIds(prev => {
                              const next = new Set(prev);
                              e.target.checked ? next.add(lead.id) : next.delete(lead.id);
                              return next;
                            });
                          }}
                          className="absolute top-2 left-2 z-10 w-4 h-4 accent-emerald-600"
                          onClick={e => e.stopPropagation()}
                        />
                      )}
                      <LeadCard lead={lead} score={lead._score}
                        onSelect={() => !bulkMode && setSelectedId(lead.id)}
                        onStatusChange={s => handleStatusChange(lead, s)}
                        onBook={openLeadBook}
                        onContact={l => { setCrmContactRow(l); setCrmContactDraft({ type: 'call', date: new Date().toISOString().slice(0, 16), notes: '', outcome: '', nextFollowUp: '', newStatus: '' }); }}
                        instituteBranches={instituteBranches}
                        courses={courses}
                        bundles={bundles}
                      />
                    </div>
                  ))}
                  {remaining > 0 && (
                    <button
                      onClick={() => setColLimit(prev => ({ ...prev, [status]: (prev[status] || 15) + 15 }))}
                      className="w-full text-xs text-primary-600 font-bold py-2 bg-primary-50 hover:bg-primary-100 rounded-lg transition">
                      عرض {Math.min(remaining, 15)} أكثر ({remaining} متبقي)
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
