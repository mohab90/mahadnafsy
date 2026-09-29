import React, { useMemo, useState } from 'react';
import {
  SHEET_FIELDS, detectLayout, paidBefore, readCsvTab, readSheetFile, tabClientRows,
  type SheetClientRow, type SheetField, type SheetTab, type TabLayout,
} from '../../../../../shared/sheetImport';

type OldDataImportPanelProps = {
  defaultSource: string;
  accent?: 'indigo' | 'violet';
  showAttendanceCol?: boolean;
  /** All the selected rows in one call, deduplicated by whoever receives them. */
  importRows: (rows: SheetClientRow[], source: string) => Promise<ImportResult>;
  onImported?: (created: number) => void | Promise<void>;
  /**
   * Reads a Google Sheet link as CSV text (through the server — Google's export
   * does not answer the browser). When given, the panel takes a link beside the
   * file, and the sheet is read exactly as an uploaded file is.
   */
  loadSheetCsv?: (link: string) => Promise<string>;
  /** A link to start with — an officer's saved sheet. */
  initialSheetLink?: string;
};

type ImportResult = { created: number; dupes: number; errors: number; assigned?: number; others?: number };
type LoadedTab = { tab: SheetTab; layout: TabLayout; include: boolean };

// A tab of certificate payments names a course and an amount too; it is not a
// list of clients, so it starts unticked.
const looksLikeClients = (layout: TabLayout) => layout.columns.cert === undefined
  && layout.columns.name !== undefined && layout.columns.phone !== undefined;

const usable = (row: SheetClientRow) => Boolean(row._name && row._phone);

const BATCH = 200;

const columnLabel = (tab: SheetTab, layout: TabLayout, index: number) => {
  const heading = layout.headerRow >= 0 ? String(tab.rows[layout.headerRow]?.[index] ?? '').trim() : '';
  const sample = String(tab.rows[layout.headerRow + 1]?.[index] ?? '').trim().slice(0, 18);
  return heading ? `${heading}` : `عمود ${index + 1}${sample ? ` (${sample})` : ''}`;
};

