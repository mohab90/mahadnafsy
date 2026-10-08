import { useMemo, useState } from 'react';
import { Activity, BookOpen, CreditCard, FileBadge, Headphones, MessageCircle, PhoneCall, ShieldCheck, ShoppingBag, UserPlus } from 'lucide-react';
import type { CustomerTimelineEvent } from '../../types';
import { CAIRO_TIME_ZONE } from '../../../shared/cairoDate';

/**
 * «رحلة العميل» (8 Oct 2026: «محتاجه اشبه بالتايم لاين ويبقي فيه تفاصيل اكتر»):
 * the client's whole story on one rail — the lead they were, every call and
 * note, each payment with how it was paid, the courses opened at what level,
 * certificates, support, and what the desk changed — by day, in Arabic, each
 * signed by name (api/lib/customerTimeline.js).
 */

const PAYMENT_TYPE: Record<string, string> = {
  COURSE: 'كورس', BUNDLE: 'مسار', CERTIFICATE: 'شهادة', CARNEH: 'كارنيه', BOOK: 'كتاب',
  CONSULTATION: 'استشارة', OTHER: 'دفعة', course: 'كورس', bundle: 'مسار', certificate: 'شهادة',
};
const EVENT_LABEL: Record<string, string> = {
  payment_paid: 'دفعة اتسجلت', payment_pending: 'دفعة مستنية الموافقة', payment_refunded: 'دفعة اتردت',
  payment_rejected: 'دفعة اترفضت', payment_cancelled: 'دفعة اتلغت', payment_failed: 'دفعة فشلت',
  entitlement_granted: 'فتح كورس', entitlement_revoked: 'قفل كورس', entitlement_expired: 'انتهى اشتراك كورس',
  certificate_issued: 'شهادة اتصدرت', certificate_revoked: 'شهادة اتلغت', certificate_reissued: 'شهادة اتصدرت تاني',
  support_open: 'تذكرة دعم مفتوحة', support_in_progress: 'تذكرة دعم تحت المعالجة', support_resolved: 'تذكرة دعم اتحلت',
  support_closed: 'تذكرة دعم اتقفلت', support_pending: 'تذكرة دعم مستنية',
  order_pending: 'طلب من الموقع مستني الدفع', order_paid: 'طلب من الموقع اتدفع', order_cancelled: 'طلب من الموقع اتلغى',
  order_refunded: 'طلب من الموقع اترد', order_failed: 'طلب من الموقع فشل',
  contact_call: 'مكالمة', contact_whatsapp: 'واتساب', contact_note: 'ملاحظة', contact_meeting: 'مقابلة',
  contact_email: 'إيميل', contact_sms: 'رسالة SMS', contact_visit: 'زيارة',
  lead_created: 'وصل كعميل محتمل',
  course_removed: 'مسح كورس', course_transferred: 'تحويل كورس', refund_requested: 'طلب استرداد',
  refund_approved: 'استرداد', refund_rejected: 'رفض استرداد', refund_handling: 'معالجة استرداد',
  create: 'إضافة', update: 'تعديل', delete: 'حذف',
};

type Filter = 'all' | 'money' | 'courses' | 'certificates' | 'contact' | 'support' | 'desk';
const FILTERS: Array<{ key: Filter; label: string; categories: CustomerTimelineEvent['category'][] }> = [
  { key: 'all', label: 'الكل', categories: [] },
  { key: 'money', label: 'الفلوس', categories: ['payment', 'order'] },
  { key: 'courses', label: 'الكورسات', categories: ['learning'] },
  { key: 'certificates', label: 'الشهادات', categories: ['certificate'] },
  { key: 'contact', label: 'التواصل', categories: ['contact', 'lead'] },
  { key: 'support', label: 'الدعم', categories: ['support'] },
  { key: 'desk', label: 'تعديلات', categories: ['client'] },
];

const STYLE: Record<CustomerTimelineEvent['category'], { icon: typeof Activity; dot: string }> = {
  payment: { icon: CreditCard, dot: 'bg-emerald-500' },
  order: { icon: ShoppingBag, dot: 'bg-teal-500' },
  learning: { icon: BookOpen, dot: 'bg-indigo-500' },
  certificate: { icon: FileBadge, dot: 'bg-amber-500' },
  support: { icon: Headphones, dot: 'bg-rose-500' },
  contact: { icon: PhoneCall, dot: 'bg-sky-500' },
  lead: { icon: UserPlus, dot: 'bg-violet-500' },
  client: { icon: ShieldCheck, dot: 'bg-slate-500' },
};

