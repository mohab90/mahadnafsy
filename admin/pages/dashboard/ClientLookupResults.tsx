import { useEffect, useState } from 'react';
import { Database, ExternalLink, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Row = {
  kind: 'subscriber' | 'lead';
  id: string;
  clientCode: string | null;
  name: string;
  phone: string | null;
  place: string;
  branch: string | null;
  owner: string | null;
  mine: boolean;
  canOpen: boolean;
};

/**
 * «بحث»: every client the institute holds, from the second letter, whoever owns
 * them — GET /admin/client-lookup. The rows above it are the caller's own
 * (bookable from here); these say who a person is, where they sit and who has
 * them, so a rep sees that a client is already registered before registering
 * them again. A file the caller may not open says whose it is instead of
 * linking to a refusal.
 */
export function ClientLookupResults({ query, skipIds }: { query: string; skipIds: Set<string> }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [capped, setCapped] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) { setRows([]); setState('idle'); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      setState('loading');
      mysqlAdmin.adminGet<{ rows: Row[]; capped?: boolean }>(`/admin/client-lookup?q=${encodeURIComponent(term)}`)
        .then(result => { if (alive) { setRows(result.rows); setCapped(Boolean(result.capped)); setState('ready'); } })
        .catch(() => { if (alive) setState('error'); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [term]);

  if (state === 'idle') return null;
  const shown = rows.filter(row => !skipIds.has(row.id));
  return (
    <div className="bg-white border border-emerald-200 rounded-2xl p-3 shadow-sm">
      <h3 className="flex items-center gap-2 text-sm font-bold text-gray-800 mb-2">
        <Database size={15} className="text-emerald-600" />
        كل العملاء على الموقع
        {state === 'ready' && <span className="text-[11px] font-normal text-gray-500">{rows.length} نتيجة{capped ? ' — اكتب أكتر لتضييق البحث' : ''}</span>}
      </h3>
      {state === 'loading' && <p className="text-xs text-gray-400 py-2">جاري البحث…</p>}
      {state === 'error' && <p className="text-xs text-red-600 py-2">تعذّر البحث، حاول مرة أخرى</p>}
      {state === 'ready' && shown.length === 0 && (
        <p className="text-xs text-gray-400 py-2">{rows.length === 0 ? 'لا يوجد أي عميل بهذا الاسم أو الرقم في النظام — يمكنك تسجيله كعميل جديد.' : 'كل النتائج ظاهرة أعلاه.'}</p>
      )}
      {state === 'ready' && shown.map(row => (
        <div key={`${row.kind}:${row.id}`} className="flex items-center gap-2 border-b border-gray-50 last:border-0 py-1.5">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-800 text-sm truncate">
              {row.name || '—'}
              {row.clientCode && <span className="mr-1 text-[10px] text-gray-400 font-normal">{row.clientCode}</span>}
            </p>
            <p className="text-xs text-gray-500 truncate" dir="ltr" style={{ textAlign: 'right' }}>{row.phone || '—'}</p>
          </div>
          <div className="text-left shrink-0">
            <span className="rounded-full bg-sky-100 text-sky-700 px-2 py-0.5 text-[10px] font-bold">{row.place}</span>
            <p className="text-[10px] text-gray-500 mt-0.5">{row.owner ? `المسئول: ${row.owner}` : 'بدون مسئول'}</p>
          </div>
          {row.canOpen ? (
            <button
              type="button"
              onClick={() => navigate(`/client/${row.clientCode || row.id}`)}
              title="فتح صفحة العميل"
              className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-primary-700 hover:bg-primary-50"
            >
              <ExternalLink size={15} />
            </button>
          ) : (
            <span title={row.owner ? `هذا العميل عند ${row.owner} — تواصل معه` : 'ملف هذا العميل ليس في نطاقك'} className="shrink-0 p-2 text-gray-300">
              <Lock size={15} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
