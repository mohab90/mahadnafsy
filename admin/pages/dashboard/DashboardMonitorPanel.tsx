import { Activity, CalendarDays, MessageSquareText, Phone, TrendingUp, Users, X } from 'lucide-react';
import type { LeadItem, SubscriberItem } from '../../types';
import { toDialable } from '../../lib/whatsappLink';

type DashboardMonitorPanelProps = {
  open: boolean;
  leads: LeadItem[];
  subscribers: SubscriberItem[];
  setOpen: (open: boolean) => void;
};

export function DashboardMonitorPanel({ open, leads, subscribers, setOpen }: DashboardMonitorPanelProps) {
  if (!open) return null;

  const todayStr = new Date().toISOString().slice(0, 10);
  const in7days = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  const salesLeads = leads
    .filter((lead) => !lead.hidden && lead.nextFollowUpDate && lead.nextFollowUpDate <= todayStr && !['converted', 'lost'].includes(lead.status || ''))
    .sort((a, b) => {
      const aOverdue = (a.nextFollowUpDate || '') < todayStr;
      const bOverdue = (b.nextFollowUpDate || '') < todayStr;
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      return (a.nextFollowUpDate || '').localeCompare(b.nextFollowUpDate || '');
    })
    .slice(0, 60);

  const collectionSubscribers = subscribers
    .filter((subscriber) => (subscriber.installmentPlans || []).some((plan) => (plan.entries || []).some((entry) => !entry.paidAt && entry.dueDate < todayStr)))
    .map((subscriber) => {
      const overdueEntries = (subscriber.installmentPlans || []).flatMap((plan) => (plan.entries || []).filter((entry) => !entry.paidAt && entry.dueDate < todayStr));
      const totalOverdue = overdueEntries.reduce((sum, entry) => sum + (entry.amount || 0), 0);
      const nearEntries = (subscriber.installmentPlans || []).flatMap((plan) => (plan.entries || []).filter((entry) => !entry.paidAt && entry.dueDate >= todayStr && entry.dueDate <= in7days));
      return { subscriber, overdueEntries, totalOverdue, nearEntries };
    })
    .sort((a, b) => b.overdueEntries.length - a.overdueEntries.length || b.totalOverdue - a.totalOverdue)
    .slice(0, 60);

  const daqqiItems = subscribers
    .filter((subscriber) => subscriber.branch === 'DAQQI' || subscriber.branch === 'دقي')
    .map((subscriber) => {
      const overdueEntries = (subscriber.installmentPlans || []).flatMap((plan) => (plan.entries || []).filter((entry) => !entry.paidAt && entry.dueDate < todayStr));
      const totalOverdue = overdueEntries.reduce((sum, entry) => sum + (entry.amount || 0), 0);
      return { subscriber, overdueEntries, totalOverdue };
    })
    .sort((a, b) => b.overdueEntries.length - a.overdueEntries.length)
    .slice(0, 60);

  const totalCount = salesLeads.length + collectionSubscribers.length;

  return (
    <>
      <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
      <div className="fixed top-14 left-3 bottom-3 z-[9999] w-[340px] bg-white rounded-2xl shadow-2xl border border-violet-200 flex flex-col overflow-hidden" dir="rtl">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-violet-100 flex-shrink-0 bg-violet-50">
          <div className="w-9 h-9 rounded-xl bg-violet-600 grid place-items-center flex-shrink-0 shadow-sm">
            <Activity size={16} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-sm text-gray-800">لوحة المتابعة</div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              سيلز · تحصيل · دقي &nbsp;·&nbsp; <span className="font-bold text-violet-600">{totalCount} تنبيه</span>
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="w-7 h-7 rounded-xl bg-white/80 hover:bg-white text-gray-400 hover:text-gray-700 grid place-items-center transition flex-shrink-0 shadow-sm">
            <X size={13} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-4">
          <SalesFollowupList leads={salesLeads} todayStr={todayStr} />
          <CollectionFollowupList entries={collectionSubscribers} />
          <DaqqiFollowupList entries={daqqiItems} />
        </div>
      </div>
    </>
  );
}

function ContactButtons({ phone }: { phone: string }) {
  return (
    <div className="flex flex-col gap-1 flex-shrink-0 mt-0.5">
      <a href={`tel:${phone}`} className="w-6 h-6 rounded-lg bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 grid place-items-center transition" title="اتصال">
        <Phone size={10} />
      </a>
      <a href={`https://wa.me/${toDialable(phone)}`} target="_blank" rel="noreferrer" className="w-6 h-6 rounded-lg bg-white border border-green-200 text-green-600 hover:bg-green-50 grid place-items-center transition" title="واتساب">
        <MessageSquareText size={10} />
      </a>
    </div>
  );
}

