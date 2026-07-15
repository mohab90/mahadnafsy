import React, { useMemo, useState } from 'react';
import { Calendar, Clock, User, Phone, BookOpen, CheckCircle, X, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'مجدولة', completed: 'مكتملة', cancelled: 'ملغاة', pending: 'معلقة', no_show: 'لم يحضر',
};
const STATUS_COLOR: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
  no_show: 'bg-gray-100 text-gray-600',
};

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export default function ConsultationCalendarTab({ notify }: { notify: NotifyFn }) {
  const { consultations, staffMembers } = useSiteData();
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const monthStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;

  const consultsByDay = useMemo(() => {
    const map: Record<string, typeof consultations> = {};
    consultations.forEach(c => {
      const day = (c.scheduledAt || c.date || '').slice(0, 10);
      if (!day) return;
      if (!map[day]) map[day] = [];
      map[day].push(c);
    });
    return map;
  }, [consultations]);

  const filtered = useMemo(() => {
    if (selectedDate) {
      const dayConsults = consultsByDay[selectedDate] || [];
      return statusFilter === 'all' ? dayConsults : dayConsults.filter(c => c.status === statusFilter);
    }
    const monthConsults = consultations.filter(c => (c.scheduledAt || c.date || '').slice(0, 7) === monthStr);
    return statusFilter === 'all' ? monthConsults : monthConsults.filter(c => c.status === statusFilter);
  }, [consultations, consultsByDay, selectedDate, monthStr, statusFilter]);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);
  const monthName = new Date(viewYear, viewMonth, 1).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
    setSelectedDate(null);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
    setSelectedDate(null);
  }

  const todayStr = today.toISOString().slice(0, 10);

  // Summary for current month
  const monthConsults = consultations.filter(c => (c.scheduledAt || c.date || '').slice(0, 7) === monthStr);
  const monthStats = {
    total: monthConsults.length,
    completed: monthConsults.filter(c => c.status === 'completed').length,
    scheduled: monthConsults.filter(c => c.status === 'scheduled' || c.status === 'pending').length,
    cancelled: monthConsults.filter(c => c.status === 'cancelled').length,
  };

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-purple-600 to-indigo-600 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2"><Calendar size={22} />تقويم الاستشارات</h2>
        <p className="text-purple-100 text-sm mt-1">عرض وتتبع جميع الاستشارات المجدولة</p>
      </div>

      {/* Month KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'إجمالي الشهر', val: monthStats.total, color: 'blue' },
          { label: 'مكتملة', val: monthStats.completed, color: 'emerald' },
          { label: 'مجدولة / معلقة', val: monthStats.scheduled, color: 'violet' },
          { label: 'ملغاة', val: monthStats.cancelled, color: 'red' },
        ].map(k => (
          <div key={k.label} className={`bg-${k.color}-50 border border-${k.color}-100 rounded-2xl p-4 text-center`}>
            <div className="text-2xl font-extrabold text-gray-900">{k.val}</div>
            <div className="text-xs text-gray-500 mt-1">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Calendar */}
        <div className="md:col-span-2 bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="p-2 hover:bg-gray-100 rounded-xl transition"><ChevronRight size={18} /></button>
            <h3 className="font-bold text-gray-800">{monthName}</h3>
            <button onClick={nextMonth} className="p-2 hover:bg-gray-100 rounded-xl transition"><ChevronLeft size={18} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-gray-500 mb-2">
            {['أح','إث','ث','أر','خ','ج','س'].map(d => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDay }).map((_, i) => <div key={`empty-${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayConsults = consultsByDay[dateStr] || [];
              const isToday = dateStr === todayStr;
              const isSelected = selectedDate === dateStr;
              return (
                <button key={day} onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                  className={`aspect-square rounded-xl text-sm font-semibold flex flex-col items-center justify-center transition relative
                    ${isToday ? 'bg-indigo-600 text-white' : ''}
                    ${isSelected && !isToday ? 'bg-indigo-100 text-indigo-700' : ''}
                    ${!isToday && !isSelected ? 'hover:bg-gray-100 text-gray-700' : ''}
                  `}>
                  {day}
                  {dayConsults.length > 0 && (
                    <span className={`text-[9px] font-bold ${isToday ? 'text-indigo-200' : 'text-indigo-600'}`}>
                      {dayConsults.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Side list */}
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-800 text-sm">
              {selectedDate ? `استشارات ${selectedDate}` : `استشارات ${monthName}`}
            </h3>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white">
              <option value="all">الكل</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="overflow-y-auto max-h-80 divide-y divide-gray-50">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">لا توجد استشارات</div>
            ) : (
              filtered.map(c => {
                const staff = staffMembers.find(s => s.id === c.consultantId || s.id === c.staffId);
                return (
                  <div key={c.id} className="p-3 hover:bg-gray-50 transition">
                    <div className="flex items-start gap-2">
                      <div className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_COLOR[c.status] || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABEL[c.status] || c.status}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-800 truncate">{c.clientName || c.name || '—'}</div>
                        {c.phone && <div className="text-xs text-gray-400 font-mono">{c.phone}</div>}
                        {staff && <div className="text-xs text-purple-600">{staff.name}</div>}
                        {(c.scheduledAt || c.date) && (
                          <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                            <Clock size={10} />{(c.scheduledAt || c.date || '').slice(0, 16).replace('T', ' ')}
                          </div>
                        )}
                        {c.notes && <div className="text-xs text-gray-500 mt-1 truncate">{c.notes}</div>}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
