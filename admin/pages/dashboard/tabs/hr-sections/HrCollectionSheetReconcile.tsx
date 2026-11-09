import React, { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { mysqlAdmin, type CollectionCategory, type CollectionSheetReport } from '../../../../lib/mysqlapi';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;

const n = (value: number | null | undefined) => (value == null ? '—' : Number(value).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 }));
const LABEL: Record<CollectionCategory, string> = {
  FOUND_SAME: 'موجودة بنفس الموظف', OTHER_EMPLOYEE: 'باسم موظف تاني', TYPE_MISMATCH: 'النوع مختلف (شهادة ↔ كورس)', DIFFERENT: 'المبلغ أو التاريخ مختلف',
  NOT_IN_SYSTEM: 'مش في السيستم', UNPAID_IN_SYSTEM: 'في السيستم بس فاشلة/معلّقة', NOT_REGISTERED: 'العميل مش مسجل',
};
const TONE: Record<CollectionCategory, string> = {
  FOUND_SAME: 'bg-emerald-50 text-emerald-700', OTHER_EMPLOYEE: 'bg-indigo-50 text-indigo-700', TYPE_MISMATCH: 'bg-amber-50 text-amber-700',
  DIFFERENT: 'bg-amber-50 text-amber-700', NOT_IN_SYSTEM: 'bg-rose-50 text-rose-700', UNPAID_IN_SYSTEM: 'bg-orange-50 text-orange-700', NOT_REGISTERED: 'bg-gray-100 text-gray-700',
};
const TYPE_AR: Record<string, string> = { COURSE: 'كورس', CERTIFICATE: 'شهادة', CARNEH: 'كارنيه', BOOK: 'كتاب', CONSULTATION: 'استشارة' };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
    reader.readAsDataURL(file);
  });
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  URL.revokeObjectURL(url);
}

const detail = (row: CollectionSheetReport['rows'][number]) => {
  const parts = (row.diffs ?? []).map(diff => (diff.field === 'amount'
    ? `المبلغ: الشيت ${n(diff.sheet as number)} · السيستم ${n(diff.system as number)}`
    : `التاريخ: الشيت ${String(diff.sheet ?? '—')} · السيستم ${String(diff.system ?? '—')}`));
  if (row.category === 'OTHER_EMPLOYEE') parts.push(`السيستم: ${[...new Set(row.payments.map(payment => payment.staff?.name ?? 'بدون موظف'))].join('، ')}`);
  if (row.flags.includes('OTHER_EMPLOYEE') && row.category === 'DIFFERENT') parts.push(`باسم موظف تاني: ${row.payments.map(payment => payment.staff?.name ?? 'بدون موظف').join('، ')}`);
  return [...parts, ...row.notes].join(' ؛ ');
};

/**
 * «مطابقة شيت التحصيل»: the collection employees' monthly sheet (.xlsx, one tab per employee, a row per payment collected) held against the system's payments
 * (api/lib/collectionSheetReconcile.js): is every payment of the sheet in the system, and under the same employee? It reads only; nothing is saved.
 */
