import React, { useEffect, useState } from 'react';
import { Award, BookOpen, CreditCard, LifeBuoy, ShoppingBag } from 'lucide-react';
import { mysqlClient } from '../../lib/mysqlapi';

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

const eventLabel = (event: TimelineEvent) => {
  const labels: Record<string, string> = {
    entitlement_granted: 'تم تفعيل الاشتراك',
    entitlement_revoked: 'تم إلغاء الاشتراك',
    certificate_issued: 'تم إصدار الشهادة',
    certificate_revoked: 'تم إلغاء الشهادة',
    certificate_reissued: 'تمت إعادة إصدار الشهادة',
    payment_paid: 'تم تأكيد الدفع',
    payment_refunded: 'تم رد الدفعة',
    order_paid: 'تم سداد الطلب',
  };
  return labels[event.event_type] || event.title || event.status;
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
                  </div>
                  {event.amount != null && <span className="text-xs font-bold text-emerald-700">{Number(event.amount).toLocaleString()} {event.currency}</span>}
                </div>
                <p className="text-[11px] text-gray-400 mt-1">{new Date(event.occurred_at).toLocaleString('ar-EG')}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