export default function OldDataImportPanel({
  defaultSource,
  accent = 'indigo',
  showAttendanceCol = false,
  importRows,
  onImported,
  loadSheetCsv,
  initialSheetLink = '',
}: OldDataImportPanelProps) {
  const [sheetLink, setSheetLink] = useState(initialSheetLink);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [source, setSource] = useState(defaultSource);
  const [tabs, setTabs] = useState<LoadedTab[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState('');
  // Nothing is written until this is true. The button used to call doImport
  // directly, so one click on a freshly-parsed file wrote every selected row to
  // the database with no chance to stop it.
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState('');

  const fileCls = accent === 'violet'
    ? 'file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100'
    : 'file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100';
  const btnCls = accent === 'violet' ? 'bg-violet-600 hover:bg-violet-700' : 'bg-indigo-600 hover:bg-indigo-700';

  const parsed = useMemo(() => tabs.filter(entry => entry.include).flatMap(entry => tabClientRows(entry.tab, entry.layout)), [tabs]);

  // Every change to what is read resets the ticks to the rows that can be
  // written, and retracts the confirmation, so the count on the confirm bar is
  // always the count about to be uploaded.
  const applyTabs = (next: LoadedTab[]) => {
    const rows = next.filter(entry => entry.include).flatMap(entry => tabClientRows(entry.tab, entry.layout));
    setTabs(next);
    setSelected(new Set(rows.filter(usable).map(row => row._id)));
    setConfirming(false);
    setResult(null);
    if (!next.length) setParseError('الملف فاضي.');
    else if (!rows.length) {
      // A file that read to nothing used to show nothing. Say what was found,
      // so the mismatch is obvious — a tab left unticked, or a column unnamed.
      setParseError(`الملف اتقرا بس مفيش ولا صف فيه اسم أو رقم في التابات المختارة (${next.map(entry => entry.tab.name).join(' | ')}) — اختار التاب أو صحح الأعمدة.`);
    } else setParseError('');
  };

  const loadTabs = (loaded: SheetTab[]) => {
    const next = loaded.filter(tab => tab.rows.length).map(tab => {
      const layout = detectLayout(tab.rows);
      return { tab, layout, include: looksLikeClients(layout) };
    });
    // One tab only: take it, whatever it looks like.
    if (next.length === 1) next[0].include = true;
    // A sheet with no heading row opens on its columns, to be checked.
    const guessed = next.findIndex(entry => entry.include && entry.layout.guessed);
    setEditing(guessed >= 0 ? guessed : null);
    applyTabs(next);
  };

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { loadTabs(await readSheetFile(file)); }
    catch (error) { setTabs([]); setParseError(error instanceof Error ? error.message : 'تعذّرت قراءة الملف.'); }
  };

  const onSheet = async () => {
    if (!loadSheetCsv || !sheetLink.trim()) return;
    setLoadingSheet(true);
    try { loadTabs([readCsvTab(await loadSheetCsv(sheetLink.trim()), 'جوجل شيت')]); }
    catch (error) { setParseError(error instanceof Error ? error.message : 'تعذّرت قراءة الشيت.'); }
    finally { setLoadingSheet(false); }
  };

  const setColumn = (tabIndex: number, field: SheetField, value: string) => {
    applyTabs(tabs.map((entry, index) => {
      if (index !== tabIndex) return entry;
      const columns = { ...entry.layout.columns };
      const column = value === '' ? undefined : Number(value);
      // One column is one field.
      for (const key of Object.keys(columns) as SheetField[]) if (columns[key] === column) delete columns[key];
      if (column === undefined) delete columns[field]; else columns[field] = column;
      return { ...entry, layout: { ...entry.layout, columns, guessed: false } };
    }));
  };

  const changeSelection = (next: Set<string>) => {
    setSelected(next);
    setConfirming(false);
  };

  const toggleRow = (rowId: string, checked: boolean) => {
    setConfirming(false);
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  };

  // In batches: a workbook of two thousand clients in one request outlasts the
  // proxy's minute. Each batch is checked against everyone already on the
  // system, the ones the batch before it created included.
  const doImport = async () => {
    setConfirming(false);
    setImporting(true);
    const rows = parsed.filter(row => selected.has(row._id) && usable(row));
    const total: ImportResult = { created: 0, dupes: 0, errors: 0, assigned: 0, others: 0 };
    try {
      for (let start = 0; start < rows.length; start += BATCH) {
        setProgress(`${start} / ${rows.length}`);
        const outcome = await importRows(rows.slice(start, start + BATCH), source);
        total.created += outcome.created;
        total.dupes += outcome.dupes;
        total.errors += outcome.errors;
        total.assigned = (total.assigned || 0) + (outcome.assigned || 0);
        total.others = (total.others || 0) + (outcome.others || 0);
      }
    } catch (error) {
      setParseError(`${error instanceof Error ? error.message : 'تعذّر الرفع'} — اللي اترفع قبل كده اتسجل، وإعادة الرفع مش هتكرره`);
    } finally {
      setResult(total);
      setProgress('');
      setImporting(false);
    }
    if (total.created + (total.assigned || 0) > 0) await onImported?.(total.created);
  };

  const withIssues = parsed.filter(row => row._issues.length).length;
  const editingTab = editing !== null ? tabs[editing] : null;
  const width = editingTab ? Math.max(0, ...editingTab.tab.rows.slice(0, 20).map(row => row.length)) : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-bold text-gray-600 mb-1 block">مصدر البيانات</label>
          <input
            value={source}
            onChange={event => setSource(event.target.value)}
            placeholder="مثال: داتا 2024"
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm w-48"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-600 mb-1 block">ملف Excel أو CSV</label>
          <input
            type="file"
            accept=".xlsx,.xlsm,.csv,.tsv,.txt"
            onChange={event => { void onFile(event); }}
            className={`text-sm text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold cursor-pointer ${fileCls}`}
          />
        </div>
        {loadSheetCsv && (
          <div className="flex min-w-[260px] flex-1 items-end gap-2">
            <div className="flex-1">
              <label className="text-xs font-bold text-gray-600 mb-1 block">أو رابط جوجل شيت</label>
              <input value={sheetLink} onChange={event => setSheetLink(event.target.value)} dir="ltr"
                placeholder="https://docs.google.com/spreadsheets/d/…" className="border border-gray-200 rounded-xl px-3 py-2 text-sm w-full" />
            </div>
            <button type="button" onClick={() => { void onSheet(); }} disabled={loadingSheet || !sheetLink.trim()}
              className={`px-4 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-50 ${btnCls}`}>
              {loadingSheet ? 'جاري السحب…' : 'سحب الشيت'}
            </button>
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 leading-5">
        بيقرا كل تابات ملف الـ Excel. الأعمدة بتتعرف من العناوين (أو من اللي فيها لو الشيت من غير عناوين) — راجعها من «الأعمدة».
        الأرقام بتتنضف (الصفر، الأرقام اللي لازقة في بعض، الأرقام التانية)، والمدفوع قبل السيستم = السعر ناقص المتبقي في الشيت.
      </p>

      {parseError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 font-bold leading-6">
          {parseError}
        </div>
      )}

      {tabs.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {tabs.map((entry, index) => (
              <div key={entry.tab.name} className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs ${entry.include ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-gray-50'}`}>
                <label className="flex items-center gap-1.5 font-bold text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={entry.include} className="w-3.5 h-3.5"
                    onChange={event => applyTabs(tabs.map((other, at) => (at === index ? { ...other, include: event.target.checked } : other)))} />
                  {entry.tab.name}
                </label>
                <span className="text-gray-400">{entry.tab.rows.length} صف</span>
                {entry.layout.guessed && <span className="text-amber-600 font-bold">من غير عناوين</span>}
                <button type="button" onClick={() => setEditing(editing === index ? null : index)} className="text-indigo-600 font-bold hover:underline">
                  الأعمدة
                </button>
              </div>
            ))}
          </div>
          {editingTab && editing !== null && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="mb-2 text-xs font-bold text-gray-600">
                أعمدة «{editingTab.tab.name}»{editingTab.layout.guessed ? ' — الشيت من غير صف عناوين، الأعمدة اتخمنت من اللي فيها: راجعها' : ''}
              </p>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {SHEET_FIELDS.filter(field => showAttendanceCol || field.key !== 'attendance').map(field => (
                  <label key={field.key} className="block text-[11px] font-bold text-gray-500">
                    {field.label}
                    <select value={editingTab.layout.columns[field.key] ?? ''} onChange={event => setColumn(editing, field.key, event.target.value)}
                      className="mt-0.5 w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-normal text-gray-700">
                      <option value="">—</option>
                      {Array.from({ length: width }, (_, column) => (
                        <option key={column} value={column}>{columnLabel(editingTab.tab, editingTab.layout, column)}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {parsed.length > 0 && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm font-bold text-gray-700">
              {parsed.length} صف - محدد: {selected.size}
              {withIssues > 0 && <span className="mr-2 text-amber-700">· {withIssues} فيهم رقم مش سليم</span>}
            </span>
            <div className="flex gap-2">
              <button onClick={() => changeSelection(new Set(parsed.filter(usable).map(row => row._id)))} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-bold">تحديد الكل</button>
              <button onClick={() => changeSelection(new Set())} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-bold">إلغاء الكل</button>
            </div>
          </div>

          <div className="max-h-72 overflow-auto border border-gray-200 rounded-xl">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-right font-bold text-gray-600 w-8">
                    <input
                      type="checkbox"
                      checked={selected.size > 0 && selected.size === parsed.filter(usable).length}
                      onChange={event => changeSelection(event.target.checked ? new Set(parsed.filter(usable).map(row => row._id)) : new Set())}
                      className="w-3.5 h-3.5"
                    />
                  </th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">الصف</th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">التاريخ</th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">الاسم</th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">الموبايل</th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">الكورس</th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">السعر</th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">مدفوع قبل السيستم</th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">المتبقي</th>
                  {showAttendanceCol && <th className="py-2 px-3 text-right font-bold text-gray-600">حضور</th>}
                  <th className="py-2 px-3 text-right font-bold text-gray-600">ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {parsed.slice(0, 200).map(row => {
                  const ok = usable(row);
                  return (
                    <tr key={row._id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${!ok ? 'opacity-50' : ''}`}>
                      <td className="py-1.5 px-3">
                        <input
                          type="checkbox"
                          checked={selected.has(row._id)}
                          disabled={!ok}
                          onChange={event => toggleRow(row._id, event.target.checked)}
                          className="w-3.5 h-3.5"
                        />
                      </td>
                      <td className="py-1.5 px-3 text-gray-400 whitespace-nowrap">{tabs.length > 1 ? `${row._tab} · ` : ''}{row._row}</td>
                      <td className="py-1.5 px-3 text-gray-500 whitespace-nowrap">{row._date || <span className="text-gray-300">-</span>}</td>
                      <td className="py-1.5 px-3 font-bold text-gray-900">{row._name || <span className="text-red-400">مطلوب</span>}</td>
                      <td className="py-1.5 px-3 font-mono text-gray-600" dir="ltr">
                        {row._phone || <span className="text-red-400">مطلوب</span>}
                        {row._otherPhones && <span className="block text-[10px] text-gray-400">{row._otherPhones}</span>}
                      </td>
                      <td className="py-1.5 px-3 text-gray-500 max-w-[140px] truncate">{row._course || <span className="text-gray-300">-</span>}</td>
                      <td className="py-1.5 px-3 text-gray-700">{row._expected || <span className="text-gray-300">-</span>}</td>
                      <td className="py-1.5 px-3 text-emerald-700 font-semibold">{paidBefore(row) || <span className="text-gray-300">-</span>}</td>
                      <td className="py-1.5 px-3 text-red-600 font-semibold">{row._remaining || <span className="text-gray-300">-</span>}</td>
                      {showAttendanceCol && <td className="py-1.5 px-3 text-blue-600">{row._attendance || <span className="text-gray-300">-</span>}</td>}
                      <td className="py-1.5 px-3 max-w-[180px]">
                        {row._issues.map(issue => <span key={issue} className="block text-amber-700">{issue}</span>)}
                        {row._notes && <span className="block text-gray-500 truncate">{row._notes}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {parsed.length > 200 && <p className="text-center py-2 text-xs text-gray-400">عرض أول 200 صف من {parsed.length}</p>}
          </div>

          {confirming ? (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-3">
              <p className="text-sm font-bold text-amber-900">
                سيتم رفع {selected.size} عميل إلى قاعدة البيانات باسم المصدر «{source || '—'}».
              </p>
              <p className="text-xs text-amber-700">
                الرفع يكتب العملاء فورًا ولا يمكن التراجع عنه من هنا. العميل الموجود على السيستم بنفس الرقم مش بيتكرر. راجع الجدول أعلاه قبل التأكيد.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={doImport}
                  className={`flex items-center gap-2 px-5 py-2.5 text-white rounded-xl font-bold text-sm transition ${btnCls}`}
                >
                  تأكيد الرفع ({selected.size})
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="px-5 py-2.5 rounded-xl font-bold text-sm border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 transition"
                >
                  إلغاء
                </button>
              </div>
            </div>
          ) : (
            <button
              disabled={importing || selected.size === 0}
              onClick={() => setConfirming(true)}
              className={`flex items-center gap-2 px-5 py-2.5 text-white rounded-xl font-bold text-sm disabled:opacity-60 transition ${btnCls}`}
            >
              {importing ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> جاري الاستيراد... {progress}</> : <>تأكيد ورفع {selected.size} عميل</>}
            </button>
          )}
        </>
      )}

      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm space-y-1">
          <p className="font-bold text-emerald-800">انتهى الاستيراد</p>
          <p className="text-emerald-700">تم إنشاء: <strong>{result.created}</strong> عميل جديد</p>
          {!!result.assigned && <p className="text-emerald-700">موجودين من غير مسئول واتسجلوا باسمه: <strong>{result.assigned}</strong></p>}
          {result.dupes > 0 && <p className="text-amber-700">مكرر أو موجود على السيستم (متسجلش تاني): <strong>{result.dupes}</strong></p>}
          {!!result.others && <p className="text-amber-700">موجودين مع مسئول تحصيل تاني (متنقلوش): <strong>{result.others}</strong></p>}
          {result.errors > 0 && <p className="text-red-700">أخطاء: <strong>{result.errors}</strong></p>}
        </div>
      )}
    </div>
  );
}
