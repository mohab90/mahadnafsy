import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Users, X } from 'lucide-react';
import { adminAuthHeaders } from '../../lib/adminAuthHeaders';

type Notify = (kind: 'success' | 'error' | 'warning' | 'info', message: string) => void;

type StaffMessage = {
  id: string; author_name: string | null;
  direction?: 'to_staff' | 'from_staff' | 'peer_broadcast';
  broadcast_label?: string | null; body: string; created_at: string;
  staff_name?: string | null; staff_id?: string;
};

const json = <T,>(url: string): Promise<T | null> =>
  fetch(url, { credentials: 'include', headers: adminAuthHeaders() })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null);

/**
 * Messages icon for the header, next to the notifications bell.
 *
 * `mode="staff"` shows the employee their own thread with management and their
 * team, and lets them reply. `mode="management"` shows one feed of everything
 * employees have sent in — previously that only existed one employee at a time,
 * buried inside each staff profile, so an incoming message went unnoticed until
 * someone happened to open that person's page.
 */
export default function MessagesBell({
  mode, notify, compact = false,
}: { mode: 'staff' | 'management'; notify: Notify; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [messages, setMessages] = useState<StaffMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState<'management' | 'team'>('management');
  const [sending, setSending] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    if (mode === 'staff') {
      const r = await json<{ unread: number }>('/api/staff/me/messages/unread-count');
      setUnread(r?.unread || 0);
    } else {
      const r = await json<{ unread: number }>('/api/admin/hr/staff-messages/inbox');
      setUnread(r?.unread || 0);
    }
  }, [mode]);

  useEffect(() => {
    void refreshCount();
    const t = setInterval(() => { void refreshCount(); }, 120000);
    return () => clearInterval(t);
  }, [refreshCount]);

  // Click-away, same behaviour as the notifications dropdown beside it.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const load = async () => {
    if (mode === 'staff') {
      const rows = await json<StaffMessage[]>('/api/staff/me/messages');
      setMessages(rows || []);
    } else {
      const r = await json<{ messages: StaffMessage[] }>('/api/admin/hr/staff-messages/inbox');
      setMessages(r?.messages || []);
      await fetch('/api/admin/hr/staff-messages/mark-read', {
        method: 'POST', credentials: 'include', headers: adminAuthHeaders(true),
      }).catch(() => {});
    }
    setUnread(0);
  };

  const toggle = async () => {
    const opening = !open;
    setOpen(opening);
    if (opening) await load();
  };

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const r = await fetch('/api/staff/me/messages', {
        method: 'POST', credentials: 'include', headers: adminAuthHeaders(true),
        body: JSON.stringify({ body, scope }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'تعذر الإرسال');
      setDraft('');
      await load();
      notify('success', scope === 'team' ? 'وصلت لفريقك' : 'وصلت للإدارة');
    } catch (e) {
      notify('error', (e as Error).message);
    } finally { setSending(false); }
  };

  const size = compact ? 13 : 15;
  const btn = compact
    ? 'relative w-7 h-7 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-600 hover:text-sky-800 grid place-items-center transition'
    : 'relative w-8 h-8 rounded-xl bg-gray-100 hover:bg-sky-50 hover:text-sky-600 text-gray-500 grid place-items-center transition';

  return (
    <div className="relative flex-shrink-0" ref={boxRef}>
      <button type="button" onClick={toggle} className={btn} title="المراسلات">
        <MessageSquare size={size} />
        {unread > 0 && (
          <span className={`absolute -top-1 -right-1 rounded-full bg-red-500 text-white font-bold grid place-items-center leading-none ${
            compact ? 'w-3.5 h-3.5 text-[8px]' : 'w-4 h-4 text-[9px]'}`}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-10 left-0 z-[200] w-[22rem] bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden" dir="rtl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="font-bold text-gray-800 text-sm">
              {mode === 'staff' ? 'مراسلاتي' : 'رسائل الموظفين'}
            </span>
            <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto p-3 space-y-2">
            {messages.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">لا توجد رسائل</div>
            ) : mode === 'management' ? (
              messages.map(m => (
                <div key={m.id} className="rounded-xl border border-gray-100 bg-gray-50/60 p-2.5">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-xs font-bold text-gray-800">{m.staff_name || m.author_name || 'موظف'}</span>
                    <span className="text-[10px] text-gray-400">{new Date(m.created_at).toLocaleString('ar-EG')}</span>
                  </div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{m.body}</p>
                  {m.staff_id && (
                    <a href={`/staff/${m.staff_id}`} className="text-[11px] font-bold text-indigo-600 hover:underline">
                      فتح ملفه والرد
                    </a>
                  )}
                </div>
              ))
            ) : (
              messages.map(m => {
                const mine = m.direction === 'from_staff';
                const peer = m.direction === 'peer_broadcast';
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                      mine ? 'bg-indigo-600 text-white'
                        : peer ? 'bg-violet-50 text-violet-900 border border-violet-200'
                          : 'bg-gray-100 text-gray-800'}`}>
                      <div className={`text-[10px] mb-0.5 ${mine ? 'text-indigo-200' : 'text-gray-500'}`}>
                        {mine ? 'أنا' : (m.author_name || 'الإدارة')}
                        {m.broadcast_label && ` · ${m.broadcast_label}`}
                        {' · '}{new Date(m.created_at).toLocaleString('ar-EG')}
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {mode === 'staff' && (
            <div className="border-t border-gray-100 p-3 space-y-2">
              <select value={scope} onChange={e => setScope(e.target.value as 'management' | 'team')}
                className="w-full border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs bg-white font-bold">
                <option value="management">إلى الإدارة</option>
                <option value="team">إلى فريقي كله</option>
              </select>
              <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2}
                placeholder="اكتب رسالتك…"
                className="w-full border border-gray-200 rounded-xl px-2.5 py-2 text-sm resize-y" />
              <button type="button" disabled={sending || !draft.trim()} onClick={send}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-sky-600 text-white rounded-xl font-bold text-sm hover:bg-sky-700 disabled:opacity-60 transition">
                {scope === 'team' ? <Users size={14} /> : <Send size={14} />} إرسال
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
