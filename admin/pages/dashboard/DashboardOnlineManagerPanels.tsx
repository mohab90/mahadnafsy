import { AlarmClock, Banknote } from 'lucide-react';
import type { InstallmentEntry, InstallmentPlan, PaymentHistoryEntry, SubscriberItem } from '../../types';
import type { TabKey } from './navigation';
import { toDialable } from '../../lib/whatsappLink';

type DashboardOnlineManagerPanelsProps = {
  followupOpen: boolean;
  newEventsOpen: boolean;
  isNonAdminStaff: boolean;
  subscribers: SubscriberItem[];
  salesOwnSubscribers: SubscriberItem[];
  setFollowupOpen: (open: boolean) => void;
  setNewEventsOpen: (open: boolean) => void;
  setActiveTab: (tab: TabKey) => void;
};

type OverdueEntry = { sub: SubscriberItem; plan: InstallmentPlan; entry: InstallmentEntry };
type NewPayItem = { sub: SubscriberItem; payment: PaymentHistoryEntry };

// Delegates to the shared rule — this used to build country code "2".
const whatsappDigits = (phone: string) => toDialable(phone);

export function DashboardOnlineManagerPanels({
  followupOpen,
  newEventsOpen,
  isNonAdminStaff,
  subscribers,
  salesOwnSubscribers,
  setFollowupOpen,
  setNewEventsOpen,
  setActiveTab,
}: DashboardOnlineManagerPanelsProps) {
  const scopedSubscribers = isNonAdminStaff ? salesOwnSubscribers : subscribers;

  const openOnlineClients = (closePanel: (open: boolean) => void) => {
    closePanel(false);
    setActiveTab('online_clients');
  };

  return (
    <>
      {followupOpen && (
        <OnlineManagerFollowupPanel
          subscribers={scopedSubscribers}
          onClose={() => setFollowupOpen(false)}
          onOpenOnlineClients={() => openOnlineClients(setFollowupOpen)}
        />
      )}

      {newEventsOpen && (
        <OnlineManagerNewEventsPanel
          subscribers={scopedSubscribers}
          onClose={() => setNewEventsOpen(false)}
          onOpenOnlineClients={() => openOnlineClients(setNewEventsOpen)}
        />
      )}
    </>
  );
}

