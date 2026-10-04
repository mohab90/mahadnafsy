import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Loader2, LogOut, MessageCircle, Plus, Search, Send, Smartphone, UserRound } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { NotifyFn } from '../../../../types';
import { useVisibleInterval } from '../../../../../shared/useVisibleInterval';
import { CAIRO_TIME_ZONE } from '../../../../../shared/cairoDate';
import { confirmDialog } from '../../../../../shared/ui/confirmDialog';

/**
 * «واتساب»: the rep's own WhatsApp inside the system (api/lib/whatsappWeb.js).
 * Linked once by scanning a QR code from the phone, like WhatsApp Web; then the
 * chats, sending and the message count all live here.
 */

type WaState = {
  status: 'disconnected' | 'connecting' | 'linking' | 'connected' | 'reconnecting' | 'logged_out';
  qr: string | null; phone: string | null; name: string | null;
  sentToday?: number; dailyLimit?: number;
};
type Chat = {
  jid: string; phone: string | null; name: string | null; lastMessage: string | null; lastAt: string | null; unread: number;
  leadId: string | null; subscriberId: string | null; crmName: string | null; clientCode: string | null;
};
type Message = { id: number; waId: string; fromMe: boolean; sentBySystem: boolean; body: string; kind: string; sentAt: string };
type StatRow = { staffId: string; staffName: string | null; day: string; sentBySystem: number; sentFromPhone: number; received: number };

const API = '/staff/whatsapp-web';
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'حصل خطأ');
const timeOf = (iso: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString('ar-EG', sameDay
    ? { hour: 'numeric', minute: '2-digit', timeZone: CAIRO_TIME_ZONE }
    : { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: CAIRO_TIME_ZONE });
};
const chatTitle = (chat: Chat) => chat.crmName || chat.name || (chat.phone ? `+${chat.phone}` : 'محادثة');

export default function WhatsAppWebTab({ notify }: { notify: NotifyFn }) {
  const [state, setState] = useState<WaState | null>(null);
  const [busy, setBusy] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const loadState = useCallback(async () => {
    try { setState(await mysqlAdmin.adminGet<WaState>(`${API}/state`)); } catch (error) { notify('error', errorText(error)); }
  }, [notify]);

  // Fast while a QR is on screen or the link is coming up; slow once settled.
  const waiting = !state || ['connecting', 'linking', 'reconnecting'].includes(state.status);
  useVisibleInterval(loadState, waiting ? 2000 : 15000);

  const connect = async () => {
    setBusy(true);
    try {
      setState(s => (s ? { ...s, status: 'connecting', qr: null } : s));
      await mysqlAdmin.adminPost(`${API}/connect`, {});
      await loadState();
    }
    catch (error) { notify('error', errorText(error)); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    if (!await confirmDialog('فصل الواتساب عن السيستم؟ هتحتاج تمسح الكود تاني عشان ترجّعه.')) return;
    setBusy(true);
    try { await mysqlAdmin.adminPost(`${API}/logout`, {}); await loadState(); notify('success', 'اتفصل الربط'); }
    catch (error) { notify('error', errorText(error)); }
    finally { setBusy(false); }
  };

  if (!state) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-green-600" size={28} /></div>;
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 text-green-600"><MessageCircle size={22} /></div>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-gray-800">واتساب</div>
          <div className="text-xs text-gray-500">
            {state.status === 'connected'
              ? <>مربوط على <span dir="ltr" className="font-semibold">+{state.phone}</span>{state.name ? ` · ${state.name}` : ''}</>
              : state.status === 'reconnecting' ? 'بيرجع يتصل…' : 'مش مربوط'}
          </div>
        </div>
        {state.status === 'connected' && (
          <div className="rounded-xl bg-green-50 px-3 py-1.5 text-sm text-green-700">
            رسايل النهارده: <span className="font-bold">{state.sentToday ?? 0}</span>
            <span className="text-xs text-green-600/70"> / {state.dailyLimit}</span>
          </div>
        )}
        <button type="button" onClick={() => setShowStats(v => !v)}
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          <BarChart3 size={15} /> عدّاد الرسايل
        </button>
        {state.status === 'connected' && (
          <button type="button" onClick={logout} disabled={busy}
            className="flex items-center gap-1.5 rounded-xl border border-red-100 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
            <LogOut size={15} /> فصل الربط
          </button>
        )}
      </div>

      {showStats && <StatsPanel notify={notify} />}

      {state.status === 'connected' || state.status === 'reconnecting'
        ? <ChatsView notify={notify} onSent={loadState} disabled={state.status !== 'connected'} />
        : <LinkPanel state={state} busy={busy} onConnect={connect} />}
    </div>
  );
}

