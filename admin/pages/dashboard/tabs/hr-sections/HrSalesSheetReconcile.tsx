import React, { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { mysqlAdmin, type SalesSheetReport, type SheetCategory } from '../../../../lib/mysqlapi';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;

const n = (value: number | null | undefined) => (value == null ? '—' : Number(value).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2 }));
const LABEL: Record<SheetCategory, string> = {
  MATCHED: 'مطابق', DIFFERENT: 'مختلف', REFUNDED: 'اتعمله استرداد', VOIDED: 'دفعته اتمسحت', NO_PAID_BOOKING: 'مسجل بدون حجز مدفوع',
  NOT_REGISTERED: 'مش مسجل في السيستم', OTHER_REP: 'باسم سيلز تاني',
};
const TONE: Record<SheetCategory, string> = {
  MATCHED: 'bg-emerald-50 text-emerald-700', DIFFERENT: 'bg-amber-50 text-amber-700', REFUNDED: 'bg-rose-50 text-rose-700', VOIDED: 'bg-rose-50 text-rose-700',
  NO_PAID_BOOKING: 'bg-orange-50 text-orange-700', NOT_REGISTERED: 'bg-gray-100 text-gray-700', OTHER_REP: 'bg-indigo-50 text-indigo-700',
};

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

const diffText = (row: SalesSheetReport['rows'][number]) => row.diffs.map(diff => {
  if (diff.field === 'rep') return `السيلز: الشيت ${String(diff.sheet)} · السيستم ${diff.system == null ? 'مفيش' : String(diff.system)}`;
  if (diff.field === 'price') return `السعر: الشيت ${n(diff.sheet as number)} · السيستم ${n(diff.system as number)}`;
  return `${diff.field === 'course' ? 'الكورس' : 'التاريخ'}: الشيت ${String(diff.sheet ?? '—')} · السيستم ${String(diff.system ?? '—')}`;
}).join(' ؛ ');

/**
 * «مطابقة شيت المبيعات»: the owner's monthly sales target sheet (.xlsx, one tab per rep) held against the system, row by row, with the target system applied to both
 * (api/lib/salesSheetReconcile.js). It reads only; nothing is saved. The Markdown report and the CSV are downloads.
 */
