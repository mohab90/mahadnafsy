import React from 'react';
import { BarChart3 } from 'lucide-react';
import type { StaffMember } from '../../../../types';
import { ROLE_LABELS, ROLE_COLORS, fmtMoney, type PerfRow } from './shared';

interface Props {
  perfMonth: string;
  setPerfMonth: React.Dispatch<React.SetStateAction<string>>;
  perfData: PerfRow[];
  onSelect: (member: StaffMember) => void;
}

const PerformanceTab: React.FC<Props> = ({ perfMonth, setPerfMonth, perfData, onSelect }) => (
  <div className="space-y-4">
    <div className="flex items-center gap-3">
      <label className="text-sm font-bold text-gray-700">شهر التقرير:</label>
      <input type="month" value={perfMonth} onChange={e => setPerfMonth(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm"/>
    </div>
    {perfData.length === 0 ? (
      <div className="text-center py-16 text-gray-400"><BarChart3 size={40} className="mx-auto mb-3 opacity-20"/><p className="text-sm">لا بيانات أداء لهذا الشهر</p></div>
    ) : (
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 border-b border-gray-100 text-right text-xs font-bold text-gray-500">
            <th className="px-4 py-3">#</th>
            <th className="px-4 py-3">الموظف</th>
            <th className="px-4 py-3">المبيعات</th>
            <th className="px-4 py-3">العمولة</th>
            <th className="px-4 py-3">التارجت</th>
            <th className="px-4 py-3">ليدات / تحويل</th>
            <th className="px-4 py-3">مكافأة</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {perfData.map((p, i) => (
              <tr key={p.member.id} className="hover:bg-gray-50 transition cursor-pointer" onClick={() => onSelect(p.member)}>
                <td className="px-4 py-3 text-center"><span className="text-sm font-bold text-gray-500">{i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i+1}`}</span></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-xs shrink-0">{p.member.name.charAt(0)}</div>
                    <div><p className="font-bold text-gray-800 text-xs">{p.member.name}</p><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ROLE_COLORS[p.member.role] || 'bg-gray-100 text-gray-600'}`}>{ROLE_LABELS[p.member.role]}</span></div>
                  </div>
                </td>
                <td className="px-4 py-3 font-bold text-green-700 text-xs">{fmtMoney(p.revenue)}</td>
                <td className="px-4 py-3 font-bold text-amber-700 text-xs">{fmtMoney(p.commission)}</td>
                <td className="px-4 py-3">
                  {p.member.monthlyTarget ? (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${p.targetHit ? 'bg-emerald-500' : 'bg-slate-400'}`} style={{ width: `${p.targetPct}%` }}/></div>
                        <span className={`text-[10px] font-bold ${p.targetHit ? 'text-emerald-700' : 'text-gray-500'}`}>{p.targetPct}%</span>
                      </div>
                      {p.targetHit && <span className="text-[10px] text-emerald-600 font-bold">✅ تحقق</span>}
                    </div>
                  ) : <span className="text-xs text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">{p.leadsCount} / {p.converted} ({p.convRate}%)</td>
                <td className="px-4 py-3 text-xs">{p.bonus > 0 ? <span className="text-emerald-700 font-bold">+{fmtMoney(p.bonus)}</span> : <span className="text-gray-300">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

export default PerformanceTab;
