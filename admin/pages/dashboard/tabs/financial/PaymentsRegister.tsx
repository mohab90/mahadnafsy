import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Receipt, Search, X } from 'lucide-react';
import { escapeHtml } from '../../../../lib/safeHtml';
import { useNavigate } from 'react-router-dom';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { cairoDateOnly, cairoDay, cairoDaysAgo } from '../../../../../shared/cairoDate';
import { downloadCsv } from '../../../../../shared/csv';

type RegisterRow = {
  id: string;
  number: number | null;
  date: string;
  amount: number;
  currency: string;
  amountEgp: number | null;
  type: string;
  typeLabel: string;
  service: string;
  channel: string;
  transactionId: string | null;
  status: string;
  installment: boolean;
  note: string | null;
  online: boolean;
  client: { id: string; name: string | null; code: string | null; phone: string | null };
  recordedBy: string | null;
};
type Facets = {
  channels: { channel: string; count: number; amountEgp: number }[];
  staff: { id: string; name: string; count: number }[];
  types: { type: string; label: string; count: number }[];
};
type Register = { rows: RegisterRow[]; total: number; totalEgp: number; facets: Facets };

const PAGE_SIZE = 50;
const STATUS_LABEL: Record<string, string> = { paid: 'مؤكدة', pending: 'قيد المراجعة', refunded: 'مستردة', failed: 'فاشلة' };
const fmt = (value: number) => Math.round(value).toLocaleString('ar-EG-u-nu-latn');
export const paymentNumber = (n: number | null) => (n == null ? '—' : `#${n}`);

