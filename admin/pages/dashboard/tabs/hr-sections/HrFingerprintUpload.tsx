// «رفع شيت البصمة»: a month's export from the fingerprint device, judged under
// the company policy (POST /admin/hr/attendance/import-sheet). The first pass
// is a preview that writes nothing; HR reads it — per employee, and day by day
// for anyone — then records the month.
import { useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type EmployeeSummary = {
  staffId: string; name: string; biometricNo: string | null;
  workDays: number; present: number; absent: number; lateDays: number; deductionDays: number;
  flagged: number; morningPermitsUsed: number; eveningPermitsUsed: number;
};
type Day = {
  date: string; status: string; checkIn: string | null; checkOut: string | null;
  lateMinutes: number; earlyLeaveMinutes: number; permit: string | null; deductionDays: number; flag: string | null;
};
type Report = {
  employees: EmployeeSummary[];
  unmatched: { bioNo: string | null; name: string | null; punches: number }[];
  punchesRead: number; rowsRead: number; skipped: { outsideMonth: number; unreadable: number };
  policy: { start: string; end: string };
  days?: { staffId: string; name: string; days: Day[] }[];
  daysWritten?: number;
};

const STATUS_AR: Record<string, string> = { PRESENT: 'حاضر', LATE: 'متأخر', ABSENT: 'غائب' };
const PERMIT_AR: Record<string, string> = { morning: 'إذن صباحي', evening: 'إذن مسائي' };
const FLAG_AR: Record<string, string> = { missing_check_out: 'بصمة حضور بس', missing_check_in: 'بصمة انصراف بس' };
const permitText = (permit: string | null) => (permit ? permit.split('+').map(p => PERMIT_AR[p] || (p.includes('approved') ? 'إذن معتمد' : p)).join(' + ') : '');
const days = (n: number) => (n === 0 ? '—' : `${n.toLocaleString('ar-EG-u-nu-latn')} يوم`);

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
    reader.readAsDataURL(file);
  });
}

