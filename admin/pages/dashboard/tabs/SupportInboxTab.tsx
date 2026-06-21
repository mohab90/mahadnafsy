import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw, Inbox, Mail, LifeBuoy, Phone } from 'lucide-react';

interface Item { source: 'ticket' | 'contact'; id: string; name: string | null; email: string | null; phone: string | null; subject: string; preview: string | null; status: string; at: string; }

export default function SupportInboxTab({ onOpen }: { onOpen?: (tab: string) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<{ tickets: number; contacts: number; total: number }>({ tickets: 0, contacts: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<'all' | 'ticket' | 'contact'>('all');

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/support-inbox?kind=${kind}`, { credentials: 'include' })
      .then(r => r.json()).then(d => { setItems(d.items || []); setCounts(d.counts || { tickets: 0, contacts: 0, total: 0 }); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [kind]);
  useEffect(() => { load(); }, [load]);

  const Tab = ({ v, label }: { v: typeof kind; label: string }) => (
    <button onClick={() => setKind(v)}
      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${kind === v ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-extrabold text-gray-800 text-base flex items-center gap-2"><Inbox size={18} className="text-indigo-600" /> صندوق الوارد الموحّد</h3>
        <button onClick={load} className="text-xs text-indigo-600 hover:underline flex items-center gap-1"><RefreshCw size={12} /> تحديث</button>
      </div>
      <div className="flex items-center gap-2">
        <Tab v="all" label={`الكل (${counts.total})`} />
        <Tab v="ticket" label={`تذاكر الدعم (${counts.tickets})`} />
        <Tab v="contact" label={`رسائل تواصل (${counts.contacts})`} />
        {loading && <Loader2 size={14} className="animate-spin text-indigo-500" />}
      </div>

      {items.length === 0 && !loading ? (
        <div className="text-center py-12 text-gray-400"><Inbox size={40} className="mx-auto mb-2 text-gray-200" /><p>لا توجد رسائل</p></div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50">
          {items.map(it => (
            <div key={`${it.source}-${it.id}`}
              onClick={() => onOpen?.(it.source === 'ticket' ? 'tickets' : 'contacts')}
              role={onOpen ? 'button' : undefined}
              title={onOpen ? (it.source === 'ticket' ? 'فتح في تذاكر الدعم' : 'فتح في رسائل التواصل') : undefined}
              className={`flex items-start gap-3 p-3.5 transition ${onOpen ? 'cursor-pointer hover:bg-indigo-50' : 'hover:bg-gray-50'}`}>
              <span className={`mt-0.5 w-8 h-8 rounded-lg grid place-items-center shrink-0 ${it.source === 'ticket' ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}>
                {it.source === 'ticket' ? <LifeBuoy size={15} /> : <Mail size={15} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-gray-800 text-sm">{it.name || it.email || '—'}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${it.source === 'ticket' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}`}>
                    {it.source === 'ticket' ? 'تذكرة' : 'تواصل'}
                  </span>
                  <span className="text-[10px] text-gray-400">{String(it.at).slice(0, 16).replace('T', ' ')}</span>
                </div>
                <p className="text-sm text-gray-700 truncate">{it.subject}</p>
                {it.preview && <p className="text-xs text-gray-400 truncate">{it.preview}</p>}
                <div className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-400">
                  {it.email && <span className="truncate">{it.email}</span>}
                  {it.phone && <span className="flex items-center gap-0.5"><Phone size={10} />{it.phone}</span>}
                  <span className="px-1.5 py-0.5 rounded bg-gray-100">{it.status}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-gray-400 text-center">يجمع تذاكر الدعم ورسائل التواصل في مكان واحد — اضغط أي عنصر للرد التفصيلي في قسمه.</p>
    </div>
  );
}
