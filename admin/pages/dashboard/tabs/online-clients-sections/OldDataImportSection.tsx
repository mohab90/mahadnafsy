import React from 'react';
import type { SubscriberItem } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import OldDataImportPanel from '../online/OldDataImportPanel';
import type { SheetClientRow } from '../../../../../shared/sheetImport';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type ViewTabKey = 'active'|'real-local'|'real-saudi'|'real-intl'|'finished'|'paused'|'refunded'|'old_data'|'old_local'|'old_intl'|'booked2024'|'booked2025';
type ImportResult = { created: number; assigned: number; skipped: number; others: number; failed: number };

interface Props {
  collOnlineViewTab: ViewTabKey;
  isDaqqiClientsTab: boolean;
  notify: NotifyFn;
  setSalesOwnSubscribers: React.Dispatch<React.SetStateAction<SubscriberItem[]>>;
}

const mergeFreshSubscribers = (fresh: SubscriberItem[], setSalesOwnSubscribers: React.Dispatch<React.SetStateAction<SubscriberItem[]>>) => {
  setSalesOwnSubscribers(prev => {
    const ids = new Set(prev.map(item => item.id));
    return [...prev, ...fresh.filter(item => !ids.has(item.id))];
  });
};

/**
 * The file's rows through the server's import (api/lib/collectionSheets.js),
 * as a collection sheet goes: nobody on the system twice, the course or track
 * matched by the catalogue, the sheet's price and remaining kept on the client.
 * These screens saved row by row before, and the Dokki one sent no price.
 */
const importOldData = (destination: 'daqqi' | 'old_local' | 'old_intl') => async (rows: SheetClientRow[], source: string) => {
  const result = await mysqlAdmin.adminPost<ImportResult>('/admin/old-data/import', { destination, source, rows });
  return { created: result.created, assigned: result.assigned, dupes: result.skipped, others: result.others, errors: result.failed };
};

export function OldDataImportSection({
  collOnlineViewTab,
  isDaqqiClientsTab,
  notify,
  setSalesOwnSubscribers,
}: Props) {
  if (collOnlineViewTab === 'old_data' && isDaqqiClientsTab) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <span className="text-base">📂</span>
          <h3 className="font-extrabold text-gray-800 text-base">داتا قديمة - استيراد عملاء دقي</h3>
        </div>
        <OldDataImportPanel
          defaultSource="داتا قديمة دقي"
          accent="indigo"
          showAttendanceCol
          importRows={importOldData('daqqi')}
          onImported={async created => {
            notify('success', `تم استيراد ${created} عميل`);
            try {
              const fresh = await mysqlAdmin.listMyDaqqiClients() as unknown as SubscriberItem[];
              mergeFreshSubscribers(fresh, setSalesOwnSubscribers);
            } catch {
              // The import itself succeeded; refresh can be retried by re-opening the tab.
            }
          }}
        />
      </div>
    );
  }

  if ((collOnlineViewTab === 'old_local' || collOnlineViewTab === 'old_intl') && !isDaqqiClientsTab) {
    return (
      <details className="mb-4 group">
        <summary className="cursor-pointer flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-2xl px-4 py-2.5 text-sm font-bold text-violet-800 hover:bg-violet-100 transition select-none list-none">
          <span>⬆️</span>
          <span>استيراد بيانات {collOnlineViewTab === 'old_local' ? 'محلي قديم' : 'دولي قديم'}</span>
          <span className="text-xs font-normal text-violet-500 mr-auto group-open:hidden">انقر للفتح</span>
          <span className="text-xs font-normal text-violet-500 mr-auto hidden group-open:inline">إخفاء</span>
        </summary>
        <div className="mt-2">
          <OldDataImportPanel
            defaultSource="داتا قديمة أونلاين"
            accent="violet"
            importRows={importOldData(collOnlineViewTab)}
            onImported={async created => {
              notify('success', `تم استيراد ${created} عميل`);
              try {
                const fresh = await mysqlAdmin.listStaffSubscribers() as unknown as SubscriberItem[];
                mergeFreshSubscribers(fresh, setSalesOwnSubscribers);
              } catch {
                // The import itself succeeded; refresh can be retried by re-opening the tab.
              }
            }}
          />
        </div>
      </details>
    );
  }

  return null;
}
