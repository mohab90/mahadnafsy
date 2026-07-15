import { Download } from 'lucide-react';

type CommissionViewMode = 'single' | 'range';

interface CommissionRow {
  rep: { name: string; role: string; commissionRate?: number };
  revenue: number;
  commission: number;
}

interface RangeCommissionRow {
  rep: { name: string };
  byMonth: { month: string; revenue: number; commission: number }[];
}

interface FinancialCommissionsControlsProps {
  commissionViewMode: CommissionViewMode;
  setCommissionViewMode: (mode: CommissionViewMode) => void;
  commissionMonth: string;
  setCommissionMonth: (month: string) => void;
  commissionFrom: string;
  setCommissionFrom: (month: string) => void;
  commissionTo: string;
  setCommissionTo: (month: string) => void;
  commissionsData: CommissionRow[];
  rangeCommissionsData: RangeCommissionRow[];
}

export function FinancialCommissionsControls({
  commissionViewMode,
  setCommissionViewMode,
  commissionMonth,
  setCommissionMonth,
  commissionFrom,
  setCommissionFrom,
  commissionTo,
  setCommissionTo,
  commissionsData,
  rangeCommissionsData,
}: FinancialCommissionsControlsProps) {
  const exportCsv = () => {
    const data = commissionViewMode === 'single'
      ? commissionsData.map((row) => ({
          الموظف: row.rep.name,
          الدور: row.rep.role,
          'نسبة العمولة': `${row.rep.commissionRate || 0}%`,
          'الإيرادات EGP': row.revenue,
          'العمولة المستحقة EGP': row.commission,
        }))
      : rangeCommissionsData.flatMap((row) => row.byMonth.map((monthRow) => ({
          الموظف: row.rep.name,
          الشهر: monthRow.month,
          'الإيرادات EGP': monthRow.revenue,
          'العمولة EGP': monthRow.commission,
        })));
    if (!data.length) return;
    const headers = Object.keys(data[0]);
    const csv = [headers.join(','), ...data.map((row) => headers.map((header) => (row as Record<string, unknown>)[header]).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `commissions-${commissionViewMode === 'single' ? commissionMonth : `${commissionFrom}_${commissionTo}`}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex rounded-xl overflow-hidden border border-gray-200">
        {(['single', 'range'] as const).map((mode) => (
          <button key={mode} onClick={() => setCommissionViewMode(mode)}
            className={`px-4 py-2 text-sm font-bold transition ${commissionViewMode === mode ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            {mode === 'single' ? '📅 شهر واحد' : '📊 نطاق زمني'}
          </button>
        ))}
      </div>
      {commissionViewMode === 'single' ? (
        <div className="flex items-center gap-2">
          <label className="text-sm font-bold text-gray-700">الشهر:</label>
          <input type="month" value={commissionMonth} onChange={(event) => setCommissionMonth(event.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm" />
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-sm font-bold text-gray-700">من:</label>
          <input type="month" value={commissionFrom} onChange={(event) => setCommissionFrom(event.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          <label className="text-sm font-bold text-gray-700">إلى:</label>
          <input type="month" value={commissionTo} onChange={(event) => setCommissionTo(event.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm" />
        </div>
      )}
      <button
        onClick={exportCsv}
        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition mr-auto"
      >
        <Download size={15} /> تصدير CSV
      </button>
    </div>
  );
}
