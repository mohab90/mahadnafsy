
type UnifiedClientPaymentSummaryPanelProps = {
  totalPaidEGP: number;
  remainingEGP: number;
  settlementLabel: string;
  transactionCount: number;
};

export function UnifiedClientPaymentSummaryPanel({
  totalPaidEGP,
  remainingEGP,
  settlementLabel,
  transactionCount,
}: UnifiedClientPaymentSummaryPanelProps) {
  if (transactionCount <= 0) return null;

  return (
    <div className="mb-3 grid grid-cols-3 gap-2">
      <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-center">
        <p className="mb-0.5 text-[10px] text-gray-400">إجمالي مدفوع</p>
        <p className="text-base font-extrabold text-emerald-700">{totalPaidEGP.toLocaleString()} {settlementLabel}</p>
      </div>
      <div className={`rounded-xl border p-3 text-center ${remainingEGP > 0 ? 'border-red-100 bg-red-50' : 'border-gray-100 bg-gray-50'}`}>
        <p className="mb-0.5 text-[10px] text-gray-400">المتبقي</p>
        <p className={`text-base font-extrabold ${remainingEGP > 0 ? 'text-red-600' : 'text-gray-400'}`}>
          {remainingEGP > 0 ? `${remainingEGP.toLocaleString()} ${settlementLabel}` : '✓'}
        </p>
      </div>
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-center">
        <p className="mb-0.5 text-[10px] text-gray-400">معاملات</p>
        <p className="text-base font-extrabold text-blue-700">{transactionCount}</p>
      </div>
    </div>
  );
}
