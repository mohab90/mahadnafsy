import { useEffect, useState } from 'react';
import { ExternalLink, Lock, Wallet } from 'lucide-react';
import { mysqlAdmin } from '../../lib/mysqlapi';

export type LookupType = 'lead' | 'online' | 'daqqi' | 'tagamoa';
export type LookupRow = {
  kind: 'subscriber' | 'lead';
  type: LookupType;
  typeLabel: string;
  id: string;
  clientCode: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  place: string;
  branch: string | null;
  owner: string | null;
  mine: boolean;
  canOpen: boolean;
};

// One look for every kind, told apart by colour and by name: a lead is yellow, an online
// subscriber blue, a Dokki one violet, a Tagamoa one teal — «ليد أصفر، مشترك أونلاين أزرق،
// مشترك الدقي لون تاني ويظهروا تحت بعض».
const TYPE_STYLE: Record<LookupType, { avatar: string; badge: string; row: string }> = {
  lead: { avatar: 'bg-amber-100 text-amber-700', badge: 'bg-amber-100 text-amber-800 border-amber-300', row: 'hover:bg-amber-50/70' },
  online: { avatar: 'bg-blue-100 text-blue-700', badge: 'bg-blue-100 text-blue-800 border-blue-300', row: 'hover:bg-blue-50/70' },
  daqqi: { avatar: 'bg-violet-100 text-violet-700', badge: 'bg-violet-100 text-violet-800 border-violet-300', row: 'hover:bg-violet-50/70' },
  tagamoa: { avatar: 'bg-teal-100 text-teal-700', badge: 'bg-teal-100 text-teal-800 border-teal-300', row: 'hover:bg-teal-50/70' },
};

/**
 * «بحث»: every client the institute holds, from the second letter, whoever owns them —
 * GET /admin/client-lookup — as ONE list. Each row says what the person is (ليد · مشترك
 * أونلاين · مشترك الدقي · مشترك التجمع), who has them, and offers the two things a desk does
 * next: «حجز / دفع» and the file. A file the caller may not open says whose it is instead.
 */
export function ClientLookupList({ query, onPay, onOpen }: {
  query: string;
  onPay: (row: LookupRow) => void;
  onOpen: (row: LookupRow) => void;
}) {
  const [rows, setRows] = useState<LookupRow[]>([]);
  const [capped, setCapped] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) { setRows([]); setState('idle'); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      setState('loading');
      mysqlAdmin.adminGet<{ rows: LookupRow[]; capped?: boolean }>(`/admin/client-lookup?q=${encodeURIComponent(term)}`)
        .then(result => { if (alive) { setRows(result.rows); setCapped(Boolean(result.capped)); setState('ready'); } })
        .catch(() => { if (alive) setState('error'); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [term]);

  if (state === 'idle') return <p className="py-6 text-center text-xs text-gray-400">اكتب 2 حرف أو أكتر للبحث</p>;
  return (
    <div className="space-y-1">
      {state === 'loading' && rows.length === 0 && <p className="py-4 text-center text-xs text-gray-400">جاري البحث…</p>}
      {state === 'error' && <p className="py-4 text-center text-xs text-red-600">تعذّر البحث، حاول مرة أخرى</p>}
      {state === 'ready' && rows.length === 0 && (
        <p className="py-4 text-center text-xs text-gray-400">لا يوجد أي عميل بهذا الاسم أو الرقم في النظام — تقدر تسجّله كعميل جديد.</p>
      )}
      {rows.length > 0 && (
        <p className="px-1 text-[11px] font-semibold text-gray-400">{rows.length} نتيجة{capped ? ' — اكتب أكتر لتضييق البحث' : ''}</p>
      )}
      {rows.map(row => {
        const style = TYPE_STYLE[row.type] || TYPE_STYLE.online;
        return (
          <div key={`${row.kind}:${row.id}`} className={`flex items-center gap-3 rounded-xl border border-gray-100 px-3 py-2 transition ${style.row}`}>
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${style.avatar}`}>{(row.name || '؟').charAt(0)}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-gray-800">
                {row.name || '—'}
                {row.clientCode && <span className="mr-1.5 text-[10px] font-normal text-gray-400">{row.clientCode}</span>}
              </p>
              <p className="truncate text-xs text-gray-500" dir="ltr" style={{ textAlign: 'right' }}>{row.phone || '—'}{row.email ? ` · ${row.email}` : ''}</p>
            </div>
            <div className="shrink-0 text-left">
              <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${style.badge}`} title={row.place}>{row.typeLabel}</span>
              <p className="mt-0.5 max-w-[150px] truncate text-[10px] text-gray-500">{row.mine ? 'عندك' : row.owner ? `المسئول: ${row.owner}` : 'بدون مسئول'}</p>
            </div>
            {row.canOpen ? (
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => onPay(row)} title="حجز / تسجيل دفعة"
                  className="flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-bold text-white transition hover:bg-emerald-700">
                  <Wallet size={13} /> حجز / دفع
                </button>
                <button type="button" onClick={() => onOpen(row)} title="فتح صفحة العميل"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition hover:bg-gray-50 hover:text-primary-700">
                  <ExternalLink size={14} />
                </button>
              </div>
            ) : (
              <span title={row.owner ? `هذا العميل عند ${row.owner} — تواصل معه` : 'ملف هذا العميل ليس في نطاقك'} className="shrink-0 p-2 text-gray-300">
                <Lock size={15} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
