import React from 'react';
import { Plus, Upload, Calendar, Clock, X } from 'lucide-react';
import type { StaffMember } from '../../../../types';
import type { AttReport, ManualEntry, ImportResult } from './shared';

interface Props {
  attMonth: string;
  setAttMonth: React.Dispatch<React.SetStateAction<string>>;
  attSummary: any[];
  loadingAtt: boolean;
  attReport: AttReport | null;
  loadingAttReport: boolean;
  fetchAttendanceSummary: (month?: string) => void;
  fetchAttendanceReport: (month?: string) => void;
  showManualEntry: boolean;
  setShowManualEntry: React.Dispatch<React.SetStateAction<boolean>>;
  manualEntry: ManualEntry;
  setManualEntry: React.Dispatch<React.SetStateAction<ManualEntry>>;
  submitManualAttendance: () => void;
  showCsvImport: boolean;
  setShowCsvImport: React.Dispatch<React.SetStateAction<boolean>>;
  csvText: string;
  setCsvText: React.Dispatch<React.SetStateAction<string>>;
  importResult: ImportResult | null;
  setImportResult: React.Dispatch<React.SetStateAction<ImportResult | null>>;
  submitCsvImport: () => void;
  safeStaff: StaffMember[];
}

const AttendanceTab: React.FC<Props> = ({
  attMonth, setAttMonth, attSummary, loadingAtt, attReport, loadingAttReport,
  fetchAttendanceSummary, fetchAttendanceReport, showManualEntry, setShowManualEntry,
  manualEntry, setManualEntry, submitManualAttendance, showCsvImport, setShowCsvImport,
  csvText, setCsvText, importResult, setImportResult, submitCsvImport, safeStaff,
}) => (
  <div className="space-y-4">
    {/* Controls */}
    <div className="flex flex-wrap gap-3 items-center">
      <label className="text-sm font-bold text-gray-700">الشهر:</label>
      <input type="month" value={attMonth} onChange={e => { setAttMonth(e.target.value); fetchAttendanceSummary(e.target.value); fetchAttendanceReport(e.target.value); }} className="border border-gray-200 rounded-xl px-3 py-2 text-sm"/>
      <button onClick={() => { fetchAttendanceSummary(); fetchAttendanceReport(); }} className="px-4 py-2 bg-slate-600 text-white rounded-xl text-sm font-bold hover:bg-slate-700 transition">تحديث</button>
      <button onClick={() => setShowManualEntry(true)} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition flex items-center gap-2"><Plus size={14}/> تسجيل يدوي</button>
      <button onClick={() => setShowCsvImport(true)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition flex items-center gap-2"><Upload size={14}/> استيراد CSV</button>
    </div>

    {/* ── Attendance % Report card ── */}
    {(attReport || loadingAttReport) && (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
          <h3 className="text-sm font-bold text-slate-700">📊 نسبة الحضور الشهري</h3>
          {attReport && <span className="text-xs text-slate-500">{attReport.workDays} يوم عمل فعلي (بدون جمعة وسبت)</span>}
        </div>
        {loadingAttReport ? (
          <div className="text-center py-6 text-gray-400 text-sm">جاري التحميل...</div>
        ) : attReport && attReport.staff.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 font-semibold text-right">
                  <th className="px-4 py-2">الموظف</th>
                  <th className="px-4 py-2 text-center">حاضر</th>
                  <th className="px-4 py-2 text-center">غياب</th>
                  <th className="px-4 py-2 text-center">إجازة</th>
                  <th className="px-4 py-2 text-center w-48">نسبة الحضور</th>
                </tr>
              </thead>
              <tbody>
                {[...attReport.staff].sort((a, b) => b.attendancePct - a.attendancePct).map((s: any) => {
                  const pct: number = s.attendancePct;
                  const barColor = pct >= 90 ? 'bg-emerald-500' : pct >= 75 ? 'bg-yellow-500' : 'bg-red-500';
                  const txtColor = pct >= 90 ? 'text-emerald-700' : pct >= 75 ? 'text-yellow-700' : 'text-red-700';
                  return (
                    <tr key={s.staffId} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-800 text-xs">{s.name}</td>
                      <td className="px-4 py-2 text-center"><span className="bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 text-xs font-bold">{s.presentDays}</span></td>
                      <td className="px-4 py-2 text-center"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${s.absenceDays > 0 ? 'bg-red-100 text-red-700' : 'text-gray-300'}`}>{s.absenceDays}</span></td>
                      <td className="px-4 py-2 text-center"><span className={`rounded-full px-2 py-0.5 text-xs ${s.leaveDays > 0 ? 'bg-blue-100 text-blue-700 font-bold' : 'text-gray-300'}`}>{s.leaveDays || '—'}</span></td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className={`text-xs font-bold w-9 text-left ${txtColor}`}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-center py-6 text-gray-400 text-sm">لا بيانات</p>
        )}
      </div>
    )}

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
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowManualEntry(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-800 flex items-center gap-2"><Calendar size={16}/> تسجيل حضور يدوي</h3>
            <button onClick={() => setShowManualEntry(false)} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
          </div>
          <div className="space-y-3">
            <select value={manualEntry.staff_id} onChange={e => setManualEntry(m => ({ ...m, staff_id: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
              <option value="">اختر موظف</option>
              {safeStaff.filter(s => s.status === 'active').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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
              <option value="LEAVE">إجازة</option>
              <option value="HALF_DAY">نصف يوم</option>
            </select>
            <input placeholder="ملاحظة (اختياري)" value={manualEntry.notes} onChange={e => setManualEntry(m => ({ ...m, notes: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={submitManualAttendance} disabled={!manualEntry.staff_id || !manualEntry.date} className="flex-1 py-2 bg-slate-700 text-white rounded-xl font-bold hover:bg-slate-800 transition disabled:opacity-50">حفظ</button>
            <button onClick={() => setShowManualEntry(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">إلغاء</button>
          </div>
        </div>
      </div>
    )}

    {/* CSV Import modal */}
    {showCsvImport && (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowCsvImport(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6" dir="rtl" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-800 flex items-center gap-2"><Upload size={16}/> استيراد CSV من جهاز البصمة</h3>
            <button onClick={() => { setShowCsvImport(false); setImportResult(null); setCsvText(''); }} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
          </div>
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
        </div>
      </div>
    )}
  </div>
);

export default AttendanceTab;
