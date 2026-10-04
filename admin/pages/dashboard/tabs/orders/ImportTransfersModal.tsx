import { useMemo, useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import { cairoDateOnly } from '../../../../../shared/cairoDate';
import { isCashBox } from '../../../../../shared/paymentMethods';
import { readSheetFile } from '../../../../../shared/sheetImport';
import { guessBox, guessCurrency, readTransferTab, type SheetTransfer, type SkippedRow } from '../../../../../shared/transferSheet';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;

type TabPlan = {
  name: string; transfers: SheetTransfer[]; skipped: SkippedRow[]; readable: boolean;
  box: string; currency: string; include: boolean;
};

type ImportResult = { created: number; existing: number; failed: { index: number; error: string }[] };

const money = (value: number) => Math.round(value).toLocaleString('ar-EG-u-nu-latn');

/**
 * «رفع ملف التحويلات» — the accounts team's workbook, a tab per account the
 * money arrived on. Each tab is read on its own (shared/transferSheet.ts), the
 * person confirms which box it is, and the rows go onto the ledger. An
 * operation number already on that box is counted, not added again, so the
 * same growing sheet can be uploaded every day.
 */
export function ImportTransfersModal({ boxes: allBoxes, notify, onClose, onSaved }: {
  boxes: string[]; notify: Notify; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  const boxes = useMemo(() => allBoxes.filter(box => !isCashBox(box)), [allBoxes]);
  const [fileName, setFileName] = useState('');
  const [tabs, setTabs] = useState<TabPlan[]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const read = async (file: File) => {
    setReading(true); setResult(null);
    try {
      const today = cairoDateOnly();
      const read = (await readSheetFile(file)).map(tab => {
        const { transfers, skipped, layout } = readTransferTab(tab, today);
        const box = guessBox(tab.name, boxes) || '';
        return { name: tab.name, transfers, skipped, readable: !!layout, box, currency: guessCurrency(tab.name, box), include: transfers.length > 0 };
      });
      setTabs(read); setFileName(file.name);
      if (!read.some(tab => tab.transfers.length)) notify('error', 'مالقيتش تحويلات في الملف — لازم عمود «رقم العملية» أو «الايداع»');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر قراءة الملف');
    } finally { setReading(false); }
  };

  const update = (name: string, patch: Partial<TabPlan>) => setTabs(current => current.map(tab => (tab.name === name ? { ...tab, ...patch } : tab)));
  const chosen = tabs.filter(tab => tab.include && tab.transfers.length);
  const missingBox = chosen.filter(tab => !tab.box);
  const total = chosen.reduce((sum, tab) => sum + tab.transfers.length, 0);

  const save = async () => {
    if (!chosen.length || missingBox.length) return;
    setSaving(true);
    try {
      const rows = chosen.flatMap(tab => tab.transfers.map(transfer => ({
        amount: transfer.amount, currency: tab.currency, method: tab.box, reference: transfer.reference,
        receivedOn: transfer.receivedOn, senderName: transfer.senderName, senderPhone: transfer.senderPhone, note: transfer.note,
      })));
      const saved = await mysqlAdmin.adminPost<ImportResult>('/admin/incoming-transfers/import', { transfers: rows });
      setResult(saved);
      notify('success', `اتسجّل ${saved.created} تحويل جديد${saved.existing ? ` · ${saved.existing} كانوا متسجلين قبل كده` : ''}`);
      await onSaved();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر رفع التحويلات');
    } finally { setSaving(false); }
  };

  const field = 'rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200';

  return (
    <Modal open onClose={onClose} size="lg" title="رفع ملف التحويلات" icon={<FileSpreadsheet size={16} />}
      subtitle="شيت لكل حساب: التاريخ، رقم العملية، المحوِّل، المبلغ — والعميل والسيلز والكورس لو مكتوبين">
      <div className="space-y-3 text-sm" dir="rtl">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 px-4 py-4 text-xs font-bold text-blue-700 transition hover:bg-blue-50">
          <Upload size={16} />
          {reading ? 'جاري قراءة الملف…' : fileName ? `${fileName} — اختار ملف تاني` : 'اختار ملف Excel (xlsx) أو CSV'}
          <input type="file" accept=".xlsx,.xlsm,.csv" className="hidden" disabled={reading || saving}
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void read(file); }} />
        </label>

        {tabs.length > 0 && (
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {tabs.map(tab => {
              const sum = tab.transfers.reduce((total, transfer) => total + transfer.amount, 0);
              const guessed = tab.transfers.filter(transfer => transfer.warnings.length).length;
              const unclaimed = tab.transfers.filter(transfer => !transfer.customerName).length;
              return (
                <div key={tab.name} className={`rounded-xl border px-3 py-2.5 ${tab.include && tab.transfers.length ? 'border-blue-200 bg-white' : 'border-gray-200 bg-gray-50'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex min-w-[160px] flex-1 items-center gap-2 font-bold text-gray-800">
                      <input type="checkbox" checked={tab.include} disabled={!tab.transfers.length}
                        onChange={event => update(tab.name, { include: event.target.checked })} className="accent-blue-600" />
                      {tab.name}
                    </label>
                    <span className="text-[11px] text-gray-500">
                      {tab.readable ? `${tab.transfers.length} تحويل · ${money(sum)} ${tab.currency}` : 'مش شيت تحويلات'}
                    </span>
                    {tab.transfers.length > 0 && (
                      <>
                        <select value={tab.box} onChange={event => update(tab.name, { box: event.target.value })}
                          className={`${field} ${tab.include && !tab.box ? 'border-red-300 bg-red-50' : ''}`} title="الحساب اللي الفلوس وصلت عليه">
                          <option value="">وصل على حساب…</option>
                          {boxes.map(box => <option key={box} value={box}>{box}</option>)}
                        </select>
                        <select value={tab.currency} onChange={event => update(tab.name, { currency: event.target.value })} className={field}>
                          {['EGP', 'SAR', 'USD'].map(code => <option key={code} value={code}>{code}</option>)}
                        </select>
                      </>
                    )}
                  </div>
                  {(tab.transfers.length > 0 || tab.skipped.length > 0) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                      {unclaimed > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800">{unclaimed} من غير اسم عميل</span>}
                      {guessed > 0 && <span className="rounded-full bg-sky-100 px-2 py-0.5 font-bold text-sky-800">{guessed} فيهم تخمين (تاريخ/رقم عملية)</span>}
                      {tab.skipped.length > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 font-bold text-red-700">{tab.skipped.length} صف متساب</span>}
                      <button type="button" onClick={() => setOpen(open === tab.name ? null : tab.name)} className="font-bold text-blue-600 hover:underline">
                        {open === tab.name ? 'إخفاء التفاصيل' : 'التفاصيل'}
                      </button>
                    </div>
                  )}
                  {open === tab.name && (
                    <div className="mt-2 space-y-1.5">
                      {tab.skipped.map(row => (
                        <div key={`s${row.row}`} className="rounded-lg bg-red-50 px-2 py-1 text-[10px] text-red-700">صف {row.row}: {row.reason}</div>
                      ))}
                      {tab.transfers.filter(transfer => transfer.warnings.length).map(transfer => (
                        <div key={`w${transfer.row}`} className="rounded-lg bg-sky-50 px-2 py-1 text-[10px] text-sky-800">صف {transfer.row}: {transfer.warnings.join(' · ')}</div>
                      ))}
                      <div className="overflow-x-auto rounded-lg border border-gray-100">
                        <table className="w-full min-w-[520px] text-[10px]">
                          <thead><tr className="bg-gray-50 text-gray-600">
                            {['صف', 'التاريخ', 'رقم العملية', 'المحوِّل', 'المبلغ', 'العميل'].map(title => <th key={title} className="px-2 py-1 text-right">{title}</th>)}
                          </tr></thead>
                          <tbody>
                            {tab.transfers.slice(0, 50).map(transfer => (
                              <tr key={transfer.row} className="border-t border-gray-100">
                                <td className="px-2 py-1 text-gray-400">{transfer.row}</td>
                                <td className="px-2 py-1 whitespace-nowrap">{transfer.receivedOn}</td>
                                <td className="px-2 py-1 font-mono" dir="ltr">{transfer.reference}</td>
                                <td className="px-2 py-1" dir="auto">{transfer.senderPhone || transfer.senderName || '—'}</td>
                                <td className="px-2 py-1 font-bold">{money(transfer.amount)}</td>
                                <td className="px-2 py-1">{transfer.customerName || <span className="text-amber-600">—</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {tab.transfers.length > 50 && <div className="px-2 py-1 text-[10px] text-gray-400">و{tab.transfers.length - 50} صف كمان…</div>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {result && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <div className="font-bold">اتسجّل {result.created} تحويل جديد · {result.existing} كانوا متسجلين قبل كده (نفس رقم العملية على نفس الحساب)</div>
            {result.failed.length > 0 && (
              <div className="mt-1 text-red-700">{result.failed.length} اترفضوا: {[...new Set(result.failed.map(row => row.error))].join(' · ')}</div>
            )}
          </div>
        )}

        {missingBox.length > 0 && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700">
            اختار الحساب اللي وصلت عليه فلوس: {missingBox.map(tab => `«${tab.name}»`).join('، ')} — أو شيل علامتها.
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">
            {result ? 'إغلاق' : 'إلغاء'}
          </button>
          <button type="button" disabled={!total || missingBox.length > 0 || saving || reading} onClick={() => { void save(); }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400">
            <Upload size={14} /> {saving ? 'جارٍ الرفع…' : `رفع ${total} تحويل`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
