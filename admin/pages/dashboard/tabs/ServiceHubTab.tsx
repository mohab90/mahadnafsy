import React, { Suspense, useState } from 'react';
import { Ticket, Mail, RotateCcw, Star, CalendarCheck2, BookOpen, TrendingUp, LifeBuoy } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import TicketsTab from './TicketsTab';
import ContactsTab from './ContactsTab';
import FinancialRefundsPanel from './financial/FinancialRefundsPanel';
import CertRequestsTab from './CertRequestsTab';
import ConsultationCalendarTab from './ConsultationCalendarTab';
import FaqManagerTab from './FaqManagerTab';
import NpsDashboardTab from './NpsDashboardTab';
import type { ExtraCertificateType } from '../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type SubTab = 'tickets' | 'contacts' | 'refunds' | 'certs' | 'consultations' | 'faq' | 'nps';

const SUBTABS: { key: SubTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'tickets', label: 'تذاكر الدعم', icon: Ticket },
  { key: 'contacts', label: 'رسائل التواصل', icon: Mail },
  { key: 'refunds', label: 'طلبات الاسترداد', icon: RotateCcw },
  { key: 'certs', label: 'طلبات الشهادات', icon: Star },
  { key: 'consultations', label: 'الاستشارات', icon: CalendarCheck2 },
  { key: 'faq', label: 'قاعدة المعرفة (FAQ)', icon: BookOpen },
  { key: 'nps', label: 'رضا العملاء (NPS)', icon: TrendingUp },
];

const spinner = (
  <div className="flex items-center justify-center p-16">
    <span className="w-6 h-6 border-2 border-rose-400 border-t-transparent rounded-full animate-spin" />
  </div>
);

// Consolidates 7 previously-separate top-level nav pages into one, as
// subtabs — every component below is unchanged, just re-homed, so nothing
// that already worked (bulk actions, SLA/priority on tickets, the refund
// approval/close workflow, certificate fulfillment stages, ...) was touched
// or re-implemented. Paired with customer_inbox (the daily triage hub with
// reply/status/escalate/transfer actions inline), خدمة العملاء goes from 8
// menu items down to 2.
export default function ServiceHubTab({ notify }: { notify: NotifyFn }) {
  const { courses, subscribers, reloadSubscribers } = useSiteData();
  const [subTab, setSubTab] = useState<SubTab>('tickets');
  const [certSearch, setCertSearch] = useState('');
  const [certTypeFilter, setCertTypeFilter] = useState<ExtraCertificateType | 'all'>('all');
  const [certStatusFilter, setCertStatusFilter] = useState('all');

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl bg-gradient-to-l from-rose-600 to-orange-500 p-5 text-white">
        <h2 className="flex items-center gap-2 text-xl font-black"><LifeBuoy size={22} /> الدعم والجودة</h2>
        <p className="mt-1 text-sm text-rose-100">تذاكر الدعم، رسائل التواصل، الاسترداد، الشهادات، الاستشارات، قاعدة المعرفة، ورضا العملاء — كلها هنا. للمتابعة اليومية السريعة استخدم Inbox خدمة العملاء الموحد.</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-1">
        {SUBTABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-t-xl text-sm font-bold border-b-2 transition-colors ${
              subTab === key ? 'border-rose-600 text-rose-700 bg-rose-50' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <Suspense fallback={spinner}>
        {subTab === 'tickets' && <TicketsTab notify={notify} />}
        {subTab === 'contacts' && <ContactsTab />}
        {subTab === 'refunds' && (
          <FinancialRefundsPanel notify={(message, tone) => notify(tone === 'error' ? 'error' : 'success', message)} />
        )}
        {subTab === 'certs' && (
          <CertRequestsTab
            notify={notify}
            courses={courses}
            subscribers={subscribers}
            reloadSubscribers={reloadSubscribers}
            certSearch={certSearch}
            setCertSearch={setCertSearch}
            certTypeFilter={certTypeFilter}
            setCertTypeFilter={(value) => setCertTypeFilter(value as ExtraCertificateType | 'all')}
            certStatusFilter={certStatusFilter}
            setCertStatusFilter={setCertStatusFilter}
          />
        )}
        {subTab === 'consultations' && <ConsultationCalendarTab />}
        {subTab === 'faq' && <FaqManagerTab notify={notify} />}
        {subTab === 'nps' && <NpsDashboardTab notify={notify} />}
      </Suspense>
    </div>
  );
}
