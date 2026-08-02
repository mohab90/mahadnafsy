import type React from 'react';
import { ExternalLink, Phone } from 'lucide-react';

import type { CommunicationRecord, LeadItem, StaffMember } from '../../../../types';
import { LeadCommunicationsControls } from './LeadCommunicationsControls';
import { LeadCommunicationsStatsPanel } from './LeadCommunicationsStatsPanel';
import type { LeadCommunicationEntry, LeadCommunicationFilter } from './useLeadCommunicationsData';
import { formatWaPhone } from './LeadSubcomponents';

type QuickCommunicationDraft = {
  leadSearch: string;
  selectedLeadId: string;
  type: CommunicationRecord['type'];
  notes: string;
  outcome: string;
  nextFollowUp: string;
  /** Send the note as a real WhatsApp message, not just log that a contact happened. */
  alsoSend: boolean;
};

type RepCommunicationStats = {
  name: string;
  calls: number;
  whatsapp: number;
  meetings: number;
  total: number;
};

type CommunicationTypeMeta = Record<string, { icon: string; label: string; color: string; dot: string }>;

type LeadCommunicationsTimelineProps = {
  todayStr: string;
  callCount: number;
  waCount: number;
  meetingCount: number;
  uniqueLeadsToday: number;
  repStats: RepCommunicationStats[];
  filteredComms: LeadCommunicationEntry[];
  allComms: LeadCommunicationEntry[];
  commFilter: LeadCommunicationFilter;
  setCommFilter: React.Dispatch<React.SetStateAction<LeadCommunicationFilter>>;
  salesReps: StaffMember[];
  isSalesOnly: boolean;
  canManageLeads: boolean;
  canExportLeads: boolean;
  showAddComm: boolean;
  setShowAddComm: React.Dispatch<React.SetStateAction<boolean>>;
  addCommDraft: QuickCommunicationDraft;
  setAddCommDraft: React.Dispatch<React.SetStateAction<QuickCommunicationDraft>>;
  addCommSearchResults: LeadItem[];
  handleLeadSearchChange: (value: string) => void;
  selectLeadForCommunication: (lead: LeadItem) => void;
  saveQuickCommunication: () => void;
  exportCommsCsv: () => void;
  effectiveLeads: LeadItem[];
  setSelectedId: (leadId: string) => void;
  typeMeta: CommunicationTypeMeta;
};

