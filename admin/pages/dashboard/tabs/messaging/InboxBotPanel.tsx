// «بوت الرد على العملاء» — when the inbox bot answers, what it knows, when it
// hands over to the team, and a console to try it before it goes live.
// Server: api/routes/inbox-bot.js, api/lib/inboxBot.js.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, BookOpen, Loader2, RotateCcw, Save, Send, UserRound } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type Platform = 'whatsapp' | 'messenger' | 'instagram';
type Settings = {
  enabled: boolean;
  platforms: Record<Platform, boolean>;
  mode: 'always' | 'off_hours' | 'unassigned';
  workingHours: { days: number[]; from: string; to: string };
  name: string;
  instructions: string;
  extraKnowledge: string;
  knowledge: { courses: boolean; prices: boolean; faq: boolean; contacts: boolean };
  handoffKeywords: string[];
  handoffMessage: string;
  maxReplies: number;
};
type Ai = { configured: boolean; provider?: string; model?: string };
type Turn = { role: 'user' | 'assistant'; content: string; handoff?: boolean };

const API = '/admin/inbox-bot';
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'حصل خطأ');
const DAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
const MODES: { key: Settings['mode']; title: string; hint: string }[] = [
  { key: 'always', title: 'يرد على طول', hint: 'أي محادثة لسه ما حدش من الفريق رد فيها' },
  { key: 'off_hours', title: 'بره مواعيد العمل بس', hint: 'الفريق يرد في المواعيد، والبوت بالليل والإجازات' },
  { key: 'unassigned', title: 'المحادثات اللي مش مستلمة', hint: 'لحد ما موظف يستلم المحادثة' },
];
const PLATFORMS: [Platform, string][] = [['whatsapp', 'واتساب'], ['messenger', 'ماسنجر'], ['instagram', 'انستجرام']];