function SalesFollowupList({ leads, todayStr }: { leads: LeadItem[]; todayStr: string }) {
  return (
    <div>
      <div className="text-[10px] font-extrabold text-violet-600 px-1 mb-1.5 flex items-center gap-1.5">
        <TrendingUp size={10} /> السيلز
        <span className="bg-violet-100 text-violet-700 rounded-full px-1.5">{leads.length}</span>
      </div>
      {leads.length === 0 ? (
        <div className="text-center py-3 text-gray-400 text-xs bg-gray-50 rounded-xl">🎉 لا توجد متابعات متأخرة</div>
      ) : leads.map((lead) => {
        const isOverdue = (lead.nextFollowUpDate || '') < todayStr;
        return (
          <div key={lead.id} className={`flex items-start gap-2 rounded-xl px-3 py-2 border mb-1.5 ${isOverdue ? 'bg-red-50 border-red-100' : 'bg-orange-50 border-orange-100'}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="font-bold text-gray-800 text-xs truncate max-w-[150px]">{lead.name}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isOverdue ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                  {isOverdue ? '⚠️ متأخر' : '🔔 اليوم'} · {lead.nextFollowUpDate}
                </span>
              </div>
              {lead.assignedSalesName && <span className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-full mt-0.5 inline-block">👤 {lead.assignedSalesName}</span>}
              <div className="text-[10px] text-gray-400 mt-0.5" dir="ltr">{lead.phone}</div>
            </div>
            <ContactButtons phone={lead.phone || ''} />
          </div>
        );
      })}
    </div>
  );
}

function CollectionFollowupList({
  entries,
}: {
  entries: { subscriber: SubscriberItem; overdueEntries: unknown[]; totalOverdue: number; nearEntries: unknown[] }[];
}) {
  return (
    <div>
      <div className="text-[10px] font-extrabold text-teal-600 px-1 mb-1.5 flex items-center gap-1.5">
        <Users size={10} /> التحصيل
        <span className="bg-teal-100 text-teal-700 rounded-full px-1.5">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className="text-center py-3 text-gray-400 text-xs bg-gray-50 rounded-xl">🎉 لا توجد أقساط متأخرة</div>
      ) : entries.map(({ subscriber, overdueEntries, totalOverdue, nearEntries }) => (
        <div key={subscriber.id} className="rounded-xl px-3 py-2 border bg-white border-gray-100 shadow-sm mb-1.5">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="font-bold text-gray-800 text-xs truncate max-w-[150px]">{subscriber.name}</span>
                {overdueEntries.length > 0 && <span className="text-[10px] font-bold bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded-full">{overdueEntries.length} قسط · {Math.round(totalOverdue).toLocaleString()} ج</span>}
                {nearEntries.length > 0 && <span className="text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full">{nearEntries.length} قريباً</span>}
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5" dir="ltr">{subscriber.phone}</div>
            </div>
            <ContactButtons phone={subscriber.phone || ''} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DaqqiFollowupList({
  entries,
}: {
  entries: { subscriber: SubscriberItem; overdueEntries: unknown[]; totalOverdue: number }[];
}) {
  return (
    <div>
      <div className="text-[10px] font-extrabold text-amber-600 px-1 mb-1.5 flex items-center gap-1.5">
        <CalendarDays size={10} /> الدقي
        <span className="bg-amber-100 text-amber-700 rounded-full px-1.5">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className="text-center py-3 text-gray-400 text-xs bg-gray-50 rounded-xl">👍 لا يوجد عملاء دقي متأخرون</div>
      ) : entries.map(({ subscriber, overdueEntries, totalOverdue }) => (
        <div key={subscriber.id} className="rounded-xl px-3 py-2 border bg-white border-gray-100 shadow-sm mb-1.5">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="font-bold text-gray-800 text-xs truncate max-w-[150px]">{subscriber.name}</span>
                {overdueEntries.length > 0 && <span className="text-[10px] font-bold bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded-full">{overdueEntries.length} قسط · {Math.round(totalOverdue).toLocaleString()} ج</span>}
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5" dir="ltr">{subscriber.phone}</div>
            </div>
            <ContactButtons phone={subscriber.phone || ''} />
          </div>
        </div>
      ))}
    </div>
  );
}
