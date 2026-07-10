import React from 'react';
import {
  Archive, ChevronDown, Columns, Download, FolderKanban, Globe,
  MapPin, MessageCircle, Phone, RefreshCw, Settings, TrendingUp, UserPlus, Users,
} from 'lucide-react';
import type { LeadItem } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { CsvImportButton } from './LeadSubcomponents';
import type { NotifyFn } from '../CrmSettingsModal';
import { isOnlineSource } from '../crmConstants';

export type LeadsSubTabKey = 'pipeline' | 'table' | 'communications' | 'performance' | 'dawliNew' | 'dawliOld' | 'archive' | 'reminders';

interface LeadsHeaderBarProps {
  notify: NotifyFn;
  isSalesOnly: boolean;
  leads: LeadItem[];
  overdueLeadsCount: number;
  rottenCount: number;
  subTab: LeadsSubTabKey;
  setSubTab: (t: LeadsSubTabKey) => void;
  showActionsMenu: boolean;
  setShowActionsMenu: React.Dispatch<React.SetStateAction<boolean>>;
  actionsMenuRef: React.RefObject<HTMLDivElement | null>;
  setShowAddLead: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  syncingSheet: boolean;
  handleSyncSheet: () => void;
  migratingBranches: boolean;
  handleMigrateBranches: () => void;
  visibleLeads: LeadItem[];
  bulkMode: boolean;
  setBulkMode: React.Dispatch<React.SetStateAction<boolean>>;
  selectedLeadIds: Set<string>;
  setSelectedLeadIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setShowBulkWA: (v: boolean) => void;
  reloadLeads: () => Promise<void>;
}

