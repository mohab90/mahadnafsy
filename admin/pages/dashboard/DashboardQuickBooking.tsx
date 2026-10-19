import React from 'react';
import { Modal } from '../../../shared/ui/Modal';
import { Search } from 'lucide-react';
import type { NavigateFunction } from 'react-router-dom';
import type { LeadItem, SubscriberItem } from '../../types';
import type { PaymentDraft } from '../../components/PaymentModal';
import { createClientPaymentDraft } from '../../lib/clientActionDrafts';
import { currencyForBranch } from '../../lib/branchCurrency';
import { realCourseIds } from './tabs/leads/leadCourseLabel';
import { ClientLookupList, type LookupRow } from './ClientLookupResults';
import { WhatsAppFab } from '../../components/InSystemWhatsApp';
import type { NotifyFn } from '../../types';

type DashboardQuickBookingProps = {
  open: boolean;
  search: string;
  leads: LeadItem[];
  subscribers: SubscriberItem[];
  setOpen: (open: boolean) => void;
  setSearch: (value: string) => void;
  setLeadPayRow: (lead: LeadItem) => void;
  setLeadPayDraft: React.Dispatch<React.SetStateAction<PaymentDraft>>;
  setSubPayRow: (subscriber: SubscriberItem) => void;
  setSubPayDraft: React.Dispatch<React.SetStateAction<PaymentDraft>>;
  navigate: NavigateFunction;
  notify: NotifyFn;
};

export function DashboardQuickBooking({
  open,
  search,
  leads,
  subscribers,
  setOpen,
  setSearch,
  setLeadPayRow,
  setLeadPayDraft,
  setSubPayRow,
  setSubPayDraft,
  navigate,
  notify,
}: DashboardQuickBookingProps) {
  const close = () => setOpen(false);

  return (
    <>
      {/* «بحث» and, beside it, «واتساب»: the quick sender of the system's own WhatsApp (only for an account that has one). */}
      {!open && (
        <div className="fixed bottom-4 left-4 z-40 flex items-center gap-2 md:bottom-6 md:left-6">
          <button
            onClick={() => {
              setOpen(true);
              setSearch('');
            }}
            aria-label="بحث في كل العملاء"
            className="flex h-11 w-11 items-center justify-center gap-2 rounded-full bg-emerald-600 text-white shadow-xl transition hover:bg-emerald-700 active:scale-95 md:h-auto md:w-auto md:rounded-2xl md:px-4 md:py-3 md:text-sm md:font-bold md:shadow-2xl md:hover:scale-105"
            title="بحث في كل العملاء — وحجز جديد / تسجيل دفعة"
          >
            <Search size={18} />
            <span className="hidden md:inline">بحث</span>
          </button>
          <WhatsAppFab notify={notify} />
        </div>
      )}

      {open && (
        <QuickBookingModal
          search={search}
          leads={leads}
          subscribers={subscribers}
          onClose={close}
          setSearch={setSearch}
          setLeadPayRow={setLeadPayRow}
          setLeadPayDraft={setLeadPayDraft}
          setSubPayRow={setSubPayRow}
          setSubPayDraft={setSubPayDraft}
          navigate={navigate}
        />
      )}
    </>
  );
}

function QuickBookingModal({
  search,
  leads,
  subscribers,
  onClose,
  setSearch,
  setLeadPayRow,
  setLeadPayDraft,
  setSubPayRow,
  setSubPayDraft,
  navigate,
}: Omit<DashboardQuickBookingProps, 'open' | 'setOpen' | 'notify'> & { onClose: () => void }) {
  // «بحث»: one list for everyone in the system, from the second letter, whoever owns them
  // (ClientLookupList). «حجز / دفع» books in place when the person is one of the caller's own
  // loaded clients; for anyone else it opens their file on the payment screen (?pay=now).
  const q = search.trim();
  const ownLead = new Map(leads.map(lead => [lead.id, lead]));
  const ownSubscriber = new Map(subscribers.map(subscriber => [subscriber.id, subscriber]));

  const openFile = (row: LookupRow) => { onClose(); navigate(`/client/${row.clientCode || row.id}`); };
  const pay = (row: LookupRow) => {
    const lead = row.kind === 'lead' ? ownLead.get(row.id) : undefined;
    const subscriber = row.kind === 'subscriber' ? ownSubscriber.get(row.id) : undefined;
    if (lead) {
      onClose();
      setLeadPayRow(lead);
      setLeadPayDraft(createClientPaymentDraft({
        courseId: realCourseIds(lead.interestedCourseIds)[0] || lead.enrolledCourseId || '',
        currency: currencyForBranch(lead.branch),
        branch: lead.branch || '',
        email: lead.email || '',
      }));
    } else if (subscriber) {
      onClose();
      setSubPayRow(subscriber);
      setSubPayDraft(createClientPaymentDraft({
        currency: currencyForBranch(subscriber.branch),
        courseId: subscriber.enrolledCourseIds?.[0] || '',
      }));
      setSubPayDraft((previous) => ({ ...previous, bookingType: (subscriber.enrolledCourseIds || []).length > 0 ? 'installment' : 'new_booking' }));
    } else {
      onClose();
      navigate(`/client/${row.clientCode || row.id}?pay=now`);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="بحث"
      subtitle="كل العملاء — بالاسم أو رقم الهاتف أو الكود"
      icon={<div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center"><Search size={20} className="text-emerald-600" /></div>}
      size="lg"
      align="sheet"
    >
      <div className="px-6 pt-5 pb-3">
        <div className="relative">
          <Search size={18} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-500" />
          <input
            autoFocus
            type="text"
            placeholder="اسم العميل / رقم الهاتف / الإيميل..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 pr-10 text-base focus:outline-none focus:ring-2 focus:ring-emerald-300"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
          <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-amber-800">ليد</span>
          <span className="rounded-full border border-blue-300 bg-blue-100 px-2 py-0.5 text-blue-800">مشترك أونلاين</span>
          <span className="rounded-full border border-violet-300 bg-violet-100 px-2 py-0.5 text-violet-800">مشترك الدقي</span>
          <span className="rounded-full border border-teal-300 bg-teal-100 px-2 py-0.5 text-teal-800">مشترك التجمع</span>
        </div>
      </div>

      <div className="px-4 pb-5 max-h-[26rem] overflow-y-auto">
        <ClientLookupList query={q} onPay={pay} onOpen={openFile} />
      </div>
    </Modal>
  );
}
