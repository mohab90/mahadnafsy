import React, { useEffect, useRef, useState } from 'react';
import { Bot, GraduationCap, LifeBuoy, Loader2, MessageSquare, RotateCcw, Send, User, X } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';

type ChatMessage = { id: string; role: 'user' | 'assistant' | 'note'; content: string };
type Topic = 'course' | 'support';
type Handoff = { kind: 'sales' | 'support'; id: string | null };

// «لازم يكون في الاول اختيار هو عاوز استفسار عن كورس ولا عنده مشكله عاوز
// مساعده؟ لو عاوز استفسار عن كورس يروح للمبيعات ولو عنده مشكله يروح لخدمه
// العملاء» — api/routes/student-ai.js does the handing over.
const TOPICS: Record<Topic, { label: string; hint: string; icon: typeof GraduationCap; opening: string; placeholder: string }> = {
  course: {
    label: 'استفسار عن كورس', hint: 'المحتوى، المدة، السعر، الحجز', icon: GraduationCap,
    opening: 'تمام! اسألني عن أي برنامج — المحتوى والمدة والسعر وطريقة الحجز. وسؤالك هيوصل لفريق المبيعات يتابع معاك.',
    placeholder: 'مثلًا: عايز أعرف عن دبلومة العلاج المعرفي السلوكي',
  },
  support: {
    label: 'عندي مشكلة ومحتاج مساعدة', hint: 'الموقع، الفيديوهات، الحساب، الشهادات', icon: LifeBuoy,
    opening: 'قولّي المشكلة بالتفصيل: في أنهي صفحة، وإيه اللي ظهر لك. هحاول أحلها معاك، وهيتفتح لك طلب لخدمة العملاء يتابعوه.',
    placeholder: 'مثلًا: الفيديو مش بيشتغل في محاضرة 3',
  },
};
const HANDOFF_NOTE: Record<Handoff['kind'], string> = {
  sales: '✅ سؤالك وصل لفريق المبيعات وهيتواصلوا معاك.',
  support: '✅ اتفتحلك طلب لخدمة العملاء — تقدر تتابعه من «حسابي > الدعم».',
};
const welcome: ChatMessage = { id: 'welcome', role: 'assistant', content: 'أهلًا بيك 👋 أنا المساعد الذكي لمعهد الدراسات النفسية. محتاج إيه؟' };

const AiTutorWidget: React.FC = () => {
  const { authUser, isAdmin } = useSiteData();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [topic, setTopic] = useState<Topic | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([welcome]);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading, open]);
  if (!authUser || isAdmin) return null;

  const add = (message: Omit<ChatMessage, 'id'>) =>
    setMessages(previous => [...previous, { ...message, id: `${Date.now()}-${previous.length}` }]);

  const choose = (next: Topic) => {
    setTopic(next);
    setHandoff(null);
    add({ role: 'user', content: TOPICS[next].label });
    add({ role: 'assistant', content: TOPICS[next].opening });
  };

  const restart = () => { setTopic(null); setHandoff(null); setMessages([welcome]); setInput(''); };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading || !topic) return;
    const history = messages.filter(message => message.role !== 'note' && message.id !== 'welcome')
      .slice(-8).map(({ role, content }) => ({ role, content }));
    add({ role: 'user', content: text });
    setInput('');
    setLoading(true);
    try {
      const token = localStorage.getItem('mahad-token');
      const response = await fetch('/api/student-ai/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message: text, history, topic, handoffId: handoff?.id || undefined }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'تعذر الاتصال بالمساعد حاليًا.');
      add({ role: 'assistant', content: data.reply || 'وصلني سؤالك.' });
      if (data.handoff && !handoff) {
        setHandoff(data.handoff);
        add({ role: 'note', content: HANDOFF_NOTE[data.handoff.kind as Handoff['kind']] });
      }
    } catch (cause) {
      add({ role: 'assistant', content: cause instanceof Error ? cause.message : 'تعذر الاتصال بالمساعد حاليًا.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-24 right-5 z-50 md:bottom-6" dir="rtl">
      {open && (
        <div className="absolute bottom-16 right-0 flex h-[520px] max-h-[78vh] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl">
          <div className="flex items-center justify-between bg-primary-700 px-4 py-3 text-white">
            <div className="flex items-center gap-2"><Bot size={21} /><div><p className="text-sm font-bold">المساعد الذكي</p><p className="text-xs text-primary-100">{topic ? TOPICS[topic].label : 'استفسار أو مساعدة'}</p></div></div>
            <div className="flex items-center gap-1">
              {topic && <button type="button" onClick={restart} title="موضوع تاني" aria-label="موضوع تاني" className="rounded-full p-1.5 hover:bg-white/15"><RotateCcw size={17} /></button>}
              <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق المساعد" className="rounded-full p-1.5 hover:bg-white/15"><X size={19} /></button>
            </div>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4">
            {messages.map(message => (message.role === 'note' ? (
              <p key={message.id} className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-center text-xs font-bold text-emerald-700">{message.content}</p>
            ) : (
              <div key={message.id} className={`flex items-start gap-2 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${message.role === 'user' ? 'bg-primary-100 text-primary-700' : 'bg-blue-100 text-blue-700'}`}>{message.role === 'user' ? <User size={15} /> : <Bot size={15} />}</span>
                <p className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${message.role === 'user' ? 'rounded-tl-sm bg-primary-600 text-white' : 'rounded-tr-sm border border-gray-100 bg-white text-gray-700'}`}>{message.content}</p>
              </div>
            )))}
            {!topic && (
              <div className="grid gap-2 pt-1">
                {(Object.keys(TOPICS) as Topic[]).map(key => {
                  const { icon: Icon, label, hint } = TOPICS[key];
                  return (
                    <button key={key} type="button" onClick={() => choose(key)}
                      className="flex items-center gap-3 rounded-2xl border border-primary-100 bg-white p-3 text-right shadow-sm transition hover:border-primary-300 hover:bg-primary-50">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700"><Icon size={20} /></span>
                      <span><span className="block text-sm font-extrabold text-gray-900">{label}</span><span className="block text-xs text-gray-500">{hint}</span></span>
                    </button>
                  );
                })}
              </div>
            )}
            {loading && <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={16} className="animate-spin text-primary-600" />جاري تجهيز الرد...</div>}
            <div ref={endRef} />
          </div>
          <form onSubmit={submit} className="border-t border-gray-100 bg-white p-3">
            <div className="relative"><input value={input} onChange={event => setInput(event.target.value)} disabled={loading || !topic} maxLength={1200} placeholder={topic ? TOPICS[topic].placeholder : 'اختار الأول: استفسار ولا مشكلة'} className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-11 pr-4 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:opacity-60" /><button type="submit" disabled={!input.trim() || loading || !topic} aria-label="إرسال" className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg bg-primary-600 text-white disabled:opacity-50"><Send size={15} /></button></div>
          </form>
        </div>
      )}
      <button type="button" onClick={() => setOpen(value => !value)} aria-label={open ? 'إغلاق المساعد الذكي' : 'فتح المساعد الذكي'} className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-600 text-white shadow-xl transition hover:bg-primary-700">{open ? <X size={23} /> : <MessageSquare size={23} />}</button>
    </div>
  );
};

export default AiTutorWidget;
