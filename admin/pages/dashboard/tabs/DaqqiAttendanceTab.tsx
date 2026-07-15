import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';

interface AttendeeRow {
  subscriberId: string;
  name: string;
  phone: string;
  bookedAt: string;
  amountPaid: number;
  attendedLectures: number;
  absentLectures: number;
  attendancePct: number | null;
}

interface RoundReport {
  id: string;
  code: string;
  courseId: string;
  instructorName: string;
  receptionName: string;
  dayOfWeek: string;
  startDate: string;
  timeSlot: string;
  status: string;
  totalSessions: number;
  attendeeCount: number;
  attendees: AttendeeRow[];
}

const STATUS_AR: Record<string, string> = { new: 'جديدة', active: 'نشطة', finished: 'منتهية' };
const STATUS_COLOR: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  active: 'bg-emerald-100 text-emerald-700',
  finished: 'bg-gray-100 text-gray-600',
};

function pctColor(pct: number | null): string {
  if (pct === null) return 'text-gray-400';
  if (pct >= 80) return 'text-emerald-600 font-bold';
  if (pct >= 60) return 'text-yellow-600 font-semibold';
  return 'text-red-600 font-bold';
}

function pctBar(pct: number | null) {
  const v = pct ?? 0;
  const color = v >= 80 ? 'bg-emerald-500' : v >= 60 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden inline-block align-middle ml-1">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export default function DaqqiAttendanceTab({ notify }: { notify: (msg: string, t?: 'success' | 'error') => void }) {
  const [rounds, setRounds] = useState<RoundReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'active' | 'finished' | ''>('active');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const notifyRef = useRef(notify);

  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const r = await fetch(`/api/admin/daqqi/attendance-report${qs}`, { credentials: 'include', headers: adminAuthHeaders() });
      if (!r.ok) throw new Error(await r.text());
      setRounds(await r.json());
    } catch (e: unknown) {
      notifyRef.current(e instanceof Error ? e.message : 'فشل التحميل', 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(rounds.map(r => r.id)));
  const collapseAll = () => setExpanded(new Set());

  const handleExport = async () => {
    const qs = statusFilter ? `?status=${statusFilter}` : '';
    const url = `/api/admin/daqqi/attendance-export${qs}`;
    try {
      const r = await fetch(url, { credentials: 'include', headers: adminAuthHeaders() });
      if (!r.ok) throw new Error('فشل التصدير');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `daqqi_attendance_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    } catch {
      notifyRef.current('فشل تصدير CSV', 'error');
    }
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? rounds.filter(r =>
        r.code.toLowerCase().includes(q) ||
        r.instructorName.toLowerCase().includes(q) ||
        r.attendees.some(a => a.name.toLowerCase().includes(q) || a.phone.includes(q))
      )
    : rounds;

  // Summary stats
  const totalAttendees = filtered.reduce((s, r) => s + r.attendeeCount, 0);
  const avgPct = (() => {
    const valid = filtered.flatMap(r => r.attendees.map(a => a.attendancePct)).filter((p): p is number => p !== null);
    return valid.length ? Math.round(valid.reduce((s, v) => s + v, 0) / valid.length) : null;
  })();

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">كشف حضور الدقي</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {filtered.length} دورة · {totalAttendees} متدرب
            {avgPct !== null && <span className="mr-2">· متوسط الحضور: <span className={pctColor(avgPct)}>{avgPct}%</span></span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white">
            <option value="">كل الدورات</option>
            <option value="active">النشطة فقط</option>
            <option value="finished">المنتهية فقط</option>
            <option value="NEW">الجديدة فقط</option>
          </select>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="بحث بالكود أو المحاضر أو المتدرب..."
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-52"
          />
          <button onClick={expandAll} className="text-xs text-indigo-600 hover:underline">فتح الكل</button>
          <button onClick={collapseAll} className="text-xs text-gray-500 hover:underline">إغلاق الكل</button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 transition">
            <Download size={14} /> تصدير CSV
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 transition">
            {loading ? '...' : 'تحديث'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-16 text-gray-400">جاري التحميل...</div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400">لا توجد دورات بهذا الفلتر</div>
      )}

      {/* Rounds */}
      <div className="space-y-3">
        {filtered.map(round => {
          const isOpen = expanded.has(round.id);
          const avgRoundPct = (() => {
            const valid = round.attendees.map(a => a.attendancePct).filter((p): p is number => p !== null);
            return valid.length ? Math.round(valid.reduce((s, v) => s + v, 0) / valid.length) : null;
          })();
          const lowAttendees = round.attendees.filter(a => a.attendancePct !== null && a.attendancePct < 60).length;

          return (
            <div key={round.id} className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
              {/* Round header row */}
              <button
                onClick={() => toggleExpand(round.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition text-right">
                <span className="text-gray-400">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
                <span className="font-bold text-indigo-700 w-20 shrink-0 text-sm">{round.code}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${STATUS_COLOR[round.status] || 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_AR[round.status] || round.status}
                </span>
                <span className="text-sm text-gray-700 flex-1">{round.instructorName}</span>
                <span className="text-xs text-gray-500 hidden sm:block">{round.dayOfWeek} · {round.startDate}</span>
                <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5 shrink-0">
                  {round.totalSessions} جلسة
                </span>
                <span className="text-xs bg-gray-50 text-gray-700 border border-gray-200 rounded-full px-2 py-0.5 shrink-0">
                  {round.attendeeCount} متدرب
                </span>
                {avgRoundPct !== null && (
                  <span className={`text-sm ${pctColor(avgRoundPct)} shrink-0`}>{avgRoundPct}%</span>
                )}
                {lowAttendees > 0 && (
                  <span className="text-[11px] bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5 shrink-0">
                    ⚠️ {lowAttendees} تحت 60%
                  </span>
                )}
              </button>

              {/* Attendees table */}
              {isOpen && (
                <div className="border-t border-gray-100">
                  {round.attendees.length === 0 ? (
                    <p className="text-sm text-gray-400 px-6 py-4">لا يوجد متدربون في هذه الدورة</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-gray-500 text-xs">
                            <th className="px-4 py-2 text-right font-semibold">الاسم</th>
                            <th className="px-4 py-2 text-right font-semibold">الهاتف</th>
                            <th className="px-4 py-2 text-center font-semibold">حضور</th>
                            <th className="px-4 py-2 text-center font-semibold">غياب</th>
                            <th className="px-4 py-2 text-center font-semibold">نسبة الحضور</th>
                            <th className="px-4 py-2 text-center font-semibold">المدفوع</th>
                          </tr>
                        </thead>
                        <tbody>
                          {round.attendees
                            .slice()
                            .sort((a, b) => (b.attendancePct ?? -1) - (a.attendancePct ?? -1))
                            .map(att => (
                              <tr key={att.subscriberId} className="border-t border-gray-100 hover:bg-gray-50">
                                <td className="px-4 py-2 font-medium text-gray-800">{att.name}</td>
                                <td className="px-4 py-2 text-gray-500 font-mono text-xs" dir="ltr">{att.phone}</td>
                                <td className="px-4 py-2 text-center">
                                  <span className="bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 text-xs font-bold">
                                    {att.attendedLectures}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-center">
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${att.absentLectures > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                                    {att.absentLectures}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-center">
                                  {att.attendancePct !== null ? (
                                    <span className="inline-flex items-center gap-1">
                                      <span className={pctColor(att.attendancePct)}>{att.attendancePct}%</span>
                                      {pctBar(att.attendancePct)}
                                    </span>
                                  ) : (
                                    <span className="text-gray-400 text-xs">—</span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-center text-xs text-gray-600">
                                  {att.amountPaid ? att.amountPaid.toLocaleString('ar-EG') + ' ج' : '—'}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
