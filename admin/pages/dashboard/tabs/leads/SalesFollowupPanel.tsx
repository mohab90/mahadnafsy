import React from 'react';
import type { LeadItem, LeadStatus, StaffMember } from '../../../../types';
import { LEAD_STATUS_CFG } from './LeadSubcomponents';
import type { FollowupFilter } from './LeadsFilterBar';

interface SalesFollowupPanelProps {
  isSalesOnly: boolean;
  currentStaff: StaffMember | null;
  leads: LeadItem[];
  setSalesNotifOpen: (v: boolean) => void;
  setLeadsFollowupFilter: (v: FollowupFilter) => void;
  setActiveDashboardTab?: (tab: string) => void;
}

// Sales "follow-up notifications" slide-over panel (overdue / today / no-followup lists).
// Extracted verbatim from LeadsTab, including its inline LeadRow sub-component.
export function SalesFollowupPanel({
  isSalesOnly, currentStaff, leads, setSalesNotifOpen, setLeadsFollowupFilter, setActiveDashboardTab,
}: SalesFollowupPanelProps) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const myLeads = isSalesOnly && currentStaff
    ? leads.filter(l => l.assignedSalesId === currentStaff.id && !['converted', 'lost'].includes(l.status))
    : leads.filter(l => !['converted', 'lost'].includes(l.status));

  const overdue = myLeads
    .filter(l => l.nextFollowUpDate && l.nextFollowUpDate < todayStr)
    .sort((a, b) => (a.nextFollowUpDate || '').localeCompare(b.nextFollowUpDate || ''));
  const todayLeads = myLeads
    .filter(l => l.nextFollowUpDate === todayStr)
    .sort((a, b) => a.name.localeCompare(b.name));
  const noFollowup = myLeads
    .filter(l => !l.nextFollowUpDate && ['new', 'contacted', 'interested'].includes(l.status))
    .sort((a, b) => b.createdAt?.localeCompare(a.createdAt || '') || 0);

  const waPhone = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('0') ? '2' + d : d; };

  const LeadRow = ({ l, badge }: { l: LeadItem; badge: React.ReactNode }) => {
    const daysSince = l.nextFollowUpDate
      ? Math.floor((Date.now() - new Date(l.nextFollowUpDate).getTime()) / 86_400_000)
      : null;
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition">
        <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
          {l.name.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="font-bold text-gray-800 text-sm">{l.name}</span>
            {badge}
            {l.assignedSalesName && !isSalesOnly && (
              <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">👤 {l.assignedSalesName}</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
            {l.phone && <a href={`tel:${l.phone}`} className="text-blue-600 hover:underline">{l.phone}</a>}
            {l.nextFollowUpDate && daysSince !== null && daysSince > 0 && (
              <span className="text-red-500 font-bold">متأخر {daysSince} يوم</span>
            )}
            {l.lastContactNote && <span className="truncate max-w-[160px] text-gray-400 italic">{l.lastContactNote}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {l.phone && (
            <a href={`https://wa.me/${waPhone(l.phone)}`} target="_blank" rel="noopener noreferrer"
              className="w-7 h-7 rounded-full bg-green-500 hover:bg-green-600 text-white text-xs font-bold flex items-center justify-center">W</a>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-end" onClick={() => setSalesNotifOpen(false)}>
      <div className="bg-white h-full w-full max-w-md shadow-2xl flex flex-col" dir="rtl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gradient-to-l from-primary-50 to-white">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">🔔 متابعات السيلز</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {isSalesOnly ? `قائمتك — ${myLeads.length} عميل` : `جميع السيلز — ${myLeads.length} عميل`}
            </p>
          </div>
          <button onClick={() => setSalesNotifOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-0 border-b border-gray-100">
          {[
            { label: 'متأخرة', val: overdue.length, color: overdue.length > 0 ? 'text-red-600 bg-red-50' : 'text-gray-400 bg-gray-50' },
            { label: 'اليوم', val: todayLeads.length, color: todayLeads.length > 0 ? 'text-amber-600 bg-amber-50' : 'text-gray-400 bg-gray-50' },
            { label: 'بدون موعد', val: noFollowup.length, color: noFollowup.length > 0 ? 'text-violet-600 bg-violet-50' : 'text-gray-400 bg-gray-50' },
          ].map(c => (
            <div key={c.label} className={`${c.color} py-3 text-center`}>
              <div className="text-2xl font-extrabold">{c.val}</div>
              <div className="text-[11px] font-medium opacity-80">{c.label}</div>
            </div>
          ))}
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* Overdue */}
          {overdue.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">⚠️ متأخرة ({overdue.length})</span>
              </div>
              <div className="space-y-2">
                {overdue.map(l => (
                  <LeadRow key={l.id} l={l} badge={
                    <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                      📅 {l.nextFollowUpDate}
                    </span>
                  } />
                ))}
              </div>
            </div>
          )}

          {/* Today */}
          {todayLeads.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">📅 متابعات اليوم ({todayLeads.length})</span>
              </div>
              <div className="space-y-2">
                {todayLeads.map(l => (
                  <LeadRow key={l.id} l={l} badge={
                    <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">اليوم</span>
                  } />
                ))}
              </div>
            </div>
          )}

          {/* No followup date */}
          {noFollowup.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">🕐 بدون موعد متابعة ({noFollowup.length})</span>
              </div>
              <div className="space-y-2">
                {noFollowup.slice(0, 20).map(l => (
                  <LeadRow key={l.id} l={l} badge={
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      l.status === 'interested' ? 'bg-emerald-100 text-emerald-700'
                        : l.status === 'contacted' ? 'bg-amber-100 text-amber-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}>
                      {LEAD_STATUS_CFG[l.status as LeadStatus]?.label || l.status}
                    </span>
                  } />
                ))}
                {noFollowup.length > 20 && (
                  <p className="text-xs text-gray-400 text-center pt-1">+{noFollowup.length - 20} عميل آخر</p>
                )}
              </div>
            </div>
          )}

          {overdue.length === 0 && todayLeads.length === 0 && noFollowup.length === 0 && (
            <div className="text-center py-20">
              <div className="text-5xl mb-3">✅</div>
              <p className="text-gray-500 font-bold">كل شيء على ما يرام!</p>
              <p className="text-gray-400 text-sm mt-1">لا توجد متابعات معلّقة</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-gray-200 px-5 py-4 bg-gray-50 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={() => { setLeadsFollowupFilter('overdue'); setSalesNotifOpen(false); setActiveDashboardTab?.('leads'); }}
              disabled={overdue.length === 0}
              className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-xl disabled:opacity-40 transition"
            >عرض المتأخرة في الجدول</button>
            <button
              onClick={() => { setLeadsFollowupFilter('today'); setSalesNotifOpen(false); setActiveDashboardTab?.('leads'); }}
              disabled={todayLeads.length === 0}
              className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl disabled:opacity-40 transition"
            >عرض اليوم</button>
          </div>
        </div>
      </div>
    </div>
  );
}
