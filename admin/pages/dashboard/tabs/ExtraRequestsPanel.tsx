import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Package, RefreshCw } from 'lucide-react';

import { mysqlAdmin, type ExtraRequestRow } from '../../../lib/mysqlapi';
import { cairoDay } from '../../../../shared/cairoDate';

type NotifyFn = (type: 'success' | 'error' | 'info', message: string) => void;

const KIND_LABEL: Record<ExtraRequestRow['kind'], string> = { carnet: 'كارنيه', book: 'كتاب', attestation: 'توثيق إضافي' };
const currencyMark = (currency: string) => (currency === 'SAR' ? 'ر.س' : currency === 'USD' ? '$' : 'ج');

/**
 * «طلبات إضافية»: a carnet, a book or an extra attestation a client paid for,
 * for the desk that hands them over. They were payments and nothing else, so
 * nobody there saw them.
 */
export default function ExtraRequestsPanel({ notify }: { notify: NotifyFn }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ExtraRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<'all' | ExtraRequestRow['kind']>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await mysqlAdmin.listExtraRequests()); }
    catch (error) { notify('error', error instanceof Error ? `تعذر تحميل الطلبات الإضافية: ${error.message}` : 'تعذر تحميل الطلبات الإضافية'); }
    finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter(row => (kind === 'all' || row.kind === kind)
      && (!term || [row.subscriberName, row.subscriberPhone, row.clientCode, row.title, row.note]
        .some(value => String(value || '').toLowerCase().includes(term))));
  }, [rows, kind, search]);

  const th = 'text-right px-3 py-2.5 border border-gray-200 font-semibold text-xs whitespace-nowrap';
  const td = 'px-3 py-2 border border-gray-100 text-xs align-top';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold text-gray-900 flex items-center gap-2"><Package size={18} className="text-amber-500" /> طلبات إضافية</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">{filtered.length} / {rows.length} طلب</span>
          <button onClick={() => void load()} disabled={loading} title="تحديث"
            className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {([['all', 'الكل'], ['carnet', 'كارنيه'], ['book', 'كتاب'], ['attestation', 'توثيق إضافي']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setKind(key)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border ${kind === key ? 'bg-amber-500 text-white border-amber-500' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {label} {key !== 'all' && <span className="opacity-70">({rows.filter(row => row.kind === key).length})</span>}
          </button>
        ))}
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="بحث بالاسم أو الرقم أو الكود"
          className="flex-1 min-w-[180px] rounded-xl border border-gray-200 px-3 py-1.5 text-sm" />
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full border-collapse">
          <thead className="bg-gray-50"><tr>
            <th className={th}>العميل</th><th className={th}>الطلب</th><th className={th}>المبلغ</th>
            <th className={th}>الحالة</th><th className={th}>التاريخ</th><th className={th}>سجّله</th><th className={th}>ملاحظة</th><th className={th} />
          </tr></thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={8} className="py-8 text-center text-sm text-gray-400">جاري التحميل…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="py-8 text-center text-sm text-gray-400">مفيش طلبات</td></tr>
            ) : filtered.map(row => (
              <tr key={row.id} className="hover:bg-gray-50/60">
                <td className={td}>
                  <div className="font-bold text-gray-800">{row.subscriberName || '—'}</div>
                  <div className="text-gray-500 font-mono">{row.clientCode || ''} {row.subscriberPhone ? `· ${row.subscriberPhone}` : ''}</div>
                </td>
                <td className={td}><span className="font-bold text-amber-700">{KIND_LABEL[row.kind]}</span>{row.title ? <div className="text-gray-500">{row.title}</div> : null}</td>
                <td className={`${td} font-bold`}>{row.amount.toLocaleString('ar-EG-u-nu-latn')} {currencyMark(row.currency)}</td>
                <td className={td}>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${row.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
                    {row.status === 'paid' ? 'مدفوع' : 'مستني موافقة الحسابات'}
                  </span>
                </td>
                <td className={`${td} whitespace-nowrap`}>{cairoDay(row.date)}</td>
                <td className={td}>{row.takenBy || '—'}</td>
                <td className={td}>{row.note || ''}</td>
                <td className={td}>
                  {(row.clientCode || row.subscriberId) && (
                    <button onClick={() => navigate(`/client/${row.clientCode || row.subscriberId}`)} title="ملف العميل"
                      className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><ExternalLink size={13} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
