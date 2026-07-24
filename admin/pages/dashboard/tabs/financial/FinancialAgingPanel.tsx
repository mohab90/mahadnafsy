import { AlertCircle, CheckCircle2, Download } from 'lucide-react';
import type { SubscriberItem } from '../../../../types';

interface Props {
  subscribers: SubscriberItem[];
  sarRate: number;
  usdRate: number;
}

export function FinancialAgingPanel({ subscribers, sarRate, usdRate }: Props) {
  const toEGP = (amt: number, cur: string) => cur === 'EGP' ? amt : cur === 'SAR' ? amt * sarRate : amt * usdRate;

  const exportCSV = (filename: string, rows: string[][], headers: string[]) => {
    const BOM = '﻿';
    const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))];
    const blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const today = new Date().toISOString().slice(0, 10);
  const subscribersWithPlans = subscribers.filter(s => (s.installmentPlans?.length ?? 0) > 0);
  const agingRows = subscribersWithPlans.flatMap(s =>
    (s.installmentPlans ?? []).flatMap(plan => {
      const totalPaid = (plan.payments ?? []).reduce((sum: number, py: { amount: number }) => sum + py.amount, 0);
      const remaining = plan.totalAmount - totalPaid;
      if (remaining <= 0) return [];
      const dueDate = plan.nextDueDate || plan.startDate || '';
      if (!dueDate) return [];
      const days = dueDate < today ? Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000) : 0;
      return [{ sub: s, plan, remaining, dueDate, daysOverdue: days }];
    })
  ).sort((a, b) => b.daysOverdue - a.daysOverdue);

  const buckets = [
    { label: '90+ يوم',         min: 91, max: Infinity, bg: 'bg-red-50',     border: 'border-red-200',     txt: 'text-red-700' },
    { label: '61-90 يوم',       min: 61, max: 90,       bg: 'bg-orange-50',  border: 'border-orange-200',  txt: 'text-orange-700' },
    { label: '31-60 يوم',       min: 31, max: 60,       bg: 'bg-amber-50',   border: 'border-amber-200',   txt: 'text-amber-700' },
    { label: '1-30 يوم',        min: 1,  max: 30,       bg: 'bg-yellow-50',  border: 'border-yellow-200',  txt: 'text-yellow-700' },
    { label: 'حالي (غير متأخر)', min: 0,  max: 0,        bg: 'bg-emerald-50', border: 'border-emerald-200', txt: 'text-emerald-700' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {buckets.map(b => {
          const rows = agingRows.filter(r => b.min === 0 ? r.daysOverdue === 0 : r.daysOverdue >= b.min && r.daysOverdue <= b.max);
          const total = rows.reduce((s, r) => s + toEGP(r.remaining, r.plan.currency), 0);
          return (
            <div key={b.label} className={`${b.bg} border ${b.border} rounded-xl p-3 text-center`}>
              <p className={`text-xs font-bold ${b.txt} mb-1`}>{b.label}</p>
              <p className={`text-lg font-extrabold ${b.txt}`}>{total.toLocaleString('ar-EG-u-nu-latn')} ج.م</p>
              <p className="text-xs text-gray-500">{rows.length} خطة</p>
            </div>
          );
        })}
      </div>

      <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm overflow-x-auto">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-bold text-gray-800 flex items-center gap-2">
            <AlertCircle size={16} className="text-red-500" />تفاصيل الأقساط المتأخرة
          </h4>
          <button
            onClick={() => exportCSV(
              'aging-report.csv',
              agingRows.map(r => [r.sub.name, r.sub.phone, r.plan.courseTitle || '—', String(Math.round(toEGP(r.remaining, r.plan.currency))), r.dueDate, String(r.daysOverdue)]),
              ['الاسم', 'الهاتف', 'الكورس', 'المتبقي (ج.م)', 'تاريخ الاستحقاق', 'أيام التأخير']
            )}
            className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl px-3 py-1.5 text-xs font-bold transition">
            <Download size={13} /> تصدير CSV
          </button>
        </div>
        {agingRows.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <CheckCircle2 size={32} className="mx-auto mb-2 opacity-40 text-emerald-500" />
            <p>لا توجد أقساط متأخرة — أداء ممتاز!</p>
          </div>
        ) : (
          <table className="w-full text-sm" dir="rtl">
            <thead>
              <tr className="text-right border-b-2 border-gray-100 text-xs text-gray-500">
                <th className="py-2 font-bold">العميل</th>
                <th className="py-2 font-bold">الكورس</th>
                <th className="py-2 font-bold">المتبقي</th>
                <th className="py-2 font-bold">تاريخ الاستحقاق</th>
                <th className="py-2 font-bold">أيام التأخير</th>
                <th className="py-2 font-bold">تواصل</th>
              </tr>
            </thead>
            <tbody>
              {agingRows.map((r, i) => {
                const badgeColor = r.daysOverdue >= 91 ? 'bg-red-100 text-red-700' : r.daysOverdue >= 61 ? 'bg-orange-100 text-orange-700' : r.daysOverdue >= 31 ? 'bg-amber-100 text-amber-700' : r.daysOverdue >= 1 ? 'bg-yellow-100 text-yellow-700' : 'bg-emerald-100 text-emerald-700';
                return (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2.5">
                      <p className="font-bold text-gray-900">{r.sub.name}</p>
                      <p className="text-xs text-gray-500">{r.sub.phone}</p>
                    </td>
                    <td className="py-2.5 text-gray-700">{r.plan.courseTitle || '—'}</td>
                    <td className="py-2.5 font-bold text-red-600">{Math.round(toEGP(r.remaining, r.plan.currency)).toLocaleString('ar-EG-u-nu-latn')} ج.م</td>
                    <td className="py-2.5 text-gray-500 text-xs">{r.dueDate}</td>
                    <td className="py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${badgeColor}`}>
                        {r.daysOverdue === 0 ? 'لم يتأخر' : `${r.daysOverdue} يوم`}
                      </span>
                    </td>
                    <td className="py-2.5">
                      {r.sub.phone && (
                        <a
                          href={`https://wa.me/${r.sub.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`مرحباً ${r.sub.name}، نذكركم بموعد دفع قسط كورس ${r.plan.courseTitle || ''} بمبلغ ${r.remaining} ${r.plan.currency}. شكراً لتعاملكم معنا.`)}`}
                          target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded-lg px-2 py-1 transition font-bold">
                          واتساب
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </article>
    </div>
  );
}