function OnlineManagerFollowupPanel({
  subscribers,
  onClose,
  onOpenOnlineClients,
}: {
  subscribers: SubscriberItem[];
  onClose: () => void;
  onOpenOnlineClients: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const overdueEntries: OverdueEntry[] = [];
  const upcomingEntries: OverdueEntry[] = [];

  for (const sub of subscribers) {
    for (const plan of sub.installmentPlans || []) {
      for (const entry of plan.entries || []) {
        if (entry.paidAt) continue;
        if (entry.dueDate <= today) overdueEntries.push({ sub, plan, entry });
        else if (entry.dueDate <= soon) upcomingEntries.push({ sub, plan, entry });
      }
    }
  }

  overdueEntries.sort((a, b) => a.entry.dueDate.localeCompare(b.entry.dueDate));
  upcomingEntries.sort((a, b) => a.entry.dueDate.localeCompare(b.entry.dueDate));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-end" onClick={onClose}>
      <div className="bg-white h-full w-full max-w-md shadow-2xl flex flex-col" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gradient-to-l from-teal-50 to-white">
          <div>
            <h2 className="font-bold text-gray-900 text-lg flex items-center gap-2">
              <AlarmClock size={18} className="text-teal-600" /> متابعات التحصيل والأقساط
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {overdueEntries.length} قسط متأخر · {upcomingEntries.length} قسط قادم خلال 7 أيام
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>
        <div className="grid grid-cols-2 gap-0 border-b border-gray-100">
          {[
            { label: 'متأخرة', val: overdueEntries.length, color: overdueEntries.length > 0 ? 'text-red-600 bg-red-50' : 'text-gray-400 bg-gray-50' },
            { label: 'قادمة (7 أيام)', val: upcomingEntries.length, color: upcomingEntries.length > 0 ? 'text-amber-600 bg-amber-50' : 'text-gray-400 bg-gray-50' },
          ].map((card) => (
            <div key={card.label} className={`${card.color} py-3 text-center`}>
              <div className="text-2xl font-extrabold">{card.val}</div>
              <div className="text-[11px] font-medium opacity-80">{card.label}</div>
            </div>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {overdueEntries.length > 0 && (
            <InstallmentEntryList title={`متأخرة (${overdueEntries.length})`} titleClass="text-red-600 bg-red-50 border-red-200" entries={overdueEntries} rowClass="bg-red-50 border-red-100" dateClass="text-red-600" />
          )}
          {upcomingEntries.length > 0 && (
            <InstallmentEntryList title={`قادمة (${upcomingEntries.length})`} titleClass="text-amber-600 bg-amber-50 border-amber-200" entries={upcomingEntries} rowClass="bg-amber-50 border-amber-100" dateClass="text-amber-700" />
          )}
          {overdueEntries.length === 0 && upcomingEntries.length === 0 && (
            <div className="text-center py-20">
              <div className="text-5xl mb-3">?</div>
              <p className="text-gray-500 font-bold">لا توجد أقساط متأخرة أو قادمة</p>
            </div>
          )}
        </div>
        <div className="border-t border-gray-200 px-5 py-4 bg-gray-50">
          <button onClick={onOpenOnlineClients} className="w-full py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold rounded-xl transition">
            عرض عملاء الاونلاين
          </button>
        </div>
      </div>
    </div>
  );
}

function InstallmentEntryList({
  title,
  titleClass,
  entries,
  rowClass,
  dateClass,
}: {
  title: string;
  titleClass: string;
  entries: OverdueEntry[];
  rowClass: string;
  dateClass: string;
}) {
  return (
    <div>
      <span className={`text-xs font-bold border px-2 py-0.5 rounded-full mb-2 inline-block ${titleClass}`}>{title}</span>
      <div className="space-y-2">
        {entries.map((entry, index) => (
          <div key={index} className={`${rowClass} border rounded-xl p-3 flex items-center justify-between gap-2`}>
            <div className="min-w-0">
              <p className="font-bold text-gray-800 text-sm truncate">{entry.sub.name}</p>
              <p className="text-[11px] text-gray-500">{entry.plan.courseTitle || 'قسط'} · {entry.entry.amount} {entry.entry.currency}</p>
              <p className={`text-[10px] font-bold ${dateClass}`}>📅 {entry.entry.dueDate}</p>
            </div>
            <div className="flex-shrink-0 flex gap-1">
              {entry.sub.phone && (
                <a href={`https://wa.me/${whatsappDigits(entry.sub.phone)}`} target="_blank" rel="noopener noreferrer" className="w-7 h-7 rounded-full bg-green-500 hover:bg-green-600 text-white text-xs font-bold flex items-center justify-center">
                  W
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OnlineManagerNewEventsPanel({
  subscribers,
  onClose,
  onOpenOnlineClients,
}: {
  subscribers: SubscriberItem[];
  onClose: () => void;
  onOpenOnlineClients: () => void;
}) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const newSubs = subscribers
    .filter((subscriber) => subscriber.createdAt && subscriber.createdAt.slice(0, 10) >= since)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const newPayments: NewPayItem[] = subscribers
    .flatMap((subscriber) => (subscriber.paymentHistory || [])
      .filter((payment) => payment.at && payment.at.slice(0, 10) >= since)
      .map((payment) => ({ sub: subscriber, payment })))
    .sort((a, b) => (b.payment.at || '').localeCompare(a.payment.at || ''));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-end" onClick={onClose}>
      <div className="bg-white h-full w-full max-w-md shadow-2xl flex flex-col" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gradient-to-l from-emerald-50 to-white">
          <div>
            <h2 className="font-bold text-gray-900 text-lg flex items-center gap-2">
              <Banknote size={18} className="text-emerald-600" /> مشتركين جدد ومدفوعات
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">آخر 7 أيام · {newSubs.length} مشترك جديد · {newPayments.length} دفعة</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>
        <div className="grid grid-cols-2 gap-0 border-b border-gray-100">
          {[
            { label: 'عملاء أونلاين جدد', val: newSubs.length, color: newSubs.length > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-gray-400 bg-gray-50' },
            { label: 'مدفوعات', val: newPayments.length, color: newPayments.length > 0 ? 'text-blue-600 bg-blue-50' : 'text-gray-400 bg-gray-50' },
          ].map((card) => (
            <div key={card.label} className={`${card.color} py-3 text-center`}>
              <div className="text-2xl font-extrabold">{card.val}</div>
              <div className="text-[11px] font-medium opacity-80">{card.label}</div>
            </div>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {newSubs.length > 0 && <NewSubscribersList subscribers={newSubs} />}
          {newPayments.length > 0 && <NewPaymentsList payments={newPayments} />}
          {newSubs.length === 0 && newPayments.length === 0 && (
            <div className="text-center py-20">
              <div className="text-5xl mb-3">📭</div>
              <p className="text-gray-500 font-bold">لا توجد أحداث جديدة في آخر 7 أيام</p>
            </div>
          )}
        </div>
        <div className="border-t border-gray-200 px-5 py-4 bg-gray-50">
          <button onClick={onOpenOnlineClients} className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition">
            عرض عملاء الاونلاين
          </button>
        </div>
      </div>
    </div>
  );
}

function NewSubscribersList({ subscribers }: { subscribers: SubscriberItem[] }) {
  return (
    <div>
      <span className="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full mb-2 inline-block">
        🆕 مشتركين جدد ({subscribers.length})
      </span>
      <div className="space-y-2">
        {subscribers.map((subscriber) => (
          <div key={subscriber.id} className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-gray-800 text-sm truncate">{subscriber.name}</p>
              <p className="text-[11px] text-gray-500">{subscriber.email}</p>
              <p className="text-[10px] text-emerald-700 font-bold">📅 {subscriber.createdAt?.slice(0, 10)}</p>
            </div>
            <div className="flex-shrink-0 flex gap-1">
              {subscriber.phone && (
                <a href={`https://wa.me/${whatsappDigits(subscriber.phone)}`} target="_blank" rel="noopener noreferrer" className="w-7 h-7 rounded-full bg-green-500 hover:bg-green-600 text-white text-xs font-bold flex items-center justify-center">
                  W
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewPaymentsList({ payments }: { payments: NewPayItem[] }) {
  return (
    <div>
      <span className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full mb-2 inline-block">
        💳 مدفوعات جديدة ({payments.length})
      </span>
      <div className="space-y-2">
        {payments.slice(0, 30).map((item, index) => (
          <div key={index} className="bg-blue-50 border border-blue-100 rounded-xl p-3">
            <p className="font-bold text-gray-800 text-sm truncate">{item.sub.name}</p>
            <p className="text-[11px] text-gray-500">{item.payment.amount} {item.payment.currency} · {item.payment.paymentType || 'دفعة'}</p>
            <p className="text-[10px] text-blue-700 font-bold">📅 {item.payment.at?.slice(0, 10)}</p>
          </div>
        ))}
        {payments.length > 30 && <p className="text-xs text-gray-400 text-center">+{payments.length - 30} دفعة أخرى</p>}
      </div>
    </div>
  );
}
