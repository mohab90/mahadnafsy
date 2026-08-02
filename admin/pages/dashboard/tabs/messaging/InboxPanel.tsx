import { useEffect, useRef, useState } from 'react';
import {
  Inbox, Loader2, Send, RefreshCw, MessageCircle, Facebook, Clock, CornerUpLeft,
} from 'lucide-react';
import {
  mysqlAdmin, type InboxConversation, type InboxMessage,
} from '../../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const conversationKey = (c: InboxConversation) => c.lead_id || c.subscriber_id || '';

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return '';
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} س`;
  return `منذ ${Math.floor(hours / 24)} يوم`;
}

/**
 * Reading and answering what customers actually sent.
 *
 * Opens on "waiting for a reply" because that is the question a rep opens this
 * screen to answer — not "what has ever been said". A conversation whose last
 * message came from the customer is the unit of work here.
 */
export function InboxPanel({ notify }: { notify: NotifyFn }) {
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [unansweredOnly, setUnansweredOnly] = useState(true);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<InboxConversation | null>(null);
  const [thread, setThread] = useState<InboxMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [via, setVia] = useState<'whatsapp' | 'messenger'>('whatsapp');
  const threadEndRef = useRef<HTMLDivElement>(null);

  const loadConversations = async (keepSelection = true) => {
    setLoading(true);
    try {
      const list = await mysqlAdmin.listInboxConversations(unansweredOnly);
      setConversations(list);
      if (!keepSelection && list.length) setSelected(list[0]);
    } catch { notify('error', 'تعذر تحميل المحادثات'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void loadConversations(false); }, [unansweredOnly]);

  const loadThread = async (conversation: InboxConversation) => {
    setThreadLoading(true);
    setSelected(conversation);
    // WhatsApp unless Messenger is the only channel we have for them, so the
    // default reply path is the one that actually reaches most people.
    setVia(conversation.phone ? 'whatsapp' : 'messenger');
    try {
      setThread(await mysqlAdmin.getInboxThread({
        leadId: conversation.lead_id || undefined,
        subscriberId: conversation.subscriber_id || undefined,
      }));
    } catch { notify('error', 'تعذر تحميل المحادثة'); }
    finally { setThreadLoading(false); }
  };

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [thread]);

  const send = async () => {
    if (!selected || !draft.trim()) return;
    setSending(true);
    try {
      await mysqlAdmin.replyInThread({
        leadId: selected.lead_id || undefined,
        subscriberId: selected.subscriber_id || undefined,
        message: draft.trim(),
        via,
      });
      setDraft('');
      await loadThread(selected);
      await loadConversations();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'لم يتم الإرسال');
    } finally { setSending(false); }
  };

  const messengerBlocked = via === 'messenger' && selected && !selected.messengerWindowOpen;
  const canSend = Boolean(draft.trim()) && !sending && !messengerBlocked
    && Boolean(via === 'whatsapp' ? selected?.phone : selected?.psid);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="bg-gradient-to-l from-sky-600 to-teal-600 rounded-2xl p-5 text-white flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><Inbox size={22} />صندوق الرسائل</h2>
          <p className="text-sky-50 text-sm mt-1">ردود العملاء على الواتساب والماسنجر في مكان واحد</p>
        </div>
        <button
          onClick={() => loadConversations()}
          className="flex items-center gap-2 px-4 py-2 bg-white/15 hover:bg-white/25 rounded-xl text-sm font-bold transition"
        >
          <RefreshCw size={15} />تحديث
        </button>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setUnansweredOnly(true)}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition border ${
            unansweredOnly ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
        >
          مستنيين رد
        </button>
        <button
          onClick={() => setUnansweredOnly(false)}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition border ${
            !unansweredOnly ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
        >
          كل المحادثات
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Conversation list */}
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden lg:max-h-[34rem] lg:overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-400">
              <Loader2 className="animate-spin mx-auto mb-2" size={20} />جاري التحميل...
            </div>
          ) : conversations.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">
              {unansweredOnly ? 'مفيش حد مستني رد 🎉' : 'مفيش محادثات لسه'}
            </p>
          ) : conversations.map(conversation => {
            const key = conversationKey(conversation);
            const active = selected && conversationKey(selected) === key;
            return (
              <button
                key={key}
                onClick={() => loadThread(conversation)}
                className={`w-full text-right px-4 py-3 border-b border-gray-100 transition ${
                  active ? 'bg-sky-50' : 'hover:bg-gray-50'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm text-gray-800 truncate">
                    {conversation.name || conversation.phone || 'زائر'}
                  </span>
                  <span className="text-[11px] text-gray-400 shrink-0">{timeAgo(conversation.last_at)}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  {conversation.last_direction === 'IN' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" title="مستني رد" />
                  )}
                  <p className="text-xs text-gray-500 truncate">{conversation.last_message || '—'}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Thread */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl flex flex-col lg:max-h-[34rem]">
          {!selected ? (
            <p className="p-10 text-center text-sm text-gray-400">اختر محادثة من القائمة</p>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p className="font-bold text-sm text-gray-800 truncate">
                    {selected.name || selected.phone || 'زائر'}
                  </p>
                  {selected.phone && (
                    <p className="text-xs text-gray-400 font-mono">+{selected.phone}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setVia('whatsapp')}
                    disabled={!selected.phone}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition disabled:opacity-30 ${
                      via === 'whatsapp' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-50 text-gray-500'}`}
                  >
                    <MessageCircle size={12} />واتساب
                  </button>
                  <button
                    onClick={() => setVia('messenger')}
                    disabled={!selected.psid}
                    title={selected.psid ? '' : 'مفيش محادثة ماسنجر مربوطة'}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition disabled:opacity-30 ${
                      via === 'messenger' ? 'bg-blue-100 text-blue-700' : 'bg-gray-50 text-gray-500'}`}
                  >
                    <Facebook size={12} />ماسنجر
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[14rem]">
                {threadLoading ? (
                  <div className="text-center text-gray-400 py-8">
                    <Loader2 className="animate-spin mx-auto" size={20} />
                  </div>
                ) : thread.map(message => (
                  <div
                    key={message.id}
                    className={`flex ${message.direction === 'IN' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${
                      message.direction === 'IN'
                        ? 'bg-gray-100 text-gray-800'
                        : 'bg-emerald-600 text-white'}`}>
                      <p className="text-sm whitespace-pre-wrap break-words">{message.notes}</p>
                      <p className={`text-[10px] mt-1 flex items-center gap-1 ${
                        message.direction === 'IN' ? 'text-gray-400' : 'text-emerald-100'}`}>
                        {message.type === 'MESSENGER' ? <Facebook size={9} /> : <MessageCircle size={9} />}
                        {timeAgo(message.date)}
                        {message.staff_name && ` · ${message.staff_name}`}
                        {message.channel_label && ` · ${message.channel_label}`}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={threadEndRef} />
              </div>

              {/* Composer */}
              <div className="border-t border-gray-100 p-3 space-y-2">
                {messengerBlocked && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
                    <Clock size={13} className="shrink-0" />
                    عدّت ٢٤ ساعة على آخر رسالة من العميل — ماسنجر مش هيقبل رد نصي. ابعت واتساب.
                  </p>
                )}
                <div className="flex gap-2 items-end">
                  <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                      // Enter sends, Shift+Enter is a newline — what everyone
                      // expects from a chat box.
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) void send(); }
                    }}
                    rows={2}
                    placeholder="اكتب ردك..."
                    className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                  <button
                    onClick={send}
                    disabled={!canSend}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition disabled:opacity-40"
                  >
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <CornerUpLeft size={14} />}
                    رد
                  </button>
                </div>
                <p className="text-[11px] text-gray-400">
                  هيتبعت من واتسابك لو رابطه، وإلا من رقم الشركة.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
