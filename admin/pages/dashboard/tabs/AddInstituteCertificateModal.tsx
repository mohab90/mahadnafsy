import { useEffect, useState } from 'react';
import { Plus, Printer, Search } from 'lucide-react';
import { Modal } from '../../../../shared/ui/Modal';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { arabicReason } from '../../../lib/apiErrorText';
import { SITE, certificateUrl, formPrintUrl } from '../../../lib/certificateForm';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';
import type { LookupRow } from '../ClientLookupResults';

type Item = { kind: 'track' | 'course'; id: string; title: string; certificate: { id: string; code: string; status: string } | null };
type Loaded = { client: { id: string; name: string; nameEn: string; clientCode: string | null }; items: Item[] };

/**
 * «زر اسمه إضافة شهادة بيقدر يختار عميل من الموجودة بالبحث ويضيفه ويظهر كورساته ويطبعله شهادة»: search a client, see the courses
 * and tracks they hold, issue the certificate of any (the same function as the hourly sweep) and print it at once.
 */
export function AddInstituteCertificateModal({ onClose, onChanged, notify }: {
  onClose: () => void;
  onChanged: () => void;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<LookupRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setFound([]); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      setSearching(true);
      mysqlAdmin.adminGet<{ rows: LookupRow[] }>(`/admin/client-lookup?q=${encodeURIComponent(term)}`)
        .then(result => { if (alive) setFound((result.rows || []).filter(row => row.kind === 'subscriber')); })
        .catch(error => { if (alive) notify('error', arabicReason(error, 'تعذّر البحث')); })
        .finally(() => { if (alive) setSearching(false); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
    // The search box is the only thing that should search again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const open = async (subscriberId: string) => {
    try { setLoaded(await mysqlAdmin.adminGet<Loaded>(`/admin/institute-certificates/client/${encodeURIComponent(subscriberId)}/items`)); }
    catch (error) { notify('error', arabicReason(error, 'تعذّر تحميل كورسات العميل')); }
  };

  const markPrinted = async (id: string, mode: 'full' | 'form') => {
    try { await mysqlAdmin.adminPost(`/admin/institute-certificates/${encodeURIComponent(id)}/printed`, { mode }); onChanged(); }
    catch { /* the print is already open */ }
  };
  const print = (item: Item, mode: 'full' | 'form') => {
    const cert = item.certificate;
    if (!cert) return;
    window.open(mode === 'form' ? formPrintUrl(SITE, cert.code, true) : certificateUrl(cert.code, true), '_blank', 'noopener,noreferrer');
    void markPrinted(cert.id, mode);
  };

  const add = async (item: Item) => {
    if (!loaded) return;
    setBusy(item.id);
    const body: Record<string, unknown> = { subscriberId: loaded.client.id };
    if (item.kind === 'track') body.bundleId = item.id; else body.courseId = item.id;
    try {
      let result: { id: string; code: string };
      try {
        result = await mysqlAdmin.adminPost<{ id: string; code: string }>('/admin/institute-certificates', body);
      } catch (error) {
        // Under the paid share: the desk can still issue it, and answers for it.
        if (!/90%/.test(error instanceof Error ? error.message : '') || !await confirmDialog(arabicReason(error))) throw error;
        result = await mysqlAdmin.adminPost<{ id: string; code: string }>('/admin/institute-certificates', { ...body, force: true });
      }
      notify('success', 'اتضافت الشهادة');
      setLoaded(current => current && {
        ...current,
        items: current.items.map(entry => (entry.id === item.id ? { ...entry, certificate: { id: result.id, code: result.code, status: 'active' } } : entry)),
      });
      onChanged();
    } catch (error) {
      notify('error', arabicReason(error, 'تعذّرت إضافة الشهادة'));
    } finally { setBusy(''); }
  };

  const btn = 'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold';
  return (
    <Modal open onClose={onClose} title="إضافة شهادة" subtitle={loaded ? loaded.client.name : 'اختار العميل من البحث'} size="lg">
      <div className="space-y-3 text-sm" dir="rtl">
        {!loaded ? (
          <>
            <div className="relative">
              <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث بالاسم أو التليفون أو الكود"
                className="w-full rounded-xl border border-gray-200 py-2 pr-9 pl-3 text-sm outline-none focus:ring-2 focus:ring-amber-200" />
            </div>
            {searching && <p className="text-center text-xs text-gray-400">بدوّر…</p>}
            {!searching && query.trim().length >= 2 && found.length === 0 && <p className="text-center text-xs text-gray-400">مفيش عميل بالاسم ده.</p>}
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {found.map(row => (
                <li key={row.id}>
                  <button onClick={() => void open(row.id)} className="flex w-full items-center justify-between rounded-xl border border-gray-100 px-3 py-2 text-right hover:bg-amber-50">
                    <span className="font-bold text-gray-800">{row.name}</span>
                    <span className="text-[11px] text-gray-500" dir="ltr">{row.phone || ''} {row.clientCode ? `· ${row.clientCode}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {!loaded.client.nameEn && (
              <p className="rounded-xl bg-red-50 p-2 text-xs font-bold text-red-700">العميل ملوش اسم بالإنجليزي — الشهادة مش هتتطبع قبل ما تضيفه من «بيانات الشهادة» في ملفه.</p>
            )}
            {loaded.items.length === 0 && <p className="rounded-xl bg-gray-50 p-3 text-center text-xs text-gray-500">العميل مش مشترك في كورسات ولا مسارات.</p>}
            <ul className="space-y-2">
              {loaded.items.map(item => (
                <li key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 p-2.5">
                  <div>
                    <p className="font-bold text-gray-800">{item.kind === 'track' ? '🧭 مسار: ' : ''}{item.title}</p>
                    {item.certificate && <p className="font-mono text-[11px] text-gray-500">{item.certificate.code}{item.certificate.status !== 'active' ? ' — ملغاة' : ''}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {!item.certificate ? (
                      <button disabled={busy === item.id} onClick={() => void add(item)} className={`${btn} bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50`}>
                        <Plus size={12} /> {busy === item.id ? '⏳…' : 'إضافة الشهادة'}
                      </button>
                    ) : item.certificate.status === 'active' ? (
                      <>
                        <button onClick={() => print(item, 'form')} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}><Printer size={12} /> على النموذج</button>
                        <button onClick={() => print(item, 'full')} className={`${btn} bg-slate-800 text-white hover:bg-slate-900`}><Printer size={12} /> كاملة</button>
                      </>
                    ) : <span className="text-[11px] text-gray-400">أعد إصدارها من ملف العميل</span>}
                  </div>
                </li>
              ))}
            </ul>
            <button onClick={() => setLoaded(null)} className="w-full rounded-xl border border-gray-200 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50">عميل تاني</button>
          </>
        )}
      </div>
    </Modal>
  );
}
