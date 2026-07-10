import React from 'react';

interface AttributionRow {
  label: string;
  leads: number;
  converted: number;
  convRate: number;
  subscribers: number;
  revenue: number;
  revShare: number;
}

// Conversion attribution — which lead source / salesperson actually turns into
// paying subscriptions + revenue (GET /api/admin/funnel/attribution).
export function AttributionTable() {
  const [by, setBy] = React.useState<'source' | 'sales'>('source');
  const [rows, setRows] = React.useState<AttributionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/funnel/attribution?by=${by}`, { credentials: 'include' })
      .then(r => r.json()).then(d => setRows(Array.isArray(d.rows) ? d.rows : []))
      .catch(() => setRows([])).finally(() => setLoading(false));
  }, [by]);
  const maxRev = Math.max(1, ...rows.map(r => Number(r.revenue)));
  const fmt = (n: number) => Number(n || 0).toLocaleString('ar-EG-u-nu-latn');
  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 mt-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">💰 مصدر الإيراد — من أين يأتي المال فعلاً؟</h3>
        <div className="flex gap-1.5">
          {([['source', 'حسب المصدر'], ['sales', 'حسب الموظف']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setBy(k)}
              className={`text-xs px-3 py-1.5 rounded-lg font-bold transition ${by === k ? 'bg-rose-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{l}</button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">جارٍ التحميل...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">لا توجد بيانات</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" dir="rtl">
            <thead className="text-xs text-gray-500 border-b border-gray-100">
              <tr>
                <th className="text-right py-2 font-semibold">{by === 'sales' ? 'الموظف' : 'المصدر'}</th>
                <th className="text-center py-2 font-semibold">عملاء محتملون</th>
                <th className="text-center py-2 font-semibold">تحوّلوا</th>
                <th className="text-center py-2 font-semibold">نسبة التحويل</th>
                <th className="text-center py-2 font-semibold">مشتركون</th>
                <th className="text-left py-2 font-semibold">الإيراد (ج.م)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="py-2 font-bold text-gray-800">{r.label}</td>
                  <td className="text-center text-gray-600">{fmt(r.leads)}</td>
                  <td className="text-center text-gray-600">{fmt(r.converted)}</td>
                  <td className="text-center"><span className={`text-xs font-bold ${r.convRate >= 30 ? 'text-green-600' : r.convRate >= 15 ? 'text-yellow-600' : 'text-red-400'}`}>{r.convRate}%</span></td>
                  <td className="text-center text-gray-600">{fmt(r.subscribers)}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden max-w-[120px]">
                        <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${(Number(r.revenue) / maxRev) * 100}%` }} />
                      </div>
                      <span className="font-bold text-emerald-700 w-24 text-left">{fmt(r.revenue)} <span className="text-[10px] text-gray-400">({r.revShare}%)</span></span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-gray-400 text-center mt-3">الإيراد منسوب للعملاء المرتبطين بليد له مصدر — يوضّح أعلى القنوات/الموظفين عائداً.</p>
    </div>
  );
}
