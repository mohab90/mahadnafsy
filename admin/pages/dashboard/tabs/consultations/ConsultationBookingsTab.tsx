import { useCallback, useMemo, useState } from 'react';
import { cairoDateOnly } from '../../../../../shared/cairoDate';
import { CalendarDays, Check, ExternalLink, Link2, MessageCircle, Phone, RotateCcw, Search, StickyNote, Trash2, X } from 'lucide-react';
import { useSiteData } from '../../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { ConsultationItem } from '../../../../types';
import { confirmDialog } from '../../../../../shared/ui/confirmDialog';
import { promptDialog } from '../../../../../shared/ui/promptDialog';
import { waLink } from '../../../../lib/whatsappLink';
import { ConsultationTimingBadge } from '../../../../components/ConsultationTimingBadge';

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
  // New requests first: they are what needs the desk, and «القادمة» holds
  // only bookings already confirmed.
  const [view, setView] = useState<ViewFilter>('pending');
  const [search, setSearch] = useState('');
  const [therapistFilter, setTherapistFilter] = useState('');
  const [busyId, setBusyId] = useState('');
  // Applied on top of the context list so a status change shows immediately
  // rather than waiting for the next full reload of the dashboard.
  const [localStatus, setLocalStatus] = useState<Record<string, string>>({});

  const statusOf = useCallback(
    (item: ConsultationItem) => localStatus[item.id] ?? item.status,
    [localStatus],
  );
  const today = cairoDateOnly();

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
      .sort((a, b) => String(b.createdAt || bookingDate(b)).localeCompare(String(a.createdAt || bookingDate(a))));
    // localStatus participates through statusOf.
  }, [consultations, view, search, therapistFilter, today, statusOf]);

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

  // The notes and the session link can be written on a booking of any age, not only a new one.
  const [localNotes, setLocalNotes] = useState<Record<string, string>>({});
  const [localLinks, setLocalLinks] = useState<Record<string, string>>({});
  const editNotes = async (item: ConsultationItem) => {
    const answer = await promptDialog({
      title: 'ملاحظات الجلسة', message: item.clientName || item.name || '', defaultValue: localNotes[item.id] ?? item.notes ?? '', placeholder: 'اكتب ملاحظاتك', confirmLabel: 'حفظ',
    });
    if (answer === null) return;
    setBusyId(item.id);
    try {
      await mysqlAdmin.updateConsultation(item.id, { notes: answer.trim() });
      setLocalNotes(prev => ({ ...prev, [item.id]: answer.trim() }));
      notify('success', 'اتحفظت الملاحظات');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ الملاحظات');
    } finally { setBusyId(''); }
  };
  const editLink = async (item: ConsultationItem) => {
    const answer = await promptDialog({
      title: 'رابط الجلسة', message: item.clientName || item.name || '', defaultValue: localLinks[item.id] ?? item.meetingLink ?? '', placeholder: 'https://…', confirmLabel: 'حفظ',
    });
    if (answer === null) return;
    const link = answer.trim();
    if (link && !/^https?:\/\//i.test(link)) { notify('error', 'الرابط لازم يبدأ بـ https://'); return; }
    setBusyId(item.id);
    try {
      await mysqlAdmin.updateConsultation(item.id, { meeting_link: link || null });
      setLocalLinks(prev => ({ ...prev, [item.id]: link }));
      notify('success', link ? 'اتحفظ رابط الجلسة' : 'اتشال رابط الجلسة');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ الرابط');
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
    { key: 'pending', label: 'طلبات جديدة' },
    { key: 'upcoming', label: 'القادمة' },
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
        <div className="space-y-2">
          {rows.map(item => {
            const status = statusOf(item);
            const busy = busyId === item.id;
            const phone = item.clientPhone || item.phone || '';
            const wa = waLink(phone);
            const notes = localNotes[item.id] ?? item.notes;
            const meetingLink = localLinks[item.id] ?? item.meetingLink;
            const kind = item.source === 'site_express' ? 'جلسة سريعة'
              : ({ individual: 'فردية', couple: 'زوجية', family: 'أسرية' }[item.sessionType] || item.sessionType || '');
            const iconBtn = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border transition disabled:opacity-50';
            return (
              <div key={item.id} className="rounded-2xl border border-gray-200 bg-white p-3 text-xs hover:border-blue-200">
                <div className="grid gap-3 md:grid-cols-[1.3fr_1.4fr_0.9fr_auto] md:items-start">
                  {/* The client */}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-gray-900">{item.clientName || item.name || '—'}</div>
                    {phone && <a href={`tel:${phone}`} dir="ltr" className="flex items-center justify-end gap-1 font-bold text-blue-600 hover:underline"><Phone size={11} />{phone}</a>}
                    {item.clientEmail && <div className="truncate text-[11px] text-gray-400" dir="ltr">{item.clientEmail}</div>}
                  </div>

                  {/* The session */}
                  <div className="min-w-0 space-y-0.5">
                    <ConsultationTimingBadge item={item} />
                    <div className="text-gray-600">{[item.therapistName, kind].filter(Boolean).join(' · ') || '—'}</div>
                    {item.slotLabel && <div className="text-[10px] text-gray-400">{item.slotLabel}</div>}
                    {item.createdAt && <div className="text-[10px] text-gray-400">وصل {String(item.createdAt).slice(0, 10)}</div>}
                  </div>

                  {/* The money */}
                  <div>
                    <div className="font-extrabold text-gray-800">
                      {item.amount ? `${Number(item.amount).toLocaleString('ar-EG-u-nu-latn')} ${item.currency || 'ج.م'}` : '—'}
                    </div>
                    {item.orderId && (
                      <div className={`text-[10px] font-bold ${item.awaitingPayment ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {item.awaitingPayment ? 'لم يُدفع بعد' : 'مدفوع'}
                      </div>
                    )}
                  </div>

                  {/* Status and controls: the same on every booking, new or old — an old one can be reopened, noted, called. */}
                  <div className="space-y-1.5 md:min-w-[220px]">
                    {item.orderOnly ? (
                      <span className="block text-[10px] leading-4 text-gray-500">
                        طلب من الموقع قبل التحديث — كلّم العميل، والدفع من «الطلبات والمدفوعات».
                      </span>
                    ) : (
                      <select value={status} disabled={busy} onChange={event => void setStatus(item, event.target.value, STATUS_LABEL[event.target.value])}
                        aria-label="حالة الحجز"
                        className={`w-full rounded-lg border px-2 py-1.5 text-xs font-bold ${STATUS_STYLE[status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                        {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select>
                    )}
                    <div className="flex flex-wrap items-center gap-1">
                      {phone && <a href={`tel:${phone}`} title="اتصال" aria-label="اتصال" className={`${iconBtn} border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100`}><Phone size={14} /></a>}
                      {wa && <a href={wa} target="_blank" rel="noopener noreferrer" title="واتساب" aria-label="واتساب" className={`${iconBtn} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}><MessageCircle size={14} /></a>}
                      {!item.orderOnly && status === 'pending' && (
                        <button disabled={busy} onClick={() => void setStatus(item, 'confirmed', 'مؤكدة')} title="تأكيد الحجز" aria-label="تأكيد الحجز" className={`${iconBtn} border-blue-200 bg-white text-blue-700 hover:bg-blue-50`}><Check size={14} /></button>
                      )}
                      {!item.orderOnly && BOOKED.includes(status) && (
                        <button disabled={busy} onClick={() => void setStatus(item, 'completed', 'مكتملة')} title="تمت الجلسة" aria-label="تمت الجلسة" className={`${iconBtn} border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50`}><Check size={14} /></button>
                      )}
                      {!item.orderOnly && (status === 'completed' || status === 'cancelled') && (
                        <button disabled={busy} onClick={() => void setStatus(item, 'pending', 'في الانتظار')} title="إعادة فتح الحجز" aria-label="إعادة فتح الحجز" className={`${iconBtn} border-amber-200 bg-white text-amber-700 hover:bg-amber-50`}><RotateCcw size={14} /></button>
                      )}
                      {!item.orderOnly && status !== 'cancelled' && (
                        <button disabled={busy} onClick={() => void setStatus(item, 'cancelled', 'ملغاة')} title="إلغاء" aria-label="إلغاء" className={`${iconBtn} border-amber-200 bg-white text-amber-700 hover:bg-amber-50`}><X size={14} /></button>
                      )}
                      {!item.orderOnly && (
                        <button disabled={busy} onClick={() => void editNotes(item)} title="ملاحظات الجلسة" aria-label="ملاحظات الجلسة" className={`${iconBtn} border-gray-200 bg-white text-gray-600 hover:bg-gray-50`}><StickyNote size={14} /></button>
                      )}
                      {!item.orderOnly && (
                        <button disabled={busy} onClick={() => void editLink(item)} title={meetingLink ? 'تعديل رابط الجلسة' : 'إضافة رابط الجلسة'} aria-label="رابط الجلسة" className={`${iconBtn} border-gray-200 bg-white text-gray-600 hover:bg-gray-50`}><Link2 size={14} /></button>
                      )}
                      {meetingLink && (
                        <a href={meetingLink} target="_blank" rel="noopener noreferrer" title="فتح رابط الجلسة" aria-label="فتح رابط الجلسة" className={`${iconBtn} border-gray-200 bg-white text-gray-600 hover:bg-gray-50`}><ExternalLink size={14} /></a>
                      )}
                      <button disabled={busy} onClick={() => void remove(item)} title="حذف" aria-label="حذف" className={`${iconBtn} border-red-200 bg-red-50 text-red-500 hover:bg-red-100`}><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
                {notes && (
                  <p className="mt-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-gray-600"><b className="text-gray-500">ملاحظات: </b>{notes}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
