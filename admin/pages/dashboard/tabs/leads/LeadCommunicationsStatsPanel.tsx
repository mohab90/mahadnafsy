import { TrendingUp } from 'lucide-react';

interface RepCommunicationStats {
  name: string;
  calls: number;
  whatsapp: number;
  meetings: number;
  total: number;
}

interface LeadCommunicationsStatsPanelProps {
  callCount: number;
  waCount: number;
  meetingCount: number;
  uniqueLeadsToday: number;
  repStats: RepCommunicationStats[];
}

export function LeadCommunicationsStatsPanel({
  callCount,
  waCount,
  meetingCount,
  uniqueLeadsToday,
  repStats,
}: LeadCommunicationsStatsPanelProps) {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'مكالمات اليوم', val: callCount, icon: '📞', color: 'bg-blue-50 border-blue-200 text-blue-700' },
          { label: 'واتساب اليوم', val: waCount, icon: '💬', color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
          { label: 'لقاءات الأسبوع', val: meetingCount, icon: '🤝', color: 'bg-orange-50 border-orange-200 text-orange-700' },
          { label: 'عملاء تواصل معهم اليوم', val: uniqueLeadsToday, icon: '👥', color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
        ].map((item) => (
          <div key={item.label} className={`${item.color} border rounded-2xl p-4 flex items-center gap-3`}>
            <span className="text-2xl">{item.icon}</span>
            <div>
              <p className="text-2xl font-extrabold">{item.val}</p>
              <p className="text-xs opacity-70">{item.label}</p>
            </div>
          </div>
        ))}
      </div>

      {repStats.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2 text-sm">
            <TrendingUp size={15} className="text-indigo-500" /> أداء الفريق هذا الأسبوع
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100">
                  <th className="text-right py-1.5 px-2 font-semibold">المندوب</th>
                  <th className="text-center py-1.5 px-2 font-semibold">📞</th>
                  <th className="text-center py-1.5 px-2 font-semibold">💬</th>
                  <th className="text-center py-1.5 px-2 font-semibold">🤝</th>
                  <th className="text-center py-1.5 px-2 font-semibold">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {repStats.map((row) => (
                  <tr key={row.name} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-1.5 px-2 font-bold text-gray-800">{row.name}</td>
                    <td className="py-1.5 px-2 text-center text-blue-700 font-bold">{row.calls}</td>
                    <td className="py-1.5 px-2 text-center text-emerald-700 font-bold">{row.whatsapp}</td>
                    <td className="py-1.5 px-2 text-center text-orange-700 font-bold">{row.meetings}</td>
                    <td className="py-1.5 px-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full font-extrabold text-xs ${row.total >= 20 ? 'bg-emerald-100 text-emerald-700' : row.total >= 10 ? 'bg-amber-100 text-amber-700' : 'bg-red-50 text-red-600'}`}>
                        {row.total}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
