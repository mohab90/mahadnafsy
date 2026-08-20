import { Percent, Users } from 'lucide-react';
import type { StaffMember } from '../../../../types';
import { FinancialCommissionsControls } from './FinancialCommissionsControls';

type CommissionViewMode = 'single' | 'range';

type CommissionRow = {
  rep: StaffMember;
  revenue: number;
  commission: number;
};

type RangeCommissionRow = {
  rep: StaffMember;
  byMonth: { month: string; revenue: number; commission: number }[];
  totalRevenue: number;
  totalCommission: number;
};

type Props = {
  commissionViewMode: CommissionViewMode;
  setCommissionViewMode: (mode: CommissionViewMode) => void;
  commissionMonth: string;
  setCommissionMonth: (month: string) => void;
  commissionFrom: string;
  setCommissionFrom: (month: string) => void;
  commissionTo: string;
  setCommissionTo: (month: string) => void;
  commissionsData: CommissionRow[];
  rangeMonths: string[];
  rangeCommissionsData: RangeCommissionRow[];
};

export function FinancialCommissionsPanel({
  commissionViewMode,
  setCommissionViewMode,
  commissionMonth,
  setCommissionMonth,
  commissionFrom,
  setCommissionFrom,
  commissionTo,
  setCommissionTo,
  commissionsData,
  rangeMonths,
  rangeCommissionsData,
}: Props) {
  return (
    <div className="space-y-4">
      <FinancialCommissionsControls
        commissionViewMode={commissionViewMode}
        setCommissionViewMode={setCommissionViewMode}
        commissionMonth={commissionMonth}
        setCommissionMonth={setCommissionMonth}
        commissionFrom={commissionFrom}
        setCommissionFrom={setCommissionFrom}
        commissionTo={commissionTo}
        setCommissionTo={setCommissionTo}
        commissionsData={commissionsData}
        rangeCommissionsData={rangeCommissionsData}
      />

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
                      <td className="py-3 px-4 font-bold text-gray-700">{revenue.toLocaleString('ar-EG-u-nu-latn')} ج.م</td>
                      <td className="py-3 px-4"><span className="text-emerald-700 font-extrabold text-base">{commission.toLocaleString('ar-EG-u-nu-latn')} ج.م</span></td>
                    </tr>
                  ))}
                  <tr className="bg-emerald-50 border-t-2 border-emerald-200 font-bold">
                    <td className="py-3 px-4 text-gray-700" colSpan={2}>الإجمالي</td>
                    <td className="py-3 px-4 text-gray-700">{commissionsData.reduce((sum, row) => sum + row.revenue, 0).toLocaleString('ar-EG-u-nu-latn')} ج.م</td>
                    <td className="py-3 px-4 text-emerald-700 text-lg">{commissionsData.reduce((sum, row) => sum + row.commission, 0).toLocaleString('ar-EG-u-nu-latn')} ج.م</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </article>
      )}

      {commissionViewMode === 'range' && (
        <div className="space-y-4">
          {rangeCommissionsData.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 py-10 text-center text-gray-400">
              <Users size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">لا يوجد موظفون لديهم نسبة عمولة</p>
            </div>
          ) : (
            <>
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
                        <p className="font-extrabold text-blue-800 text-sm">{totalRevenue.toLocaleString('ar-EG-u-nu-latn')} ج.م</p>
                      </div>
                      <div className="bg-emerald-50 rounded-xl p-3 text-center">
                        <p className="text-xs text-emerald-600 mb-1">العمولة</p>
                        <p className="font-extrabold text-emerald-800 text-sm">{totalCommission.toLocaleString('ar-EG-u-nu-latn')} ج.م</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <article className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="p-4 border-b border-gray-100">
                  <h4 className="font-bold text-gray-800">تفصيل شهري — العمولات المستحقة (ج.م)</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-right border-b border-gray-100">
                        <th className="py-3 px-4 font-bold text-gray-700 sticky right-0 bg-gray-50">الموظف</th>
                        {rangeMonths.map((month) => <th key={month} className="py-3 px-3 font-semibold text-gray-600 whitespace-nowrap">{month}</th>)}
                        <th className="py-3 px-4 font-bold text-emerald-700">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rangeCommissionsData.map(({ rep, byMonth, totalCommission }) => (
                        <tr key={rep.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="py-3 px-4 font-bold text-gray-800 sticky right-0 bg-white">{rep.name}</td>
                          {byMonth.map((monthRow) => (
                            <td key={monthRow.month} className="py-3 px-3 text-center">
                              {monthRow.commission > 0 ? (
                                <div>
                                  <p className="font-bold text-emerald-700">{monthRow.commission.toLocaleString('ar-EG-u-nu-latn')}</p>
                                  <p className="text-[10px] text-gray-400">{monthRow.revenue.toLocaleString('ar-EG-u-nu-latn')}</p>
                                </div>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                          ))}
                          <td className="py-3 px-4 font-extrabold text-emerald-700">{totalCommission.toLocaleString('ar-EG-u-nu-latn')}</td>
                        </tr>
                      ))}
                      <tr className="bg-emerald-50 border-t-2 border-emerald-200 font-bold">
                        <td className="py-3 px-4 text-gray-700 sticky right-0 bg-emerald-50">الإجمالي</td>
                        {rangeMonths.map((month) => {
                          const total = rangeCommissionsData.reduce((sum, row) => sum + (row.byMonth.find((item) => item.month === month)?.commission || 0), 0);
                          return <td key={month} className="py-3 px-3 text-center font-bold text-emerald-700">{total > 0 ? total.toLocaleString('ar-EG-u-nu-latn') : '—'}</td>;
                        })}
                        <td className="py-3 px-4 text-emerald-800 text-base">{rangeCommissionsData.reduce((sum, row) => sum + row.totalCommission, 0).toLocaleString('ar-EG-u-nu-latn')}</td>
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
