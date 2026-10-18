import { AlarmClock, Banknote } from 'lucide-react';
import { cairoDay } from '../../../shared/cairoDate';
import { Modal } from '../../../shared/ui/Modal';
import type { TabKey } from './navigation';
import { toDialable } from '../../lib/whatsappLink';
import type { DueInstallment, OnlineManagerSummary } from './useOnlineManagerSummary';

type DashboardOnlineManagerPanelsProps = {
  followupOpen: boolean;
  newEventsOpen: boolean;
  /** What the server counted and listed (GET /api/staff/online-manager-summary); null until it answers. */
  summary: OnlineManagerSummary | null;
  setFollowupOpen: (open: boolean) => void;
  setNewEventsOpen: (open: boolean) => void;
  setActiveTab: (tab: TabKey) => void;
};

type NewClient = OnlineManagerSummary['newClients']['rows'][number];
type NewPayItem = OnlineManagerSummary['newPayments']['rows'][number];

// Delegates to the shared rule — this used to build country code "2".
const whatsappDigits = (phone: string) => toDialable(phone);

export function DashboardOnlineManagerPanels({
  followupOpen,
  newEventsOpen,
  summary,
  setFollowupOpen,
  setNewEventsOpen,
  setActiveTab,
}: DashboardOnlineManagerPanelsProps) {
  const openOnlineClients = (closePanel: (open: boolean) => void) => {
    closePanel(false);
    setActiveTab('online_clients');
  };

  return (
    <>
      {followupOpen && (
        <OnlineManagerFollowupPanel
          summary={summary}
          onClose={() => setFollowupOpen(false)}
          onOpenOnlineClients={() => openOnlineClients(setFollowupOpen)}
        />
      )}

      {newEventsOpen && (
        <OnlineManagerNewEventsPanel
          summary={summary}
          onClose={() => setNewEventsOpen(false)}
          onOpenOnlineClients={() => openOnlineClients(setNewEventsOpen)}
        />
      )}
    </>
  );
}

