import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { waLink } from '../../../lib/whatsappLink';
import { WhatsAppIcon } from '../../../components/WhatsAppIcon';

// «عملاء في خطر» (8 Oct 2026): clients in a running round with two of a low
// rating, two lectures missed and money owed (api/lib/clientsAtRisk.js) — the
// ones customer service calls first.
type AtRisk = { subscriberId: string; name: string; phone: string; roundCode: string; courseTitle: string; reasons: string[] };

export function ClientsAtRiskPanel() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AtRisk[] | null>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    mysqlAdmin.adminGet<AtRisk[]>('/admin/clients-at-risk').then(list => setRows(Array.isArray(list) ? list : [])).catch(() => setRows([]));
  }, []);
  if (!rows) return null;
  return (
    <section className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4" dir="rtl">
      <button type="button" onClick={() => setOpen(value => !value)} className="flex w-full items-center justify-between gap-2 text-right">
        <h3 className="flex items-center gap-2 text-sm font-extrabold text-rose-800"><AlertTriangle size={16} /> عملاء في خطر ({rows.length})</h3>
        <span className="text-[11px] text-rose-700">اتنين من تلاتة: تقييم أقل من 5 · غاب محاضرتين · عليه فلوس</span>
      </button>
      {open && (rows.length === 0 ? (
        <p className="mt-2 text-xs text-rose-700">مفيش عميل في خطر دلوقتي 👌</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-rose-100 bg-white">
          <table className="w-full text-xs">
            <tbody>
              {rows.slice(0, 200).map(row => {
                const wa = waLink(row.phone);
                return (
                  <tr key={`${row.subscriberId}-${row.roundCode}`} className="border-t border-rose-50 first:border-t-0">
                    <td className="px-3 py-2">
                      <div className="whitespace-nowrap font-bold text-gray-800">{row.name}</div>
                      {row.phone && <div className="text-right text-[11px] text-gray-500" dir="ltr">{row.phone}</div>}
                    </td>
                    <td className="px-3 py-2 text-gray-600"><div className="font-bold text-indigo-700">روند {row.roundCode}</div><div className="text-[11px]">{row.courseTitle}</div></td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">{row.reasons.map(reason => <span key={reason} className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">{reason}</span>)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-nowrap items-center gap-1">
                        {wa && <a href={wa} target="_blank" rel="noreferrer" title="واتساب" className="grid h-6 w-6 place-items-center rounded-md border border-gray-200 bg-white hover:bg-gray-900 hover:text-white"><WhatsAppIcon size={12} /></a>}
                        <button onClick={() => navigate(`/client/${row.subscriberId}`)} className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-gray-600 hover:bg-gray-100"><ExternalLink size={10} /> الملف</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
