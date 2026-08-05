import React, { useCallback, useEffect, useState } from 'react';
import { CalendarRange, Phone, CreditCard, Users, Target, MessageCircle, ListChecks, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../lib/mysqlapi';
import { fmtMoney, fmtNum } from './types';

const PERIODS = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: 'week', label: 'آخر 7 أيام' },
  { key: 'days15', label: 'آخر 15 يوم' },
  { key: 'month', label: 'آخر 30 يوم' },
  { key: 'months3', label: 'آخر 3 شهور' },
] as const;

type Report = {
  period: { key: string; label: string; from: string; to: string };
  revenue: number; bookings: number; biggestSale: number;
  leads: number; converted: number; lost: number; untouched: number; conversionRate: number;
  touches: number; calls: number; whatsapp: number; meetings: number;
  tasksDone: number; tasksOpen: number;
  daily: { day: string; bookings: number; revenue: number; calls: number }[];
};

/** Compact bar strip for the selected window — one bar per day. */
function DailyStrip({ daily }: { daily: Report['daily'] }) {
  if (daily.length <= 1) return null;
  const max = Math.max(...daily.map(d => d.revenue), 1);
  const maxCalls = Math.max(...daily.map(d => d.calls), 1);
  return (
    <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <p className="mb-2 text-[11px] font-bold text-gray-500">التوزيع اليومي داخل الفترة</p>
      <div className="flex items-end gap-[3px]" style={{ height: 64, direction: 'ltr' }}>
        {daily.map(day => {
          const h = Math.round((day.revenue / max) * 52);
          const c = Math.round((day.calls / maxCalls) * 52);
          return (
            <div key={day.day} className="group relative flex flex-1 items-end justify-center gap-[1px]" style={{ minWidth: 3 }}
              title={`${day.day} — ${fmtMoney(day.revenue)} · ${fmtNum(day.calls)} مكالمة`}>
              <div className="w-full rounded-t bg-emerald-500" style={{ height: Math.max(day.revenue > 0 ? 3 : 1, h) }} />
              <div className="w-full rounded-t bg-cyan-400" style={{ height: Math.max(day.calls > 0 ? 3 : 1, c) }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-gray-400">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-emerald-500" /> إيراد</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded bg-cyan-400" /> مكالمات</span>
        <span className="ml-auto">{daily[0]?.day} → {daily[daily.length - 1]?.day}</span>
      </div>
    </div>
  );
}

/**
 * Period-scoped scorecard. Every window is computed server-side over a
 * half-open date range, so "اليوم" and "آخر 3 شهور" are the same query shape and
 * neither depends on what the browser happens to have loaded.
 */
export default function StaffPeriodReport({
  staffId, notify,
}: {
  staffId: string;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [period, setPeriod] = useState<string>('month');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((key: string) => {
    setLoading(true);
    mysqlAdmin.getStaffReport(staffId, key)
      .then(data => setReport(data as unknown as Report))
      .catch(error => notify('error', error instanceof Error ? error.message : 'تعذر تحميل التقرير'))
      .finally(() => setLoading(false));
  }, [staffId, notify]);

  useEffect(() => { load(period); }, [period, load]);

  const cards = report ? [
    { label: 'الإيراد', value: fmtMoney(report.revenue), sub: `${fmtNum(report.bookings)} حجز`, icon: CreditCard, cls: 'text-emerald-600 bg-emerald-50' },
    { label: 'المكالمات', value: fmtNum(report.calls), sub: `${fmtNum(report.touches)} تواصل`, icon: Phone, cls: 'text-cyan-600 bg-cyan-50' },
    { label: 'الليدات', value: fmtNum(report.leads), sub: `${fmtNum(report.untouched)} لم تُلمس`, icon: Users, cls: 'text-amber-600 bg-amber-50' },
    { label: 'التحويلات', value: fmtNum(report.converted), sub: `${report.conversionRate}% معدل`, icon: Target, cls: 'text-violet-600 bg-violet-50' },
    { label: 'واتساب', value: fmtNum(report.whatsapp), sub: `${fmtNum(report.meetings)} اجتماع`, icon: MessageCircle, cls: 'text-teal-600 bg-teal-50' },
    { label: 'المهام', value: fmtNum(report.tasksDone), sub: `${fmtNum(report.tasksOpen)} مفتوحة`, icon: ListChecks, cls: 'text-indigo-600 bg-indigo-50' },
  ] : [];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-gray-800">
            <CalendarRange size={17} className="text-indigo-600" /> تقرير الفترة
          </h3>
          {report && (
            <p className="mt-0.5 text-xs text-gray-400">
              {report.period.label} · من {report.period.from} إلى {report.period.to}
            </p>
          )}
        </div>
        <button onClick={() => load(period)} disabled={loading}
          className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-200 disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {PERIODS.map(option => (
          <button key={option.key} onClick={() => setPeriod(option.key)}
            className={`rounded-xl px-3 py-2 text-xs font-bold border transition ${
              period === option.key
                ? 'border-indigo-500 bg-indigo-600 text-white'
                : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
            }`}>
            {option.label}
          </button>
        ))}
      </div>

      {loading && !report ? (
        <p className="py-12 text-center text-sm text-gray-400">جاري حساب التقرير...</p>
      ) : report ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {cards.map(card => {
              const Icon = card.icon;
              return (
                <div key={card.label} className="rounded-xl border border-gray-100 p-3">
                  <span className={`inline-grid h-7 w-7 place-items-center rounded-lg ${card.cls}`}><Icon size={14} /></span>
                  <p className="mt-2 text-lg font-black leading-none text-gray-900">{card.value}</p>
                  <p className="mt-1 text-[11px] font-bold text-gray-500">{card.label}</p>
                  <p className="text-[10px] text-gray-400">{card.sub}</p>
                </div>
              );
            })}
          </div>
          {report.biggestSale > 0 && (
            <p className="mt-3 text-xs text-gray-500">
              أكبر عملية بيع داخل الفترة: <b className="text-emerald-700">{fmtMoney(report.biggestSale)}</b>
              {report.lost > 0 && <> · ليدات خسرها: <b className="text-red-600">{fmtNum(report.lost)}</b></>}
            </p>
          )}
          <DailyStrip daily={report.daily} />
        </>
      ) : null}
    </div>
  );
}
