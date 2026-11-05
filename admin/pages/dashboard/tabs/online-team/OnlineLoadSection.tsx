import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { OnlinePerformance } from '../../../../types';

// «توزيع العملاء»: who carries how many online clients and leads, and what they turn into — the part of «إدارة فريق الأونلاين» worth keeping (that page was
// removed on 5 Nov 2026). Counted by the server (GET /api/admin/online-performance); nothing here names a client.

const ROLE_LABEL: Record<string, string> = {
  online_manager: 'مدير أونلاين', sales: 'سيلز', collection: 'تحصيل', support: 'خدمة عملاء', sales_collection_manager: 'مدير سيلز وتحصيل',
};

export default function OnlineLoadSection() {
  const [perf, setPerf] = useState<OnlinePerformance | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    mysqlAdmin.getOnlinePerformance().then(data => { if (live) setPerf(data); }).catch(() => { if (live) setPerf(null); });
    return () => { live = false; };
  }, []);

  if (perf === undefined) return <div className="py-10 text-center text-sm text-gray-400">جاري التحميل…</div>;
  if (perf === null) return <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">تعذر تحميل توزيع العملاء — حاول مرة أخرى بعد قليل.</div>;

  const chart = perf.months.map(row => ({ month: row.month.slice(5), مشتركين: row.clients, ليدات: row.leads }));
  const card = 'rounded-xl border border-gray-100 bg-white p-4';
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className={card}><div className="text-2xl font-black text-teal-700">{perf.totals.clients.toLocaleString('ar-EG-u-nu-latn')}</div><div className="text-xs text-gray-500">عملاء الأونلاين</div></div>
        <div className={card}><div className="text-2xl font-black text-emerald-700">{perf.totals.activeClients.toLocaleString('ar-EG-u-nu-latn')}</div><div className="text-xs text-gray-500">عملاء نشطين</div></div>
        <div className={card}><div className="text-2xl font-black text-indigo-700">{perf.byStaff.length.toLocaleString('ar-EG-u-nu-latn')}</div><div className="text-xs text-gray-500">موظفين في التشغيل</div></div>
      </div>

      <div className={card}>
        <h4 className="mb-3 text-sm font-bold text-gray-700">العملاء والليدات الجداد — آخر 6 شهور</h4>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chart}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="مشتركين" fill="#0d9488" radius={[4, 4, 0, 0]} />
            <Bar dataKey="ليدات" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className={`${card} overflow-x-auto`}>
        <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-700"><Users size={15} /> كل واحد شايل كام</h4>
        <table className="w-full min-w-[480px] text-sm">
          <thead className="text-right text-xs text-gray-500">
            <tr><th className="py-2">الموظف</th><th>الدور</th><th>عملاء</th><th>ليدات</th><th>اتحولوا</th><th>التحويل</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {perf.byStaff.map(row => (
              <tr key={row.id}>
                <td className="py-2 font-bold text-gray-800">{row.name}</td>
                <td className="text-gray-500">{ROLE_LABEL[row.role] || row.role}</td>
                <td className="tabular-nums">{row.clients.toLocaleString('ar-EG-u-nu-latn')}</td>
                <td className="tabular-nums">{row.leads.toLocaleString('ar-EG-u-nu-latn')}</td>
                <td className="tabular-nums text-emerald-700">{row.converted.toLocaleString('ar-EG-u-nu-latn')}</td>
                <td className="tabular-nums font-bold text-indigo-700">{row.leads ? `${Math.round((row.converted / row.leads) * 100)}٪` : '—'}</td>
              </tr>
            ))}
            {perf.byStaff.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-gray-400">مفيش موظفين نشطين في التشغيل</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
