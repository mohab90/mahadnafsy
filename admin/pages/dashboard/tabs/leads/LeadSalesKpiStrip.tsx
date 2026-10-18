import { useEffect, useRef, useState } from 'react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { CRM_CHANGED_EVENT } from '../../../../lib/crmChanged';

type Props = {
  isSalesOnly: boolean;
  /** Bumped after a follow-up action, so the figures are asked for again. */
  refreshKey?: unknown;
};

/** GET /api/staff/leads-kpis: the figures this strip draws, counted by the database over the rep's own leads. */
type LeadKpis = {
  totalLeads: number;
  converted: number;
  convertedThisMonth: number;
  active: number;
  overdue: number;
  callsToday: number;
  callsWeek: number;
  collectedEgp: number;
};

/**
 * The strip summed these over every lead and client of the rep, which the screen downloaded whole (37,000 leads and
 * 5,000 clients with their payments on the production-scale lab) to print seven numbers. The server counts them
 * now; they are asked for again after a write (lib/crmChanged.ts).
 */
export function LeadSalesKpiStrip({ isSalesOnly, refreshKey }: Props) {
  const [kpis, setKpis] = useState<LeadKpis | null>(null);
  const [changes, setChanges] = useState(0);
  // A slow answer must not overwrite a newer one.
  const latest = useRef(0);

  useEffect(() => {
    if (!isSalesOnly) return undefined;
    const onChanged = () => setChanges(count => count + 1);
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CRM_CHANGED_EVENT, onChanged);
  }, [isSalesOnly]);

  useEffect(() => {
    if (!isSalesOnly) return;
    const ticket = ++latest.current;
    mysqlAdmin.adminGet<LeadKpis>('/staff/leads-kpis').then(
      answer => { if (ticket === latest.current) setKpis(answer); },
      () => { /* the last good figures stay */ },
    );
  }, [isSalesOnly, refreshKey, changes]);

  if (!isSalesOnly) return null;

  const dash = '—';
  const show = (value: number | undefined) => (kpis ? value ?? 0 : dash);
  const totalLeads = kpis?.totalLeads ?? 0;
  const totalConverted = kpis?.converted ?? 0;
  const overdueCount = kpis?.overdue ?? 0;
  const totalCollected = kpis?.collectedEgp ?? 0;
  const convRate = totalLeads > 0 ? Math.round((totalConverted / totalLeads) * 100) : 0;

  const cards = [
    { label: 'مكالمات اليوم', value: show(kpis?.callsToday), icon: '📞', cls: 'bg-blue-50 border-blue-200 text-blue-800', tip: 'عدد تسجيلات التواصل اليوم' },
    { label: 'مكالمات الأسبوع', value: show(kpis?.callsWeek), icon: '📅', cls: 'bg-indigo-50 border-indigo-200 text-indigo-800', tip: 'عدد التواصلات في آخر 7 أيام' },
    { label: 'محوّلون / الشهر', value: show(kpis?.convertedThisMonth), icon: '🎯', cls: 'bg-emerald-50 border-emerald-200 text-emerald-800', tip: 'عدد العملاء المحولين للتسجيل هذا الشهر' },
    { label: 'نشط الآن', value: show(kpis?.active), icon: '⚡', cls: 'bg-amber-50 border-amber-200 text-amber-800', tip: 'ليدز نشطة لم تُحوَّل أو تُفقد' },
    { label: 'متابعة متأخرة', value: show(kpis?.overdue), icon: '⚠️', cls: overdueCount > 0 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-gray-50 border-gray-200 text-gray-500', tip: 'ليدز تجاوزت تاريخ المتابعة' },
    { label: 'نسبة التحويل', value: kpis ? `${convRate}%` : dash, icon: '📈', cls: convRate >= 30 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : convRate >= 15 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-gray-50 border-gray-200 text-gray-600', tip: `${totalConverted} من ${totalLeads} ليد` },
    { label: 'إجمالي التحصيلات', value: totalCollected > 0 ? `${totalCollected.toLocaleString('ar-EG-u-nu-latn')} ج.م` : dash, icon: '💰', cls: 'bg-teal-50 border-teal-200 text-teal-800', tip: 'إجمالي المبالغ المحصّلة من ليدزك بالجنيه' },
  ];

  return (
    <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
      {cards.map(c => (
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
