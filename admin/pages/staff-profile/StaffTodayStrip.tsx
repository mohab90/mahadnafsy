import React from 'react';
import { Phone, CreditCard, Users, ListChecks, AlertTriangle, Wallet } from 'lucide-react';
import { fmtMoney, fmtNum, type StaffProfileData } from './types';

/**
 * "عداد يومي" — today's live counters. Deliberately the first thing on the page:
 * for a sales/CS employee this is the number a manager checks daily, and it was
 * previously buried inside a month-scoped report.
 */
export default function StaffTodayStrip({ data }: { data: StaffProfileData }) {
  const { today, tasks } = data;
  const cards = [
    { label: 'مكالمات اليوم', value: fmtNum(today.calls), sub: `${fmtNum(today.touches)} تواصل إجمالي`, icon: Phone, cls: 'from-cyan-500 to-sky-600' },
    { label: 'حجوزات اليوم', value: fmtNum(today.bookings), sub: fmtMoney(today.revenue), icon: CreditCard, cls: 'from-emerald-500 to-teal-600' },
    { label: 'ليدات اليوم', value: fmtNum(today.leads), sub: 'مُسندة له اليوم', icon: Users, cls: 'from-amber-500 to-orange-600' },
    { label: 'مهام مفتوحة', value: fmtNum(tasks.todo + tasks.inProgress), sub: `${fmtNum(tasks.done)} منجزة`, icon: ListChecks, cls: 'from-indigo-500 to-violet-600' },
    tasks.overdue > 0
      ? { label: 'مهام متأخرة', value: fmtNum(tasks.overdue), sub: 'تحتاج متابعة', icon: AlertTriangle, cls: 'from-red-500 to-rose-600' }
      : { label: 'إيراد اليوم', value: fmtMoney(today.revenue), sub: 'مدفوعات مؤكدة', icon: Wallet, cls: 'from-slate-500 to-gray-600' },
  ];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-700">عدادات اليوم</h3>
        <span className="text-[11px] text-gray-400">{today.date}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map(card => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={`rounded-2xl bg-gradient-to-br ${card.cls} p-4 text-white shadow-sm`}>
              <div className="flex items-center justify-between">
                <Icon size={16} className="opacity-80" />
              </div>
              <p className="mt-2 text-2xl font-black leading-none">{card.value}</p>
              <p className="mt-1.5 text-[11px] font-bold opacity-95">{card.label}</p>
              <p className="text-[10px] opacity-70">{card.sub}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
