import React from 'react';
import { Tag, CheckCircle, Hash, X, Award, Copy } from 'lucide-react';
import type { DiscountRule } from '../../../../types';
import { StatCard, ProgressBar, pct } from './shared';
import type { NotifyFn } from './shared';

interface Props {
  discounts: DiscountRule[];
  activeDiscounts: DiscountRule[];
  totalDiscountUsage: number;
  discountAnalytics: { topUsed: DiscountRule[]; totalSaved: number };
  notify: NotifyFn;
}

export function DiscountsSection({ discounts, activeDiscounts, totalDiscountUsage, discountAnalytics, notify }: Props) {
  return (
    <div className="space-y-5">

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="إجمالي الكوبونات" value={discounts.length} icon={Tag} color="text-rose-600" bg="bg-rose-50" />
        <StatCard label="كوبونات نشطة" value={activeDiscounts.length} icon={CheckCircle} color="text-green-600" bg="bg-green-50" />
        <StatCard label="إجمالي الاستخدامات" value={totalDiscountUsage} icon={Hash} color="text-indigo-600" bg="bg-indigo-50" />
        <StatCard label="متوقف" value={discounts.filter(d => !d.isActive).length} icon={X} color="text-gray-500" bg="bg-gray-50" />
      </div>

      {/* Top used discounts chart */}
      {discountAnalytics.topUsed.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
          <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-1.5">
            <Award size={16} className="text-amber-500" /> أكثر الكوبونات استخداماً
          </h3>
          <div className="space-y-3">
            {discountAnalytics.topUsed.map((d, idx) => (
              <div key={d.id} className="flex items-center gap-3">
                <span className="text-sm font-mono text-gray-400 w-4">{idx + 1}.</span>
                <span className="font-mono font-bold text-indigo-600 w-28">{d.code}</span>
                <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded w-16 text-center">
                  {d.type === 'percent' ? `${d.value}%` : `${d.value} ج`}
                </span>
                <div className="flex-1">
                  <ProgressBar value={d.usageCount || 0} max={discountAnalytics.topUsed[0]?.usageCount || 1} color="bg-rose-400" height="h-2.5" />
                </div>
                <span className="text-sm font-bold text-gray-700 w-12 text-left">{d.usageCount || 0}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full discounts table */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Tag size={16} className="text-rose-500" /> جميع الخصومات والكوبونات
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-600 font-semibold">{activeDiscounts.length} نشط</span>
            <span className="text-xs text-gray-400">/ {discounts.length} إجمالي</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-right p-3 font-medium">الكود</th>
                <th className="text-center p-3 font-medium">النوع</th>
                <th className="text-center p-3 font-medium">القيمة</th>
                <th className="text-center p-3 font-medium">الاستخدامات</th>
                <th className="text-center p-3 font-medium">الحد الأقصى</th>
                <th className="text-center p-3 font-medium">الاستخدام</th>
                <th className="text-center p-3 font-medium">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {discounts.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-400">لا كوبونات مضافة بعد</td></tr>
              ) : discounts.map(d => {
                const usagePct = d.usageLimit ? pct(d.usageCount || 0, d.usageLimit) : 0;
                return (
                  <tr key={d.id} className={`hover:bg-gray-50 transition-colors ${!d.isActive ? 'opacity-60' : ''}`}>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-indigo-600">{d.code}</span>
                        <button onClick={() => { navigator.clipboard?.writeText(d.code || ''); notify('success', 'تم نسخ الكود'); }}
                          className="text-gray-400 hover:text-gray-600">
                          <Copy size={12} />
                        </button>
                      </div>
                    </td>
                    <td className="p-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${d.type === 'percent' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {d.type === 'percent' ? 'نسبة' : 'مبلغ'}
                      </span>
                    </td>
                    <td className="p-3 text-center font-semibold">
                      {d.type === 'percent' ? `${d.value}%` : `${d.value} ج`}
                    </td>
                    <td className="p-3 text-center font-bold">{d.usageCount ?? 0}</td>
                    <td className="p-3 text-center text-gray-500">{d.usageLimit ?? '∞'}</td>
                    <td className="p-3 text-center w-24">
                      {d.usageLimit ? (
                        <div className="space-y-0.5">
                          <ProgressBar value={d.usageCount || 0} max={d.usageLimit} color="bg-indigo-400" height="h-1.5" />
                          <span className="text-xs text-gray-400">{usagePct}%</span>
                        </div>
                      ) : <span className="text-xs text-gray-300">غير محدود</span>}
                    </td>
                    <td className="p-3 text-center">
                      {d.isActive
                        ? <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-medium">نشط</span>
                        : <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">متوقف</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