const money = (value: unknown) => Number(value || 0).toLocaleString('ar-EG-u-nu-latn');
const dayKey = (at: string) => new Intl.DateTimeFormat('en-CA', { timeZone: CAIRO_TIME_ZONE }).format(new Date(at));
const dayTitle = (key: string) => {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  if (key === today) return 'النهارده';
  if (key === yesterday) return 'امبارح';
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${key}T00:00:00Z`));
};
const timeOf = (at: string) => new Date(at).toLocaleTimeString('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit', timeZone: CAIRO_TIME_ZONE });

/** The headline and the line under it, from the event and its detail. */
function describe(event: CustomerTimelineEvent): { head: string; sub: string[] } {
  const detail = (event.detail || {}) as Record<string, unknown>;
  const label = EVENT_LABEL[event.event_type] || EVENT_LABEL[event.status || ''] || event.event_type.replace(/_/g, ' ');
  const sub: string[] = [];
  if (event.category === 'payment') {
    const type = String(detail.type || '');
    const title = PAYMENT_TYPE[event.title] ? '' : event.title;
    const head = `${Number(detail.installment) ? 'قسط' : label}${type && type !== 'COURSE' && PAYMENT_TYPE[type] ? ` — ${PAYMENT_TYPE[type]}` : ''}${title ? ` · ${title}` : ''}`;
    if (detail.method) sub.push(`طريقة الدفع: ${String(detail.method).trim()}`);
    if (Number(detail.expected) > 0) sub.push(`سعر الكورس ${money(detail.expected)}`);
    if (detail.note) sub.push(String(detail.note));
    if (event.status && event.status !== 'paid') sub.push(EVENT_LABEL[`payment_${event.status}`] || event.status);
    return { head, sub };
  }
  if (event.category === 'learning') {
    const meta = (typeof detail.meta === 'string' ? (() => { try { return JSON.parse(detail.meta as string); } catch { return {}; } })() : detail.meta || {}) as Record<string, unknown>;
    if (event.event_type === 'entitlement_granted') {
      sub.push(meta.accessType === 'full' ? 'وصول كامل' : meta.lectureLimit ? `وصول محدود — ${meta.lectureLimit} محاضرة` : 'وصول محدود');
    }
    const source = String(detail.source || '');
    if (/payment/.test(source)) sub.push('مع دفعة');
    else if (/manual|desk/.test(source)) sub.push('من الموظف');
    return { head: `${label} · ${event.title}`, sub };
  }
  if (event.category === 'contact') {
    if (event.status) sub.push(`النتيجة: ${event.status}`);
    if (detail.next) sub.push(`المتابعة الجاية: ${String(detail.next).slice(0, 10)}`);
    return { head: label, sub: event.title ? [event.title, ...sub] : sub };
  }
  if (event.category === 'lead') {
    if (event.title) sub.push(`المصدر: ${event.title}`);
    if (detail.rep) sub.push(`السيلز: ${detail.rep}`);
    return { head: label, sub };
  }
  if (event.category === 'support') {
    if (detail.code) sub.push(`رقم ${detail.code}`);
    if (detail.resolution) sub.push(`الحل: ${detail.resolution}`);
    return { head: `${label}: ${event.title}`, sub };
  }
  if (event.category === 'certificate') {
    if (detail.code) sub.push(`كود ${detail.code}`);
    if (detail.reason) sub.push(String(detail.reason));
    return { head: `${label} · ${event.title}`, sub };
  }
  if (event.category === 'order') return { head: `${label} · ${event.title}`, sub: detail.method ? [`طريقة الدفع: ${detail.method}`] : [] };
  return { head: event.title || label, sub: [] };
}

export function ClientJourneyTimeline({ events }: { events: CustomerTimelineEvent[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(30);
  const picked = FILTERS.find(item => item.key === filter)!;
  const list = useMemo(
    () => events.filter(event => filter === 'all' || picked.categories.includes(event.category)),
    [events, filter, picked],
  );
  const days = useMemo(() => {
    const grouped = new Map<string, CustomerTimelineEvent[]>();
    for (const event of list.slice(0, shown)) {
      const key = dayKey(event.occurred_at);
      grouped.set(key, [...(grouped.get(key) || []), event]);
    }
    return [...grouped.entries()];
  }, [list, shown]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(item => [item.key,
    item.key === 'all' ? events.length : events.filter(event => item.categories.includes(event.category)).length])), [events]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-800">
          <Activity size={16} className="text-indigo-500" /> رحلة العميل
        </h3>
        <div className="flex flex-wrap gap-1">
          {FILTERS.filter(item => item.key === 'all' || counts[item.key] > 0).map(item => (
            <button key={item.key} type="button" onClick={() => { setFilter(item.key); setShown(30); }}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${filter === item.key ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'}`}>
              {item.label} <span className="opacity-70">{counts[item.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">مفيش أحداث هنا لسه</p>
      ) : days.map(([key, dayEvents]) => (
        <div key={key} className="mb-4 last:mb-0">
          <p className="mb-2 text-[11px] font-extrabold text-slate-500">{dayTitle(key)}</p>
          <ol className="relative border-r-2 border-slate-100 pr-4 space-y-3">
            {dayEvents.map(event => {
              const { icon: Icon, dot } = STYLE[event.category] || STYLE.client;
              const { head, sub } = describe(event);
              return (
                <li key={`${event.category}:${event.entity_id}:${event.occurred_at}`} className="relative">
                  <span className={`absolute -right-[25px] top-1 flex h-5 w-5 items-center justify-center rounded-full ${dot} text-white ring-4 ring-white`}>
                    <Icon size={11} />
                  </span>
                  <div className={`rounded-xl px-3 py-2 ${event.category === 'client' ? 'border border-amber-100 bg-amber-50' : 'bg-slate-50'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs font-bold leading-5 text-slate-800">{head}</p>
                      {event.amount != null && (
                        <span className={`shrink-0 text-xs font-extrabold ${Number(event.amount) < 0 || event.status === 'refunded' ? 'text-rose-600' : 'text-emerald-700'}`}>
                          {money(event.amount)} {event.currency === 'SAR' ? 'ر.س' : event.currency === 'USD' ? '$' : 'ج.م'}
                        </span>
                      )}
                    </div>
                    {sub.length > 0 && <p className="mt-0.5 text-[11px] leading-5 text-slate-500 whitespace-pre-wrap">{sub.join(' · ')}</p>}
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {timeOf(event.occurred_at)}
                      {event.actor && <span className="font-semibold text-slate-500"> · بواسطة {event.actor}</span>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}

      {list.length > shown && (
        <button type="button" onClick={() => setShown(count => count + 30)}
          className="mt-2 w-full rounded-xl border border-slate-200 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
          <MessageCircle size={12} className="inline ml-1" /> عرض أقدم ({list.length - shown})
        </button>
      )}
    </section>
  );
}
