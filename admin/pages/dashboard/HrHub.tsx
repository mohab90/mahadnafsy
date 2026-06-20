/**
 * HrHub — consolidates HR/staff admin tabs (HR system, staff overview, my-HR)
 * under one menu entry with an internal sub-tab bar. Children reused as-is.
 */
import React, { Suspense, lazy, useState } from 'react';
import { Briefcase, Users, User } from 'lucide-react';
import type { NotifyFn } from '../../types';

const HrTab = lazy(() => import('./tabs/HRTab'));
const StaffPerformanceTab = lazy(() => import('./tabs/StaffPerformanceTab'));
const MyHrTab = lazy(() => import('./tabs/MyHrTab'));

const SUBS = [
  { key: 'hr', label: 'نظام HR والرواتب', icon: Briefcase, Comp: HrTab },
  { key: 'staff', label: 'الموظفون والأداء', icon: Users, Comp: StaffPerformanceTab },
  { key: 'my_hr', label: 'بياناتي الوظيفية', icon: User, Comp: MyHrTab },
] as const;

export default function HrHub({ notify, initial }: { notify: NotifyFn; initial?: string }) {
  const [sub, setSub] = useState<string>(SUBS.some(s => s.key === initial) ? (initial as string) : 'hr');
  const Active = SUBS.find(s => s.key === sub)?.Comp;
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-2">
        {SUBS.map(s => {
          const Ic = s.icon;
          return (
            <button key={s.key} onClick={() => setSub(s.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold transition ${sub === s.key ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              <Ic size={15} /> {s.label}
            </button>
          );
        })}
      </div>
      <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>}>
        {Active && <Active notify={notify} />}
      </Suspense>
    </div>
  );
}
