import React, { useState } from 'react';

export type OldDataRow = {
  _id: string;
  _name: string;
  _phone: string;
  _email: string;
  _notes: string;
  _course: string;
  _paid: string;
  _expected: string;
  _cert: string;
  _attendance: string;
};

type OldDataImportPanelProps = {
  defaultSource: string;
  accent?: 'indigo' | 'violet';
  showAttendanceCol?: boolean;
  importRow: (row: OldDataRow, source: string) => Promise<void>;
  onImported?: (created: number) => void | Promise<void>;
};

const supportedColumns = [
  ['name / الاسم', 'phone / هاتف', 'email'],
  ['course / كورس', 'paid / مدفوع', 'expected / متوقع'],
  ['cert / شهادة', 'attendance / حضور', 'notes / ملاحظات'],
];

const normalizeCell = (value: string | undefined) => (value || '').replace(/^"|"$/g, '').trim();

const findColumn = (headers: string[], ...keys: string[]) =>
  headers.findIndex(header => keys.some(key => header.includes(key)));

function parseOldData(text: string): OldDataRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const separator = lines[0]?.includes('\t') ? '\t' : ',';
  const headers = (lines[0] || '').split(separator).map(header => normalizeCell(header).toLowerCase());
  const nameCol = findColumn(headers, 'name', 'اسم');
  const phoneCol = findColumn(headers, 'phone', 'هاتف');
  const emailCol = findColumn(headers, 'email', 'إيميل', 'ايميل');
  const notesCol = findColumn(headers, 'note', 'ملاحظ');
  const courseCol = findColumn(headers, 'course', 'كورس');
  const paidCol = findColumn(headers, 'paid', 'مدفوع');
  const expectedCol = findColumn(headers, 'expected', 'متوقع');
  const certCol = findColumn(headers, 'cert', 'شهاد');
  const attendanceCol = findColumn(headers, 'attend', 'حضور');

  return lines.slice(1)
    .map((line, index) => {
      const cols = line.split(separator).map(normalizeCell);
      return {
        _id: `r${index}`,
        _name: cols[nameCol] || '',
        _phone: cols[phoneCol] || '',
        _email: cols[emailCol] || '',
        _notes: cols[notesCol] || '',
        _course: cols[courseCol] || '',
        _paid: cols[paidCol] || '',
        _expected: cols[expectedCol] || '',
        _cert: cols[certCol] || '',
        _attendance: cols[attendanceCol] || '',
      };
    })
    .filter(row => row._name || row._phone);
}

