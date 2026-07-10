import React from 'react';
import type { LeadItem, SubscriberItem } from '../../../../types';

interface LeadsSalesKpiStripProps {
  effectiveLeads: LeadItem[];
  effectiveSubs: SubscriberItem[];
}

// 7-stat KPI strip shown only for sales-only users. Extracted verbatim from LeadsTab.
export function LeadsSalesKpiStrip({ effectiveLeads, effectiveSubs }: LeadsSalesKpiStripProps) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const thisMonthStr = new Date().toISOString().slice(0, 7);
  const weekAgoStr = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const todayCalls = effectiveLeads.reduce((n, l) =>
    n + (l.communications || []).filter(c => c.date?.slice(0, 10) === todayStr).length, 0);
  const weekCalls = effectiveLeads.reduce((n, l) =>
    n + (l.communications || []).filter(c => c.date?.slice(0, 10) >= weekAgoStr).length, 0);
  const monthConverted = effectiveLeads.filter(l =>
    l.status === 'converted' && (l.updatedAt || l.createdAt || '').slice(0, 7) === thisMonthStr).length;
  const totalActive = effectiveLeads.filter(l => !['converted', 'lost', 'not_interested_hidden'].includes(l.status || '')).length;
  const overdueCount = effectiveLeads.filter(l =>
    l.nextFollowUpDate && l.nextFollowUpDate < todayStr && !['converted', 'lost'].includes(l.status || '')).length;
  const totalCollected = (effectiveSubs || []).reduce((s, sub) =>
    s + (sub.paymentHistory || []).reduce((a: number, p) =>
      a + (p.currency === 'EGP' ? (p.amount || 0) : 0), 0)
  , 0);
  const totalLeads = effectiveLeads.length;
  const totalConverted = effectiveLeads.filter(l => l.status === 'converted').length;
  const convRate = totalLeads > 0 ? Math.round((totalConverted / totalLeads) * 100) : 0;

  return (
    <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
      {[
        { label: 'مكالمات اليوم', value: todayCalls, icon: '📞', cls: 'bg-blue-50 border-blue-200 text-blue-800', tip: 'عدد تسجيلات التواصل اليوم' },
        { label: 'مكالمات الأسبوع', value: weekCalls, icon: '📅', cls: 'bg-indigo-50 border-indigo-200 text-indigo-800', tip: 'عدد التواصلات في آخر 7 أيام' },
        { label: 'محوّلون / الشهر', value: monthConverted, icon: '🎯', cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', tip: 'عدد العملاء المحولين للتسجيل هذا الشهر' },
        { label: 'نشط الآن', value: totalActive, icon: '⚡', cls: 'bg-amber-50 border-amber-200 text-amber-800', tip: 'ليدز نشطة لم تُحوَّل أو تُفقد' },
        { label: 'متابعة متأخرة', value: overdueCount, icon: '⚠️', cls: overdueCount > 0 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-gray-50 border-gray-200 text-gray-500', tip: 'ليدز تجاوزت تاريخ المتابعة' },
        { label: 'نسبة التحويل', value: `${convRate}%`, icon: '📈', cls: convRate >= 30 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : convRate >= 15 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-gray-50 border-gray-200 text-gray-600', tip: `${totalConverted} من ${totalLeads} ليد` },
        { label: 'إجمالي التحصيلات', value: totalCollected > 0 ? `${totalCollected.toLocaleString()} ج.م` : '—', icon: '💰', cls: 'bg-teal-50 border-teal-200 text-teal-800', tip: 'إجمالي المبالغ المحصّلة من ليدزك بالجنيه' },
      ].map(c => (
        <div key={c.label} className={`border rounded-xl px-2.5 py-2 flex flex-col gap-0.5 ${c.cls}`} title={c.tip}>
          <div className="flex items-center gap-1.5">
            <span className="text-lg leading-none">{c.icon}</span>
            <span className="text-lg font-extrabold leading-tight truncate">{c.value}</span>
          </div>
          <div className="text-[10px] font-medium opacity-75 leading-tight">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
