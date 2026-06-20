import React, { useMemo, useState } from 'react';
import { Download, Percent, Users } from 'lucide-react';
import { useSiteData } from '../../../../context/SiteDataContext';
import type { SubscriberItem } from '../../../../types';

interface Props {
  subscribers: SubscriberItem[];
}

export function FinancialCommissionsPanel({ subscribers }: Props) {
  const { staffMembers, content } = useSiteData();

  const [commissionMonth, setCommissionMonth] = useState(new Date().toISOString().slice(0, 7));
  const [commissionFrom, setCommissionFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 2); return d.toISOString().slice(0, 7);
  });
  const [commissionTo, setCommissionTo] = useState(new Date().toISOString().slice(0, 7));
  const [commissionViewMode, setCommissionViewMode] = useState<'single' | 'range'>('single');

  const sarRate = parseFloat(content['exchange.sar_to_egp'] || '13') || 13;
  const usdRate = parseFloat(content['exchange.usd_to_egp'] || '50') || 50;
  const toEGP = (amt: number, cur: string) => cur === 'EGP' ? amt : cur === 'SAR' ? amt * sarRate : amt * usdRate;

  const commissionsData = useMemo(() =>
    staffMembers
      .filter(s => (s.commissionRate || 0) > 0 && s.status === 'active')
      .map(rep => {
        const repSubs = subscribers.filter(s => s.assignedSalesId === rep.id);
        const revenue = repSubs
          .flatMap(s => s.paymentHistory || [])
          .filter(p => p.at.startsWith(commissionMonth))
          .reduce((sum, p) => sum + toEGP(p.amount, p.currency), 0);
        const commission = Math.round(revenue * (rep.commissionRate || 0) / 100);
        return { rep, revenue, commission };
      }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [staffMembers, subscribers, commissionMonth, sarRate, usdRate]);

  const rangeMonths = useMemo(() => {
    const months: string[] = [];
    const [fy, fm] = commissionFrom.split('-').map(Number);
    const [ty, tm] = commissionTo.split('-').map(Number);
    let y = fy; let m = fm;
    while (y < ty || (y === ty && m <= tm)) {
      months.push(`${y}-${String(m).padStart(2, '0')}`);
      m++; if (m > 12) { m = 1; y++; }
      if (months.length > 24) break;
    }
    return months;
  }, [commissionFrom, commissionTo]);

  const rangeCommissionsData = useMemo(() => {
    const reps = staffMembers.filter(s => (s.commissionRate || 0) > 0 && s.status === 'active');
    return reps.map(rep => {
      const repSubs = subscribers.filter(s => s.assignedSalesId === rep.id);
      const allPayments = repSubs.flatMap(s => s.paymentHistory || []);
      const byMonth = rangeMonths.map(month => {
        const rev = allPayments.filter(p => p.at.startsWith(month)).reduce((sum, p) => sum + toEGP(p.amount, p.currency), 0);
        return { month, revenue: rev, commission: Math.round(rev * (rep.commissionRate || 0) / 100) };
      });
      const totalRevenue = byMonth.reduce((s, mm) => s + mm.revenue, 0);
      const totalCommission = byMonth.reduce((s, mm) => s + mm.commission, 0);
      return { rep, byMonth, totalRevenue, totalCommission };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffMembers, subscribers, rangeMonths, sarRate, usdRate]);

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl overflow-hidden border border-gray-200">
          {(['single', 'range'] as const).map(m => (
            <button key={m} onClick={() => setCommissionViewMode(m)}
              className={`px-4 py-2 text-sm font-bold transition ${commissionViewMode === m ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {m === 'single' ? '📅 شهر واحد' : '📊 نطاق زمني'}
            </button>
          ))}
        </div>
        {commissionViewMode === 'single' ? (
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold text-gray-700">الشهر:</label>
            <input type="month" value={commissionMonth} onChange={e => setCommissionMonth(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-sm font-bold text-gray-700">من:</label>
            <input type="month" value={commissionFrom} onChange={e => setCommissionFrom(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            <label className="text-sm font-bold text-gray-700">إلى:</label>
            <input type="month" value={commissionTo} onChange={e => setCommissionTo(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          </div>
        )}
        {/* Export CSV */}
        <button
          onClick={() => {
            const data = commissionViewMode === 'single'
              ? commissionsData.map(r => ({ 'الموظف': r.rep.name, 'الدور': r.rep.role, 'نسبة العمولة': r.rep.commissionRate + '%', 'الإيرادات EGP': r.revenue, 'العمولة المستحقة EGP': r.commission }))
              : rangeCommissionsData.flatMap(r => r.byMonth.map(b => ({ 'الموظف': r.rep.name, 'الشهر': b.month, 'الإيرادات EGP': b.revenue, 'العمولة EGP': b.commission })));
            if (!data.length) return;
            const headers = Object.keys(data[0]);
            const csv = [headers.join(','), ...data.map(row => headers.map(h => (row as Record<string, unknown>)[h]).join(','))].join('\n');
            const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `commissions-${commissionViewMode === 'single' ? commissionMonth : `${commissionFrom}_${commissionTo}`}.csv`; a.click(); URL.revokeObjectURL(url);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition mr-auto"
        >
          <Download size={15} /> تصدير CSV
        </button>
      </div>

      {/* Single month view */}
      {commissionViewMode === 'single' && (
        <article className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-gray-100 flex items-center gap-2">
            <Percent size={16} className="text-emerald-500" />
            <h4 className="font-bold text-gray-800">عمولات فريق المبيعات — {commissionMonth}</h4>
          </div>
          {commissionsData.length === 0 ? (
            <div className="py-10 text-center text-gray-400">
              <Users size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">لا يوجد موظفون لديهم نسبة عمولة محددة</p>
              <p className="text-xs mt-1 text-gray-300">عدّل نسبة العمولة في ملف الموظف (إدارة الموظفون)</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-right border-b border-gray-100">
                    <th className="py-3 px-4 font-bold text-gray-700">الموظف</th>
                    <th className="py-3 px-4 font-bold text-gray-700">نسبة العمولة</th>
                    <th className="py-3 px-4 font-bold text-gray-700">الإيرادات {commissionMonth}</th>
                    <th className="py-3 px-4 font-bold text-gray-700">العمولة المستحقة</th>
                  </tr>
                </thead>
                <tbody>
                  {commissionsData.map(({ rep, revenue, commission }) => (
                    <tr key={rep.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-xs font-bold text-primary-700">{rep.name.charAt(0)}</div>
                          <div>
                            <p className="font-bold text-gray-900">{rep.name}</p>
                            <p className="text-xs text-gray-400">{rep.role}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4"><span className="bg-primary-100 text-primary-800 px-2 py-0.5 rounded-full text-xs font-bold">{rep.commissionRate}%</span></td>
                      <td className="py-3 px-4 font-bold text-gray-700">{revenue.toLocaleString('ar-EG')} ج.م</td>
                      <td className="py-3 px-4"><span className="text-emerald-700 font-extrabold text-base">{commission.toLocaleString('ar-EG')} ج.م</span></td>
                    </tr>
                  ))}
                  <tr className="bg-emerald-50 border-t-2 border-emerald-200 font-bold">
                    <td className="py-3 px-4 text-gray-700" colSpan={2}>الإجمالي</td>
                    <td className="py-3 px-4 text-gray-700">{commissionsData.reduce((s, c) => s + c.revenue, 0).toLocaleString('ar-EG')} ج.م</td>
                    <td className="py-3 px-4 text-emerald-700 text-lg">{commissionsData.reduce((s, c) => s + c.commission, 0).toLocaleString('ar-EG')} ج.م</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </article>
      )}

      {/* Range view */}
      {commissionViewMode === 'range' && (
        <div className="space-y-4">
          {rangeCommissionsData.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 py-10 text-center text-gray-400">
              <Users size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">لا يوجد موظفون لديهم نسبة عمولة</p>
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {rangeCommissionsData.map(({ rep, totalRevenue, totalCommission }) => (
                  <div key={rep.id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center text-sm font-bold text-primary-700">{rep.name.charAt(0)}</div>
                      <div>
                        <p className="font-bold text-gray-900">{rep.name}</p>
                        <p className="text-xs text-gray-400">{rep.role} · عمولة {rep.commissionRate}%</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-blue-50 rounded-xl p-3 text-center">
                        <p className="text-xs text-blue-600 mb-1">الإيرادات</p>
                        <p className="font-extrabold text-blue-800 text-sm">{totalRevenue.toLocaleString('ar-EG')} ج.م</p>
                      </div>
                      <div className="bg-emerald-50 rounded-xl p-3 text-center">
                        <p className="text-xs text-emerald-600 mb-1">العمولة</p>
                        <p className="font-extrabold text-emerald-800 text-sm">{totalCommission.toLocaleString('ar-EG')} ج.م</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Monthly breakdown table */}
              <article className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="p-4 border-b border-gray-100">
                  <h4 className="font-bold text-gray-800">تفصيل شهري — العمولات المستحقة (ج.م)</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-right border-b border-gray-100">
                        <th className="py-3 px-4 font-bold text-gray-700 sticky right-0 bg-gray-50">الموظف</th>
                        {rangeMonths.map(m => <th key={m} className="py-3 px-3 font-semibold text-gray-600 whitespace-nowrap">{m}</th>)}
                        <th className="py-3 px-4 font-bold text-emerald-700">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rangeCommissionsData.map(({ rep, byMonth, totalCommission }) => (
                        <tr key={rep.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="py-3 px-4 font-bold text-gray-800 sticky right-0 bg-white">{rep.name}</td>
                          {byMonth.map(b => (
                            <td key={b.month} className="py-3 px-3 text-center">
                              {b.commission > 0 ? (
                                <div>
                                  <p className="font-bold text-emerald-700">{b.commission.toLocaleString('ar-EG')}</p>
                                  <p className="text-[10px] text-gray-400">{b.revenue.toLocaleString('ar-EG')}</p>
                                </div>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                          ))}
                          <td className="py-3 px-4 font-extrabold text-emerald-700">{totalCommission.toLocaleString('ar-EG')}</td>
                        </tr>
                      ))}
                      <tr className="bg-emerald-50 border-t-2 border-emerald-200 font-bold">
                        <td className="py-3 px-4 text-gray-700 sticky right-0 bg-emerald-50">الإجمالي</td>
                        {rangeMonths.map(m => {
                          const tot = rangeCommissionsData.reduce((s, r) => s + (r.byMonth.find(b => b.month === m)?.commission || 0), 0);
                          return <td key={m} className="py-3 px-3 text-center font-bold text-emerald-700">{tot > 0 ? tot.toLocaleString('ar-EG') : '—'}</td>;
                        })}
                        <td className="py-3 px-4 text-emerald-800 text-base">{rangeCommissionsData.reduce((s, r) => s + r.totalCommission, 0).toLocaleString('ar-EG')}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </article>
            </>
          )}
        </div>
      )}
    </div>
  );
}
