// The parts of «صندوق الرسائل» around the conversation itself: its labels, the
// customer panel beside it, the saved answers, and how fast the team replies.
// Server side: api/routes/team-inbox.js.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Pencil, Plus, Tag, Trash2, X, Zap } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { Modal } from '../../../../../shared/ui/Modal';
import { CAIRO_TIME_ZONE } from '../../../../../shared/cairoDate';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
const API = '/admin/team-inbox';
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'حصل خطأ');
const egp = (value: number) => `${Math.round(value || 0).toLocaleString('ar-EG-u-nu-latn')} ج.م`;
const dateOf = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric', timeZone: CAIRO_TIME_ZONE }) : '—');

/** Suggested before any are in use; the team's own labels join them as they are used. */
export const STARTER_LABELS = ['مهتم', 'سأل عن السعر', 'حجز', 'متابعة', 'شكوى', 'عميل حالي', 'مش مهتم'];

/** How long the customer has been waiting on us, and how worried to be. */
export function waitingFor(lastInboundAt: string | null, now = Date.now()): { text: string; tone: string } | null {
  if (!lastInboundAt) return null;
  const minutes = Math.max(0, Math.round((now - new Date(lastInboundAt).getTime()) / 60000));
  const text = minutes < 1 ? 'دلوقتي' : minutes < 60 ? `${minutes} د` : minutes < 1440 ? `${Math.floor(minutes / 60)} س` : `${Math.floor(minutes / 1440)} يوم`;
  const tone = minutes <= 15 ? 'bg-emerald-50 text-emerald-700' : minutes <= 60 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700';
  return { text, tone };
}

// ── Labels ─────────────────────────────────────────────────────────────────
export function LabelEditor({ threadId, labels, onSaved, notify, known }: {
  threadId: string; labels: string[]; onSaved: (labels: string[]) => void; notify: NotifyFn; known: string[];
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const save = async (next: string[]) => {
    try {
      const result = await mysqlAdmin.adminPost<{ labels: string[] }>(`${API}/threads/${threadId}/labels`, { labels: next });
      onSaved(result.labels);
    } catch (error) { notify('error', errorText(error)); }
  };
  const suggestions = [...new Set([...known, ...STARTER_LABELS])].filter(l => !labels.includes(l)).slice(0, 12);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {labels.map(label => (
        <span key={label} className="flex items-center gap-0.5 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700">
          {label}
          <button type="button" aria-label={`شيل ${label}`} onClick={() => save(labels.filter(l => l !== label))} className="text-violet-400 hover:text-violet-700"><X size={11} /></button>
        </span>
      ))}
      {adding ? (
        <span className="relative">
          <input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="تصنيف…" maxLength={30}
            onKeyDown={e => {
              if (e.key === 'Enter' && text.trim()) { void save([...labels, text.trim()]); setText(''); setAdding(false); }
              if (e.key === 'Escape') setAdding(false);
            }}
            className="w-28 rounded-full border border-violet-200 px-2 py-0.5 text-[11px] focus:outline-none" />
          <span className="absolute right-0 top-full z-20 mt-1 flex w-56 flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
            {suggestions.filter(l => !text || l.includes(text)).map(label => (
              <button key={label} type="button" onMouseDown={e => { e.preventDefault(); void save([...labels, label]); setAdding(false); setText(''); }}
                className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-violet-100">{label}</button>
            ))}
            <button type="button" onMouseDown={e => { e.preventDefault(); setAdding(false); }} className="text-[11px] text-gray-400">إغلاق</button>
          </span>
        </span>
      ) : (
        labels.length < 8 && (
          <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-0.5 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] text-gray-500 hover:border-violet-300 hover:text-violet-700">
            <Tag size={10} /> تصنيف
          </button>
        )
      )}
    </div>
  );
}

// ── Customer panel ─────────────────────────────────────────────────────────
type Contact = {
  lead: null | { id: string; client_code: string | null; name: string; phone: string; email: string | null; status: string; source: string | null; branch: string | null; created_at: string; assigned_sales_name: string | null; next_follow_up_date: string | null; last_contact_note: string | null; course_title: string | null };
  client: null | { id: string; client_code: string | null; name: string; name_ar: string | null; phone: string; email: string | null; branch: string | null; assigned_sales_name: string | null; assigned_cs_name: string | null; created_at: string };
  payments: { id: string; date: string; amount: number; currency: string; amount_egp: number; status: string; item: string | null }[];
  paidEgp: number;
  messages: number;
  firstContactAt: string | null;
};

