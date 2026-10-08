import React, { Suspense, useState } from 'react';
import { Mail, BookOpen, TrendingUp, LifeBuoy } from 'lucide-react';
import ContactsTab from './ContactsTab';
import FaqManagerTab from './FaqManagerTab';
import NpsDashboardTab from './NpsDashboardTab';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
// Refunds, certificates and consultations each already have their own page in
// خدمة العملاء, so carrying them here as well meant the same workflow lived in
// two places and staff had to guess which copy was authoritative. They are
// reached from the menu now; this page keeps the parts that have nowhere else.
// The tickets moved out too (8 Oct 2026): they are «مشاكل العملاء والتذاكر»,
// one page with the website's problem messages, so nothing shows twice.
type SubTab = 'contacts' | 'faq' | 'nps';

const SUBTABS: { key: SubTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'contacts', label: 'رسائل التواصل', icon: Mail },
  { key: 'faq', label: 'قاعدة المعرفة (FAQ)', icon: BookOpen },
  { key: 'nps', label: 'رضا العملاء (NPS)', icon: TrendingUp },
];

const spinner = (
  <div className="flex items-center justify-center p-16">
    <span className="w-6 h-6 border-2 border-rose-400 border-t-transparent rounded-full animate-spin" />
  </div>
);

// The parts of الدعم والجودة that exist only here: website contact messages, the FAQ knowledge base and the NPS dashboard. Refunds,
// certificates and consultations moved back out to their own menu entries,
// because each of them was reachable two ways and no longer is.
export default function ServiceHubTab({ notify }: { notify: NotifyFn }) {
  const [subTab, setSubTab] = useState<SubTab>('contacts');

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl bg-gradient-to-l from-rose-600 to-orange-500 p-5 text-white">
        <h2 className="flex items-center gap-2 text-xl font-black"><LifeBuoy size={22} /> الدعم والجودة</h2>
        <p className="mt-1 text-sm text-rose-100">رسائل التواصل، قاعدة المعرفة، ورضا العملاء. التذاكر والمشاكل في «مشاكل العملاء والتذاكر»، والاسترداد والشهادات والاستشارات لها صفحاتها.</p>
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
        {subTab === 'contacts' && <ContactsTab />}
        {subTab === 'faq' && <FaqManagerTab notify={notify} />}
        {subTab === 'nps' && <NpsDashboardTab notify={notify} />}
      </Suspense>
    </div>
  );
}
