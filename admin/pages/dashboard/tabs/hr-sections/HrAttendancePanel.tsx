// Monthly attendance: the per-employee summary, a manual entry form, and a CSV
// import for the fingerprint device.
//
// Lifted out of HRTab.tsx with its own state — the month, the summary rows and
// both modals were read by this tab and nothing else.
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../../../../../shared/ui/Modal';
import { X, Plus, Calendar, Clock, Upload } from 'lucide-react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';
import type { StaffMember } from '../../../../types';
import HrPolicyPanel from './HrPolicyPanel';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type AttendanceSummaryRow = {
  id: string;
  name: string;
  department_name?: string;
  present_days?: number;
  absent_days: number;
  late_days: number;
  total_late_minutes: number;
  leave_days: number;
};

export default function HrAttendancePanel({ notify, staff }: {
  notify: Notify;
  staff: StaffMember[];
}) {
  // ── Attendance state ────────────────────────────────────────
  const [attMonth, setAttMonth] = useState(new Date().toISOString().slice(0, 7));
  const [attSummary, setAttSummary] = useState<AttendanceSummaryRow[]>([]);
  const [loadingAtt, setLoadingAtt] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualEntry, setManualEntry] = useState({ staff_id: '', date: new Date().toISOString().slice(0, 10), check_in: '', check_out: '', status: 'PRESENT', notes: '' });
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);

  const fetchAttendanceSummary = useCallback(async () => {
    const [y, mo] = attMonth.split('-');
    setLoadingAtt(true);
    try {
      const res = await fetch(`/api/admin/hr/attendance/summary?month=${parseInt(mo)}&year=${y}`, { credentials: 'include', headers: adminAuthHeaders() });
      if (res.ok) setAttSummary(await res.json());
    } catch { notify('error', 'تعذر تحميل تقرير الحضور'); } finally { setLoadingAtt(false); }
  }, [attMonth, notify]);

  const submitManualAttendance = useCallback(async () => {
    if (!manualEntry.staff_id || !manualEntry.date) return;
    try {
      const res = await fetch('/api/admin/hr/attendance', {
        method: 'POST', credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify(manualEntry),
      });
      if (res.ok) {
        notify('success', 'تم تسجيل الحضور ✅');
        setShowManualEntry(false);
        setManualEntry({ staff_id: '', date: new Date().toISOString().slice(0, 10), check_in: '', check_out: '', status: 'PRESENT', notes: '' });
        fetchAttendanceSummary();
      } else { const d = await res.json(); notify('error', d.error || 'فشل التسجيل'); }
    } catch { notify('error', 'خطأ في الاتصال'); }
  }, [manualEntry, notify, fetchAttendanceSummary]);

  const submitCsvImport = useCallback(async () => {
    if (!csvText.trim()) return;
    try {
      const [y, mo] = attMonth.split('-');
      const res = await fetch('/api/admin/hr/attendance/import', {
        method: 'POST', credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify({ csvText, month: parseInt(mo), year: parseInt(y) }),
      });
      if (res.ok) {
        const data = await res.json();
        setImportResult(data);
        notify('success', `تم استيراد ${data.imported} سجل ✅`);
        fetchAttendanceSummary();
      } else { const d = await res.json(); notify('error', d.error || 'فشل الاستيراد'); }
    } catch { notify('error', 'خطأ في الاتصال'); }
  }, [csvText, attMonth, notify, fetchAttendanceSummary]);

  // The panel only mounts while its tab is open, so mounting is the cue to load.
  useEffect(() => { fetchAttendanceSummary(); }, [fetchAttendanceSummary]);

  return (
      <div className="space-y-4">
        <HrPolicyPanel notify={notify} />
        {/* Controls */}
        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-sm font-bold text-gray-700">الشهر:</label>
          <input type="month" value={attMonth} onChange={e => setAttMonth(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm"/>
          <button onClick={() => fetchAttendanceSummary()} className="px-4 py-2 bg-slate-600 text-white rounded-xl text-sm font-bold hover:bg-slate-700 transition">تحديث</button>
          <button onClick={() => setShowManualEntry(true)} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition flex items-center gap-2"><Plus size={14}/> تسجيل يدوي</button>
          <button onClick={() => setShowCsvImport(true)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition flex items-center gap-2"><Upload size={14}/> استيراد CSV</button>
        </div>

        {/* Summary table */}
        {loadingAtt ? (
          <div className="text-center py-12 text-gray-400">
            <div className="animate-spin w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full mx-auto mb-3"/>
            <p className="text-sm">جاري تحميل بيانات الحضور...</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-right text-xs font-bold text-gray-500">
                  <th className="px-4 py-3">الموظف</th>
                  <th className="px-4 py-3 text-center">حاضر</th>
                  <th className="px-4 py-3 text-center">غائب</th>
                  <th className="px-4 py-3 text-center">متأخر</th>
                  <th className="px-4 py-3 text-center">دقائق التأخير</th>
                  <th className="px-4 py-3 text-center">إجازة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {attSummary.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-gray-400">
                    <Clock size={32} className="mx-auto mb-2 opacity-20"/><p className="text-sm">لا بيانات حضور لهذا الشهر</p>
                  </td></tr>
                ) : attSummary.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-xs shrink-0">{row.name?.charAt(0)}</div>
                        <div>
                          <p className="font-bold text-xs text-gray-800">{row.name}</p>
                          <span className="text-[10px] text-gray-400">{row.department_name || '—'}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center"><span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full text-xs font-bold">{row.present_days || 0}</span></td>
                    <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${row.absent_days > 0 ? 'bg-red-100 text-red-700' : 'text-gray-300'}`}>{row.absent_days || 0}</span></td>
                    <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${row.late_days > 0 ? 'bg-amber-100 text-amber-700' : 'text-gray-300'}`}>{row.late_days || 0}</span></td>
                    <td className="px-4 py-3 text-center text-xs text-gray-600">{row.total_late_minutes > 0 ? `${row.total_late_minutes} د` : '—'}</td>
                    <td className="px-4 py-3 text-center text-xs text-blue-600 font-semibold">{row.leave_days > 0 ? row.leave_days : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Manual entry modal */}
        {showManualEntry && (
    <Modal
      open
      onClose={() => setShowManualEntry(false)}
      title="تسجيل حضور يدوي"
      icon={<Calendar size={16} />}
      size="sm"
    >
              <div className="space-y-3">
                <select value={manualEntry.staff_id} onChange={e => setManualEntry(m => ({ ...m, staff_id: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                  <option value="">اختر موظف</option>
                  {staff.filter(s => s.status === 'active').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input type="date" value={manualEntry.date} onChange={e => setManualEntry(m => ({ ...m, date: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-xs text-gray-500 mb-1 block">وقت الحضور</label><input type="time" value={manualEntry.check_in} onChange={e => setManualEntry(m => ({ ...m, check_in: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/></div>
                  <div><label className="text-xs text-gray-500 mb-1 block">وقت الانصراف</label><input type="time" value={manualEntry.check_out} onChange={e => setManualEntry(m => ({ ...m, check_out: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/></div>
                </div>
                <select value={manualEntry.status} onChange={e => setManualEntry(m => ({ ...m, status: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                  <option value="PRESENT">حاضر</option>
                  <option value="ABSENT">غائب</option>
                  <option value="LATE">متأخر</option>
                  <option value="HALF_DAY">نصف يوم</option>
                </select>
                <input placeholder="ملاحظة (اختياري)" value={manualEntry.notes} onChange={e => setManualEntry(m => ({ ...m, notes: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={submitManualAttendance} disabled={!manualEntry.staff_id || !manualEntry.date} className="flex-1 py-2 bg-slate-700 text-white rounded-xl font-bold hover:bg-slate-800 transition disabled:opacity-50">حفظ</button>
                <button onClick={() => setShowManualEntry(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">إلغاء</button>
              </div>
    </Modal>
        )}

        {/* CSV Import modal */}
        {showCsvImport && (
    <Modal
      open
      onClose={() => { setShowCsvImport(false); setImportResult(null); setCsvText(''); }}
      title="استيراد الحضور من CSV"
      icon={<Upload size={16} />}
    >
              <div className="space-y-3">
                <div className="bg-blue-50 text-blue-700 text-xs rounded-xl p-3">
                  <p className="font-bold mb-1">تنسيق الأعمدة المطلوب:</p>
                  <code>employee_id أو name, date, check_in, check_out</code>
                </div>
                <input type="month" value={attMonth} onChange={e => setAttMonth(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/>
                <textarea value={csvText} onChange={e => setCsvText(e.target.value)} rows={8} placeholder="الصق محتوى CSV هنا..." className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono resize-none"/>
                {importResult && (
                  <div className={`rounded-xl p-3 text-sm ${importResult.errors.length > 0 ? 'bg-amber-50 border border-amber-200 text-amber-700' : 'bg-emerald-50 border border-emerald-200 text-emerald-700'}`}>
                    <p className="font-bold">تم الاستيراد: {importResult.imported} سجل · تجاهل: {importResult.skipped}</p>
                    {importResult.errors.slice(0, 5).map((err, i) => <p key={i} className="text-xs mt-1 opacity-80">{err}</p>)}
                  </div>
                )}
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={submitCsvImport} disabled={!csvText.trim()} className="flex-1 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-2"><Upload size={14}/> استيراد</button>
                <button onClick={() => { setShowCsvImport(false); setImportResult(null); setCsvText(''); }} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">إغلاق</button>
              </div>
    </Modal>
        )}
      </div>
  );
}
