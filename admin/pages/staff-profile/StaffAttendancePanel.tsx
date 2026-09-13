// One staff member's attendance for a month: the summary tiles and the log.
//
// Lifted out of StaffProfile.tsx with its own state — the month, year, rows and
// summary were read by this tab and nothing else, so only the staff id crosses
// the boundary.

import { useEffect, useMemo, useState } from 'react';
import { CAIRO_TIME_ZONE } from '../../../shared/cairoDate';

interface AttendanceLog {
  id: string; date: string; check_in: string | null; check_out: string | null;
  total_hours: number | null; late_minutes: number; status: string; notes: string | null;
}

const ATTENDANCE_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  PRESENT:  { label: 'حاضر',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  LATE:     { label: 'متأخر',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  ABSENT:   { label: 'غائب',    cls: 'bg-red-50 text-red-700 border-red-200' },
  HALF_DAY: { label: 'نصف يوم', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  LEAVE:    { label: 'إجازة',   cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  HOLIDAY:  { label: 'عطلة',    cls: 'bg-gray-50 text-gray-600 border-gray-200' },
  REMOTE:   { label: 'عن بُعد', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
};

export default function StaffAttendancePanel({ staffId }: { staffId?: string }) {
  const id = staffId;
  // ── Attendance (month picker + fetch from HR attendance log) ─────────────────
  const now = new Date();
  const [attMonth, setAttMonth] = useState(now.getMonth() + 1);
  const [attYear, setAttYear] = useState(now.getFullYear());
  const [attLogs, setAttLogs] = useState<AttendanceLog[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  useEffect(() => {
    if (!id) return;
    setAttLoading(true);
    fetch(`/api/admin/hr/attendance/${id}?month=${attMonth}&year=${attYear}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(rows => setAttLogs(Array.isArray(rows) ? rows : []))
      .catch(() => setAttLogs([]))
      .finally(() => setAttLoading(false));
  }, [id, attMonth, attYear]);

  const attSummary = useMemo(() => {
    const present = attLogs.filter(l => l.status === 'PRESENT' || l.status === 'REMOTE').length;
    const late = attLogs.filter(l => l.status === 'LATE' || l.late_minutes > 0).length;
    const absent = attLogs.filter(l => l.status === 'ABSENT').length;
    const leave = attLogs.filter(l => l.status === 'LEAVE').length;
    const totalHours = attLogs.reduce((s, l) => s + (l.total_hours || 0), 0);
    return { present, late, absent, leave, totalHours: Math.round(totalHours * 10) / 10 };
  }, [attLogs]);

  return (
        <div className="space-y-6">
          {/* Month picker */}
          <div className="flex items-center gap-3">
            <select value={attMonth} onChange={e => setAttMonth(Number(e.target.value))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleDateString('ar-EG-u-nu-latn', { month: 'long', timeZone: CAIRO_TIME_ZONE })}</option>
              ))}
            </select>
            <select value={attYear} onChange={e => setAttYear(Number(e.target.value))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
              {Array.from({ length: 3 }, (_, i) => now.getFullYear() - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {attLoading && <span className="text-xs text-gray-400">جارٍ التحميل...</span>}
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
              <div className="text-2xl font-bold text-emerald-700">{attSummary.present}</div>
              <div className="text-xs text-emerald-600 mt-1">أيام حضور</div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
              <div className="text-2xl font-bold text-amber-700">{attSummary.late}</div>
              <div className="text-xs text-amber-600 mt-1">أيام تأخير</div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
              <div className="text-2xl font-bold text-red-700">{attSummary.absent}</div>
              <div className="text-xs text-red-600 mt-1">أيام غياب</div>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 text-center">
              <div className="text-2xl font-bold text-purple-700">{attSummary.leave}</div>
              <div className="text-xs text-purple-600 mt-1">إجازات</div>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center">
              <div className="text-2xl font-bold text-blue-700">{attSummary.totalHours}</div>
              <div className="text-xs text-blue-600 mt-1">إجمالي الساعات</div>
            </div>
          </div>

          {/* Daily log */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h4 className="text-sm font-bold text-gray-700">سجل الحضور اليومي</h4>
            </div>
            {!attLoading && attLogs.length === 0 ? (
              <p className="text-center py-10 text-sm text-gray-400">لا يوجد سجل حضور لهذا الشهر</p>
            ) : (
              <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                {attLogs.map(log => {
                  const cfg = ATTENDANCE_STATUS_LABEL[log.status] || { label: log.status, cls: 'bg-gray-50 text-gray-600 border-gray-200' };
                  return (
                    <div key={log.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                      <span className="font-bold text-gray-700 w-24 flex-shrink-0">{log.date?.slice(0, 10)}</span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${cfg.cls}`}>{cfg.label}</span>
                      <span className="text-gray-500 text-xs flex-1 text-center" dir="ltr">
                        {log.check_in || '—'} → {log.check_out || '—'}
                      </span>
                      {log.late_minutes > 0 && <span className="text-amber-600 text-xs font-bold">تأخير {log.late_minutes} د</span>}
                      {log.total_hours != null && <span className="text-gray-400 text-xs w-16 text-left">{log.total_hours} س</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
  );
}