export default function HrCollectionSheetReconcile({ notify, defaultMonth }: { notify: Notify; defaultMonth: string }) {
  const [month, setMonth] = useState(defaultMonth);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ report: CollectionSheetReport; markdown: string; csv: string } | null>(null);
  const [show, setShow] = useState<CollectionCategory | 'MISSING' | null>(null);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fileBase64 = await fileToBase64(file);
      const result = await mysqlAdmin.reconcileCollectionSheet({ fileBase64, filename: file.name, month });
      setAnswer({ report: result.report, markdown: result.markdown, csv: result.csv });
      setShow(null);
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّرت المطابقة'); } finally { setBusy(false); }
  };

  const report = answer?.report;
  const shownRows = report && show && show !== 'MISSING' ? report.rows.filter(row => row.category === show) : [];
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-extrabold text-gray-900"><FileSpreadsheet size={16} className="text-sky-600" /> مطابقة شيت التحصيل</h3>
      <p className="mb-3 text-xs text-gray-500">
        ارفع شيت التحصيل (Excel، كل موظف تحصيل في تاب). السيستم بيدوّر على كل دفعة في الشيت عند العميل (بالتليفون ثم الاسم) بنفس المبلغ في حدود 3 أيام، ويقولك: موجودة بنفس الموظف / باسم موظف تاني / النوع مختلف (شهادة ↔ كورس) / المبلغ أو التاريخ مختلف / مش موجودة / العميل مش مسجل، ودفعات السيستم اللي مش في التاب. قراءة بس.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" dir="ltr" value={month} onChange={e => setMonth(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
        <input type="file" accept=".xlsx" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
        <button type="button" onClick={run} disabled={!file || busy} className="flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
          {busy && <Loader2 size={14} className="animate-spin" />} {busy ? 'بيطابق…' : 'طابق'}
        </button>
      </div>

      {report && answer && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {(Object.keys(LABEL) as CollectionCategory[]).map(category => (
              <button key={category} type="button" onClick={() => setShow(show === category ? null : category)}
                className={`rounded-full px-3 py-1 font-bold ${TONE[category]} ${show === category ? 'ring-2 ring-gray-400' : ''}`}>
                {LABEL[category]} {n(report.totals[category])}
              </button>
            ))}
            <button type="button" onClick={() => setShow(show === 'MISSING' ? null : 'MISSING')}
              className={`rounded-full bg-sky-50 px-3 py-1 font-bold text-sky-700 ${show === 'MISSING' ? 'ring-2 ring-gray-400' : ''}`}>في السيستم ومش في التاب {n(report.totals.missingFromSheet)}</button>
            {report.unreadable.length > 0 && <span className="rounded-full bg-gray-100 px-3 py-1 font-bold text-gray-700">صفوف ما اتقراتش {n(report.unreadable.length)}</span>}
            <span className="flex-1" />
            <button type="button" onClick={() => download(`مطابقة-شيت-التحصيل-${report.month}.md`, answer.markdown, 'text/markdown;charset=utf-8')} className="rounded-lg border border-gray-200 px-3 py-1 font-bold">تقرير (md)</button>
            <button type="button" onClick={() => download(`مطابقة-شيت-التحصيل-${report.month}.csv`, answer.csv, 'text/csv;charset=utf-8')} className="rounded-lg border border-gray-200 px-3 py-1 font-bold">Excel (csv)</button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr><th className="p-2 text-right">التاب</th><th className="p-2 text-right">الموظف</th><th className="p-2 text-right">دفعات</th><th className="p-2 text-right">بنفس الموظف</th>
                  <th className="p-2 text-right">موظف تاني</th><th className="p-2 text-right">نوع مختلف</th><th className="p-2 text-right">مبلغ/تاريخ مختلف</th><th className="p-2 text-right">مش في السيستم</th><th className="p-2 text-right">فاشلة/معلّقة</th>
                  <th className="p-2 text-right">مش مسجل</th><th className="p-2 text-right">إجمالي الشيت</th><th className="p-2 text-right">إجمالي السيستم</th><th className="p-2 text-right">الفرق</th></tr>
              </thead>
              <tbody>
                {report.perCollector.map(item => (
                  <React.Fragment key={item.tab}>
                    <tr className="border-t border-gray-100">
                      <td className="p-2 font-bold">{item.tab}</td>
                      <td className="p-2 text-xs">{item.employee ? item.employee.name : <span className="text-rose-600">مفيش موظف بالاسم ده</span>}</td>
                      <td className="p-2">{n(item.rows)}</td><td className="p-2">{n(item.counts.FOUND_SAME)}</td><td className="p-2">{n(item.counts.OTHER_EMPLOYEE)}</td>
                      <td className="p-2">{n(item.counts.TYPE_MISMATCH)}</td><td className="p-2">{n(item.counts.DIFFERENT)}</td><td className="p-2">{n(item.counts.NOT_IN_SYSTEM)}</td><td className="p-2">{n(item.counts.UNPAID_IN_SYSTEM)}</td>
                      <td className="p-2">{n(item.counts.NOT_REGISTERED)}</td>
                      <td className="p-2 font-bold">{n(item.sheetTotal)}</td><td className="p-2 font-bold">{item.employee ? n(item.systemTotal) : '—'}</td>
                      <td className={`p-2 font-extrabold ${item.difference ? 'text-rose-600' : 'text-emerald-700'}`}>{item.difference == null ? '—' : n(item.difference)}</td>
                    </tr>
                    {item.reasons.length > 0 && (
                      <tr><td colSpan={13} className="bg-gray-50 px-3 py-1.5 text-[11px] text-gray-600">
                        تفصيل الفرق: {item.reasons.map(reason => `${reason.label}: ${reason.rows} (${reason.amount > 0 ? '+' : ''}${n(reason.amount)})`).join(' · ')}
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            {report.tabs.some(tab => !tab.employee) && (
              <p className="mt-2 text-xs text-rose-700">تابات ما اتطابقتش مع موظف: {report.tabs.filter(tab => !tab.employee).map(tab => `${tab.tab}${tab.ambiguous.length ? ` (بيطابق: ${tab.ambiguous.join('، ')})` : ''}`).join('، ')}</p>
            )}
          </div>

          {show && show !== 'MISSING' && (
            <div className="max-h-96 overflow-auto rounded-xl border border-gray-100">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 text-gray-500"><tr><th className="p-1.5 text-right">التاب / صف</th><th className="p-1.5 text-right">العميل</th><th className="p-1.5 text-right">النوع</th><th className="p-1.5 text-right">التاريخ</th><th className="p-1.5 text-right">المبلغ</th><th className="p-1.5 text-right">التفاصيل</th></tr></thead>
                <tbody>
                  {shownRows.map(row => (
                    <tr key={`${row.tab}-${row.rowNumber}`} className="border-t border-gray-100 align-top">
                      <td className="p-1.5">{row.tab} · {row.rowNumber}</td>
                      <td className="p-1.5">{row.name}<div className="text-gray-400" dir="ltr">{row.phones[0] ?? row.senderPhones[0]}</div></td>
                      <td className="p-1.5">{row.kinds.map(kind => TYPE_AR[kind] ?? kind).join(' + ')} <span className="text-gray-400">{row.text}</span></td>
                      <td className="p-1.5" dir="ltr">{row.day || '—'}</td><td className="p-1.5">{n(row.amount)}</td>
                      <td className="p-1.5 text-gray-700">{detail(row) || (row.client ? `كود ${row.client.code}` : '')}</td>
                    </tr>
                  ))}
                  {shownRows.length === 0 && <tr><td colSpan={6} className="p-3 text-center text-gray-400">مفيش</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {show === 'MISSING' && (
            <div className="max-h-96 overflow-auto rounded-xl border border-gray-100">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 text-gray-500"><tr><th className="p-1.5 text-right">الموظف</th><th className="p-1.5 text-right">العميل</th><th className="p-1.5 text-right">النوع</th><th className="p-1.5 text-right">التاريخ</th><th className="p-1.5 text-right">المبلغ بالمصري</th><th className="p-1.5 text-right">ملاحظة</th></tr></thead>
                <tbody>
                  {report.missingFromSheet.map((item, index) => (
                    <tr key={index} className="border-t border-gray-100">
                      <td className="p-1.5">{item.employee ? item.employee.name : '—'}{!item.employeeHasTab && <span className="text-gray-400"> (مالوش تاب)</span>}</td>
                      <td className="p-1.5">{item.client} {item.clientCode && <span className="text-gray-400">({item.clientCode})</span>}</td>
                      <td className="p-1.5">{TYPE_AR[item.type] ?? item.type} {item.title && <span className="text-gray-400">{item.title}</span>}</td>
                      <td className="p-1.5" dir="ltr">{item.day}</td><td className="p-1.5">{n(item.amountEgp)}</td>
                      <td className="p-1.5 text-gray-500">{item.claimedByTab ? `موجودة في تاب «${item.claimedByTab}»` : ''}</td>
                    </tr>
                  ))}
                  {report.missingFromSheet.length === 0 && <tr><td colSpan={6} className="p-3 text-center text-gray-400">كل دفعات المحصّلين في التابات</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
