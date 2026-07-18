import React, { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, MessageSquare, Send, User, X } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';

type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string };
const welcome: ChatMessage = { id: 'welcome', role: 'assistant', content: 'أهلًا بك. أقدر أساعدك في الكورسات والمحاضرات والشهادات والمدفوعات والدعم الفني.' };

const AiTutorWidget: React.FC = () => {
  const { authUser, isAdmin } = useSiteData();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([welcome]);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading, open]);
  if (!authUser || isAdmin) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setMessages(previous => [...previous, { id: `${Date.now()}-user`, role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    try {
      const token = localStorage.getItem('mahad-token');
      const response = await fetch('/api/student-ai/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message: text, history: messages.slice(-8) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'تعذر الاتصال بالمساعد حاليًا.');
      setMessages(previous => [...previous, { id: `${Date.now()}-assistant`, role: 'assistant', content: data.reply || 'تم استلام سؤالك.' }]);
    } catch (cause) {
      setMessages(previous => [...previous, { id: `${Date.now()}-error`, role: 'assistant', content: cause instanceof Error ? cause.message : 'تعذر الاتصال بالمساعد حاليًا.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-24 right-5 z-50 md:bottom-6" dir="rtl">
      {open && (
        <div className="absolute bottom-16 right-0 flex h-[500px] max-h-[78vh] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl">
          <div className="flex items-center justify-between bg-primary-700 px-4 py-3 text-white">
            <div className="flex items-center gap-2"><Bot size={21} /><div><p className="text-sm font-bold">المساعد الذكي</p><p className="text-xs text-primary-100">دعم دراسي سريع</p></div></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق المساعد" className="rounded-full p-1.5 hover:bg-white/15"><X size={19} /></button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4">
            {messages.map(message => (
              <div key={message.id} className={`flex items-start gap-2 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${message.role === 'user' ? 'bg-primary-100 text-primary-700' : 'bg-blue-100 text-blue-700'}`}>{message.role === 'user' ? <User size={15} /> : <Bot size={15} />}</span>
                <p className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${message.role === 'user' ? 'rounded-tl-sm bg-primary-600 text-white' : 'rounded-tr-sm border border-gray-100 bg-white text-gray-700'}`}>{message.content}</p>
              </div>
            ))}
            {loading && <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={16} className="animate-spin text-primary-600" />جاري تجهيز الرد...</div>}
            <div ref={endRef} />
          </div>
          <form onSubmit={submit} className="border-t border-gray-100 bg-white p-3">
            <div className="relative"><input value={input} onChange={event => setInput(event.target.value)} disabled={loading} maxLength={1200} placeholder="اكتب سؤالك هنا..." className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-11 pr-4 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" /><button type="submit" disabled={!input.trim() || loading} aria-label="إرسال" className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg bg-primary-600 text-white disabled:opacity-50"><Send size={15} /></button></div>
          </form>
        </div>
      )}
      <button type="button" onClick={() => setOpen(value => !value)} aria-label={open ? 'إغلاق المساعد الذكي' : 'فتح المساعد الذكي'} className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-600 text-white shadow-xl transition hover:bg-primary-700">{open ? <X size={23} /> : <MessageSquare size={23} />}</button>
    </div>
  );
};

export default AiTutorWidget;