export default function HrSalesSheetReconcile({ notify, defaultMonth }: { notify: Notify; defaultMonth: string }) {
  const [month, setMonth] = useState(defaultMonth);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ report: SalesSheetReport; markdown: string; csv: string } | null>(null);
  const [show, setShow] = useState<SheetCategory | 'MISSING' | null>(null);
  // «اعتمد تقسيم الشيت»: the reps whose second-round day is being confirmed (one, or all), with the reason the owner can edit.
  const [approving, setApproving] = useState<{ staffIds: string[]; reason: string } | null>(null);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fileBase64 = await fileToBase64(file);
      const result = await mysqlAdmin.reconcileSalesSheet({ fileBase64, filename: file.name, month });
      setAnswer({ report: result.report, markdown: result.markdown, csv: result.csv });
      setShow(null);
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّرت المطابقة'); } finally { setBusy(false); }
  };

  const report = answer?.report;
  const splittable = (report?.perRep ?? []).filter(rep => rep.staff?.scheme === 'SALES_BOOKINGS' && rep.suggestedSplit.day != null);
  const approve = async () => {
    if (!report || !approving) return;
    const splits = splittable.filter(rep => approving.staffIds.includes(rep.staff!.id)).map(rep => ({ staffId: rep.staff!.id, day: rep.suggestedSplit.day as number }));
    setBusy(true);
    try {
      await mysqlAdmin.saveRoundSplits({ month: report.month, reason: approving.reason.trim(), splits });
      notify('success', `اتسجّل تقسيم ${splits.length} سيلز: الروند التاني من اليوم اللي في الشيت. احسب الشهر تاني من «حساب مكافآت الشهر».`);
      setApproving(null);
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر تسجيل التقسيم'); } finally { setBusy(false); }
  };
  const shownRows = report && show && show !== 'MISSING' ? report.rows.filter(row => row.category === show) : [];
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-extrabold text-gray-900"><FileSpreadsheet size={16} className="text-emerald-600" /> مطابقة شيت المبيعات</h3>
      <p className="mb-3 text-xs text-gray-500">
        ارفع شيت التارجيت (Excel، كل سيلز في تاب). السيستم بيطابق كل صف مع العميل وحجزه (مطابق / مختلف / استرداد / مش مسجل / باسم سيلز تاني)، ويطبّق نظام التارجيت على الشيت وعلى السيستم جنب بعض. قراءة بس: مفيش حاجة بتتغيّر.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" dir="ltr" value={month} onChange={e => setMonth(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
        <input type="file" accept=".xlsx" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
        <button type="button" onClick={run} disabled={!file || busy} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
          {busy && <Loader2 size={14} className="animate-spin" />} {busy ? 'بيطابق…' : 'طابق'}
        </button>
      </div>

      {report && answer && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {(Object.keys(LABEL) as SheetCategory[]).map(category => (
              <button key={category} type="button" onClick={() => setShow(show === category ? null : category)}
                className={`rounded-full px-3 py-1 font-bold ${TONE[category]} ${show === category ? 'ring-2 ring-gray-400' : ''}`}>
                {LABEL[category]} {n(report.totals[category])}
              </button>
            ))}
            <button type="button" onClick={() => setShow(show === 'MISSING' ? null : 'MISSING')}
              className={`rounded-full bg-sky-50 px-3 py-1 font-bold text-sky-700 ${show === 'MISSING' ? 'ring-2 ring-gray-400' : ''}`}>في السيستم ومش في الشيت {n(report.totals.missingFromSheet)}</button>
            {report.unreadable.length > 0 && <span className="rounded-full bg-gray-100 px-3 py-1 font-bold text-gray-700">صفوف ما اتقراتش {n(report.unreadable.length)}</span>}
            <span className="flex-1" />
            <button type="button" onClick={() => download(`مطابقة-شيت-المبيعات-${report.month}.md`, answer.markdown, 'text/markdown;charset=utf-8')} className="rounded-lg border border-gray-200 px-3 py-1 font-bold">تقرير (md)</button>
            <button type="button" onClick={() => download(`مطابقة-شيت-المبيعات-${report.month}.csv`, answer.csv, 'text/csv;charset=utf-8')} className="rounded-lg border border-gray-200 px-3 py-1 font-bold">Excel (csv)</button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr><th className="p-2 text-right">التاب</th><th className="p-2 text-right">الموظف</th><th className="p-2 text-right">صفوف</th><th className="p-2 text-right">مطابق</th><th className="p-2 text-right">مختلف</th>
                  <th className="p-2 text-right">استرداد / ممسوح</th><th className="p-2 text-right">مش مسجل / بدون حجز</th><th className="p-2 text-right">سيلز تاني</th>
                  <th className="p-2 text-right">مكافأة الشيت</th><th className="p-2 text-right">مكافأة السيستم</th><th className="p-2 text-right">الفرق</th></tr>
              </thead>
              <tbody>
                {report.perRep.map(rep => (
                  <React.Fragment key={rep.tab}>
                    <tr className="border-t border-gray-100">
                      <td className="p-2 font-bold">{rep.tab}</td>
                      <td className="p-2 text-xs">{rep.staff ? `${rep.staff.name} (أول تارجيت ${rep.staff.firstTarget ?? 'غير محدد'})` : <span className="text-rose-600">مفيش موظف بالاسم ده</span>}</td>
                      <td className="p-2">{n(rep.rows)} <span className="text-[11px] text-gray-400">({n(rep.rowsByRound['1'])} / {n(rep.rowsByRound['2'])})</span></td>
                      <td className="p-2">{n(rep.counts.MATCHED)}</td><td className="p-2">{n(rep.counts.DIFFERENT)}</td><td className="p-2">{n(rep.counts.REFUNDED + rep.counts.VOIDED)}</td>
                      <td className="p-2">{n(rep.counts.NOT_REGISTERED + rep.counts.NO_PAID_BOOKING)}</td><td className="p-2">{n(rep.counts.OTHER_REP)}</td>
                      <td className="p-2 font-bold">{n(rep.sheet.byMarker.amount)} <span className="text-[11px] font-normal text-gray-400">({n(rep.sheet.byMarker.bookings)} حجز)</span></td>
                      <td className="p-2 font-bold">{rep.system ? <>{n(rep.system.amount)} <span className="text-[11px] font-normal text-gray-400">({n(rep.system.bookings)} حجز)</span></> : '—'}</td>
                      <td className={`p-2 font-extrabold ${rep.difference ? 'text-rose-600' : 'text-emerald-700'}`}>{rep.difference == null ? '—' : n(rep.difference)}</td>
                    </tr>
                    <tr><td colSpan={11} className="px-3 py-1.5 text-[11px] text-gray-700">
                      {rep.suggestedSplit.day != null ? <>تقسيم الشيت المقترح: الروند التاني من يوم <b>{rep.suggestedSplit.day}</b></> : <>تقسيم الشيت: {rep.suggestedSplit.note}</>}
                      {rep.suggestedSplit.day != null && rep.suggestedSplit.note && <span className="mr-2 font-bold text-amber-700">⚠ {rep.suggestedSplit.note}</span>}
                      {rep.suggestedSplit.day != null && rep.staff?.scheme === 'SALES_BOOKINGS' && (
                        <button type="button" disabled={busy} onClick={() => setApproving({ staffIds: [rep.staff!.id], reason: 'من شيت المبيعات' })} className="mr-3 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700 disabled:opacity-40">اعتمد تقسيم الشيت</button>
                      )}
                      {rep.suggestedSplit.day != null && rep.staff && rep.staff.scheme !== 'SALES_BOOKINGS' && <span className="mr-3 text-gray-400">(الموظف مش على نظام «حجوزات (سيلز)»)</span>}
                    </td></tr>
                    {rep.reasons.length > 0 && (
                      <tr><td colSpan={11} className="bg-gray-50 px-3 py-1.5 text-[11px] text-gray-600">
                        سبب الفرق: {rep.reasons.map(reason => `${reason.label}: ${reason.rows} صف${reason.weight ? ` (${reason.weight > 0 ? '+' : ''}${n(reason.weight)} حجز)` : ''}`).join(' · ')}
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            {report.tabs.some(tab => !tab.staff) && (
              <p className="mt-2 text-xs text-rose-700">تابات ما اتطابقتش مع موظف: {report.tabs.filter(tab => !tab.staff).map(tab => `${tab.tab}${tab.ambiguous.length ? ` (بيطابق: ${tab.ambiguous.join('، ')})` : ''}`).join('، ')}</p>
            )}
          </div>

          {splittable.length > 1 && !approving && (
            <button type="button" disabled={busy} onClick={() => setApproving({ staffIds: splittable.map(rep => rep.staff!.id), reason: 'من شيت المبيعات' })} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 disabled:opacity-40">اعتمد تقسيم الشيت للكل ({splittable.length})</button>
          )}
          {approving && (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
              <div className="font-extrabold text-amber-900">
                تسجيل بداية الروند التاني: {splittable.filter(rep => approving.staffIds.includes(rep.staff!.id)).map(rep => `${rep.staff!.name} يوم ${rep.suggestedSplit.day}`).join('، ')}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input value={approving.reason} onChange={e => setApproving({ ...approving, reason: e.target.value })} placeholder="السبب (مطلوب)" maxLength={500} className="min-w-[14rem] flex-1 rounded-lg border border-gray-200 px-2 py-1" />
                <button type="button" onClick={approve} disabled={busy || approving.reason.trim().length < 3} className="rounded-lg bg-amber-600 px-3 py-1 font-bold text-white disabled:opacity-40">تأكيد</button>
                <button type="button" onClick={() => setApproving(null)} className="rounded-lg border border-gray-200 bg-white px-3 py-1 font-bold">رجوع</button>
              </div>
            </div>
          )}

          {show && show !== 'MISSING' && (
            <div className="max-h-96 overflow-auto rounded-xl border border-gray-100">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 text-gray-500"><tr><th className="p-1.5 text-right">التاب / صف</th><th className="p-1.5 text-right">العميل</th><th className="p-1.5 text-right">الكورس</th><th className="p-1.5 text-right">التاريخ</th><th className="p-1.5 text-right">سعر الشيت</th><th className="p-1.5 text-right">التفاصيل</th></tr></thead>
                <tbody>
                  {shownRows.map(row => (
                    <tr key={`${row.tab}-${row.rowNumber}`} className="border-t border-gray-100 align-top">
                      <td className="p-1.5">{row.tab} · {row.rowNumber}</td>
                      <td className="p-1.5">{row.name}<div className="text-gray-400" dir="ltr">{row.phones[0]}</div></td>
                      <td className="p-1.5">{row.course}</td><td className="p-1.5" dir="ltr">{row.day || '—'}</td><td className="p-1.5">{n(row.price)}</td>
                      <td className="p-1.5 text-gray-700">{[diffText(row), ...row.notes].filter(Boolean).join(' ؛ ') || (row.client ? `كود ${row.client.code}` : '')}</td>
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
                <thead className="sticky top-0 bg-gray-50 text-gray-500"><tr><th className="p-1.5 text-right">السيلز في السيستم</th><th className="p-1.5 text-right">العميل</th><th className="p-1.5 text-right">الكورس</th><th className="p-1.5 text-right">التاريخ</th><th className="p-1.5 text-right">السعر بالمصري</th></tr></thead>
                <tbody>
                  {report.missingFromSheet.map((item, index) => (
                    <tr key={index} className="border-t border-gray-100">
                      <td className="p-1.5">{item.owner ? item.owner.name : 'مفيش سيلز'}{item.owner && !item.ownerHasTab && <span className="text-gray-400"> (مالوش تاب)</span>}</td>
                      <td className="p-1.5">{item.client} {item.clientCode && <span className="text-gray-400">({item.clientCode})</span>}</td>
                      <td className="p-1.5">{item.item}</td><td className="p-1.5" dir="ltr">{item.day}</td><td className="p-1.5">{n(item.priceEgp)}</td>
                    </tr>
                  ))}
                  {report.missingFromSheet.length === 0 && <tr><td colSpan={5} className="p-3 text-center text-gray-400">كل حجوزات الشهر في الشيت</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
