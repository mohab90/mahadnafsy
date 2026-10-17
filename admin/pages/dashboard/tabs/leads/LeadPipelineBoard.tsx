import React, { useState } from 'react';
import type { Bundle, Course, LeadItem, LeadStatus } from '../../../../types';
import { useIsMobile } from '../../../../hooks/useIsMobile';
import { STATUS_CFG } from '../leadUtils';
import { LeadCard } from './LeadSubcomponents';

type ScoredLead = LeadItem & { _score?: number };

const LEGACY_COLUMN_AR: Record<string, string> = { follow_up: 'متابعة' };

type LeadPipelineBoardProps = {
  activeStatusCols: LeadStatus[];
  scoredLeads: ScoredLead[];
  colLimit: Record<LeadStatus, number>;
  setColLimit: React.Dispatch<React.SetStateAction<Record<LeadStatus, number>>>;
  dragOverCol: LeadStatus | null;
  setDragOverCol: React.Dispatch<React.SetStateAction<LeadStatus | null>>;
  draggedLeadRef: React.MutableRefObject<LeadItem | null>;
  canManageLeads: boolean;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  handleStatusChange: (lead: LeadItem, status: LeadStatus) => void;
  openLeadBook: (lead: LeadItem) => void;
  onLogContact: (lead: LeadItem) => void;
  onOutcomeRecorded?: () => void;
  instituteBranches: { id: string; label: string }[];
  courses: Course[];
  bundles: Bundle[];
  /** Each column's true size when the cards are a server page (useServerLeadBoard). */
  columnTotals?: Record<string, number>;
};

/**
 * The pipeline: three columns across on a desktop (the stages wrap onto a second row), two on a tablet,
 * and on a phone ONE list at a time with the stages as tabs above it — «يبقى عرض العملاء على الموبايل بنظام
 * البايبلان هو الأساسي مش الجدول» (17 Oct 2026). It used to be six 240 px columns side by side, scrolled
 * sideways, with cards too small to read or press.
 */
export function LeadPipelineBoard({
  activeStatusCols,
  scoredLeads,
  colLimit,
  setColLimit,
  dragOverCol,
  setDragOverCol,
  draggedLeadRef,
  canManageLeads,
  setSelectedId,
  handleStatusChange,
  openLeadBook,
  onLogContact,
  onOutcomeRecorded,
  instituteBranches,
  courses,
  bundles,
  columnTotals,
}: LeadPipelineBoardProps) {
  const mobile = useIsMobile();
  const [chosen, setChosen] = useState<LeadStatus | null>(null);

  const columns = activeStatusCols.map(status => {
    const colLeads = scoredLeads.filter(lead => lead.status === status);
    const limit = colLimit[status] || 15;
    const visible = colLeads.slice(0, limit);
    const size = columnTotals ? (columnTotals[status] || 0) : colLeads.length;
    // A status from before the current stages ('follow_up') has no entry in STATUS_CFG; its column still
    // needs a name and colours.
    const cfg = STATUS_CFG[status] || {
      label: LEGACY_COLUMN_AR[status] || status,
      color: 'bg-gray-100 text-gray-700 border-gray-200',
      colColor: 'border-t-gray-400',
    };
    return { status, cfg, visible, size, remaining: size - visible.length };
  });

  if (columns.length === 0) {
    return <div className="flex w-full items-center justify-center py-16 text-sm text-gray-400">لا توجد ليدز تطابق الفلاتر المختارة</div>;
  }

  const card = (lead: ScoredLead) => (
    <div
      key={lead.id}
      className="relative"
      draggable={canManageLeads && !mobile}
      onDragStart={() => { draggedLeadRef.current = lead; }}
      onDragEnd={() => { draggedLeadRef.current = null; setDragOverCol(null); }}
    >
      <LeadCard
        lead={lead}
        score={lead._score || 0}
        onSelect={() => canManageLeads && setSelectedId(lead.id)}
        onStatusChange={nextStatus => handleStatusChange(lead, nextStatus)}
        onBook={canManageLeads ? openLeadBook : undefined}
        onContact={canManageLeads ? onLogContact : undefined}
        onOutcomeRecorded={onOutcomeRecorded}
        canManageLeads={canManageLeads}
        instituteBranches={instituteBranches}
        courses={courses}
        bundles={bundles}
      />
    </div>
  );

  const more = (status: LeadStatus, remaining: number) => remaining > 0 && (
    <button
      onClick={() => setColLimit(prev => ({ ...prev, [status]: (prev[status] || 15) + 15 }))}
      className="w-full rounded-xl bg-primary-50 py-2.5 text-xs font-bold text-primary-600 transition hover:bg-primary-100"
    >
      عرض {Math.min(remaining, 15)} أكثر ({remaining} متبقي)
    </button>
  );

  if (mobile) {
    // The stage in view: the one chosen, else the first that has anyone in it.
    const current = columns.find(column => column.status === chosen) || columns.find(column => column.size > 0) || columns[0];
    return (
      <div className="space-y-2" dir="rtl">
        <div className="no-scrollbar sticky top-0 z-10 -mx-1 flex gap-1.5 overflow-x-auto bg-gray-50/95 px-1 py-1.5 backdrop-blur" role="tablist">
          {columns.map(column => (
            <button key={column.status} role="tab" aria-selected={column.status === current.status} onClick={() => setChosen(column.status)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                column.status === current.status ? `${column.cfg.color} ring-2 ring-gray-300` : 'border-gray-200 bg-white text-gray-600'}`}>
              {column.cfg.label}
              <span className="rounded-full bg-white/70 px-1.5 text-[10px]">{column.size}</span>
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {current.visible.length === 0 && <p className="py-10 text-center text-sm text-gray-400">لا يوجد</p>}
          {current.visible.map(card)}
          {more(current.status, current.remaining)}
        </div>
      </div>
    );
  }

  return (
    <div className="grid items-start gap-3 md:grid-cols-2 lg:grid-cols-3" dir="rtl">
      {columns.map(column => {
        const isDropTarget = dragOverCol === column.status;
        return (
          <div
            key={column.status}
            className={`rounded-2xl border-t-4 transition ${column.cfg.colColor} ${isDropTarget ? 'bg-primary-50 ring-2 ring-primary-300' : 'bg-gray-50'}`}
            onDragOver={event => { if (!canManageLeads) return; event.preventDefault(); setDragOverCol(column.status); }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={event => {
              event.preventDefault();
              setDragOverCol(null);
              if (canManageLeads && draggedLeadRef.current && draggedLeadRef.current.status !== column.status) {
                handleStatusChange(draggedLeadRef.current, column.status);
              }
              draggedLeadRef.current = null;
            }}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${column.cfg.color}`}>{column.cfg.label}</span>
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full border border-gray-200 bg-white px-1.5 text-xs font-bold text-gray-500">{column.size}</span>
            </div>
            <div className="space-y-2.5 p-2.5">
              {column.visible.length === 0 && <p className="py-8 text-center text-xs text-gray-400">لا يوجد</p>}
              {column.visible.map(card)}
              {more(column.status, column.remaining)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
