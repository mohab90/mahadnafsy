import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Bot, Check, CheckCheck, FileText, Hand, IdCard, Inbox, Loader2, Lock, RotateCcw, Search, Send, StickyNote, UserRound, Zap } from 'lucide-react';
import { ContactPanel, InboxStatsPanel, LabelEditor, QuickRepliesManager, QuickReplyPicker, fillReply, useQuickReplies, waitingFor, type QuickReply } from './inboxExtras';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { useVisibleInterval } from '../../../../../shared/useVisibleInterval';
import { CAIRO_TIME_ZONE } from '../../../../../shared/cairoDate';

/**
 * «صندوق الرسائل»: the company WhatsApp number, the Facebook page and the
 * Instagram account in one inbox the whole sales team works from
 * (api/routes/team-inbox.js). Each conversation is one rep's; answering an
 * unowned one takes it, and it can be handed to a colleague.
 */

// Only these three are used here, so both notify shapes in the dashboard fit.
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type Platform = 'whatsapp' | 'messenger' | 'instagram';
type Thread = {
  id: string; platform: Platform; contact_key: string; lead_id: string | null; subscriber_id: string | null;
  name: string | null; phone: string | null; assigned_staff_id: string | null; assigned_name: string | null;
  status: 'open' | 'closed'; unread_count: number; last_direction: 'IN' | 'OUT' | null; last_preview: string | null;
  last_message_at: string | null; last_inbound_at: string | null; windowOpen: boolean;
  labels: string[]; bot_paused: boolean; bot_replies: number;
};
type Note = { id: string; body: string; date: string; staff_name: string | null };
type Message = {
  id: string; direction: 'IN' | 'OUT'; date: string; text: string; delivery_status: string | null; staff_name: string | null;
  /** Sent by the bot (communications.outcome = 'BOT'). */
  by_bot?: number | boolean;
};
type Counts = { mine: number; mineUnread: number; unassigned: number; all: number | null };
type Template = { name: string; language: string; body: string; params: number; category: string };
type Agent = { id: string; name: string; role: string };
type View = 'mine' | 'unassigned' | 'all';

const API = '/admin/team-inbox';
const PLATFORM: Record<Platform, { label: string; dot: string; bubble: string }> = {
  whatsapp: { label: 'واتساب', dot: 'bg-green-500', bubble: 'bg-[#d9fdd3]' },
  messenger: { label: 'ماسنجر', dot: 'bg-blue-500', bubble: 'bg-blue-50' },
  instagram: { label: 'انستجرام', dot: 'bg-pink-500', bubble: 'bg-pink-50' },
};
// The composer is open with nothing picked yet.
const NO_TEMPLATE: Template = { name: '', language: '', body: '', params: 0, category: '' };
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'حصل خطأ');
const timeOf = (iso: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString('ar-EG', sameDay
    ? { hour: 'numeric', minute: '2-digit', timeZone: CAIRO_TIME_ZONE }
    : { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: CAIRO_TIME_ZONE });
};
const titleOf = (t: Thread) => t.name || (t.platform === 'whatsapp' ? `+${t.contact_key}` : PLATFORM[t.platform].label);

function Ticks({ status }: { status: string | null }) {
  if (status === 'failed') return <span className="text-red-500">⚠ ما وصلتش</span>;
  if (status === 'read') return <CheckCheck size={14} className="inline text-sky-500" />;
  if (status === 'delivered') return <CheckCheck size={14} className="inline text-gray-400" />;
  if (status === 'sent' || status === 'accepted') return <Check size={14} className="inline text-gray-400" />;
  return null;
}

