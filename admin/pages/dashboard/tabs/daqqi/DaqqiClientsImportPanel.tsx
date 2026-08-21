import { useRef, useState, type ChangeEvent } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Trash2, Upload } from 'lucide-react';
import { useSiteData } from '../../../../context/SiteDataContext';
import type { SubscriberItem } from '../../../../types';
import { parseCsvText } from '../leads/leadCsvUtils';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Props {
  subscribers: SubscriberItem[];
  notify: NotifyFn;
}

type RowVerdict = 'ready' | 'duplicate' | 'invalid';

interface StagedRow {
  key: string;
  line: number;
  name: string;
  phone: string;
  email: string;
  verdict: RowVerdict;
  reason: string;
}

const digitsOnly = (value: string) => value.replace(/\D/g, '');

const columnValue = (row: Record<string, string>, mapping: Record<string, string>, field: string) => {
  const column = Object.entries(mapping).find(([, mapped]) => mapped === field)?.[0];
  return column ? (row[column] || '').trim() : '';
};

// Reads the file into a reviewable list and stops there. Deliberately does no
// network call: the desk sees every row and what would happen to it before
// anything is written, which is the difference from the leads CSV button that
// posts the moment a file is picked.
const stageRows = (text: string, existing: SubscriberItem[]): StagedRow[] => {
  const parsed = parseCsvText(text.replace(/^﻿/, ''));
  if (!parsed || !parsed.rows.length) throw new Error('الملف فارغ أو لا يحتوي على صفوف بيانات.');
  const mapped = Object.values(parsed.autoMap);
  if (!mapped.includes('name') || !mapped.includes('phone')) {
    throw new Error('الملف لا يحتوي على عمودي الاسم والهاتف.');
  }
  const takenPhones = new Set(existing.map(item => digitsOnly(item.phone || '')).filter(phone => phone.length >= 7));
  const takenEmails = new Set(existing.map(item => (item.email || '').toLowerCase().trim()).filter(Boolean));
  const seenPhones = new Set<string>();

  return parsed.rows.map((row, index) => {
    const name = columnValue(row, parsed.autoMap, 'name');
    const phone = columnValue(row, parsed.autoMap, 'phone');
    const email = columnValue(row, parsed.autoMap, 'email');
    const normalizedPhone = digitsOnly(phone);
    // line is the spreadsheet row number: +1 for the header, +1 for 1-based rows.
    const base = { key: `row-${index}`, line: index + 2, name, phone, email };
    if (!name || normalizedPhone.length < 7) {
      return { ...base, verdict: 'invalid' as const, reason: name ? 'رقم هاتف غير صالح' : 'بدون اسم' };
    }
    if (takenPhones.has(normalizedPhone) || (email && takenEmails.has(email.toLowerCase()))) {
      return { ...base, verdict: 'duplicate' as const, reason: 'موجود بالفعل' };
    }
    if (seenPhones.has(normalizedPhone)) {
      return { ...base, verdict: 'duplicate' as const, reason: 'مكرر داخل الملف' };
    }
    seenPhones.add(normalizedPhone);
    return { ...base, verdict: 'ready' as const, reason: '' };
  });
};

const verdictStyles: Record<RowVerdict, string> = {
  ready: 'bg-emerald-50 text-emerald-700',
  duplicate: 'bg-amber-50 text-amber-700',
  invalid: 'bg-red-50 text-red-600',
};
const verdictLabels: Record<RowVerdict, string> = {
  ready: 'جاهز',
  duplicate: 'مكرر — يتخطى',
  invalid: 'غير صالح — يتخطى',
};