// Title + sub-tab switcher + primary actions row. Extracted verbatim from LeadsTab's render.
export function LeadsHeaderBar({
  notify, isSalesOnly, leads, overdueLeadsCount, rottenCount, subTab, setSubTab,
  showActionsMenu, setShowActionsMenu, actionsMenuRef, setShowAddLead, setShowSettings,
  syncingSheet, handleSyncSheet, migratingBranches, handleMigrateBranches,
  visibleLeads, bulkMode, setBulkMode, selectedLeadIds, setSelectedLeadIds, setShowBulkWA,
  reloadLeads,
}: LeadsHeaderBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <FolderKanban size={22} className="text-primary-600" />
          {isSalesOnly ? 'عملائي المحتملون' : 'CRM — إدارة المبيعات'}
        </h2>
        {!isSalesOnly && (
          <p className="text-sm text-gray-500 mt-0.5">
            {leads.filter(l => !l.hidden && !isOnlineSource(l.source)).length} عميل محتمل ·{' '}
            <span className={overdueLeadsCount > 0 ? 'text-red-600 font-bold' : ''}>{overdueLeadsCount} يحتاج متابعة عاجلة</span>
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {([
          ['pipeline', 'البايبلاين', Columns],
          ['table', 'الجدول', Users],
          ['communications', 'الاتصالات', Phone],
          ...(!isSalesOnly ? [['performance', 'أداء الفريق', TrendingUp]] : []),
          ['dawliNew', 'دولي جديد', Globe],
          ['dawliOld', 'دولي قديم', Globe],
          ...(!isSalesOnly ? [['archive', 'محلي قديم', Archive]] : []),
        ] as [LeadsSubTabKey, string, React.ElementType][]).map(([t, lbl, Ic]) => (
          <button key={t} onClick={() => setSubTab(t)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition relative ${
              subTab === t ? 'bg-primary-600 text-white shadow-sm shadow-primary-500/30' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            <Ic size={13} />
            {lbl}
            {t === 'communications' && (rottenCount + overdueLeadsCount) > 0 && (
              <span className="w-3.5 h-3.5 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center">
                {rottenCount + overdueLeadsCount}
              </span>
            )}
          </button>
        ))}
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <button onClick={() => setShowAddLead(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm shadow-emerald-500/30">
          <UserPlus size={15} />
          إضافة ليد
        </button>
        {!isSalesOnly && (
          <div className="relative" ref={actionsMenuRef}>
            <button
              onClick={() => setShowActionsMenu(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition border border-gray-200">
              <Settings size={15} />
              إجراءات
              <ChevronDown size={14} className={`transition-transform ${showActionsMenu ? 'rotate-180' : ''}`} />
            </button>
            {showActionsMenu && (
              <div className="absolute left-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-xl z-50 w-52 py-1 overflow-hidden">
                <button onClick={() => { setShowSettings(true); setShowActionsMenu(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition text-right">
                  <Settings size={14} className="text-indigo-500 flex-shrink-0" /> إعدادات CRM
                </button>
                <div className="border-t border-gray-100 my-0.5" />
                <div className="px-3 py-1.5">
                  <CsvImportButton notify={notify} onImported={() => {}} />
                </div>
                <button onClick={() => { handleSyncSheet(); setShowActionsMenu(false); }}
                  disabled={syncingSheet}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-blue-700 hover:bg-blue-50 transition disabled:opacity-60 text-right">
                  <RefreshCw size={14} className={`flex-shrink-0 ${syncingSheet ? 'animate-spin' : ''}`} />
                  {syncingSheet ? 'جاري...' : 'مزامنة الشيت'}
                </button>
                <button onClick={() => { handleMigrateBranches(); setShowActionsMenu(false); }}
                  disabled={migratingBranches}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-amber-700 hover:bg-amber-50 transition disabled:opacity-60 text-right">
                  {migratingBranches
                    ? <span className="inline-block w-4 h-4 border-2 border-amber-400/40 border-t-amber-600 rounded-full animate-spin flex-shrink-0" />
                    : <MapPin size={14} className="flex-shrink-0" />}
                  {migratingBranches ? 'جاري...' : 'استيراد الفروع'}
                </button>
                <button onClick={() => {
                  const headers = ['الاسم', 'الهاتف', 'البريد', 'المصدر', 'الحالة', 'مستوى الاهتمام', 'المندوب', 'تاريخ الإنشاء'];
                  const rows = visibleLeads.map(l => [
                    l.name, l.phone, l.email || '', l.source || '',
                    l.status, l.interestLevel || '', l.assignedSalesName || '',
                    (l.createdAt || '').slice(0, 10),
                  ]);
                  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
                  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
                  URL.revokeObjectURL(url);
                  setShowActionsMenu(false);
                }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition text-right">
                  <Download size={14} className="text-gray-500 flex-shrink-0" /> تصدير CSV
                </button>
                <div className="border-t border-gray-100 my-0.5" />
                <button onClick={() => { setBulkMode(b => !b); setSelectedLeadIds(new Set()); setShowActionsMenu(false); }}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition text-right ${
                    bulkMode ? 'text-emerald-700 bg-emerald-50' : 'text-gray-700 hover:bg-gray-50'
                  }`}>
                  <MessageCircle size={14} className="flex-shrink-0" />
                  {bulkMode ? `إرسال جماعي (${selectedLeadIds.size})` : 'إرسال جماعي'}
                </button>
                {bulkMode && selectedLeadIds.size > 0 && (
                  <button onClick={() => { setShowBulkWA(true); setShowActionsMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition text-right font-bold">
                    <MessageCircle size={14} className="flex-shrink-0" />
                    إرسال واتساب ({selectedLeadIds.size})
                  </button>
                )}
                <div className="border-t border-gray-100 my-0.5" />
                <button onClick={async () => {
                  if (!window.confirm('سيتم إخفاء العملاء المحتملين بدون اسم ولا هاتف. تأكيد؟')) return;
                  setShowActionsMenu(false);
                  try {
                    const r = await mysqlAdmin.adminPost('/api/admin/cleanup-junk-leads', {}) as Record<string, unknown>;
                    notify('success', `تم إخفاء ${r.hidden as number} سجل جنك`);
                    reloadLeads();
                  } catch { notify('error', 'فشل التنظيف'); }
                }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition text-right">
                  <span className="flex-shrink-0">🗑</span> تنظيف جنك
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