export default function TeamInboxTab({ notify }: { notify: NotifyFn }) {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('mine');
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [closed, setClosed] = useState(false);
  const [search, setSearch] = useState('');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [seesAll, setSeesAll] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [templates, setTemplates] = useState<{ list: Template[]; error?: string } | null>(null);
  const [template, setTemplate] = useState<Template | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [botEnabled, setBotEnabled] = useState(false);
  const [noteMode, setNoteMode] = useState(false);
  const [labelFilter, setLabelFilter] = useState('');
  const [waitingOnly, setWaitingOnly] = useState(false);
  const [knownLabels, setKnownLabels] = useState<{ label: string; count: number }[]>([]);
  const [showContact, setShowContact] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [managing, setManaging] = useState(false);
  const [picker, setPicker] = useState(false);
  const quick = useQuickReplies(notify);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mysqlAdmin.adminGet<{ label: string; count: number }[]>(`${API}/labels`).then(setKnownLabels, () => {});
  }, []);

  const loadThreads = useCallback(async () => {
    try {
      const query = new URLSearchParams({ view, status: closed ? 'closed' : 'open' });
      if (platform) query.set('platform', platform);
      if (search.trim()) query.set('q', search.trim());
      if (labelFilter) query.set('label', labelFilter);
      if (waitingOnly) query.set('waiting', '1');
      const [list, badge] = await Promise.all([
        mysqlAdmin.adminGet<{ threads: Thread[]; seesAll: boolean }>(`${API}/threads?${query}`),
        mysqlAdmin.adminGet<Counts>(`${API}/counts`),
      ]);
      setThreads(list.threads);
      setSeesAll(list.seesAll);
      setCounts(badge);
    } catch (error) { notify('error', errorText(error)); }
  }, [view, platform, closed, search, labelFilter, waitingOnly, notify]);
  useVisibleInterval(loadThreads, 10000);

  const loadThread = useCallback(async () => {
    if (!activeId) return;
    try {
      const data = await mysqlAdmin.adminGet<{ thread: Thread; messages: Message[]; notes: Note[]; botEnabled?: boolean }>(`${API}/threads/${activeId}`);
      setActive(data.thread);
      setBotEnabled(!!data.botEnabled);
      setNotes(current => (current.length === (data.notes || []).length ? current : data.notes || []));
      setMessages(current => (current.length === data.messages.length && current.at(-1)?.delivery_status === data.messages.at(-1)?.delivery_status
        ? current : data.messages));
    } catch (error) { notify('error', errorText(error)); setActiveId(null); }
  }, [activeId, notify]);
  useVisibleInterval(loadThread, activeId ? 5000 : 60000);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [messages.length, activeId]);

  const open = (thread: Thread) => {
    setActiveId(thread.id); setActive(thread); setMessages([]); setNotes([]); setDraft(''); setTemplate(null); setNoteMode(false); setPicker(false);
  };

  const addNote = async () => {
    if (!active || !draft.trim()) return;
    setSending(true);
    try {
      await mysqlAdmin.adminPost(`${API}/threads/${active.id}/notes`, { body: draft.trim() });
      setDraft(''); setNoteMode(false);
      await loadThread();
    } catch (error) { notify('error', errorText(error)); } finally { setSending(false); }
  };

  // «/» at the start of the box opens the saved answers, filtered by what follows.
  const typing = (value: string) => {
    setDraft(value);
    const opening = value.startsWith('/') && !value.includes('\n');
    setPicker(opening);
    if (opening && quick.list === null) void quick.load();
  };
  const pickReply = (reply: QuickReply) => { setDraft(fillReply(reply.body, active?.name)); setPicker(false); };

  // Messages and the team's notes on one line of time.
  const timeline = useMemo(() => [
    ...messages.map(m => ({ kind: 'message' as const, at: m.date, message: m })),
    ...notes.map(n => ({ kind: 'note' as const, at: n.date, note: n })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()), [messages, notes]);

  const act = async (path: string, body: Record<string, unknown>, done: string) => {
    if (!active) return;
    try {
      await mysqlAdmin.adminPost(`${API}/threads/${active.id}/${path}`, body);
      notify('success', done);
      await Promise.all([loadThread(), loadThreads()]);
    } catch (error) { notify('error', errorText(error)); }
  };

  const transfer = async (staffId: string) => {
    if (!staffId) return;
    const name = agents?.find(a => a.id === staffId)?.name || '';
    await act('assign', { staffId: staffId === 'none' ? null : staffId }, staffId === 'none' ? 'رجعت لغير المستلمة' : `اتحولت لـ${name}`);
  };

  const loadAgents = async () => {
    if (agents) return;
    try { setAgents(await mysqlAdmin.adminGet<Agent[]>(`${API}/agents`)); } catch (error) { notify('error', errorText(error)); }
  };

  const loadTemplates = async () => {
    if (templates) return;
    try {
      const data = await mysqlAdmin.adminGet<{ templates: Template[]; error?: string }>(`${API}/templates`);
      setTemplates({ list: data.templates, error: data.error });
    } catch (error) { notify('error', errorText(error)); }
  };

  const pickTemplate = (name: string) => {
    const chosen = templates?.list.find(t => `${t.name}|${t.language}` === name) || null;
    setTemplate(chosen);
    // {{1}} is almost always the customer's name.
    setParams(chosen ? Array.from({ length: chosen.params }, (_, i) => (i === 0 ? active?.name || '' : '')) : []);
  };

  const send = async () => {
    if (!active) return;
    const body = template
      ? { template: { name: template.name, language: template.language, params } }
      : { text: draft.trim() };
    if (!template && !draft.trim()) return;
    setSending(true);
    try {
      await mysqlAdmin.adminPost(`${API}/threads/${active.id}/reply`, body);
      setDraft(''); setTemplate(null);
      await Promise.all([loadThread(), loadThreads()]);
    } catch (error) { notify('error', errorText(error)); }
    finally { setSending(false); }
  };

  const preview = useMemo(() => (template
    ? template.body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] || `{{${n}}}`)
    : ''), [template, params]);

  const tab = (key: View, label: string, badge?: number | null) => (
    <button key={key} type="button" onClick={() => setView(key)}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${view === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
      {label}{badge ? <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] text-white">{badge}</span> : null}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
        <Inbox size={20} className="text-indigo-600" />
        <h2 className="ml-2 font-bold text-gray-800">صندوق الرسائل</h2>
        <div className="flex rounded-xl bg-gray-100 p-1">
          {tab('mine', 'محادثاتي', counts?.mineUnread)}
          {tab('unassigned', 'مش مستلمة', counts?.unassigned)}
          {tab('all', seesAll ? 'الكل' : 'محادثاتي + المش مستلمة')}
        </div>
        <div className="flex gap-1">
          {(['', 'whatsapp', 'messenger', 'instagram'] as const).map(key => (
            <button key={key || 'any'} type="button" onClick={() => setPlatform(key)}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold ${platform === key ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500'}`}>
              {key && <span className={`h-2 w-2 rounded-full ${PLATFORM[key].dot}`} />}{key ? PLATFORM[key].label : 'كل القنوات'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          <input type="checkbox" checked={closed} onChange={e => setClosed(e.target.checked)} /> المقفولة
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          <input type="checkbox" checked={waitingOnly} onChange={e => setWaitingOnly(e.target.checked)} /> مستنيين رد
        </label>
        {knownLabels.length > 0 && (
          <select aria-label="التصنيف" value={labelFilter} onChange={e => setLabelFilter(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600">
            <option value="">كل التصنيفات</option>
            {knownLabels.map(l => <option key={l.label} value={l.label}>{l.label} ({l.count})</option>)}
          </select>
        )}
        <div className="mr-auto flex gap-1.5">
          <button type="button" onClick={() => { setManaging(true); void quick.load(); }} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"><Zap size={13} className="text-amber-500" /> الردود السريعة</button>
          <button type="button" onClick={() => setShowStats(v => !v)} aria-pressed={showStats} className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold ${showStats ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}><BarChart3 size={13} /> سرعة الرد</button>
        </div>
      </div>
      {showStats && <InboxStatsPanel notify={notify} />}
      {managing && <QuickRepliesManager list={quick.list} reload={quick.load} onClose={() => setManaging(false)} notify={notify} />}

      <div className={`grid h-[calc(100vh-300px)] min-h-[480px] grid-cols-1 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm md:grid-cols-[340px_1fr] ${showContact && active ? 'lg:grid-cols-[320px_1fr_288px]' : ''}`}>
        <aside className={`flex min-h-0 flex-col border-l border-gray-100 ${active ? 'hidden md:flex' : 'flex'}`}>
          <div className="border-b border-gray-100 p-3">
            <div className="relative">
              <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="دوّر باسم أو رقم"
                className="w-full rounded-xl border border-gray-200 py-2 pl-3 pr-9 text-sm focus:border-indigo-400 focus:outline-none" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {threads.length === 0 && (
              <p className="p-6 text-center text-sm text-gray-400">
                {view === 'unassigned' ? 'مفيش محادثات مستنية حد يستلمها.' : 'مفيش محادثات هنا.'}
              </p>
            )}
            {threads.map(thread => (
              <button key={thread.id} type="button" onClick={() => open(thread)}
                className={`flex w-full items-start gap-3 border-b border-gray-50 px-3 py-2.5 text-right hover:bg-gray-50 ${activeId === thread.id ? 'bg-indigo-50' : ''}`}>
                <div className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                  <UserRound size={18} />
                  <span className={`absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-full border-2 border-white ${PLATFORM[thread.platform].dot}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-gray-800">{titleOf(thread)}</span>
                    <span className="shrink-0 text-[10px] text-gray-400">{timeOf(thread.last_message_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-gray-500">{thread.last_direction === 'OUT' ? 'إنت: ' : ''}{thread.last_preview}</span>
                    {thread.unread_count > 0 && <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white">{thread.unread_count}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className={`text-[10px] ${thread.assigned_staff_id ? 'text-gray-400' : 'font-semibold text-amber-600'}`}>
                      {thread.assigned_staff_id ? `مع ${thread.assigned_name || 'موظف'}` : 'مش مستلمة'}
                    </span>
                    {thread.last_direction === 'IN' && thread.status === 'open' && (() => {
                      const wait = waitingFor(thread.last_inbound_at);
                      return wait ? <span className={`rounded px-1 text-[10px] font-bold ${wait.tone}`} title="مستني رد من">⏱ {wait.text}</span> : null;
                    })()}
                    {(thread.labels || []).slice(0, 2).map(label => <span key={label} className="rounded bg-violet-50 px-1 text-[10px] text-violet-700">{label}</span>)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className={`min-h-0 flex-col ${active ? 'flex' : 'hidden md:flex'}`}>
          {active ? (
            <>
              <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
                <button type="button" className="text-sm text-gray-500 md:hidden" onClick={() => { setActiveId(null); setActive(null); }}>رجوع</button>
                <div className="min-w-0 flex-1">
                  {active.lead_id || active.subscriber_id
                    ? <button type="button" onClick={() => navigate(`/client/${active.subscriber_id || active.lead_id}`)} className="font-bold text-primary-700 hover:underline">{titleOf(active)}</button>
                    : <span className="font-bold text-gray-800">{titleOf(active)}</span>}
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className={`h-2 w-2 rounded-full ${PLATFORM[active.platform].dot}`} />{PLATFORM[active.platform].label}
                    {active.platform === 'whatsapp' && <span dir="ltr">+{active.contact_key}</span>}
                    <span>· {active.assigned_staff_id ? `مع ${active.assigned_name || 'موظف'}` : 'مش مستلمة'}</span>
                  </div>
                </div>
                {botEnabled && <button type="button" onClick={() => act('bot', { paused: !active.bot_paused }, active.bot_paused ? 'البوت هيرد تاني في المحادثة دي' : 'البوت وقف في المحادثة دي')}
                  title={active.bot_paused ? 'رجّع المحادثة للبوت' : 'وقّف البوت في المحادثة دي'}
                  className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${active.bot_paused ? 'border-gray-200 text-gray-500' : 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700'}`}>
                  <Bot size={13} /> {active.bot_paused ? 'البوت واقف' : 'البوت شغال'}
                </button>}
                <button type="button" onClick={() => setShowContact(v => !v)} aria-pressed={showContact} title="بيانات العميل"
                  className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${showContact ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}><IdCard size={13} /> العميل</button>
                {!active.assigned_staff_id && (
                  <button type="button" onClick={() => act('claim', {}, 'استلمت المحادثة')}
                    className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600"><Hand size={14} /> استلام</button>
                )}
                <select aria-label="تحويل المحادثة" value="" onFocus={loadAgents} onChange={e => transfer(e.target.value)}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-600">
                  <option value="">تحويل لزميل…</option>
                  {seesAll && <option value="none">رجّعها لغير المستلمة</option>}
                  {(agents || []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
                {active.status === 'open'
                  ? <button type="button" onClick={() => act('status', { status: 'closed' }, 'اتقفلت')} title="قفل المحادثة"
                      className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"><Lock size={13} /> قفل</button>
                  : <button type="button" onClick={() => act('status', { status: 'open' }, 'اتفتحت')}
                      className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"><RotateCcw size={13} /> فتح</button>}
                <div className="w-full">
                  <LabelEditor threadId={active.id} labels={active.labels || []} known={knownLabels.map(l => l.label)} notify={notify}
                    onSaved={labels => { setActive({ ...active, labels }); void loadThreads(); }} />
                </div>
              </header>

              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-[#efeae2] px-4 py-3">
                {messages.length === 0 && <div className="flex justify-center py-6"><Loader2 className="animate-spin text-indigo-500" /></div>}
                {timeline.map(entry => entry.kind === 'note' ? (
                  <div key={`n-${entry.note.id}`} className="flex justify-center">
                    <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 shadow-sm">
                      <span className="font-bold"><StickyNote size={11} className="inline" /> ملاحظة داخلية — {entry.note.staff_name || 'الإدارة'}:</span> {entry.note.body}
                      <span className="mr-2 text-[10px] text-amber-600">{timeOf(entry.note.date)}</span>
                    </div>
                  </div>
                ) : ((message) => (
                  <div key={message.id} className={`flex ${message.direction === 'OUT' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[75%] whitespace-pre-wrap break-words rounded-xl px-3 py-1.5 text-sm shadow-sm ${message.direction === 'OUT' ? PLATFORM[active.platform].bubble : 'bg-white'}`}>
                      {message.text}
                      <div className="mt-0.5 flex items-center justify-end gap-1 text-left text-[10px] text-gray-400">
                        {message.direction === 'OUT' && (message.by_bot ? <span>🤖 البوت ·</span> : message.staff_name ? <span>{message.staff_name} ·</span> : null)}
                        <span>{timeOf(message.date)}</span>
                        {message.direction === 'OUT' && <Ticks status={message.delivery_status} />}
                      </div>
                    </div>
                  </div>
                ))(entry.message))}
                <div ref={bottom} />
              </div>

              {noteMode ? (
                <footer className="flex items-end gap-2 border-t border-amber-200 bg-amber-50/60 p-3">
                  <button type="button" onClick={() => setNoteMode(false)} className="h-[42px] rounded-xl border border-gray-200 bg-white px-2.5 text-xs text-gray-500">رجوع</button>
                  <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} rows={1} placeholder="ملاحظة للفريق — العميل مش هيشوفها"
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void addNote(); } }}
                    className="max-h-32 min-h-[42px] flex-1 resize-y rounded-xl border border-amber-200 px-3 py-2 text-sm focus:outline-none" />
                  <button type="button" onClick={addNote} disabled={sending || !draft.trim()} className="h-[42px] rounded-xl bg-amber-500 px-3 text-sm font-bold text-white disabled:opacity-40">حفظ الملاحظة</button>
                </footer>
              ) : active.windowOpen && !template ? (
                <footer className="relative flex items-end gap-2 border-t border-gray-100 p-3">
                  {picker && <QuickReplyPicker list={quick.list} query={draft.slice(1)} onPick={pickReply} onManage={() => { setPicker(false); setManaging(true); }} />}
                  <button type="button" title="ملاحظة داخلية" onClick={() => { setNoteMode(true); setPicker(false); }}
                    className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-gray-200 text-amber-600 hover:bg-amber-50"><StickyNote size={18} /></button>
                  <button type="button" title="الردود السريعة" onClick={() => { setPicker(v => !v); if (quick.list === null) void quick.load(); }}
                    className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-gray-200 text-amber-500 hover:bg-amber-50"><Zap size={18} /></button>
                  {active.platform === 'whatsapp' && (
                    <button type="button" title="ابعت قالب" onClick={() => { setParams([]); setTemplate(NO_TEMPLATE); }}
                      className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50"><FileText size={18} /></button>
                  )}
                  <textarea value={draft} onChange={e => typing(e.target.value)} rows={1} placeholder="اكتب رسالة — أو / للردود السريعة"
                    onKeyDown={e => { if (e.key === 'Escape') setPicker(false); if (e.key === 'Enter' && !e.shiftKey && !picker) { e.preventDefault(); void send(); } }}
                    className="max-h-32 min-h-[42px] flex-1 resize-y rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
                  <button type="button" onClick={send} disabled={sending || !draft.trim()}
                    className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                    {sending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} className="rotate-180" />}
                  </button>
                </footer>
              ) : active.platform === 'whatsapp' ? (
                <TemplateComposer
                  windowOpen={active.windowOpen}
                  templates={templates} load={loadTemplates}
                  chosen={template?.name ? template : null} pick={pickTemplate} params={params} setParams={setParams}
                  preview={preview} sending={sending} send={send} cancel={() => setTemplate(null)}
                />
              ) : (
                <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 p-3 text-sm text-amber-700">
                  <span>عدّت 24 ساعة على آخر رسالة من العميل — {PLATFORM[active.platform].label} مش هيقبل رد لحد ما يبعت تاني.</span>
                  <button type="button" onClick={() => setNoteMode(true)} className="flex items-center gap-1 rounded-lg border border-amber-200 px-2.5 py-1 text-xs font-bold"><StickyNote size={13} /> ملاحظة داخلية</button>
                </footer>
              )}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-gray-400">
              <Inbox size={36} className="text-gray-300" />
              اختار محادثة
            </div>
          )}
        </section>
        {showContact && active && (
          <div className="hidden min-h-0 lg:flex">
            <ContactPanel threadId={active.id} onClose={() => setShowContact(false)} onOpenProfile={id => navigate(`/client/${id}`)} />
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateComposer({ windowOpen, templates, load, chosen, pick, params, setParams, preview, sending, send, cancel }: {
  windowOpen: boolean;
  templates: { list: Template[]; error?: string } | null; load: () => Promise<void>;
  chosen: Template | null; pick: (key: string) => void;
  params: string[]; setParams: (next: string[]) => void; preview: string;
  sending: boolean; send: () => void; cancel: () => void;
}) {
  useEffect(() => { void load(); }, [load]);
  return (
    <footer className="space-y-2 border-t border-gray-100 p-3">
      {!windowOpen && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          عدّت 24 ساعة على آخر رسالة من العميل، فواتساب بيقبل قالب متوافق عليه بس. لما العميل يرد، ترجع تكتب عادي.
        </p>
      )}
      {templates?.error && <p className="text-xs text-red-600">{templates.error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <select value={chosen ? `${chosen.name}|${chosen.language}` : ''} onChange={e => pick(e.target.value)}
          className="min-w-[200px] flex-1 rounded-lg border border-gray-200 px-2 py-2 text-sm">
          <option value="">{templates ? (templates.list.length ? 'اختار قالب' : 'مفيش قوالب متوافق عليها') : 'بيحمّل القوالب…'}</option>
          {(templates?.list || []).map(t => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language})</option>)}
        </select>
        {windowOpen && <button type="button" onClick={cancel} className="text-xs text-gray-500 hover:underline">رجوع للكتابة</button>}
      </div>
      {chosen && (
        <>
          {params.map((value, index) => (
            <input key={index} value={value} onChange={e => setParams(params.map((p, i) => (i === index ? e.target.value : p)))}
              placeholder={`قيمة {{${index + 1}}}`} className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm" />
          ))}
          <div className="whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{preview}</div>
          <button type="button" onClick={send} disabled={sending}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-40">
            {sending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} className="rotate-180" />} ابعت القالب
          </button>
        </>
      )}
    </footer>
  );
}