export default function OldDataImportPanel({
  defaultSource,
  accent = 'indigo',
  showAttendanceCol = false,
  importRow,
  onImported,
}: OldDataImportPanelProps) {
  const [source, setSource] = useState(defaultSource);
  const [parsed, setParsed] = useState<OldDataRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; dupes: number; errors: number } | null>(null);

  const fileCls = accent === 'violet'
    ? 'file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100'
    : 'file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100';
  const btnCls = accent === 'violet' ? 'bg-violet-600 hover:bg-violet-700' : 'bg-indigo-600 hover:bg-indigo-700';

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = loaded => {
      const rows = parseOldData(String(loaded.target?.result || ''));
      setParsed(rows);
      setSelected(new Set(rows.filter(row => row._name && row._phone).map(row => row._id)));
      setResult(null);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const toggleRow = (rowId: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  };

  const doImport = async () => {
    setImporting(true);
    let created = 0;
    let dupes = 0;
    let errors = 0;
    const rows = parsed.filter(row => selected.has(row._id) && row._name && row._phone);
    for (const row of rows) {
      try {
        await importRow(row, source);
        created++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('duplicate') || message.includes('مكرر')) dupes++;
        else errors++;
      }
    }
    setImporting(false);
    setResult({ created, dupes, errors });
    if (created > 0) await onImported?.(created);
  };

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
          <label className="text-xs font-bold text-gray-600 mb-1 block">ملف CSV أو TSV</label>
          <input
            type="file"
            accept=".csv,.tsv,.txt"
            onChange={onFile}
            className={`text-sm text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold cursor-pointer ${fileCls}`}
          />
        </div>
      </div>

      <div className="text-[11px] text-gray-400 space-y-1">
        <span>الأعمدة المدعومة:</span>
        {supportedColumns.map((group, index) => (
          <div key={index} className="flex flex-wrap gap-1">
            {group.map(column => (
              <code key={column} className="bg-gray-100 px-1 rounded">{column}</code>
            ))}
          </div>
        ))}
      </div>

      {parsed.length > 0 && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm font-bold text-gray-700">{parsed.length} صف - محدد: {selected.size}</span>
            <div className="flex gap-2">
              <button onClick={() => setSelected(new Set(parsed.map(row => row._id)))} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-bold">تحديد الكل</button>
              <button onClick={() => setSelected(new Set())} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-bold">إلغاء الكل</button>
            </div>
          </div>

          <div className="max-h-64 overflow-auto border border-gray-200 rounded-xl">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-right font-bold text-gray-600 w-8">
                    <input
                      type="checkbox"
                      checked={selected.size === parsed.length}
                      onChange={event => setSelected(event.target.checked ? new Set(parsed.map(row => row._id)) : new Set())}
                      className="w-3.5 h-3.5"
                    />
                  </th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">الاسم</th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">الهاتف</th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">الكورس</th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">مدفوع</th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">متوقع</th>
                  <th className="py-2 px-3 text-right font-bold text-gray-600">شهادة</th>
                  {showAttendanceCol && <th className="py-2 px-3 text-right font-bold text-gray-600">حضور</th>}
                  <th className="py-2 px-3 text-right font-bold text-gray-600">ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {parsed.slice(0, 200).map(row => {
                  const ok = !!(row._name && row._phone);
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
                      <td className="py-1.5 px-3 font-bold text-gray-900">{row._name || <span className="text-red-400">مطلوب</span>}</td>
                      <td className="py-1.5 px-3 font-mono text-gray-600">{row._phone || <span className="text-red-400">مطلوب</span>}</td>
                      <td className="py-1.5 px-3 text-gray-500 max-w-[120px] truncate">{row._course || <span className="text-gray-300">-</span>}</td>
                      <td className="py-1.5 px-3 text-emerald-700 font-semibold">{row._paid || <span className="text-gray-300">-</span>}</td>
                      <td className="py-1.5 px-3 text-gray-500">{row._expected || <span className="text-gray-300">-</span>}</td>
                      <td className="py-1.5 px-3 text-amber-700">{row._cert || <span className="text-gray-300">-</span>}</td>
                      {showAttendanceCol && <td className="py-1.5 px-3 text-blue-600">{row._attendance || <span className="text-gray-300">-</span>}</td>}
                      <td className="py-1.5 px-3 text-gray-500 max-w-[100px] truncate">{row._notes || <span className="text-gray-300">-</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {parsed.length > 200 && <p className="text-center py-2 text-xs text-gray-400">عرض أول 200 صف من {parsed.length}</p>}
          </div>

          <button
            disabled={importing || selected.size === 0}
            onClick={doImport}
            className={`flex items-center gap-2 px-5 py-2.5 text-white rounded-xl font-bold text-sm disabled:opacity-60 transition ${btnCls}`}
          >
            {importing ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> جاري الاستيراد...</> : <>استيراد {selected.size} عميل</>}
          </button>
        </>
      )}

      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm space-y-1">
          <p className="font-bold text-emerald-800">انتهى الاستيراد</p>
          <p className="text-emerald-700">تم إنشاء: <strong>{result.created}</strong> عميل جديد</p>
          {result.dupes > 0 && <p className="text-amber-700">مكرر تم تجاهله: <strong>{result.dupes}</strong></p>}
          {result.errors > 0 && <p className="text-red-700">أخطاء: <strong>{result.errors}</strong></p>}
        </div>
      )}
    </div>
  );
}