function LinkPanel({ state, busy, onConnect }: { state: WaState; busy: boolean; onConnect: () => void }) {
  const waiting = state.status === 'connecting' || (state.status === 'linking' && !state.qr);
  return (
    <div className="grid gap-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm md:grid-cols-2">
      <div className="space-y-3 text-sm text-gray-700">
        <h3 className="text-lg font-bold text-gray-800">اربط الواتساب بتاعك بالسيستم</h3>
        <ol className="list-decimal space-y-2 pr-5">
          <li>اضغط «اعرض كود الربط».</li>
          <li>افتح واتساب على موبايلك.</li>
          <li>ادخل على <b>الإعدادات</b> ← <b>الأجهزة المرتبطة</b> ← <b>ربط جهاز</b>.</li>
          <li>وجّه الكاميرا على الكود اللي هيظهر هنا.</li>
        </ol>
        <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
          الموبايل مش لازم يفضل فاتح بعد الربط. السيستم بيبعت بهدوء وبحد يومي، لأن الإرسال الجماعي السريع ممكن يخلّي واتساب يقفل الرقم.
        </p>
        {state.status === 'logged_out' && <p className="text-xs text-red-600">الربط اتشال من الموبايل — اربط تاني.</p>}
      </div>
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 rounded-2xl bg-gray-50 p-4">
        {state.status === 'linking' && state.qr ? (
          <>
            <img src={state.qr} alt="كود ربط واتساب" className="h-[280px] w-[280px] rounded-xl bg-white p-2" />
            <span className="text-xs text-gray-500">الكود بيتغيّر لوحده كل شوية — امسحه وهو ظاهر</span>
          </>
        ) : waiting ? (
          <><Loader2 className="animate-spin text-green-600" size={28} /><span className="text-sm text-gray-500">بيجهّز الكود…</span></>
        ) : (
          <button type="button" onClick={onConnect} disabled={busy}
            className="flex items-center gap-2 rounded-xl bg-green-600 px-5 py-3 font-bold text-white hover:bg-green-700 disabled:opacity-50">
            <Smartphone size={18} /> اعرض كود الربط
          </button>
        )}
      </div>
    </div>
  );
}

