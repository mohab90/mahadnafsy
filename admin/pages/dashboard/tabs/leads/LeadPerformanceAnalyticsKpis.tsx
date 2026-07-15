interface LeadPerformanceAnalyticsKpisProps {
  totalLeads: number;
  conversionRate: string;
  convertedCount: number;
  totalCommunications: number;
  monthlyLeads: number;
}

export function LeadPerformanceAnalyticsKpis({
  totalLeads,
  conversionRate,
  convertedCount,
  totalCommunications,
  monthlyLeads,
}: LeadPerformanceAnalyticsKpisProps) {
  const cards = [
    { label: 'إجمالي الليدز', val: totalLeads, sub: 'نشط', accent: 'bg-indigo-500' },
    { label: 'معدل التحويل', val: conversionRate, sub: `${convertedCount} محوّل`, accent: 'bg-emerald-500' },
    { label: 'إجمالي التواصلات', val: totalCommunications, sub: 'مكالمة + واتساب + لقاء', accent: 'bg-violet-500' },
    { label: 'ليدز هذا الشهر', val: monthlyLeads, sub: 'جديدة هذا الشهر', accent: 'bg-amber-500' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <div className={`w-8 h-1 ${card.accent} rounded-full mb-3`} />
          <p className="text-2xl font-extrabold text-gray-900">{card.val}</p>
          <p className="text-sm font-bold text-gray-700 mt-0.5">{card.label}</p>
          <p className="text-xs text-gray-400">{card.sub}</p>
        </div>
      ))}
    </div>
  );
}