/** A printable receipt carrying the operation number. Every value is escaped. */
function printReceipt(row: RegisterRow) {
  const w = window.open('', '_blank', 'width=700,height=900');
  if (!w) return;
  const amount = `${escapeHtml(row.amount)} ${escapeHtml(row.currency)}`;
  w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>إيصال ${escapeHtml(paymentNumber(row.number))}</title><style>body{font-family:Arial,sans-serif;padding:40px;direction:rtl;color:#111}.header{text-align:center;border-bottom:3px solid #059669;padding-bottom:20px;margin-bottom:30px}h1{color:#059669;margin:0;font-size:24px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:12px 16px;border:1px solid #e5e7eb;text-align:right}th{background:#f0fdf4;font-weight:700}tfoot td{font-weight:700;background:#f0fdf4}.footer{margin-top:40px;text-align:center;color:#888;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px}</style></head><body><div class="header"><h1>معهد الدراسات النفسية</h1><p style="color:#888;font-size:12px">إيصال رقم ${escapeHtml(paymentNumber(row.number))} — ${escapeHtml(cairoDay(row.date))}</p></div><h3>العميل: ${escapeHtml(row.client.name || '—')}${row.client.code ? ` (${escapeHtml(row.client.code)})` : ''}${row.recordedBy ? ` | بواسطة: ${escapeHtml(row.recordedBy)}` : ''}</h3><table><thead><tr><th>الخدمة</th><th>النوع</th><th>وسيلة الدفع</th><th>المبلغ</th></tr></thead><tbody><tr><td>${escapeHtml(row.service)}</td><td>${escapeHtml(row.typeLabel)}</td><td>${escapeHtml(row.channel)}</td><td>${amount}</td></tr></tbody><tfoot><tr><td colspan="3">الإجمالي</td><td>${amount}</td></tr></tfoot></table><div class="footer">معهد الدراسات النفسية — mahadnafsy.com</div></body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 500);
}

/**
 * The payments register (GET /admin/finance/payments-register): every payment
 * with its running number, the service by name, its channel with duplicate
 * spellings merged, who recorded it and the client — filtered and paged by the
 * server, so it does not depend on which client histories the browser loaded.
 */
export function PaymentsRegister({ branch, initialMethod }: { branch?: string; initialMethod?: string }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [channel, setChannel] = useState('');
  const [method, setMethod] = useState(initialMethod || '');
  const [type, setType] = useState('');
  const [staff, setStaff] = useState('');
  const [status, setStatus] = useState('paid');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Register | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => { setMethod(initialMethod || ''); if (initialMethod) setChannel(''); }, [initialMethod]);
  useEffect(() => { const t = setTimeout(() => setSearch(q.trim()), 350); return () => clearTimeout(t); }, [q]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    const set = (key: string, value: string) => { if (value) params.set(key, value); };
    set('q', search); set('from', from); set('to', to); set('channel', channel);
    if (!channel) set('method', method);
    set('type', type); set('staff', staff); set('status', status); set('branch', branch || '');
    return params.toString();
  }, [search, from, to, channel, method, type, staff, status, branch]);
  useEffect(() => { setPage(0); }, [query]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    mysqlAdmin.adminGet<Register>(`/admin/finance/payments-register?${query}&page=${page}&pageSize=${PAGE_SIZE}`)
      .then(result => { if (alive) setData(result); })
      .catch(err => { if (alive) setError(err instanceof Error ? err.message : 'تعذّر تحميل المدفوعات'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [query, page]);

  const quick = (days: number | 'month') => {
    const today = cairoDateOnly();
    setTo(today);
    setFrom(days === 'month' ? `${today.slice(0, 8)}01` : cairoDaysAgo(days));
  };
  const filtersActive = Boolean(q || from || to || channel || method || type || staff || status !== 'paid');
  const clear = () => { setQ(''); setFrom(''); setTo(''); setChannel(''); setMethod(''); setType(''); setStaff(''); setStatus('paid'); };

  const exportCsv = useCallback(async () => {
    if (!data) return;
    setExporting(true);
    try {
      const rows: RegisterRow[] = [];
      for (let p = 0; p * 200 < Math.min(data.total, 20000); p++) {
        const chunk = await mysqlAdmin.adminGet<Register>(`/admin/finance/payments-register?${query}&page=${p}&pageSize=200`);
        rows.push(...chunk.rows);
      }
      downloadCsv('payments', [
        ['رقم العملية', 'التاريخ', 'العميل', 'كود العميل', 'الخدمة', 'النوع', 'القناة', 'المبلغ', 'العملة', 'القائم بالعملية', 'رقم التحويل', 'الحالة'],
        ...rows.map(r => [paymentNumber(r.number), cairoDay(r.date), r.client.name || '', r.client.code || '', r.service, r.typeLabel, r.channel,
          String(r.amount), r.currency, r.recordedBy || '', r.transactionId || '', STATUS_LABEL[r.status] || r.status]),
      ]);
    } finally { setExporting(false); }
  }, [data, query]);

  const select = 'border border-gray-200 rounded-xl px-2 py-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-400 max-w-[190px]';
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-emerald-600 rounded-2xl p-4 text-white shadow-sm">
          <p className="text-xs opacity-80 mb-1">{filtersActive ? 'إجمالي المفلتر' : 'إجمالي المدفوعات المؤكدة'}</p>
          <p className="text-xl font-extrabold">{fmt(data?.totalEgp || 0)} <span className="text-sm font-normal">ج.م</span></p>
          <p className="text-[11px] opacity-70 mt-1">{(data?.total || 0).toLocaleString('ar-EG-u-nu-latn')} عملية</p>
        </div>
        <div className="bg-violet-600 rounded-2xl p-4 text-white shadow-sm">
          <p className="text-xs opacity-80 mb-1">متوسط العملية</p>
          <p className="text-xl font-extrabold">{fmt(data?.total ? data.totalEgp / data.total : 0)} <span className="text-sm font-normal">ج.م</span></p>
        </div>
        <div className="bg-amber-500 rounded-2xl p-4 text-white shadow-sm col-span-2 md:col-span-1">
          <p className="text-xs opacity-80 mb-1">القنوات</p>
          <p className="text-xl font-extrabold">{data?.facets.channels.length || 0}</p>
          <p className="text-[11px] opacity-70 mt-1">بعد دمج المكرر</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={13} className="absolute top-1/2 -translate-y-1/2 right-3 text-gray-400 pointer-events-none" />
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="اسم العميل، الكود، الموبايل، رقم العملية (#123)، رقم التحويل، الكورس..."
              className="w-full border border-gray-200 rounded-xl pr-8 pl-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-400" />
          </div>
          <label className="text-xs text-gray-500">من</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={select} />
          <label className="text-xs text-gray-500">إلى</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={select} />
          {[['اليوم', 0], ['آخر 7 أيام', 7], ['الشهر', 'month']].map(([label, days]) => (
            <button key={String(label)} type="button" onClick={() => quick(days as number | 'month')}
              className="text-xs px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 font-bold text-gray-600">{label}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select value={channel || (method ? '__method__' : '')} onChange={e => { setChannel(e.target.value === '__method__' ? '' : e.target.value); setMethod(''); }} className={select}>
            <option value="">كل القنوات</option>
            {method && !channel && <option value="__method__">{method}</option>}
            {data?.facets.channels.map(c => <option key={c.channel} value={c.channel}>{c.channel} ({c.count})</option>)}
          </select>
          <select value={type} onChange={e => setType(e.target.value)} className={select}>
            <option value="">كل الأنواع</option>
            {data?.facets.types.map(t => <option key={t.type} value={t.type}>{t.label} ({t.count})</option>)}
          </select>
          <select value={staff} onChange={e => setStaff(e.target.value)} className={select}>
            <option value="">كل القائمين بالعملية</option>
            {data?.facets.staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.count})</option>)}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)} className={select}>
            <option value="paid">مؤكدة</option>
            <option value="pending">قيد المراجعة</option>
            <option value="refunded">مستردة</option>
            <option value="failed">فاشلة</option>
            <option value="all">كل الحالات</option>
          </select>
          <span className="flex-1" />
          {filtersActive && (
            <button type="button" onClick={clear} className="flex items-center gap-1 text-xs bg-red-50 text-red-600 border border-red-200 rounded-xl px-3 py-2 font-bold hover:bg-red-100">
              <X size={11} /> مسح الفلاتر
            </button>
          )}
          <button type="button" onClick={() => void exportCsv()} disabled={exporting || !data?.total}
            className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl px-3 py-2 font-bold hover:bg-emerald-100 disabled:opacity-50">
            <Download size={11} /> {exporting ? 'جارٍ التصدير…' : 'تصدير CSV'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {error && <div className="px-4 py-3 text-xs text-red-600 bg-red-50">{error}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-xs font-bold text-gray-500 bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-3">رقم العملية</th>
                <th className="px-3 py-3">التاريخ</th>
                <th className="px-3 py-3">العميل</th>
                <th className="px-3 py-3">الخدمة</th>
                <th className="px-3 py-3">النوع</th>
                <th className="px-3 py-3">القناة</th>
                <th className="px-3 py-3 text-left">المبلغ</th>
                <th className="px-3 py-3">القائم بالعملية</th>
                <th className="px-3 py-3">رقم التحويل / ملاحظة</th>
                <th className="px-3 py-3 w-12">إيصال</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data?.rows.map(row => (
                <tr key={row.id} className="hover:bg-gray-50/80">
                  <td className="px-3 py-2.5 font-mono text-xs font-bold text-gray-700">{paymentNumber(row.number)}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{cairoDay(row.date)}</td>
                  <td className="px-3 py-2.5">
                    {row.client.id
                      ? <button type="button" onClick={() => navigate(`/client/${row.client.code || row.client.id}`)} className="font-bold text-primary-700 hover:underline text-right">{row.client.name || '—'}</button>
                      : <span className="text-gray-500">—</span>}
                    {row.client.code && <p className="text-[10px] text-gray-400">{row.client.code}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-gray-700 max-w-[220px] truncate" title={row.service}>
                    {row.service}{row.installment ? <span className="mr-1 text-[10px] text-amber-600">(قسط)</span> : null}
                  </td>
                  <td className="px-3 py-2.5"><span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-bold">{row.typeLabel}</span></td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${row.online ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>{row.online ? '🌐 ' : ''}{row.channel}</span>
                  </td>
                  <td className="px-3 py-2.5 text-left whitespace-nowrap">
                    <span className="font-extrabold text-emerald-700">{row.amount.toLocaleString('ar-EG-u-nu-latn')}</span>
                    <span className="text-[10px] text-gray-400 mr-1">{row.currency}</span>
                    {row.status !== 'paid' && <p className="text-[10px] text-amber-600">{STATUS_LABEL[row.status] || row.status}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-700">{row.recordedBy || <span className="text-gray-400">—</span>}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-400 max-w-[180px] truncate" title={row.note || ''}>{row.transactionId || row.note || ''}</td>
                  <td className="px-3 py-2.5">
                    <button type="button" onClick={() => printReceipt(row)} title="طباعة إيصال"
                      className="text-[11px] bg-gray-100 hover:bg-emerald-50 hover:text-emerald-700 text-gray-600 px-2 py-1 rounded-lg"><Receipt size={11} /></button>
                  </td>
                </tr>
              ))}
              {data && data.rows.length === 0 && (
                <tr><td colSpan={10} className="py-12 text-center text-gray-400 text-sm">{loading ? 'جاري التحميل…' : 'لا توجد مدفوعات مطابقة للفلتر'}</td></tr>
              )}
              {!data && <tr><td colSpan={10} className="py-12 text-center text-gray-400 text-sm">جاري التحميل…</td></tr>}
            </tbody>
          </table>
        </div>
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-center gap-2 px-5 py-3 border-t border-gray-100">
            <button type="button" disabled={page <= 0} onClick={() => setPage(p => p - 1)} className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-gray-600 text-xs font-bold">‹</button>
            <span className="text-xs text-gray-500">{page + 1} / {Math.ceil(data.total / PAGE_SIZE)}</span>
            <button type="button" disabled={(page + 1) * PAGE_SIZE >= data.total} onClick={() => setPage(p => p + 1)} className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-gray-600 text-xs font-bold">›</button>
          </div>
        )}
      </div>
    </div>
  );
}
