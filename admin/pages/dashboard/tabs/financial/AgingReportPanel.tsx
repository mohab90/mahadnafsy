import React from 'react';
import { AlertCircle, CheckCircle2, Download } from 'lucide-react';
import type { InstallmentPlan, SubscriberItem } from '../../../../types';

type AgingRow = {
  sub: SubscriberItem;
  plan: InstallmentPlan;
  remaining: number;
  dueDate: string;
  daysOverdue: number;
};

interface AgingReportPanelProps {
  rows: AgingRow[];
  toEGP: (amount: number, currency: string) => number;
  exportCSV: (filename: string, rows: string[][], headers: string[]) => void;
}

const agingBuckets = [
  { label: '90+ يوم', min: 91, max: Infinity, bg: 'bg-red-50', border: 'border-red-200', txt: 'text-red-700' },
  { label: '61-90 يوم', min: 61, max: 90, bg: 'bg-orange-50', border: 'border-orange-200', txt: 'text-orange-700' },
  { label: '31-60 يوم', min: 31, max: 60, bg: 'bg-amber-50', border: 'border-amber-200', txt: 'text-amber-700' },
  { label: '1-30 يوم', min: 1, max: 30, bg: 'bg-yellow-50', border: 'border-yellow-200', txt: 'text-yellow-700' },
  { label: 'حالي (غير متأخر)', min: 0, max: 0, bg: 'bg-emerald-50', border: 'border-emerald-200', txt: 'text-emerald-700' },
];

function agingBadgeColor(daysOverdue: number) {
  if (daysOverdue >= 91) return 'bg-red-100 text-red-700';
  if (daysOverdue >= 61) return 'bg-orange-100 text-orange-700';
  if (daysOverdue >= 31) return 'bg-amber-100 text-amber-700';
  if (daysOverdue >= 1) return 'bg-yellow-100 text-yellow-700';
  return 'bg-emerald-100 text-emerald-700';
}

export function AgingReportPanel({ rows, toEGP, exportCSV }: AgingReportPanelProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {agingBuckets.map(bucket => {
          const bucketRows = rows.filter(row => (
            bucket.min === 0
              ? row.daysOverdue === 0
              : row.daysOverdue >= bucket.min && row.daysOverdue <= bucket.max
          ));
          const total = bucketRows.reduce((sum, row) => sum + toEGP(row.remaining, row.plan.currency), 0);

          return (
            <div key={bucket.label} className={`${bucket.bg} border ${bucket.border} rounded-xl p-3 text-center`}>
              <p className={`text-xs font-bold ${bucket.txt} mb-1`}>{bucket.label}</p>
              <p className={`text-lg font-extrabold ${bucket.txt}`}>{total.toLocaleString('ar-EG')} ج.م</p>
              <p className="text-xs text-gray-500">{bucketRows.length} خطة</p>
            </div>
          );
        })}
      </div>

      <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm overflow-x-auto">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-bold text-gray-800 flex items-center gap-2">
            <AlertCircle size={16} className="text-red-500" />
            تفاصيل الأقساط المتأخرة
          </h4>
          <button
            onClick={() => exportCSV(
              'aging-report.csv',
              rows.map(row => [
                row.sub.name,
                row.sub.phone,
                row.plan.courseTitle || '—',
                String(Math.round(toEGP(row.remaining, row.plan.currency))),
                row.dueDate,
                String(row.daysOverdue),
              ]),
              ['الاسم', 'الهاتف', 'الكورس', 'المتبقي (ج.م)', 'تاريخ الاستحقاق', 'أيام التأخير'],
            )}
            className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl px-3 py-1.5 text-xs font-bold transition"
          >
            <Download size={13} /> تصدير CSV
          </button>
        </div>

        {rows.length === 0 ? (
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
              {rows.map((row, index) => (
                <tr key={`${row.sub.id}-${row.plan.id}-${index}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="py-2.5">
                    <p className="font-bold text-gray-900">{row.sub.name}</p>
                    <p className="text-xs text-gray-500">{row.sub.phone}</p>
                  </td>
                  <td className="py-2.5 text-gray-700">{row.plan.courseTitle || '—'}</td>
                  <td className="py-2.5 font-bold text-red-600">
                    {Math.round(toEGP(row.remaining, row.plan.currency)).toLocaleString('ar-EG')} ج.م
                  </td>
                  <td className="py-2.5 text-gray-500 text-xs">{row.dueDate}</td>
                  <td className="py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${agingBadgeColor(row.daysOverdue)}`}>
                      {row.daysOverdue === 0 ? 'لم يتأخر' : `${row.daysOverdue} يوم`}
                    </span>
                  </td>
                  <td className="py-2.5">
                    {row.sub.phone && (
                      <a
                        href={`https://wa.me/${row.sub.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`مرحباً ${row.sub.name}، نذكركم بموعد دفع قسط كورس ${row.plan.courseTitle || ''} بمبلغ ${row.remaining} ${row.plan.currency}. شكراً لتعاملكم معنا.`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded-lg px-2 py-1 transition font-bold"
                      >
                        واتساب
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </div>
  );
}