export function LeadCommunicationsTimeline({
  todayStr,
  callCount,
  waCount,
  meetingCount,
  uniqueLeadsToday,
  repStats,
  filteredComms,
  allComms,
  commFilter,
  setCommFilter,
  salesReps,
  isSalesOnly,
  canManageLeads,
  canExportLeads,
  showAddComm,
  setShowAddComm,
  addCommDraft,
  setAddCommDraft,
  addCommSearchResults,
  handleLeadSearchChange,
  selectLeadForCommunication,
  saveQuickCommunication,
  exportCommsCsv,
  effectiveLeads,
  setSelectedId,
  typeMeta: TYPE_META,
}: LeadCommunicationsTimelineProps) {
  return (
    <div className="space-y-5" dir="rtl">    
        
                <LeadCommunicationsStatsPanel
                  callCount={callCount}
                  waCount={waCount}
                  meetingCount={meetingCount}
                  uniqueLeadsToday={uniqueLeadsToday}
                  repStats={repStats}
                />
        
                <LeadCommunicationsControls
                  filteredCount={filteredComms.length}
                  totalCount={allComms.length}
                  commFilter={commFilter}
                  setCommFilter={setCommFilter}
                  salesReps={salesReps}
                  isSalesOnly={isSalesOnly}
                  canManageLeads={canManageLeads}
                  canExportLeads={canExportLeads}
                  showAddComm={showAddComm}
                  setShowAddComm={setShowAddComm}
                  addCommDraft={addCommDraft}
                  setAddCommDraft={setAddCommDraft}
                  addCommSearchResults={addCommSearchResults}
                  handleLeadSearchChange={handleLeadSearchChange}
                  selectLeadForCommunication={selectLeadForCommunication}
                  saveQuickCommunication={saveQuickCommunication}
                  exportCommsCsv={exportCommsCsv}
                />
        
                {/* ── Communications Timeline ── */}    
                <div className="space-y-2">    
                  {filteredComms.length === 0 ? (    
                    <div className="bg-gray-50 border border-gray-200 rounded-2xl p-10 text-center">    
                      <Phone size={32} className="text-gray-200 mx-auto mb-3" />    
                      <p className="text-sm text-gray-400 font-medium">لا توجد تواصلات تطابق الفلتر</p>    
                    </div>    
                  ) : (    
                    <>    
                      {filteredComms.slice(0, 120).map((c, i) => {    
                        const meta = TYPE_META[c.type] || { icon: '📌', label: c.type, color: 'bg-gray-100 text-gray-700 border-gray-200', dot: 'bg-gray-400' };    
                        const dateStr = c.date.slice(0, 16).replace('T', ' ');    
                        const isToday = c.date.slice(0, 10) === todayStr;    
                        const lead = effectiveLeads.find(l => l.id === c.leadId);    
                        return (    
                          <div key={`${c.commId}-${i}`} className={`bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-start gap-3 shadow-sm hover:shadow transition ${isToday ? 'border-r-4 border-r-primary-400' : ''}`}>    
                            {/* Type Badge */}    
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-base flex-shrink-0 mt-0.5 border ${meta.color}`}>    
                              {meta.icon}    
                            </div>    
                            {/* Content */}    
                            <div className="flex-1 min-w-0">    
                              <div className="flex flex-wrap items-center gap-1.5 mb-0.5">    
                                <span className="font-bold text-gray-900 text-sm">{c.leadName}</span>    
                                <a href={`tel:${c.leadPhone}`} className="text-blue-600 font-mono text-xs hover:underline" dir="ltr">{c.leadPhone}</a>    
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${meta.color}`}>{meta.label}</span>    
                                {!isSalesOnly && c.staffName !== '—' && (    
                                  <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded-full">{c.staffName}</span>    
                                )}    
                                {isToday && <span className="text-[10px] bg-primary-50 text-primary-700 font-bold px-1.5 py-0.5 rounded-full border border-primary-200">اليوم</span>}    
                              </div>    
                              <p className="text-xs text-gray-700 leading-relaxed line-clamp-2">{c.notes}</p>    
                              {c.outcome && <p className="text-[10px] text-emerald-600 mt-0.5 font-medium">↩ {c.outcome}</p>}    
                            </div>    
                            {/* Date + Actions */}    
                            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">    
                              <span className="text-[10px] text-gray-400" dir="ltr">{dateStr}</span>    
                              <div className="flex gap-1">    
                                {lead && canManageLeads && (
                                  <a href={`https://wa.me/${formatWaPhone(c.leadPhone)}`} target="_blank" rel="noreferrer"    
                                    className="h-6 w-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-100 text-xs transition" title="واتساب">    
                                    💬    
                                  </a>    
                                )}    
                                {lead && (    
                                  <button onClick={() => setSelectedId(c.leadId)}    
                                    className="h-6 w-6 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center hover:bg-primary-50 hover:text-primary-600 transition" title="تفاصيل العميل">    
                                    <ExternalLink size={11} />    
                                  </button>    
                                )}    
                              </div>    
                            </div>    
                          </div>    
                        );    
                      })}    
                      {filteredComms.length > 120 && (    
                        <p className="text-center text-xs text-gray-400 py-3">تم عرض 120 من {filteredComms.length} — استخدم الفلتر لتضييق النتائج</p>    
                      )}    
                    </>    
                  )}    
                </div>    
              </div>
  );
}