export function DaqqiClientsImportPanel({ subscribers, notify }: Props) {
  const { addSubscriber } = useSiteData();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<StagedRow[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ added: number; failed: number } | null>(null);

  const readyRows = (rows || []).filter(row => row.verdict === 'ready');
  const duplicateCount = (rows || []).filter(row => row.verdict === 'duplicate').length;
  const invalidCount = (rows || []).filter(row => row.verdict === 'invalid').length;

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    setResult(null);
    try {
      const staged = stageRows(await file.text(), subscribers);
      setRows(staged);
      setFileName(file.name);
      notify('info', `تمت قراءة ${staged.length} صف — راجعها ثم اضغط «تأكيد ورفع».`);
    } catch (error) {
      setRows(null);
      setFileName('');
      notify('error', error instanceof Error ? error.message : 'تعذر قراءة الملف.');
    }
  };

  const discard = () => {
    setRows(null);
    setFileName('');
    setResult(null);
  };

  const confirmUpload = async () => {
    if (uploading || !readyRows.length) return;
    setUploading(true);
    setProgress(0);
    const createdAt = new Date().toISOString().slice(0, 10);
    let added = 0;
    let failed = 0;
    for (const row of readyRows) {
      const subscriber: SubscriberItem = {
        id: `daqqi-import-${Date.now()}-${row.key}`,
        name: row.name,
        phone: row.phone,
        email: row.email,
        branch: 'daqqi',
        status: 'active',
        enrolledCourseIds: [],
        paymentHistory: [],
        createdAt,
        clientCode: '',
      };
      try {
        if (await addSubscriber(subscriber)) added += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
      setProgress(added + failed);
    }
    setUploading(false);
    setRows(null);
    setFileName('');
    setResult({ added, failed });
    notify(failed ? 'error' : 'success', `تم رفع ${added} عميل${failed ? ` · فشل ${failed}` : ''}.`);
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-gray-600 leading-6">
          <div className="font-bold text-gray-800 text-sm mb-1">استيراد عملاء الدقي من ملف CSV</div>
          الأعمدة المطلوبة: <span className="font-bold">الاسم</span> و<span className="font-bold">الهاتف</span>، والبريد اختياري.
          <br />لا يُرفع أي صف قبل الضغط على «تأكيد ورفع».
        </div>
        <div className="flex items-center gap-2">
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          <button onClick={() => inputRef.current?.click()} disabled={uploading}
            className="flex items-center gap-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-2 rounded-xl text-xs font-bold hover:bg-indigo-100 transition disabled:opacity-60">
            <FileSpreadsheet size={14} /> اختيار ملف
          </button>
        </div>
      </div>

      {fileName && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-gray-200 rounded-xl px-3 py-2.5 bg-gray-50/70">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-gray-700">{fileName}</span>
            <span className="px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 font-bold">جاهز: {readyRows.length}</span>
            {duplicateCount > 0 && <span className="px-2 py-0.5 rounded-lg bg-amber-50 text-amber-700 font-bold">مكرر: {duplicateCount}</span>}
            {invalidCount > 0 && <span className="px-2 py-0.5 rounded-lg bg-red-50 text-red-600 font-bold">غير صالح: {invalidCount}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={discard} disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-gray-200 text-gray-600 hover:bg-white transition disabled:opacity-60">
              <Trash2 size={13} /> إلغاء
            </button>
            <button onClick={() => void confirmUpload()} disabled={uploading || !readyRows.length}
              className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-2 rounded-xl text-xs font-bold hover:bg-green-700 transition disabled:opacity-50">
              {uploading
                ? <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : <Upload size={13} />}
              {uploading ? `جارٍ الرفع ${progress}/${readyRows.length}` : `تأكيد ورفع (${readyRows.length})`}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className={`flex items-center gap-2 text-xs font-bold rounded-xl px-3 py-2.5 border ${
          result.failed ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {result.failed ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
          تمت إضافة {result.added} عميل{result.failed ? ` · تعذّر رفع ${result.failed}` : ''}.
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded-xl max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs min-w-[560px] border-collapse">
            <thead className="bg-gray-50 text-gray-600 sticky top-0">
              <tr>{['#', 'الاسم', 'الهاتف', 'البريد', 'الحالة'].map(label =>
                <th key={label} className="text-right px-2 py-2 border border-gray-200 font-semibold">{label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key} className="hover:bg-gray-50/80">
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-400">{row.line}</td>
                  <td className="px-2 py-1.5 border border-gray-200 font-bold text-gray-800">{row.name || '—'}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-blue-600 font-semibold">{row.phone || '—'}</td>
                  <td className="px-2 py-1.5 border border-gray-200 text-gray-500">{row.email || '—'}</td>
                  <td className="px-2 py-1.5 border border-gray-200">
                    <span className={`px-2 py-0.5 rounded-lg font-bold ${verdictStyles[row.verdict]}`}>
                      {row.reason || verdictLabels[row.verdict]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!fileName && !result && (
        <div className="py-10 text-center text-gray-400 text-sm border border-dashed border-gray-300 rounded-xl">
          اختر ملف CSV لعرض محتواه قبل الرفع.
        </div>
      )}
    </div>
  );
}
