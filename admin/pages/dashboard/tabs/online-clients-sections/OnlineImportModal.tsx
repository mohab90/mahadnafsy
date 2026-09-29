import { useMemo, useState } from 'react';
import { Upload } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { StaffMember } from '../../../../types';
import OldDataImportPanel from '../online/OldDataImportPanel';
import { parseSheetLink } from './CollectionSettingsModal';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
type Destination = 'active' | 'old_local' | 'old_intl';
type Market = 'local' | 'saudi' | 'intl';
type ImportResult = { created: number; assigned: number; skipped: number; others: number; failed: number };

const DESTINATIONS: [Destination, string][] = [['active', 'النشطين'], ['old_local', '🏠 محلي قديم'], ['old_intl', '🌐 دولي قديم']];
const MARKETS: [Market, string][] = [['local', '🇪🇬 محلي'], ['saudi', '🇸🇦 سعودي'], ['intl', '🌍 دولي']];

/**
 * «استيراد عملاء» in the online tab's settings: a file or a Google Sheet, and
 * where its clients show — «النشطين» (in which market), «محلي قديم» or «دولي
 * قديم». Someone already on the system is not created again.
 */
export function OnlineImportModal({ staffMembers, notify, onClose, onImported }: {
  staffMembers: StaffMember[];
  notify: Notify;
  onClose: () => void;
  onImported: () => void | Promise<void>;
}) {
  const [destination, setDestination] = useState<Destination>('active');
  const [market, setMarket] = useState<Market>('local');
  const [staffId, setStaffId] = useState('');
  const officers = useMemo(() => staffMembers.filter(member => (member.role || '').toLowerCase() === 'collection' && member.status !== 'inactive'), [staffMembers]);
  const chip = (on: boolean) => `rounded-xl border px-3 py-1.5 text-xs font-bold transition ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300'}`;

  return (
    <Modal open onClose={onClose} size="xl" title="استيراد عملاء" icon={<Upload size={16} />} subtitle="ملف أو جوجل شيت — والعملاء هيظهروا فين">
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-3 sm:grid-cols-3">
          <div>
            <p className="mb-1.5 text-[11px] font-extrabold text-gray-500">هيظهروا في</p>
            <div className="flex flex-wrap gap-1.5">
              {DESTINATIONS.map(([key, label]) => (
                <button key={key} type="button" onClick={() => setDestination(key)} className={chip(destination === key)}>{label}</button>
              ))}
            </div>
          </div>
          {destination === 'active' && (
            <div>
              <p className="mb-1.5 text-[11px] font-extrabold text-gray-500">السوق</p>
              <div className="flex flex-wrap gap-1.5">
                {MARKETS.map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setMarket(key)} className={chip(market === key)}>{label}</button>
                ))}
              </div>
            </div>
          )}
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-extrabold text-gray-500">مسئول التحصيل (اختياري)</span>
            <select value={staffId} onChange={e => setStaffId(e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-2 py-2">
              <option value="">من غير — يتوزعوا بعدين</option>
              {officers.map(officer => <option key={officer.id} value={officer.id}>{officer.name}</option>)}
            </select>
          </label>
        </div>
        <OldDataImportPanel
          key={`${destination}-${market}-${staffId}`}
          defaultSource="استيراد الأونلاين"
          accent="indigo"
          loadSheetCsv={async link => {
            const { sheetId, gid } = parseSheetLink(link);
            const result = await mysqlAdmin.adminGet<{ csv: string }>(
              `/admin/collection-sheets/csv?sheetId=${encodeURIComponent(sheetId)}&gid=${encodeURIComponent(gid)}`);
            return result.csv;
          }}
          importRows={async (rows, source) => {
            const result = await mysqlAdmin.adminPost<ImportResult>('/admin/online-clients/import',
              { destination, market, staffId: staffId || undefined, source, rows });
            return { created: result.created, assigned: result.assigned, dupes: result.skipped, others: result.others, errors: result.failed };
          }}
          onImported={async created => {
            notify('success', `تم استيراد ${created} عميل جديد`);
            await onImported();
          }}
        />
      </div>
    </Modal>
  );
}