export default function InboxBotPanel({ notify }: { notify: NotifyFn }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ai, setAi] = useState<Ai | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [keywords, setKeywords] = useState('');
  const [chat, setChat] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [knowledge, setKnowledge] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await mysqlAdmin.adminGet<{ settings: Settings; ai: Ai }>(API);
      setSettings(data.settings); setAi(data.ai); setKeywords(data.settings.handoffKeywords.join('، ')); setDirty(false);
    } catch (error) { notify('error', errorText(error)); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const change = (patch: Partial<Settings>) => { setSettings(current => (current ? { ...current, ...patch } : current)); setDirty(true); };
  const draft = (): Settings | null => (settings ? { ...settings, handoffKeywords: keywords.split(/[,،\n]/).map(k => k.trim()).filter(Boolean) } : null);

  const save = async () => {
    const body = draft(); if (!body) return;
    setSaving(true);
    try {
      const result = await mysqlAdmin.adminPut<{ settings: Settings }>(API, { settings: body });
      setSettings(result.settings); setDirty(false);
      notify('success', result.settings.enabled ? 'اتحفظ — البوت شغال' : 'اتحفظ — البوت مقفول');
    } catch (error) { notify('error', errorText(error)); } finally { setSaving(false); }
  };

  const ask = async () => {
    const message = input.trim(); if (!message) return;
    const history: Turn[] = [...chat, { role: 'user', content: message }];
    setChat(history); setInput(''); setThinking(true);
    try {
      const result = await mysqlAdmin.adminPost<{ reply: string; handoff: boolean }>(`${API}/test`, {
        settings: draft(), messages: history.map(({ role, content }) => ({ role, content })),
      });
      setChat([...history, { role: 'assistant', content: result.reply || '(ما ردّش)', handoff: result.handoff }]);
    } catch (error) {
      notify('error', errorText(error));
      setChat(history.slice(0, -1)); setInput(message);
    } finally { setThinking(false); }
  };

  const showKnowledge = async () => {
    try {
      const data = await mysqlAdmin.adminPost<{ knowledge: string; characters: number }>(`${API}/knowledge`, { settings: draft() });
      setKnowledge(data.knowledge || '(مفيش معلومات — فعّل الكورسات أو الأسئلة الشائعة أو اكتب معلومات إضافية)');
    } catch (error) { notify('error', errorText(error)); }
  };

  if (!settings) return <div className="flex justify-center p-10"><Loader2 className="animate-spin text-fuchsia-500" /></div>;

  const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />{label}</label>
  );

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_400px]" dir="rtl">
      <div className="space-y-4">
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className={`grid h-11 w-11 place-items-center rounded-2xl ${settings.enabled ? 'bg-fuchsia-600 text-white' : 'bg-gray-100 text-gray-400'}`}><Bot size={22} /></div>
              <div>
                <h2 className="text-lg font-extrabold text-gray-900">بوت الرد على العملاء</h2>
                <p className="text-xs text-gray-500">بيرد من صندوق الرسائل على واتساب الشركة والماسنجر والانستجرام، ويحوّل للفريق لما يحتاج.</p>
              </div>
            </div>
            <label className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold">
              <input type="checkbox" checked={settings.enabled} onChange={e => change({ enabled: e.target.checked })} />
              {settings.enabled ? 'شغال' : 'مقفول'}
            </label>
          </div>
          {ai && !ai.configured && (
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
              البوت محتاج مفتاح ذكاء اصطناعي (Claude أو OpenAI أو Gemini). حطه في <Link to="/dashboard/integrations/ai" className="font-bold underline">التكاملات ← إعدادات AI</Link>.
            </p>
          )}
          {ai?.configured && <p className="mt-3 text-[11px] text-gray-500">بيشتغل على <b dir="ltr">{ai.provider} · {ai.model}</b> — من إعدادات AI.</p>}
        </section>

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-extrabold text-gray-900">إمتى يرد</h3>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {MODES.map(mode => (
              <button key={mode.key} type="button" onClick={() => change({ mode: mode.key })} aria-pressed={settings.mode === mode.key}
                className={`rounded-xl border p-3 text-right transition ${settings.mode === mode.key ? 'border-fuchsia-400 bg-fuchsia-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <span className="block text-sm font-bold text-gray-900">{mode.title}</span>
                <span className="mt-0.5 block text-[11px] text-gray-500">{mode.hint}</span>
              </button>
            ))}
          </div>
          {settings.mode === 'off_hours' && (
            <div className="space-y-2 rounded-xl bg-gray-50 p-3">
              <p className="text-xs font-bold text-gray-600">مواعيد عمل الفريق (بتوقيت القاهرة)</p>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((day, i) => {
                  const on = settings.workingHours.days.includes(i);
                  return (
                    <button key={day} type="button" onClick={() => change({ workingHours: { ...settings.workingHours, days: on ? settings.workingHours.days.filter(d => d !== i) : [...settings.workingHours.days, i] } })}
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${on ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>{day}</button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 text-xs">
                من <input type="time" value={settings.workingHours.from} onChange={e => change({ workingHours: { ...settings.workingHours, from: e.target.value } })} className="rounded-lg border border-gray-200 px-2 py-1" />
                لـ <input type="time" value={settings.workingHours.to} onChange={e => change({ workingHours: { ...settings.workingHours, to: e.target.value } })} className="rounded-lg border border-gray-200 px-2 py-1" />
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-4">
            {PLATFORMS.map(([key, label]) => toggle(label, settings.platforms[key], v => change({ platforms: { ...settings.platforms, [key]: v } })))}
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-gray-900">بيعرف إيه</h3>
            <button type="button" onClick={showKnowledge} className="flex items-center gap-1 text-xs font-bold text-fuchsia-700"><BookOpen size={13} /> شوف اللي البوت بيقراه</button>
          </div>
          <div className="flex flex-wrap gap-4">
            {toggle('الكورسات والمسارات', settings.knowledge.courses, v => change({ knowledge: { ...settings.knowledge, courses: v } }))}
            {toggle('الأسعار حسب الفرع', settings.knowledge.prices, v => change({ knowledge: { ...settings.knowledge, prices: v } }))}
            {toggle('الأسئلة الشائعة', settings.knowledge.faq, v => change({ knowledge: { ...settings.knowledge, faq: v } }))}
            {toggle('بيانات التواصل', settings.knowledge.contacts, v => change({ knowledge: { ...settings.knowledge, contacts: v } }))}
          </div>
          <label className="block text-xs font-bold text-gray-600">معلومات إضافية (مواعيد الدفعات الجاية، طرق الدفع، العروض…)
            <textarea value={settings.extraKnowledge} onChange={e => change({ extraKnowledge: e.target.value })} rows={5} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-normal" />
          </label>
          {knowledge !== null && (
            <div className="rounded-xl bg-gray-50 p-3">
              <div className="mb-1 flex justify-between text-[11px] text-gray-500"><span>{knowledge.length.toLocaleString('ar-EG-u-nu-latn')} حرف</span><button type="button" onClick={() => setKnowledge(null)}>إخفاء</button></div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-gray-700">{knowledge}</pre>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-extrabold text-gray-900">شخصيته وحدوده</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block text-xs font-bold text-gray-600">اسمه
              <input value={settings.name} onChange={e => change({ name: e.target.value })} maxLength={60} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-normal" />
            </label>
            <label className="block text-xs font-bold text-gray-600">أقصى عدد ردود في المحادثة قبل ما يحوّل
              <input type="number" min={1} max={30} value={settings.maxReplies} onChange={e => change({ maxReplies: Number(e.target.value) })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-normal" />
            </label>
          </div>
          <label className="block text-xs font-bold text-gray-600">تعليمات (أسلوبه، إيه يقول وإيه ما يقولش)
            <textarea value={settings.instructions} onChange={e => change({ instructions: e.target.value })} rows={4} placeholder="مثلاً: اسأل العميل دايماً هو من أنهي محافظة، واعرض الحجز المبكر لو سأل عن السعر." className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-normal" />
          </label>
          <label className="block text-xs font-bold text-gray-600">كلمات لو العميل قالها يتحوّل لموظف على طول (افصل بفاصلة)
            <input value={keywords} onChange={e => { setKeywords(e.target.value); setDirty(true); }} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-normal" />
          </label>
          <label className="block text-xs font-bold text-gray-600">رسالة التحويل للفريق
            <input value={settings.handoffMessage} onChange={e => change({ handoffMessage: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-normal" />
          </label>
          <p className="text-[11px] leading-5 text-gray-500">البوت بيحوّل كمان لوحده لو العميل عايز يحجز أو يدفع فعلاً، أو عنده شكوى، أو سأل حاجة مش في المعلومات. أول ما حد من الفريق يرد في محادثة، البوت يقف فيها.</p>
        </section>

        <div className="sticky bottom-3 flex justify-end">
          <button type="button" onClick={save} disabled={saving || !dirty} className="flex items-center gap-1.5 rounded-xl bg-fuchsia-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg disabled:opacity-40">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} حفظ الإعدادات
          </button>
        </div>
      </div>

      <section className="flex h-[640px] flex-col rounded-2xl border border-gray-200 bg-white xl:sticky xl:top-4" aria-label="جرّب البوت">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-extrabold text-gray-900">جرّب البوت</h3>
            <p className="text-[11px] text-gray-500">بالإعدادات اللي على الشاشة — مفيش حاجة بتتبعت لحد.</p>
          </div>
          <button type="button" onClick={() => setChat([])} title="محادثة جديدة" className="text-gray-400 hover:text-gray-700"><RotateCcw size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#efeae2] p-3">
          {chat.length === 0 && <p className="mt-10 text-center text-xs text-gray-500">اكتب كأنك عميل: «سعر دبلومة العلاج المعرفي كام؟»</p>}
          {chat.map((turn, i) => (
            <div key={i} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm shadow-sm ${turn.role === 'user' ? 'bg-white' : 'bg-[#d9fdd3]'}`}>
                <span className="mb-0.5 flex items-center gap-1 text-[10px] text-gray-500">{turn.role === 'user' ? <><UserRound size={10} /> العميل</> : <><Bot size={10} /> {settings.name}</>}</span>
                {turn.content}
                {turn.handoff && <span className="mt-1 block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">↪ هنا البوت هيقف ويحوّل للفريق</span>}
              </div>
            </div>
          ))}
          {thinking && <div className="flex justify-start"><span className="rounded-xl bg-white px-3 py-2"><Loader2 size={14} className="animate-spin text-gray-400" /></span></div>}
        </div>
        <div className="flex gap-2 border-t border-gray-100 p-3">
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void ask(); }} placeholder="رسالة العميل…"
            className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none" />
          <button type="button" onClick={ask} disabled={thinking || !input.trim()} className="grid h-10 w-10 place-items-center rounded-xl bg-fuchsia-600 text-white disabled:opacity-40"><Send size={16} className="rotate-180" /></button>
        </div>
      </section>
    </div>
  );
}