function ChatsView({ notify, onSent, disabled }: { notify: NotifyFn; onSent: () => void; disabled: boolean }) {
  const navigate = useNavigate();
  const [chats, setChats] = useState<Chat[]>([]);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [newPhone, setNewPhone] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const loadChats = useCallback(async () => {
    try {
      const query = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : '';
      const { chats: rows } = await mysqlAdmin.adminGet<{ chats: Chat[] }>(`${API}/chats${query}`);
      setChats(rows);
      setActive(current => (current ? rows.find(row => row.jid === current.jid) || current : current));
    } catch (error) { notify('error', errorText(error)); }
  }, [search, notify]);

  const loadMessages = useCallback(async (jid: string) => {
    try {
      const result = await mysqlAdmin.adminGet<{ messages: Message[] }>(`${API}/messages?jid=${encodeURIComponent(jid)}`);
      setMessages(result.messages);
    } catch (error) { notify('error', errorText(error)); }
  }, [notify]);

  // Typing in the search box asks once the typing pauses; the list refreshes on its own.
  useEffect(() => {
    const first = setTimeout(loadChats, search ? 300 : 0);
    return () => clearTimeout(first);
  }, [loadChats, search]);
  useVisibleInterval(loadChats, 5000);

  const activeJid = active?.jid || null;
  useEffect(() => { if (activeJid) void loadMessages(activeJid); }, [activeJid, loadMessages]);
  useVisibleInterval(() => { if (activeJid) void loadMessages(activeJid); }, 4000, Boolean(activeJid));

  useEffect(() => {
    if (messages.length !== lastCount.current) bottom.current?.scrollIntoView({ block: 'end' });
    lastCount.current = messages.length;
  }, [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const body = active ? { jid: active.jid, text } : { phone: newPhone, text };
      const { message } = await mysqlAdmin.adminPost<{ message: { jid: string } }>(`${API}/send`, body);
      setDraft('');
      if (!active) {
        setNewPhone(null);
        await loadChats();
        setActive({ jid: message.jid, phone: null, name: null, lastMessage: text, lastAt: null, unread: 0, leadId: null, subscriberId: null, crmName: null, clientCode: null });
      } else {
        await loadMessages(active.jid);
      }
      onSent();
    } catch (error) { notify('error', errorText(error)); }
    finally { setSending(false); }
  };

  const openProfile = (chat: Chat) => {
    if (chat.clientCode || chat.subscriberId || chat.leadId) navigate(`/client/${chat.clientCode || chat.subscriberId || chat.leadId}`);
  };

  return (
    <div className="grid h-[calc(100vh-260px)] min-h-[480px] grid-cols-1 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm md:grid-cols-[320px_1fr]">
      <aside className={`flex min-h-0 flex-col border-l border-gray-100 ${active || newPhone !== null ? 'hidden md:flex' : 'flex'}`}>
        <div className="flex gap-2 border-b border-gray-100 p-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="دوّر باسم أو رقم"
              className="w-full rounded-xl border border-gray-200 py-2 pl-3 pr-9 text-sm focus:border-green-400 focus:outline-none" />
          </div>
          <button type="button" title="محادثة جديدة" onClick={() => { setActive(null); setMessages([]); setNewPhone(''); }}
            className="rounded-xl bg-green-600 px-3 text-white hover:bg-green-700"><Plus size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {chats.length === 0 && <p className="p-6 text-center text-sm text-gray-400">مفيش محادثات لسه — الرسايل الجديدة هتظهر هنا.</p>}
          {chats.map(chat => (
            <button key={chat.jid} type="button" onClick={() => { setNewPhone(null); setActive(chat); }}
              className={`flex w-full items-start gap-3 border-b border-gray-50 px-3 py-2.5 text-right hover:bg-gray-50 ${active?.jid === chat.jid ? 'bg-green-50' : ''}`}>
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500"><UserRound size={18} /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-gray-800">{chatTitle(chat)}</span>
                  <span className="shrink-0 text-[10px] text-gray-400">{timeOf(chat.lastAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-gray-500">{chat.lastMessage}</span>
                  {chat.unread > 0 && <span className="rounded-full bg-green-600 px-1.5 text-[10px] font-bold text-white">{chat.unread}</span>}
                </div>
                {(chat.leadId || chat.subscriberId) && (
                  <span className="text-[10px] text-primary-600">{chat.subscriberId ? 'عميل' : 'عميل محتمل'}{chat.clientCode ? ` · ${chat.clientCode}` : ''}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className={`min-h-0 flex-col ${active || newPhone !== null ? 'flex' : 'hidden md:flex'}`}>
        {active || newPhone !== null ? (
          <>
            <header className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
              <button type="button" className="text-sm text-gray-500 md:hidden" onClick={() => { setActive(null); setNewPhone(null); }}>رجوع</button>
              {active ? (
                <div className="min-w-0 flex-1">
                  {active.leadId || active.subscriberId
                    ? <button type="button" onClick={() => openProfile(active)} className="font-bold text-primary-700 hover:underline">{chatTitle(active)}</button>
                    : <span className="font-bold text-gray-800">{chatTitle(active)}</span>}
                  {active.phone && <div dir="ltr" className="text-right text-xs text-gray-400">+{active.phone}</div>}
                </div>
              ) : (
                <input autoFocus value={newPhone || ''} onChange={e => setNewPhone(e.target.value)} placeholder="رقم الموبايل — مثلاً 01012345678 أو 9665…"
                  dir="ltr" className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-green-400 focus:outline-none" />
              )}
            </header>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-[#efeae2] px-4 py-3">
              {messages.map(message => (
                <div key={message.id} className={`flex ${message.fromMe ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[75%] whitespace-pre-wrap break-words rounded-xl px-3 py-1.5 text-sm shadow-sm ${message.fromMe ? 'bg-[#d9fdd3]' : 'bg-white'}`}>
                    {message.body}
                    <div className="mt-0.5 text-left text-[10px] text-gray-400">
                      {timeOf(message.sentAt)}{message.fromMe && !message.sentBySystem ? ' · من الموبايل' : ''}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottom} />
            </div>
            <footer className="flex items-end gap-2 border-t border-gray-100 p-3">
              <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={1} placeholder={disabled ? 'بيرجع يتصل…' : 'اكتب رسالة'}
                disabled={disabled}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                className="max-h-32 min-h-[42px] flex-1 resize-y rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-green-400 focus:outline-none disabled:bg-gray-50" />
              <button type="button" onClick={send} disabled={disabled || sending || !draft.trim() || (!active && !(newPhone || '').trim())}
                className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-green-600 text-white hover:bg-green-700 disabled:opacity-40">
                {sending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} className="rotate-180" />}
              </button>
            </footer>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">اختار محادثة أو ابدأ واحدة جديدة</div>
        )}
      </section>
    </div>
  );
}

function StatsPanel({ notify }: { notify: NotifyFn }) {
  const [data, setData] = useState<{ rows: StatRow[]; everyone: boolean } | null>(null);
  useEffect(() => {
    mysqlAdmin.adminGet<{ rows: StatRow[]; everyone: boolean }>(`${API}/stats`).then(setData, error => notify('error', errorText(error)));
  }, [notify]);
  if (!data) return <div className="flex justify-center py-6"><Loader2 className="animate-spin text-green-600" /></div>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <h3 className="mb-3 font-bold text-gray-800">الرسايل — آخر 7 أيام{data.everyone ? ' (كل الفريق)' : ''}</h3>
      {data.rows.length === 0 ? <p className="text-sm text-gray-400">مفيش رسايل في الفترة دي.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="text-right text-xs text-gray-500">
            <th className="py-1">اليوم</th>{data.everyone && <th>الموظف</th>}
            <th>اتبعتت من السيستم</th><th>اتبعتت من الموبايل</th><th>وصلت</th>
          </tr></thead>
          <tbody>
            {data.rows.map(row => (
              <tr key={`${row.staffId}-${row.day}`} className="border-t border-gray-50">
                <td className="py-1.5">{row.day}</td>{data.everyone && <td>{row.staffName || row.staffId}</td>}
                <td className="font-bold text-green-700">{row.sentBySystem}</td><td>{row.sentFromPhone}</td><td>{row.received}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