export default function HrFingerprintUpload({ month: initialMonth, notify, onClose, onImported }: {
  month: string; notify: Notify; onClose: () => void; onImported: (month: string) => void;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [openStaff, setOpenStaff] = useState<string | null>(null);

  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(dryRun ? 'preview' : 'apply');
    setError('');
    try {
      const fileBase64 = await fileToBase64(file);
      const result = await mysqlAdmin.adminPost<Report>('/admin/hr/attendance/import-sheet', { fileBase64, filename: file.name, month, dryRun });
      if (dryRun) { setReport(result); setOpenStaff(null); }
      else {
        notify('success', `اتسجل حضور ${result.employees.length} موظف لشهر ${month} (${result.daysWritten} يوم)`);
        onImported(month);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر قراءة الشيت');
    } finally { setBusy(null); }
  };

  const detail = report?.days?.find(d => d.staffId === openStaff);
  return (
    <Modal open onClose={onClose} title="رفع شيت البصمة" icon={<Upload size={16} />} size="xl">
      <div className="space-y-3" dir="rtl">
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <label className="text-xs text-gray-600">الشهر
            <input type="month" value={month} onChange={e => { setMonth(e.target.value); setReport(null); }} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-gray-600">ملف جهاز البصمة (Excel أو CSV أو ملف attlog)
            <input type="file" accept=".xlsx,.csv,.txt,.dat" onChange={e => { setFile(e.target.files?.[0] || null); setReport(null); }}
              className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2 text-sm file:ml-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-indigo-700" />
          </label>
        </div>
        <p className="rounded-xl bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
          السيستم بيطابق كل موظف برقمه على جهاز البصمة (من «الرواتب والبصمة والتارجت»)، وبياخد أول وآخر بصمة في اليوم، وبيحسب التأخير والانصراف بدري والغياب والأذونات حسب سياسة الشركة.
          الأيام اللي فيها إجازة معتمدة أو اتسجلت يدوي ما بتتغيرش.
        </p>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {report && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs text-gray-600">
              <span className="rounded-full bg-gray-100 px-2.5 py-1">{report.punchesRead.toLocaleString('ar-EG-u-nu-latn')} بصمة في الشهر</span>
              <span className="rounded-full bg-gray-100 px-2.5 py-1">مواعيد العمل {report.policy.start.slice(0, 5)} – {report.policy.end.slice(0, 5)}</span>
              {report.skipped.outsideMonth > 0 && <span className="rounded-full bg-gray-100 px-2.5 py-1">{report.skipped.outsideMonth} بصمة من شهر تاني اتجاهلت</span>}
              {report.skipped.unreadable > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">{report.skipped.unreadable} سطر وقته مش مقروء</span>}
            </div>
            {report.unmatched.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <b>أرقام في الشيت مش متسجلة لأي موظف</b> — سجّلها في «الرواتب والبصمة والتارجت» وارفع تاني:
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {report.unmatched.slice(0, 30).map(u => (
                    <span key={`${u.bioNo}|${u.name}`} className="rounded-full bg-white px-2 py-0.5">{u.bioNo ? `رقم ${u.bioNo}` : ''}{u.name ? ` ${u.name}` : ''} · {u.punches} بصمة</span>
                  ))}
                </div>
              </div>
            )}
            <div className="max-h-[45vh] overflow-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="sticky top-0 bg-gray-50 text-right text-xs font-bold text-gray-500">
                  <tr><th className="px-3 py-2">الموظف</th><th className="px-3 py-2">أيام العمل</th><th className="px-3 py-2">حضور</th><th className="px-3 py-2">غياب</th>
                    <th className="px-3 py-2">أيام فيها خصم</th><th className="px-3 py-2">خصم التأخير</th><th className="px-3 py-2">أذونات</th><th className="px-3 py-2">محتاج مراجعة</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {report.employees.map(e => (
                    <tr key={e.staffId} onClick={() => setOpenStaff(openStaff === e.staffId ? null : e.staffId)} className={`cursor-pointer hover:bg-gray-50 ${openStaff === e.staffId ? 'bg-indigo-50' : ''}`}>
                      <td className="px-3 py-2 font-bold text-gray-800">{e.name}<span className="mr-1 text-[11px] font-normal text-gray-400">{e.biometricNo ? `#${e.biometricNo}` : ''}</span></td>
                      <td className="px-3 py-2">{e.workDays}</td>
                      <td className="px-3 py-2 text-emerald-700">{e.present}</td>
                      <td className={`px-3 py-2 ${e.absent ? 'font-bold text-red-600' : 'text-gray-300'}`}>{e.absent}</td>
                      <td className="px-3 py-2">{e.lateDays || '—'}</td>
                      <td className={`px-3 py-2 ${e.deductionDays ? 'font-bold text-amber-700' : 'text-gray-300'}`}>{days(e.deductionDays)}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{[e.morningPermitsUsed ? `${e.morningPermitsUsed} صباحي` : '', e.eveningPermitsUsed ? `${e.eveningPermitsUsed} مسائي` : ''].filter(Boolean).join(' · ') || '—'}</td>
                      <td className={`px-3 py-2 ${e.flagged ? 'text-amber-700' : 'text-gray-300'}`}>{e.flagged ? `${e.flagged} يوم` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail && (
              <div className="max-h-[35vh] overflow-auto rounded-xl border border-indigo-200">
                <div className="sticky top-0 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-900">أيام {detail.name}</div>
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="text-right text-gray-500"><tr><th className="px-3 py-1.5">اليوم</th><th className="px-3 py-1.5">الحالة</th><th className="px-3 py-1.5">حضور</th><th className="px-3 py-1.5">انصراف</th><th className="px-3 py-1.5">تأخير</th><th className="px-3 py-1.5">انصراف بدري</th><th className="px-3 py-1.5">إذن</th><th className="px-3 py-1.5">الخصم</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {detail.days.map(d => (
                      <tr key={d.date} className={d.status === 'ABSENT' ? 'bg-red-50/50' : d.deductionDays ? 'bg-amber-50/50' : ''}>
                        <td className="px-3 py-1.5 tabular-nums">{d.date}</td>
                        <td className="px-3 py-1.5">{STATUS_AR[d.status] || d.status}{d.flag ? ` · ${FLAG_AR[d.flag] || d.flag}` : ''}</td>
                        <td className="px-3 py-1.5 tabular-nums">{d.checkIn || '—'}</td>
                        <td className="px-3 py-1.5 tabular-nums">{d.checkOut || '—'}</td>
                        <td className="px-3 py-1.5">{d.lateMinutes ? `${d.lateMinutes} د` : '—'}</td>
                        <td className="px-3 py-1.5">{d.earlyLeaveMinutes ? `${d.earlyLeaveMinutes} د` : '—'}</td>
                        <td className="px-3 py-1.5">{permitText(d.permit) || '—'}</td>
                        <td className="px-3 py-1.5 font-bold">{d.status === 'ABSENT' ? 'يوم غياب' : days(d.deductionDays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => send(true)} disabled={!file || !month || busy !== null}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-700 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-40">
            {busy === 'preview' ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />} معاينة الحساب
          </button>
          <button type="button" onClick={() => send(false)} disabled={!report || busy !== null}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
            {busy === 'apply' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} اعتماد وتسجيل الشهر
          </button>
          <button type="button" onClick={onClose} className="rounded-xl bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200">إغلاق</button>
        </div>
      </div>
    </Modal>
  );
}
