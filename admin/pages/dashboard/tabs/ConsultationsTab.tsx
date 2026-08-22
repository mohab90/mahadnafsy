import React, { Suspense, useState } from 'react';
import { CalendarDays, CalendarRange, Settings } from 'lucide-react';
import { ConsultationBookingsTab } from './consultations/ConsultationBookingsTab';
import { ConsultationSettingsTab } from './consultations/ConsultationSettingsTab';

const ConsultationCalendarTab = React.lazy(() => import('./ConsultationCalendarTab'));

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

// The consultations screen used to be the calendar and nothing else: there was
// no list of the bookings themselves, so a booking could only be found by
// knowing which day it fell on, and there was nowhere to confirm or cancel one.
// The bookings list is the default tab for that reason — it is what the desk
// opens this screen to do.
type Tab = 'bookings' | 'calendar' | 'settings';

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'bookings', label: 'حجوزات الاستشارات', icon: CalendarDays },
  { key: 'calendar', label: 'التقويم', icon: CalendarRange },
  { key: 'settings', label: 'إعدادات الاستشارات', icon: Settings },
];

export default function ConsultationsTab({ notify }: { notify: NotifyFn }) {
  const [tab, setTab] = useState<Tab>('bookings');

  return (
    <div className="space-y-4" dir="rtl">
      <div className="bg-gradient-to-l from-blue-600 to-indigo-600 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <CalendarDays size={22} />الاستشارات
        </h2>
        <p className="text-blue-50 text-sm mt-1">الحجوزات، التقويم، وإعدادات السعر والمواعيد</p>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-gray-200 pb-2">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition ${
              tab === key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {tab === 'bookings' && <ConsultationBookingsTab notify={notify} />}
      {tab === 'calendar' && (
        <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" /></div>}>
          <ConsultationCalendarTab />
        </Suspense>
      )}
      {tab === 'settings' && <ConsultationSettingsTab notify={notify} />}
    </div>
  );
}
