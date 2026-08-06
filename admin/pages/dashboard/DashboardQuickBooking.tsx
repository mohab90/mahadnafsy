import React from 'react';
import { ExternalLink, Search, X } from 'lucide-react';
import type { NavigateFunction } from 'react-router-dom';
import type { LeadItem, SubscriberItem } from '../../types';
import type { PaymentDraft } from '../../components/PaymentModal';
import { createClientPaymentDraft } from '../../lib/clientActionDrafts';
import { currencyForBranch } from '../../lib/branchCurrency';
import { realCourseIds } from './tabs/leads/leadCourseLabel';

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
}: DashboardQuickBookingProps) {
  const close = () => setOpen(false);

  return (
    <>
      {!open && (
        <button
          onClick={() => {
            setOpen(true);
            setSearch('');
          }}
          className="fixed bottom-6 left-6 z-40 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl shadow-2xl px-4 py-3 font-bold text-sm transition hover:scale-105 active:scale-95"
          title="حجز جديد / تسجيل دفعة"
        >
          <Search size={18} />
          <span>حجز / دفعة</span>
        </button>
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
}: Omit<DashboardQuickBookingProps, 'open' | 'setOpen'> & { onClose: () => void }) {
  const q = search.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');
  const matchedLeads: LeadItem[] = q.length < 2 ? [] : leads
    .filter((lead) => !['converted', 'lost'].includes(lead.status))
    .filter((lead) =>
      lead.name.toLowerCase().includes(q) ||
      (lead.phone || '').includes(q) ||
      (lead.email || '').toLowerCase().includes(q))
    .slice(0, 8);
  const matchedSubs: SubscriberItem[] = q.length < 2 ? [] : subscribers
    .filter((subscriber) =>
      subscriber.name.toLowerCase().includes(q) ||
      (subscriber.phone || '').replace(/\D/g, '').includes(qDigits) ||
      (subscriber.email || '').toLowerCase().includes(q))
    .slice(0, 8);
  const hasResults = matchedLeads.length > 0 || matchedSubs.length > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl" dir="rtl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
            <Search size={20} className="text-emerald-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-extrabold text-gray-900 text-lg">البحث داخل قاعدة العملاء</h3>
            <p className="text-xs text-gray-400 mt-0.5">ابحث بالاسم أو رقم الهاتف أو الإيميل لحجز أو تسجيل دفعة</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 rounded-lg p-1.5"><X size={20} /></button>
        </div>

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
        </div>

        <div className="px-4 pb-5 space-y-1 max-h-96 overflow-y-auto">
          {q.length < 2 && (
            <p className="text-center text-xs text-gray-400 py-6">اكتب 2 حرف أو أكثر للبحث</p>
          )}
          {q.length >= 2 && !hasResults && (
            <p className="text-center text-xs text-gray-400 py-6">لا توجد نتائج</p>
          )}
          {matchedLeads.length > 0 && (
            <LeadResults
              leads={matchedLeads}
              onClose={onClose}
              setLeadPayRow={setLeadPayRow}
              setLeadPayDraft={setLeadPayDraft}
              navigate={navigate}
            />
          )}
          {matchedSubs.length > 0 && (
            <SubscriberResults
              subscribers={matchedSubs}
              onClose={onClose}
              setSubPayRow={setSubPayRow}
              setSubPayDraft={setSubPayDraft}
              navigate={navigate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function LeadResults({
  leads,
  onClose,
  setLeadPayRow,
  setLeadPayDraft,
  navigate,
}: {
  leads: LeadItem[];
  onClose: () => void;
  setLeadPayRow: (lead: LeadItem) => void;
  setLeadPayDraft: React.Dispatch<React.SetStateAction<PaymentDraft>>;
  navigate: NavigateFunction;
}) {
  return (
    <>
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-2 pt-2">عملاء CRM (ليدز)</p>
      {leads.map((lead) => (
        <div key={lead.id} className="flex items-center gap-2 rounded-xl hover:bg-amber-50 transition px-1">
          <button
            onClick={() => {
              onClose();
              setLeadPayRow(lead);
              setLeadPayDraft(createClientPaymentDraft({
                courseId: realCourseIds(lead.interestedCourseIds)[0] || lead.enrolledCourseId || '',
                currency: currencyForBranch(lead.branch),
                branch: lead.branch || '',
                email: lead.email || '',
              }));
            }}
            className="flex-1 flex items-center gap-3 px-3 py-2.5 text-right"
          >
            <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-sm flex-shrink-0">{lead.name.charAt(0)}</div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-800 text-sm truncate">{lead.name}</p>
              <p className="text-xs text-gray-400 truncate">{lead.phone}{lead.email ? ' · ' + lead.email : ''}</p>
            </div>
            <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full font-bold flex-shrink-0">ليد</span>
          </button>
          <button
            onClick={() => {
              onClose();
              navigate(`/client/${lead.clientCode || lead.id}`);
            }}
            title="فتح صفحة العميل المحتمل"
            className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-amber-700 hover:bg-amber-100"
          >
            <ExternalLink size={15} />
          </button>
        </div>
      ))}
    </>
  );
}

function SubscriberResults({
  subscribers,
  onClose,
  setSubPayRow,
  setSubPayDraft,
  navigate,
}: {
  subscribers: SubscriberItem[];
  onClose: () => void;
  setSubPayRow: (subscriber: SubscriberItem) => void;
  setSubPayDraft: React.Dispatch<React.SetStateAction<PaymentDraft>>;
  navigate: NavigateFunction;
}) {
  return (
    <>
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-2 pt-2">عملاء الأونلاين</p>
      {subscribers.map((subscriber) => (
        <div key={subscriber.id} className="flex items-center gap-2 rounded-xl hover:bg-blue-50 transition px-1">
          <button
            onClick={() => {
              onClose();
              setSubPayRow(subscriber);
              setSubPayDraft(createClientPaymentDraft({
                currency: currencyForBranch(subscriber.branch),
                courseId: subscriber.enrolledCourseIds?.[0] || '',
              }));
              setSubPayDraft((previous) => ({ ...previous, bookingType: (subscriber.enrolledCourseIds || []).length > 0 ? 'installment' : 'new_booking' }));
            }}
            className="flex-1 flex items-center gap-3 px-3 py-2.5 text-right"
          >
            <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm flex-shrink-0">{subscriber.name.charAt(0)}</div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-800 text-sm truncate">{subscriber.name}</p>
              <p className="text-xs text-gray-400 truncate">{subscriber.phone}{subscriber.email ? ' · ' + subscriber.email : ''}</p>
            </div>
            <span className="text-[10px] bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full font-bold flex-shrink-0">مشترك</span>
          </button>
          <button
            onClick={() => {
              onClose();
              navigate(`/client/${subscriber.clientCode || subscriber.id}`);
            }}
            title="فتح صفحة العميل"
            className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-primary-700 hover:bg-primary-50"
          >
            <ExternalLink size={15} />
          </button>
        </div>
      ))}
    </>
  );
}