export function ContactPanel({ threadId, onOpenProfile, onClose }: { threadId: string; onOpenProfile: (id: string) => void; onClose: () => void }) {
  const [data, setData] = useState<Contact | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setData(null); setError('');
    mysqlAdmin.adminGet<Contact>(`${API}/threads/${threadId}/contact`).then(d => { if (!cancelled) setData(d); }, e => { if (!cancelled) setError(errorText(e)); });
    return () => { cancelled = true; };
  }, [threadId]);
  const row = (label: string, value?: string | null) => value ? (
    <div className="flex justify-between gap-2 py-1 text-xs"><span className="text-gray-500">{label}</span><span className="text-left font-semibold text-gray-800">{value}</span></div>
  ) : null;
  return (
    <aside className="flex min-h-0 w-full flex-col border-r border-gray-100 bg-gray-50/60 lg:w-72" aria-label="بيانات العميل">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2.5">
        <span className="text-sm font-bold text-gray-800">بيانات العميل</span>
        <button type="button" onClick={onClose} aria-label="إغلاق" className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!data && !error && <p className="text-xs text-gray-400">بيحمّل…</p>}
        {data && !data.lead && !data.client && (
          <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">المحادثة دي مش مربوطة بليد ولا عميل لسه. أول ما يتسجل برقمه هتتربط لوحدها.</p>
        )}
        {data?.client && (
          <section className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="mb-1 text-[11px] font-bold text-emerald-700">عميل</p>
            <button type="button" onClick={() => onOpenProfile(data.client!.id)} className="text-sm font-extrabold text-primary-700 hover:underline">{data.client.name_ar || data.client.name}</button>
            {row('الكود', data.client.client_code)}
            {row('الفرع', data.client.branch)}
            {row('السيلز', data.client.assigned_sales_name)}
            {row('مسئول التحصيل', data.client.assigned_cs_name)}
            {row('دفع لحد دلوقتي', egp(data.paidEgp))}
            {row('عميل من', dateOf(data.client.created_at))}
          </section>
        )}
        {data?.lead && (
          <section className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="mb-1 text-[11px] font-bold text-sky-700">ليد</p>
            <button type="button" onClick={() => onOpenProfile(data.lead!.id)} className="text-sm font-extrabold text-primary-700 hover:underline">{data.lead.name}</button>
            {row('الحالة', data.lead.status)}
            {row('المصدر', data.lead.source)}
            {row('الكورس', data.lead.course_title)}
            {row('السيلز', data.lead.assigned_sales_name)}
            {row('المتابعة الجاية', data.lead.next_follow_up_date ? dateOf(data.lead.next_follow_up_date) : null)}
            {data.lead.last_contact_note && <p className="mt-1 rounded-lg bg-gray-50 p-2 text-[11px] text-gray-600">{data.lead.last_contact_note}</p>}
          </section>
        )}
        {data && data.payments.length > 0 && (
          <section className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="mb-1.5 text-[11px] font-bold text-gray-500">آخر المدفوعات</p>
            <ul className="space-y-1.5">
              {data.payments.map(p => (
                <li key={p.id} className="flex justify-between gap-2 text-xs">
                  <span className="truncate text-gray-700">{p.item || '—'} <span className="text-gray-400">· {dateOf(p.date)}</span></span>
                  <span className={`whitespace-nowrap font-bold tabular-nums ${p.status === 'paid' ? 'text-gray-900' : 'text-amber-600'}`}>{Number(p.amount).toLocaleString('ar-EG-u-nu-latn')} {p.currency}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data && <p className="text-[11px] text-gray-400">{data.messages} رسالة · أول تواصل {dateOf(data.firstContactAt)}</p>}
      </div>
    </aside>
  );
}

// ── Quick replies ──────────────────────────────────────────────────────────
export type QuickReply = { id: string; title: string; shortcut: string | null; body: string; created_by: string | null };

export function useQuickReplies(notify: NotifyFn) {
  const [list, setList] = useState<QuickReply[] | null>(null);
  const load = useCallback(async () => {
    try { setList(await mysqlAdmin.adminGet<QuickReply[]>(`${API}/quick-replies`)); } catch (error) { notify('error', errorText(error)); }
  }, [notify]);
  return { list, load };
}

/** Fills a saved answer for this customer: {name} is their name. */
export const fillReply = (body: string, name?: string | null) => body.replace(/\{name\}|\{الاسم\}/g, (name || '').split(' ')[0] || '');

export function QuickReplyPicker({ list, query, onPick, onManage }: { list: QuickReply[] | null; query: string; onPick: (r: QuickReply) => void; onManage: () => void }) {
  const q = query.trim().toLowerCase();
  const shown = (list || []).filter(r => !q || (r.shortcut || '').includes(q) || r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q)).slice(0, 8);
  return (
    <div className="absolute bottom-full right-0 z-20 mb-2 w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 text-xs">
        <span className="flex items-center gap-1 font-bold text-gray-700"><Zap size={13} className="text-amber-500" /> الردود السريعة</span>
        <button type="button" onMouseDown={e => { e.preventDefault(); onManage(); }} className="font-bold text-indigo-600">إدارة</button>
      </div>
      {list === null && <p className="p-3 text-xs text-gray-400">بيحمّل…</p>}
      {list && shown.length === 0 && <p className="p-3 text-xs text-gray-400">{list.length ? 'مفيش رد بالكلام ده' : 'مفيش ردود محفوظة لسه — دوس «إدارة» وضيف أول رد.'}</p>}
      <ul className="max-h-64 overflow-y-auto">
        {shown.map(r => (
          <li key={r.id}>
            <button type="button" onMouseDown={e => { e.preventDefault(); onPick(r); }} className="block w-full px-3 py-2 text-right hover:bg-indigo-50">
              <span className="text-xs font-bold text-gray-800">{r.title}</span>
              {r.shortcut && <span className="mr-1.5 text-[11px] text-indigo-500" dir="ltr">/{r.shortcut}</span>}
              <span className="block truncate text-[11px] text-gray-500">{r.body}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function QuickRepliesManager({ list, reload, onClose, notify }: { list: QuickReply[] | null; reload: () => Promise<void>; onClose: () => void; notify: NotifyFn }) {
  const blank = { id: '', title: '', shortcut: '', body: '' };
  const [draft, setDraft] = useState(blank);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const body = { title: draft.title, shortcut: draft.shortcut, body: draft.body };
      if (draft.id) await mysqlAdmin.adminPut(`${API}/quick-replies/${draft.id}`, body);
      else await mysqlAdmin.adminPost(`${API}/quick-replies`, body);
      notify('success', 'اتحفظ الرد');
      setDraft(blank);
      await reload();
    } catch (error) { notify('error', errorText(error)); } finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    try { await mysqlAdmin.adminDelete(`${API}/quick-replies/${id}`); await reload(); } catch (error) { notify('error', errorText(error)); }
  };
  return (
    <Modal open onClose={onClose} title="الردود السريعة" icon={<Zap size={16} />} tone="amber" size="lg">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2" dir="rtl">
          <div className="space-y-2">
            <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="العنوان (مثلاً: سعر دبلومة CBT)" maxLength={120} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            <input value={draft.shortcut} onChange={e => setDraft({ ...draft, shortcut: e.target.value })} placeholder="اختصار بعد / (مثلاً: cbt)" maxLength={40} dir="ltr" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            <textarea value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} rows={6} placeholder={'النص… استخدم {name} لاسم العميل'} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button type="button" onClick={save} disabled={saving || !draft.title.trim() || !draft.body.trim()} className="flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
                <Plus size={14} /> {draft.id ? 'حفظ التعديل' : 'إضافة'}
              </button>
              {draft.id && <button type="button" onClick={() => setDraft(blank)} className="text-sm text-gray-500">إلغاء</button>}
            </div>
            <p className="text-[11px] leading-5 text-gray-500">في خانة الرسالة اكتب <b dir="ltr">/</b> وبعده الاختصار أو جزء من العنوان، أو دوس ⚡.</p>
          </div>
          <ul className="space-y-2">
            {(list || []).length === 0 && <li className="text-xs text-gray-400">مفيش ردود لسه.</li>}
            {(list || []).map(r => (
              <li key={r.id} className="rounded-xl border border-gray-200 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-gray-800">{r.title} {r.shortcut && <span className="text-indigo-500" dir="ltr">/{r.shortcut}</span>}</span>
                  <span className="flex gap-1">
                    <button type="button" aria-label="تعديل" onClick={() => setDraft({ id: r.id, title: r.title, shortcut: r.shortcut || '', body: r.body })} className="text-gray-400 hover:text-indigo-600"><Pencil size={13} /></button>
                    <button type="button" aria-label="مسح" onClick={() => remove(r.id)} className="text-gray-400 hover:text-red-600"><Trash2 size={13} /></button>
                  </span>
                </div>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px] text-gray-600">{r.body}</p>
              </li>
            ))}
          </ul>
        </div>
    </Modal>
  );
}

// ── Team speed ─────────────────────────────────────────────────────────────
type Stats = {
  days: number; waitingNow: number; oldestWaitingAt: string | null; newConversations: number;
  people: { staffId: string | null; name: string; replies: number; avgMinutes: number | null; within15m: number }[];
};

export function InboxStatsPanel({ notify }: { notify: NotifyFn }) {
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    mysqlAdmin.adminGet<Stats>(`${API}/stats?days=${days}`).then(setStats, e => notify('error', errorText(e)));
  }, [days, notify]);
  const oldest = useMemo(() => waitingFor(stats?.oldestWaitingAt || null), [stats]);
  const totals = useMemo(() => {
    const people = stats?.people || [];
    const replies = people.reduce((s, p) => s + p.replies, 0);
    const timed = people.filter(p => p.avgMinutes !== null);
    const avg = timed.length ? timed.reduce((s, p) => s + (p.avgMinutes || 0) * p.replies, 0) / Math.max(1, timed.reduce((s, p) => s + p.replies, 0)) : null;
    const fast = people.reduce((s, p) => s + p.within15m, 0);
    return { replies, avg, fastPct: replies ? Math.round((fast / replies) * 100) : 0 };
  }, [stats]);
  return (
    <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-gray-900"><BarChart3 size={16} className="text-indigo-600" /> سرعة رد الفريق</h3>
        <div className="flex rounded-lg bg-gray-100 p-0.5 text-xs">
          {[1, 7, 30].map(d => (
            <button key={d} type="button" onClick={() => setDays(d)} className={`rounded-md px-2.5 py-1 font-bold ${days === d ? 'bg-white shadow-sm' : 'text-gray-500'}`}>{d === 1 ? 'النهارده' : `${d} يوم`}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          ['مستنيين رد دلوقتي', String(stats?.waitingNow ?? '…'), oldest ? `أقدمهم من ${oldest.text}` : ''],
          ['متوسط وقت الرد', totals.avg === null ? '—' : `${totals.avg.toFixed(1)} د`, ''],
          ['اترد عليهم في 15 دقيقة', `${totals.fastPct}%`, `${totals.replies} رد`],
          ['محادثات جديدة', String(stats?.newConversations ?? '…'), ''],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-xl bg-gray-50 p-3">
            <p className="text-[11px] text-gray-500">{label}</p>
            <p className="text-lg font-black tabular-nums text-gray-900">{value}</p>
            {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-xs">
          <thead><tr className="text-gray-500"><th className="py-1.5 text-right">الموظف</th><th className="text-left">ردود</th><th className="text-left">متوسط الرد</th><th className="text-left">خلال 15 د</th></tr></thead>
          <tbody>
            {(stats?.people || []).length === 0 && <tr><td colSpan={4} className="py-4 text-center text-gray-400">مفيش ردود في الفترة دي</td></tr>}
            {(stats?.people || []).map(p => (
              <tr key={p.staffId || 'bot'} className="border-t border-gray-100">
                <td className="py-1.5 font-bold text-gray-800">{p.name}</td>
                <td className="text-left tabular-nums">{p.replies}</td>
                <td className={`text-left tabular-nums ${p.avgMinutes !== null && p.avgMinutes > 60 ? 'text-red-600' : p.avgMinutes !== null && p.avgMinutes > 15 ? 'text-amber-600' : 'text-emerald-700'}`}>{p.avgMinutes === null ? '—' : `${p.avgMinutes} د`}</td>
                <td className="text-left tabular-nums">{p.replies ? Math.round((p.within15m / p.replies) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