function OnlineManagerFollowupPanel({
  summary,
  onClose,
  onOpenOnlineClients,
}: {
  summary: OnlineManagerSummary | null;
  onClose: () => void;
  onOpenOnlineClients: () => void;
}) {
  const overdueEntries = summary?.installments.overdueRows ?? [];
  const upcomingEntries = summary?.installments.upcomingRows ?? [];
  const overdueCount = summary?.installments.overdue ?? 0;
  const upcomingCount = summary?.installments.upcoming ?? 0;

  return (
    <Modal
      open
      onClose={onClose}
      title="متابعات التحصيل والأقساط"
      subtitle={`${overdueCount} قسط متأخر · ${upcomingCount} قسط قادم خلال 7 أيام`}
      icon={<AlarmClock size={18} className="text-teal-600" />}
      align="drawer"
      bodyClassName="p-0"
    >
        <div className="grid grid-cols-2 gap-0 border-b border-gray-100">
          {[
            { label: 'متأخرة', val: overdueCount, color: overdueCount > 0 ? 'text-red-600 bg-red-50' : 'text-gray-400 bg-gray-50' },
            { label: 'قادمة (7 أيام)', val: upcomingCount, color: upcomingCount > 0 ? 'text-amber-600 bg-amber-50' : 'text-gray-400 bg-gray-50' },
          ].map((card) => (
            <div key={card.label} className={`${card.color} py-3 text-center`}>
              <div className="text-2xl font-extrabold">{card.val}</div>
              <div className="text-[11px] font-medium opacity-80">{card.label}</div>
            </div>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {overdueEntries.length > 0 && (
            <InstallmentEntryList title={`متأخرة (${overdueCount})`} titleClass="text-red-600 bg-red-50 border-red-200" entries={overdueEntries} rowClass="bg-red-50 border-red-100" dateClass="text-red-600" />
          )}
          {upcomingEntries.length > 0 && (
            <InstallmentEntryList title={`قادمة (${upcomingCount})`} titleClass="text-amber-600 bg-amber-50 border-amber-200" entries={upcomingEntries} rowClass="bg-amber-50 border-amber-100" dateClass="text-amber-700" />
          )}
          {overdueCount === 0 && upcomingCount === 0 && (
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
    </Modal>
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
  entries: DueInstallment[];
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
              <p className="font-bold text-gray-800 text-sm truncate">{entry.name}</p>
              <p className="text-[11px] text-gray-500">{entry.courseTitle || 'قسط'} · {entry.amount} {entry.currency}</p>
              <p className={`text-[10px] font-bold ${dateClass}`}>📅 {entry.dueDate}</p>
            </div>
            <div className="flex-shrink-0 flex gap-1">
              {entry.phone && (
                <a href={`https://wa.me/${whatsappDigits(entry.phone)}`} target="_blank" rel="noopener noreferrer" className="w-7 h-7 rounded-full bg-green-500 hover:bg-green-600 text-white text-xs font-bold flex items-center justify-center">
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
  summary,
  onClose,
  onOpenOnlineClients,
}: {
  summary: OnlineManagerSummary | null;
  onClose: () => void;
  onOpenOnlineClients: () => void;
}) {
  const newSubs = summary?.newClients.rows ?? [];
  const newPayments = summary?.newPayments.rows ?? [];
  const newSubsCount = summary?.newClients.count ?? 0;
  const newPaymentsCount = summary?.newPayments.count ?? 0;

  return (
    <Modal
      open
      onClose={onClose}
      title="مشتركين جدد ومدفوعات"
      subtitle={`آخر 7 أيام · ${newSubsCount} مشترك جديد · ${newPaymentsCount} دفعة`}
      icon={<Banknote size={18} className="text-emerald-600" />}
      align="drawer"
      bodyClassName="p-0"
    >
        <div className="grid grid-cols-2 gap-0 border-b border-gray-100">
          {[
            { label: 'عملاء أونلاين جدد', val: newSubsCount, color: newSubsCount > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-gray-400 bg-gray-50' },
            { label: 'مدفوعات', val: newPaymentsCount, color: newPaymentsCount > 0 ? 'text-blue-600 bg-blue-50' : 'text-gray-400 bg-gray-50' },
          ].map((card) => (
            <div key={card.label} className={`${card.color} py-3 text-center`}>
              <div className="text-2xl font-extrabold">{card.val}</div>
              <div className="text-[11px] font-medium opacity-80">{card.label}</div>
            </div>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {newSubs.length > 0 && <NewSubscribersList subscribers={newSubs} count={newSubsCount} />}
          {newPayments.length > 0 && <NewPaymentsList payments={newPayments} count={newPaymentsCount} />}
          {newSubsCount === 0 && newPaymentsCount === 0 && (
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
    </Modal>
  );
}

function NewSubscribersList({ subscribers, count }: { subscribers: NewClient[]; count: number }) {
  return (
    <div>
      <span className="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full mb-2 inline-block">
        🆕 مشتركين جدد ({count})
      </span>
      <div className="space-y-2">
        {subscribers.map((subscriber) => (
          <div key={subscriber.id} className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-gray-800 text-sm truncate">{subscriber.name}</p>
              <p className="text-[11px] text-gray-500">{subscriber.email}</p>
              <p className="text-[10px] text-emerald-700 font-bold">📅 {cairoDay(subscriber.createdAt)}</p>
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

function NewPaymentsList({ payments, count }: { payments: NewPayItem[]; count: number }) {
  return (
    <div>
      <span className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full mb-2 inline-block">
        💳 مدفوعات جديدة ({count})
      </span>
      <div className="space-y-2">
        {payments.map((item, index) => (
          <div key={index} className="bg-blue-50 border border-blue-100 rounded-xl p-3">
            <p className="font-bold text-gray-800 text-sm truncate">{item.name}</p>
            <p className="text-[11px] text-gray-500">{item.amount} {item.currency} · {item.paymentType || 'دفعة'}</p>
            <p className="text-[10px] text-blue-700 font-bold">📅 {cairoDay(item.at)}</p>
          </div>
        ))}
        {count > payments.length && <p className="text-xs text-gray-400 text-center">+{count - payments.length} دفعة أخرى</p>}
      </div>
    </div>
  );
}
