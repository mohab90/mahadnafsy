import { useCallback, useEffect, useState } from 'react';
import { Archive, RotateCcw, Search, AlertCircle } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

// Deleting a customer archives them — payments, orders and enrolments are all
// kept — and the screen says "تمت أرشفة العميل". But every list in the system
// filters archived rows out, so there was nowhere to see what had been archived
// and no way to undo it: a customer archived by mistake could only be recovered
// by editing the database. This is that missing screen.

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;

type ArchivedClient = {
  id: string;
  client_code?: string;
  name?: string;
  email?: string;
  phone?: string;
  branch?: string;
  deleted_at?: string;
  created_at?: string;
  total_paid?: number;
};

const fmtDate = (value?: string) => (value ? String(value).slice(0, 10) : '—');

export default function ArchivedClientsTab({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<ArchivedClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const data = await mysqlAdmin.adminGet<ArchivedClient[]>(
        `/admin/subscribers/archived${q ? `?q=${encodeURIComponent(q)}` : ''}`
      );
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل أرشيف العملاء');
    } finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load(query); }, [load, query]);

  const restore = async (row: ArchivedClient) => {
    if (!window.confirm(`استعادة ${row.name || 'هذا العميل'} إلى قائمة العملاء النشطين؟\nسيُعاد تفعيل حسابه ودخوله للموقع.`)) return;
    setBusy(row.id);
    try {
      const result = await mysqlAdmin.adminPost<{ ok: boolean; message?: string }>(
        `/admin/subscribers/${encodeURIComponent(row.id)}/restore`, {}
      );
      notify('success', result?.message || 'تمت استعادة العميل');
      await load(query);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر استعادة العميل');
    } finally { setBusy(''); }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl bg-gradient-to-l from-slate-700 to-slate-500 p-5 text-white">
        <h2 className="flex items-center gap-2 text-xl font-black"><Archive size={22} /> أرشيف العملاء</h2>
        <p className="mt-1 text-sm text-slate-200">
          العملاء الذين تم حذفهم. لم يُفقد شيء — المدفوعات والطلبات والاشتراكات محفوظة كما هي، ويمكن استعادة أي عميل بضغطة واحدة.
        </p>
      </div>

      <form
        onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); }}
        className="flex flex-wrap items-center gap-2"
      >
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث بالاسم أو الكود أو البريد أو الهاتف"
            className="w-full rounded-xl border border-gray-200 py-2 pr-9 pl-3 text-sm"
          />
        </div>
        <button type="submit" className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800">بحث</button>
        {query && (
          <button type="button" onClick={() => { setSearch(''); setQuery(''); }}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-50">
            إلغاء البحث
          </button>
        )}
      </form>

      {loading ? (
        <div className="py-16 text-center text-gray-400">
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-slate-600" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-700 flex items-center gap-2">
          <AlertCircle size={16} />
          {query ? 'لا يوجد عميل مؤرشف مطابق لبحثك.' : 'الأرشيف فارغ — لم يتم حذف أي عميل.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 text-right font-bold">الكود</th>
                <th className="px-4 py-3 text-right font-bold">الاسم</th>
                <th className="px-4 py-3 text-right font-bold">التواصل</th>
                <th className="px-4 py-3 text-right font-bold">الفرع</th>
                <th className="px-4 py-3 text-right font-bold">إجمالي المدفوع</th>
                <th className="px-4 py-3 text-right font-bold">تاريخ التسجيل</th>
                <th className="px-4 py-3 text-right font-bold">تاريخ الأرشفة</th>
                <th className="px-4 py-3 text-right font-bold">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{row.client_code || '—'}</td>
                  <td className="px-4 py-3 font-bold text-gray-800">{row.name || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    <div dir="ltr" className="text-right">{row.phone || '—'}</div>
                    <div dir="ltr" className="text-right text-gray-400">{row.email || ''}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{row.branch || '—'}</td>
                  {/* Worth showing: a customer who has paid is one you very
                      probably did not mean to archive. */}
                  <td className={`px-4 py-3 font-bold ${Number(row.total_paid) > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
                    {Number(row.total_paid || 0).toLocaleString('ar-EG')} ج.م
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(row.created_at)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(row.deleted_at)}</td>
                  <td className="px-4 py-3">
                    <button
                      disabled={busy === row.id}
                      onClick={() => restore(row)}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <RotateCcw size={12} /> {busy === row.id ? 'جارٍ...' : 'استعادة'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
