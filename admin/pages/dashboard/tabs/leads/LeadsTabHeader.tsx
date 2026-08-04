import React from 'react';
import {
  ChevronDown, Download, FolderKanban, MapPin, MessageCircle,
  RefreshCw, Settings, UserPlus,
} from 'lucide-react';
import type { NotifyFn } from '../CrmSettingsModal';
import { CsvImportButton } from './CsvImportButton';
import { LeadSubTabs, type SubTabKey } from './LeadSubTabs';

interface LeadsTabHeaderProps {
  isSalesOnly: boolean;
  canAdministerCrm: boolean;
  canManageLeads: boolean;
  canExportLeads: boolean;
  canBulkWhatsApp: boolean;
  canManageDuplicates: boolean;
  totalOfflineLeads: number;
  overdueCount: number;
  rottenCount: number;
  dueTodayCount: number;
  unassignedCount?: number;
  subTab: SubTabKey;
  setSubTab: (tab: SubTabKey) => void;
  onAddLead: () => void;
  showActionsMenu: boolean;
  actionsMenuRef: React.RefObject<HTMLDivElement | null>;
  onToggleActionsMenu: () => void;
  onCloseActionsMenu: () => void;
  onOpenSettings: () => void;
  notify: NotifyFn;
  onSyncSheet: () => void;
  syncingSheet: boolean;
  onMigrateBranches: () => void;
  migratingBranches: boolean;
  onExportCsv: () => void;
  bulkMode: boolean;
  selectedLeadCount: number;
  onToggleBulkMode: () => void;
  onOpenBulkWhatsApp: () => void;
  onCleanupJunk: () => void;
}

export function LeadsTabHeader({
  isSalesOnly,
  canAdministerCrm,
  canManageLeads,
  canExportLeads,
  canBulkWhatsApp,
  canManageDuplicates,
  totalOfflineLeads,
  overdueCount,
  rottenCount,
  dueTodayCount,
  unassignedCount = 0,
  subTab,
  setSubTab,
  onAddLead,
  showActionsMenu,
  actionsMenuRef,
  onToggleActionsMenu,
  onCloseActionsMenu,
  onOpenSettings,
  notify,
  onSyncSheet,
  syncingSheet,
  onMigrateBranches,
  migratingBranches,
  onExportCsv,
  bulkMode,
  selectedLeadCount,
  onToggleBulkMode,
  onOpenBulkWhatsApp,
  onCleanupJunk,
}: LeadsTabHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <FolderKanban size={22} className="text-primary-600" />
          {isSalesOnly ? 'عملائي المحتملون' : 'CRM — إدارة المبيعات'}
        </h2>
        {(canAdministerCrm || canExportLeads || canBulkWhatsApp) && (
          <p className="text-sm text-gray-500 mt-0.5">
            {totalOfflineLeads} عميل محتمل ·{' '}
            <span className={overdueCount > 0 ? 'text-red-600 font-bold' : ''}>{overdueCount} يحتاج متابعة عاجلة</span>
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <LeadSubTabs
          subTab={subTab}
          isSalesOnly={isSalesOnly}
          canManageDuplicates={canManageDuplicates}
          rottenCount={rottenCount}
          overdueCount={overdueCount}
          dueTodayCount={dueTodayCount}
          unassignedCount={unassignedCount}
          setSubTab={setSubTab}
        />
        <div className="w-px h-6 bg-gray-200 mx-1" />
        {canManageLeads && (
          <button
            onClick={onAddLead}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm shadow-emerald-500/30"
          >
            <UserPlus size={15} />
            إضافة ليد
          </button>
        )}
        {!isSalesOnly && (
          <div className="relative" ref={actionsMenuRef}>
            <button
              onClick={onToggleActionsMenu}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition border border-gray-200"
            >
              <Settings size={15} />
              الإعدادات
              <ChevronDown size={14} className={`transition-transform ${showActionsMenu ? 'rotate-180' : ''}`} />
            </button>
            {showActionsMenu && (
              <div className="absolute left-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-xl z-50 w-52 py-1 overflow-hidden">
                {canAdministerCrm && (<>
                  <button
                    onClick={() => { onOpenSettings(); onCloseActionsMenu(); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition text-right"
                  >
                    <Settings size={14} className="text-indigo-500 flex-shrink-0" /> إعدادات CRM
                  </button>
                  {canManageDuplicates && (
                    <button
                      onClick={() => { setSubTab('pipelineSettings'); onCloseActionsMenu(); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition text-right"
                    >
                      <Settings size={14} className="text-purple-500 flex-shrink-0" /> إعداد المراحل
                    </button>
                  )}
                  <div className="border-t border-gray-100 my-0.5" />
                  <div className="px-3 py-1.5">
                    <CsvImportButton notify={notify} onImported={() => {}} />
                  </div>
                  <button
                    onClick={() => { onSyncSheet(); onCloseActionsMenu(); }}
                    disabled={syncingSheet}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-blue-700 hover:bg-blue-50 transition disabled:opacity-60 text-right"
                  >
                    <RefreshCw size={14} className={`flex-shrink-0 ${syncingSheet ? 'animate-spin' : ''}`} />
                    {syncingSheet ? 'جاري...' : 'مزامنة الشيت'}
                  </button>
                  <button
                    onClick={() => { onMigrateBranches(); onCloseActionsMenu(); }}
                    disabled={migratingBranches}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-amber-700 hover:bg-amber-50 transition disabled:opacity-60 text-right"
                  >
                    {migratingBranches
                      ? <span className="inline-block w-4 h-4 border-2 border-amber-400/40 border-t-amber-600 rounded-full animate-spin flex-shrink-0" />
                      : <MapPin size={14} className="flex-shrink-0" />}
                    {migratingBranches ? 'جاري...' : 'استيراد الفروع'}
                  </button>
                </>)}
                {canExportLeads && (
                  <button
                    onClick={() => { onExportCsv(); onCloseActionsMenu(); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition text-right"
                  >
                    <Download size={14} className="text-gray-500 flex-shrink-0" /> تصدير CSV
                  </button>
                )}
                {canBulkWhatsApp && (<>
                  <div className="border-t border-gray-100 my-0.5" />
                  <button
                    onClick={() => { onToggleBulkMode(); onCloseActionsMenu(); }}
                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition text-right ${
                      bulkMode ? 'text-emerald-700 bg-emerald-50' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <MessageCircle size={14} className="flex-shrink-0" />
                    {bulkMode ? `إرسال جماعي (${selectedLeadCount})` : 'إرسال جماعي'}
                  </button>
                  {bulkMode && selectedLeadCount > 0 && (
                    <button
                      onClick={() => { onOpenBulkWhatsApp(); onCloseActionsMenu(); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition text-right font-bold"
                    >
                      <MessageCircle size={14} className="flex-shrink-0" />
                      إرسال واتساب ({selectedLeadCount})
                    </button>
                  )}
                </>)}
                {canAdministerCrm && (<>
                  <div className="border-t border-gray-100 my-0.5" />
                  <button
                    onClick={() => { onCleanupJunk(); onCloseActionsMenu(); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition text-right"
                  >
                    <span className="flex-shrink-0">🗑</span> تنظيف جنك
                  </button>
                </>)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
