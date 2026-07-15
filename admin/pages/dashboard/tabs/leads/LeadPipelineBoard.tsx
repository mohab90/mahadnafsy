import React from 'react';
import type { Bundle, Course, LeadItem, LeadStatus, BranchType } from '../../../../types';
import { STATUS_CFG } from '../leadUtils';
import { LeadCard } from './LeadSubcomponents';

type ScoredLead = LeadItem & { _score?: number };

type LeadPipelineBoardProps = {
  activeStatusCols: LeadStatus[];
  scoredLeads: ScoredLead[];
  colLimit: Record<LeadStatus, number>;
  setColLimit: React.Dispatch<React.SetStateAction<Record<LeadStatus, number>>>;
  dragOverCol: LeadStatus | null;
  setDragOverCol: React.Dispatch<React.SetStateAction<LeadStatus | null>>;
  draggedLeadRef: React.MutableRefObject<LeadItem | null>;
  bulkMode: boolean;
  selectedLeadIds: Set<string>;
  setSelectedLeadIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  handleStatusChange: (lead: LeadItem, status: LeadStatus) => void;
  openLeadBook: (lead: LeadItem) => void;
  setCrmContactRow: React.Dispatch<React.SetStateAction<LeadItem | null>>;
  setCrmContactDraft: React.Dispatch<React.SetStateAction<{
    type: 'call' | 'whatsapp' | 'email' | 'meeting' | 'note';
    date: string;
    notes: string;
    outcome: string;
    nextFollowUp: string;
    newStatus: LeadStatus | '';
  }>>;
  instituteBranches: BranchType[];
  courses: Course[];
  bundles: Bundle[];
};

export function LeadPipelineBoard({
  activeStatusCols,
  scoredLeads,
  colLimit,
  setColLimit,
  dragOverCol,
  setDragOverCol,
  draggedLeadRef,
  bulkMode,
  selectedLeadIds,
  setSelectedLeadIds,
  setSelectedId,
  handleStatusChange,
  openLeadBook,
  setCrmContactRow,
  setCrmContactDraft,
  instituteBranches,
  courses,
  bundles,
}: LeadPipelineBoardProps) {
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
              <div
                key={status}
                className={`w-60 flex-shrink-0 rounded-xl border-t-4 transition ${cfg.colColor} ${isDropTarget ? 'bg-primary-50 ring-2 ring-primary-300' : 'bg-gray-50'}`}
                dir="rtl"
                onDragOver={event => { event.preventDefault(); setDragOverCol(status); }}
                onDragLeave={() => setDragOverCol(null)}
                onDrop={event => {
                  event.preventDefault();
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
                    <div
                      key={lead.id}
                      className="relative"
                      draggable
                      onDragStart={() => { draggedLeadRef.current = lead; }}
                      onDragEnd={() => { draggedLeadRef.current = null; setDragOverCol(null); }}
                    >
                      {bulkMode && (
                        <input
                          type="checkbox"
                          checked={selectedLeadIds.has(lead.id)}
                          onChange={event => {
                            event.stopPropagation();
                            setSelectedLeadIds(prev => {
                              const next = new Set(prev);
                              event.target.checked ? next.add(lead.id) : next.delete(lead.id);
                              return next;
                            });
                          }}
                          className="absolute top-2 left-2 z-10 w-4 h-4 accent-emerald-600"
                          onClick={event => event.stopPropagation()}
                        />
                      )}
                      <LeadCard
                        lead={lead}
                        score={lead._score}
                        onSelect={() => !bulkMode && setSelectedId(lead.id)}
                        onStatusChange={nextStatus => handleStatusChange(lead, nextStatus)}
                        onBook={openLeadBook}
                        onContact={row => {
                          setCrmContactRow(row);
                          setCrmContactDraft({
                            type: 'call',
                            date: new Date().toISOString().slice(0, 16),
                            notes: '',
                            outcome: '',
                            nextFollowUp: '',
                            newStatus: '',
                          });
                        }}
                        instituteBranches={instituteBranches}
                        courses={courses}
                        bundles={bundles}
                      />
                    </div>
                  ))}
                  {remaining > 0 && (
                    <button
                      onClick={() => setColLimit(prev => ({ ...prev, [status]: (prev[status] || 15) + 15 }))}
                      className="w-full text-xs text-primary-600 font-bold py-2 bg-primary-50 hover:bg-primary-100 rounded-lg transition"
                    >
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
