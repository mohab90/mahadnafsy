import { useEffect, useState } from 'react';
import { Award, BookOpen, CreditCard, LifeBuoy, ShoppingBag } from 'lucide-react';
import { mysqlClient } from '../../lib/mysqlapi';
import { CAIRO_TIME_ZONE } from '../../../shared/cairoDate';

interface TimelineEvent {
  category: 'payment' | 'learning' | 'certificate' | 'support' | 'order';
  event_type: string;
  entity_id: string;
  occurred_at: string;
  title: string;
  status: string;
  amount?: number | null;
  currency?: string | null;
}

const categoryMeta = {
  payment: { icon: CreditCard, color: 'bg-emerald-100 text-emerald-700' },
  learning: { icon: BookOpen, color: 'bg-blue-100 text-blue-700' },
  certificate: { icon: Award, color: 'bg-amber-100 text-amber-700' },
  support: { icon: LifeBuoy, color: 'bg-violet-100 text-violet-700' },
  order: { icon: ShoppingBag, color: 'bg-slate-100 text-slate-700' },
};

// Matched case-insensitively. event_type is built server-side as
// CONCAT('order_', o.status) and orders store PENDING/PAID in upper case, so
// 'order_paid' never matched anything — every order fell through to the branch
// below and was drawn as the item's own title next to a green amount. To a
// customer who had only sent a transfer screenshot, their page said
// "تدريب المدربين — 2,805 EGP" and read as a completed payment.
const LABELS: Record<string, string> = {
  entitlement_granted: 'تم تفعيل الاشتراك',
  entitlement_revoked: 'تم إلغاء الاشتراك',
  certificate_issued: 'تم إصدار الشهادة',
  certificate_revoked: 'تم إلغاء الشهادة',
  certificate_reissued: 'تمت إعادة إصدار الشهادة',
  payment_paid: 'تم تأكيد الدفع',
  payment_pending: 'في انتظار تأكيد الحسابات',
  payment_refunded: 'تم رد الدفعة',
  order_paid: 'تم سداد الطلب',
  order_pending: 'في انتظار تأكيد الحسابات',
  order_cancelled: 'تم إلغاء الطلب',
  order_failed: 'لم يكتمل الطلب',
};

/** Nothing here is money the institute has confirmed receiving. */
const isConfirmed = (event: TimelineEvent) => {
  const type = (event.event_type || '').toLowerCase();
  if (type.startsWith('order_') || type.startsWith('payment_')) {
    return type.endsWith('_paid') || type.endsWith('_refunded');
  }
  return true;
};

const eventLabel = (event: TimelineEvent) => {
  const label = LABELS[(event.event_type || '').toLowerCase()];
  if (label) return label;
  // An unrecognised money state must not borrow the item's title and look
  // settled — say plainly that it is still with the accounts team.
  if (!isConfirmed(event)) return 'في انتظار تأكيد الحسابات';
  return event.title || event.status;
};

export function StudentJourneyTimeline() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  useEffect(() => {
    let active = true;
    mysqlClient.getMyTimeline()
      .then(rows => { if (active) setEvents(rows as unknown as TimelineEvent[]); })
      .catch(() => { if (active) setEvents([]); });
    return () => { active = false; };
  }, []);

  if (!events.length) return null;
  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm" dir="rtl">
      <h3 className="font-extrabold text-gray-800 text-sm mb-4">رحلتي داخل المعهد</h3>
      <div className="space-y-3">
        {events.slice(0, 12).map(event => {
          const meta = categoryMeta[event.category] || categoryMeta.order;
          const Icon = meta.icon;
          return (
            <div key={`${event.category}:${event.entity_id}:${event.occurred_at}`} className="flex items-start gap-3">
              <span className={`w-8 h-8 rounded-xl grid place-items-center flex-shrink-0 ${meta.color}`}><Icon size={14} /></span>
              <div className="min-w-0 flex-1 border-b border-gray-50 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-gray-800">{eventLabel(event)}</p>
                    <p className="text-xs text-gray-500 truncate">{event.title}</p>
                    {!isConfirmed(event) && (
                      <span className="mt-1 inline-block rounded-lg bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                        لم يتم تأكيد الدفع بعد
                      </span>
                    )}
                  </div>
                  {/* Amber, not emerald: green is the colour of money received,
                      and an unconfirmed amount shown in it is the whole reason
                      a submitted screenshot looked like a completed payment. */}
                  {event.amount != null && (
                    <span className={`text-xs font-bold ${isConfirmed(event) ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {Number(event.amount).toLocaleString('ar-EG-u-nu-latn')} {event.currency}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 mt-1">{new Date(event.occurred_at).toLocaleString('ar-EG-u-nu-latn', { timeZone: CAIRO_TIME_ZONE })}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
