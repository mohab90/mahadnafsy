import { useRef, useState, type ChangeEvent } from 'react';
import { Upload } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { NotifyFn } from '../CrmSettingsModal';
import { parseCsvRows, detectCsvDelimiter } from '../../../../../shared/csv';

export function CsvImportButton({ notify, onImported }: {
  notify: NotifyFn;
  onImported: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      // Not a line split: a note with a comma in it is one field, and a note
      // with a newline in it is still one row. parseCsvRows reads what this
      // system's own exports write.
      const text = await file.text();
      const [headerRow, ...body] = parseCsvRows(text, detectCsvDelimiter(text.split(/\r?\n/)[0] || ''));
      if (!headerRow || body.length === 0) throw new Error('الملف فارغ أو لا يحتوي بيانات');
      const headers = headerRow.map(header => header.trim().toLowerCase().replace(/'/g, ''));
      const leads = body.map(values => {
        const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
        return {
          name: row.name || row['الاسم'] || row['اسم'] || '',
          phone: row.phone || row['هاتف'] || row['رقم الهاتف'] || row.mobile || '',
          email: row.email || row['بريد'] || '',
          source: row.source || row['المصدر'] || 'استيراد CSV',
          notes: row.notes || row['ملاحظات'] || '',
        };
      }).filter(lead => lead.name && lead.phone);
      if (!leads.length) throw new Error('لم يتم العثور على أعمدة name/phone');
      const result = await mysqlAdmin.importLeads(leads);
      notify('success', `تم استيراد ${result.imported} ليد · تخطي: ${result.skipped}`);
      onImported();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل الاستيراد');
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition disabled:opacity-60"
      >
        {loading
          ? <span className="w-4 h-4 border-2 border-indigo-400 border-t-indigo-700 rounded-full animate-spin" />
          : <Upload size={15} />}
        استيراد CSV
      </button>
    </>
  );
}
