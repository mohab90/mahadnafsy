import { useMemo, useState } from 'react';
import { CalendarDays, Check, Link2, Phone, Search, Trash2, X } from 'lucide-react';
import { useSiteData } from '../../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { ConsultationItem } from '../../../../types';
import { confirmDialog } from '../../../../components/shared/confirmDialog';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

// The statuses the API actually stores. 'confirmed' and 'scheduled' both mean
// "booked and going ahead" — the client site writes one and staff write the
// other — so they are shown together rather than as two near-identical filters
// nobody can tell apart.
const BOOKED = ['confirmed', 'scheduled'];

const STATUS_LABEL: Record<string, string> = {
  pending: 'في الانتظار',
  confirmed: 'مؤكدة',
  scheduled: 'مجدولة',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};
const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
  scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-red-50 text-red-600 border-red-200',
};

type ViewFilter = 'upcoming' | 'pending' | 'completed' | 'cancelled' | 'all';

const bookingDate = (item: ConsultationItem) =>
  String(item.sessionDate || item.scheduledAt || item.date || '').slice(0, 10);

export function ConsultationBookingsTab({ notify }: { notify: NotifyFn }) {
  const { consultations, therapists } = useSiteData();
  const [view, setView] = useState<ViewFilter>('upcoming');
  const [search, setSearch] = useState('');
  const [therapistFilter, setTherapistFilter] = useState('');
  const [busyId, setBusyId] = useState('');
  // Applied on top of the context list so a status change shows immediately
  // rather than waiting for the next full reload of the dashboard.
  const [localStatus, setLocalStatus] = useState<Record<string, string>>({});

  const statusOf = (item: ConsultationItem) => localStatus[item.id] ?? item.status;
  const today = new Date().toISOString().slice(0, 10);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return consultations
      .filter(item => {
        const status = statusOf(item);
        const date = bookingDate(item);
        if (view === 'upcoming' && !(BOOKED.includes(status) && (!date || date >= today))) return false;
        if (view === 'pending' && status !== 'pending') return false;
        if (view === 'completed' && status !== 'completed') return false;
        if (view === 'cancelled' && status !== 'cancelled') return false;
        if (therapistFilter && item.therapistId !== therapistFilter) return false;
        if (term) {
          const haystack = [item.clientName, item.name, item.clientPhone, item.phone, item.clientEmail, item.therapistName]
            .filter(Boolean).join(' ').toLowerCase();
          if (!haystack.includes(term)) return false;
        }
        return true;
      })
      .sort((a, b) => bookingDate(b).localeCompare(bookingDate(a)));
    // localStatus participates through statusOf.
  }, [consultations, view, search, therapistFilter, localStatus, today]);

  const countFor = (filter: ViewFilter) => consultations.filter(item => {
    const status = statusOf(item);
    const date = bookingDate(item);
    if (filter === 'upcoming') return BOOKED.includes(status) && (!date || date >= today);
    if (filter === 'all') return true;
    return status === filter;
  }).length;

  const setStatus = async (item: ConsultationItem, status: string, label: string) => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      await mysqlAdmin.updateConsultationStatus(item.id, status);
      setLocalStatus(prev => ({ ...prev, [item.id]: status }));
      notify('success', `تم تحديث الحجز إلى «${label}»`);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحديث الحجز');
    } finally { setBusyId(''); }
  };

  const remove = async (item: ConsultationItem) => {
    if (!await confirmDialog(`حذف حجز «${item.clientName || item.name || ''}»؟`)) return;
    setBusyId(item.id);
    try {
      await mysqlAdmin.deleteConsultation(item.id);
      // Hidden by marking it cancelled locally — the row leaves the default view
      // without pretending the whole list reloaded.
      setLocalStatus(prev => ({ ...prev, [item.id]: 'cancelled' }));
      notify('success', 'تم حذف الحجز');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حذف الحجز');
    } finally { setBusyId(''); }
  };

  const FILTERS: { key: ViewFilter; label: string }[] = [
    { key: 'upcoming', label: 'القادمة' },
    { key: 'pending', label: 'في الانتظار' },
    { key: 'completed', label: 'المكتملة' },
    { key: 'cancelled', label: 'الملغاة' },
    { key: 'all', label: 'الكل' },
  ];

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(filter => (
          <button key={filter.key} onClick={() => setView(filter.key)}
            className={`border rounded-xl px-3 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${
              view === filter.key ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {filter.label}
            <span className={`inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] rounded-full text-[10px] font-extrabold ${
              view === filter.key ? 'bg-white/30' : 'bg-gray-100 text-gray-600'}`}>{countFor(filter.key)}</span>
          </button>
        ))}
        <span className="flex-1" />
        <div className="relative">
          <Search size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="بحث بالاسم أو الهاتف..."
            className="pr-7 pl-3 py-1.5 border border-gray-200 rounded-lg text-xs min-w-[180px] focus:outline-none focus:border-blue-400" />
        </div>
        <select value={therapistFilter} onChange={event => setTherapistFilter(event.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[140px]">
          <option value="">كل الدكاترة</option>
          {therapists.map(therapist => <option key={therapist.id} value={therapist.id}>{therapist.name}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="border border-dashed border-gray-300 rounded-2xl py-14 text-center text-gray-400">
          <CalendarDays size={30} className="mx-auto mb-2 opacity-30" />
          مفيش حجوزات في العرض ده.
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-2xl bg-white">
          <table className="w-full text-xs min-w-[900px] border-collapse">
            <thead className="bg-gray-50 text-gray-600">
              <tr>{['العميل', 'الدكتور', 'الموعد', 'النوع', 'المبلغ', 'الحالة', 'إجراءات'].map(label =>
                <th key={label} className="text-right px-3 py-2.5 border-b border-gray-200 font-semibold">{label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(item => {
                const status = statusOf(item);
                const busy = busyId === item.id;
                return (
                  <tr key={item.id} className="hover:bg-gray-50/70 align-top border-b border-gray-100">
                    <td className="px-3 py-2.5">
                      <div className="font-bold text-gray-800">{item.clientName || item.name || '—'}</div>
                      {(item.clientPhone || item.phone) && (
                        <a href={`tel:${item.clientPhone || item.phone}`} className="text-blue-600 font-semibold flex items-center gap-1">
                          <Phone size={10} />{item.clientPhone || item.phone}
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-700">{item.therapistName || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="text-gray-800 font-semibold">{bookingDate(item) || 'بدون تاريخ'}</div>
                      {item.slotLabel && <div className="text-gray-400 text-[10px]">{item.slotLabel}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">
                      {{ individual: 'فردية', couple: 'زوجية', family: 'أسرية' }[item.sessionType] || item.sessionType || '—'}
                    </td>
                    <td className="px-3 py-2.5 font-bold text-gray-800">
                      {item.amount ? `${Number(item.amount).toLocaleString()} ${item.currency || 'ج.م'}` : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-lg border font-bold ${STATUS_STYLE[status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                        {STATUS_LABEL[status] || status}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        {status === 'pending' && (
                          <button disabled={busy} onClick={() => void setStatus(item, 'confirmed', 'مؤكدة')}
                            className="h-7 px-2 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold disabled:opacity-50" title="تأكيد الحجز">
                            <Check size={12} />
                          </button>
                        )}
                        {BOOKED.includes(status) && (
                          <button disabled={busy} onClick={() => void setStatus(item, 'completed', 'مكتملة')}
                            className="h-7 px-2 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold disabled:opacity-50" title="تمت الجلسة">
                            <Check size={12} />
                          </button>
                        )}
                        {status !== 'cancelled' && (
                          <button disabled={busy} onClick={() => void setStatus(item, 'cancelled', 'ملغاة')}
                            className="h-7 px-2 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 font-bold disabled:opacity-50" title="إلغاء">
                            <X size={12} />
                          </button>
                        )}
                        {item.meetingLink && (
                          <a href={item.meetingLink} target="_blank" rel="noopener noreferrer"
                            className="h-7 px-2 rounded bg-gray-50 text-gray-600 hover:bg-gray-100 flex items-center" title="رابط الجلسة">
                            <Link2 size={12} />
                          </a>
                        )}
                        <button disabled={busy} onClick={() => void remove(item)}
                          className="h-7 px-2 rounded bg-red-50 text-red-500 hover:bg-red-100 disabled:opacity-50" title="حذف">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
