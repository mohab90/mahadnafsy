import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Loader2, Send, Sparkles, UserCheck, X, Megaphone } from 'lucide-react';
import { Modal } from '../../shared/ui/Modal';
import { mysqlAdmin } from '../lib/mysqlapi';
import { CAIRO_TIME_ZONE } from '../../shared/cairoDate';
import type { NotifyFn } from '../types';

// The CRM tools of the in-system WhatsApp chat (19 Oct 2026): an AI-suggested reply, scheduled messages, handing a chat to
// a colleague, the lead's status, and a campaign to the chats picked in the list. Served by api/routes/whatsapp-web-crm.js.

const API = '/staff/whatsapp-web';
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'حصل خطأ');
const when = (ms: number) => new Date(ms).toLocaleString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: CAIRO_TIME_ZONE });

/** «ذكاء اصطناعي يقترح رد»: a draft from the conversation, put in the box for the rep to read, change and send. */
export function SuggestReplyButton({ jid, disabled, onReply, notify }: { jid: string; disabled?: boolean; onReply: (text: string) => void; notify: NotifyFn }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const result = await mysqlAdmin.adminPost<{ reply: string }>(`${API}/suggest`, { jid });
      onReply(result.reply);
    } catch (error) { notify('error', errorText(error)); }
    finally { setBusy(false); }
  };
  return (
    <button type="button" onClick={() => void run()} disabled={disabled || busy} title="الذكاء الاصطناعي يقترح رد على آخر رسالة — بتراجعه وتبعته بنفسك"
      className="flex h-[42px] items-center gap-1 rounded-xl border border-violet-200 bg-violet-50 px-2.5 text-xs font-bold text-violet-700 hover:bg-violet-100 disabled:opacity-40">
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} اقترح رد
    </button>
  );
}

type Scheduled = { id: string; jid: string; body: string; status: string; sendAtMs: number; error: string | null; batchLabel: string | null };

/** The messages waiting to go out in this chat, with a way to cancel each. */
export function ScheduledList({ jid, version, notify, onChanged }: { jid: string; version: number; notify: NotifyFn; onChanged: () => void }) {
  const [items, setItems] = useState<Scheduled[]>([]);
  useEffect(() => {
    let alive = true;
    mysqlAdmin.adminGet<{ items: Scheduled[] }>(`${API}/scheduled?jid=${encodeURIComponent(jid)}`)
      .then(result => { if (alive) setItems(result.items || []); }, () => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [jid, version]);
  if (!items.length) return null;
  const cancel = async (id: string) => {
    try { await mysqlAdmin.adminDelete(`${API}/scheduled/${encodeURIComponent(id)}`); onChanged(); }
    catch (error) { notify('error', errorText(error)); }
  };
  return (
    <div className="space-y-1 border-t border-violet-100 bg-violet-50/60 px-3 py-2">
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-2 text-[11px] text-violet-900">
          <Clock size={12} className="shrink-0" />
          <span className="shrink-0 font-bold">{when(item.sendAtMs)}</span>
          <span className="min-w-0 flex-1 truncate" title={item.body}>{item.body}</span>
          {item.error && <span className="shrink-0 text-amber-700">{item.error}</span>}
          {item.batchLabel && <span className="shrink-0 rounded-full bg-white px-1.5 text-violet-700">حملة</span>}
          <button type="button" onClick={() => void cancel(item.id)} aria-label="إلغاء الرسالة" className="shrink-0 rounded p-0.5 text-violet-600 hover:bg-violet-100"><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

const pad = (value: number) => String(value).padStart(2, '0');
const localInput = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** «رسائل مجدولة»: the text in the box, sent later — at a time the rep picks. */
export function ScheduleDialog({ jid, text, onClose, onScheduled, notify }: { jid: string; text: string; onClose: () => void; onScheduled: () => void; notify: NotifyFn }) {
  const [at, setAt] = useState(() => localInput(new Date(Date.now() + 3600e3)));
  const [saving, setSaving] = useState(false);
  const quick = useMemo(() => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(10, 0, 0, 0);
    const evening = new Date(); evening.setHours(19, 0, 0, 0);
    return [
      { label: 'بعد ساعة', date: new Date(Date.now() + 3600e3) },
      ...(evening.getTime() > Date.now() + 120e3 ? [{ label: 'النهاردة ٧ م', date: evening }] : []),
      { label: 'بكرة ١٠ ص', date: tomorrow },
    ];
  }, []);
  const save = async () => {
    setSaving(true);
    try {
      await mysqlAdmin.adminPost(`${API}/scheduled`, { jid, text, sendAt: new Date(at).toISOString() });
      notify('success', 'اتجدولت — هتتبعت في معادها من الواتساب بتاعك');
      onScheduled(); onClose();
    } catch (error) { notify('error', errorText(error)); }
    finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="جدولة الرسالة" subtitle="تتبعت في الوقت اللي تختاره" size="sm" layer="over">
      <div className="space-y-3 px-5 pb-5 pt-3" dir="rtl">
        <p className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-sm text-gray-700">{text}</p>
        <div className="flex flex-wrap gap-1.5">
          {quick.map(option => (
            <button key={option.label} type="button" onClick={() => setAt(localInput(option.date))}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-gray-700 hover:border-violet-400 hover:text-violet-700">{option.label}</button>
          ))}
        </div>
        <input type="datetime-local" value={at} onChange={event => setAt(event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
        <p className="text-[11px] text-gray-500">لو الواتساب مش مربوط في الوقت ده بيحاول تاني، ولو وصلت للحد اليومي بتتبعت تاني يوم الصبح.</p>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50">إلغاء</button>
          <button type="button" onClick={() => void save()} disabled={saving || !text.trim()} className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-violet-600 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-40">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Clock size={15} />} جدولة
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** «تعيين المحادثة لموظف تاني»: a sales lead changes hands; the colleague always gets the conversation as a message. */
export function HandOverDialog({ jid, leadId, onClose, onDone, notify }: { jid: string; leadId: string | null; onClose: () => void; onDone: () => void; notify: NotifyFn }) {
  const [staff, setStaff] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { mysqlAdmin.adminGet<{ staff: Array<{ id: string; name: string; role: string }> }>(`${API}/colleagues`).then(result => setStaff(result.staff), () => undefined); }, []);
  const picked = staff.find(member => member.id === target);
  const salesTarget = String(picked?.role || '').toUpperCase() === 'SALES';
  const save = async () => {
    setSaving(true);
    try {
      const result = await mysqlAdmin.adminPost<{ reassigned: boolean; to: string }>(`${API}/assign`, { jid, staffId: target, note });
      notify('success', result.reassigned ? `اتحولت لـ${result.to} واتنقل له كعميل محتمل` : `اتبعتت لـ${result.to} برسالة فيها المحادثة`);
      onDone(); onClose();
    } catch (error) { notify('error', errorText(error)); }
    finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="حوّل المحادثة لزميل" subtitle="هيوصله ملخص الكلام برسالة" size="sm" layer="over">
      <div className="space-y-3 px-5 pb-5 pt-3" dir="rtl">
        <select value={target} onChange={event => setTarget(event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" aria-label="الزميل">
          <option value="">— اختار الزميل —</option>
          {staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
        <textarea value={note} onChange={event => setNote(event.target.value)} rows={3} maxLength={600} placeholder="ملاحظة للزميل (اختياري)" className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm" />
        {target && (
          <p className="rounded-xl bg-sky-50 p-2.5 text-[11px] text-sky-900">
            {leadId && salesTarget ? 'العميل المحتمل هيتنقل للزميل في الليدز، ويوصله ملخص المحادثة.' : 'هيوصل الزميل ملخص المحادثة وبيانات العميل، ويكمل معاه من «واتسابي».'}
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50">إلغاء</button>
          <button type="button" onClick={() => void save()} disabled={saving || !target} className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <UserCheck size={15} />} تحويل
          </button>
        </div>
      </div>
    </Modal>
  );
}

// The statuses a conversation moves a lead through. A sale («converted») is made by a booking, not by choosing it here.
export const CHAT_LEAD_STATUSES: Array<[string, string]> = [
  ['new', 'جديد'], ['contacted', 'اتكلّم معاه'], ['interested', 'مهتم'], ['interested_followup', 'مهتم — متابعة'],
  ['interested_booking', 'عايز يحجز'], ['no_answer', 'مردّش'], ['postpone_month', 'مؤجل شهر'], ['with_colleague', 'مع زميل'],
  ['not_interested', 'مش مهتم'], ['wrong_number', 'رقم غلط'],
];

/** «تغيير حالة الليد من جوه الشات». */
export function LeadStatusControl({ leadId, status, notify, onChanged }: { leadId: string; status: string | null; notify: NotifyFn; onChanged: (next: string) => void }) {
  const [busy, setBusy] = useState(false);
  const known = CHAT_LEAD_STATUSES.some(([key]) => key === status);
  const change = async (next: string) => {
    if (!next || next === status) return;
    setBusy(true);
    try {
      await mysqlAdmin.adminPut(`/admin/crm/leads/${encodeURIComponent(leadId)}/status`, { status: next });
      notify('success', 'اتغيّرت حالة العميل المحتمل');
      onChanged(next);
    } catch (error) { notify('error', errorText(error)); }
    finally { setBusy(false); }
  };
  return (
    <label className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-600">
      الحالة
      <select value={status || ''} disabled={busy} onChange={event => void change(event.target.value)} aria-label="حالة العميل المحتمل"
        className="h-7 rounded-lg border border-amber-200 bg-amber-50 px-1.5 text-[11px] font-bold text-amber-900 disabled:opacity-50">
        {!known && <option value={status || ''}>{status || '—'}</option>}
        {CHAT_LEAD_STATUSES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
  );
}

type Campaign = { batchId: string; label: string | null; total: number; sent: number; waiting: number; failed: number; canceled: number; createdMs: number; lastMs: number };

/** «حملات من الشات»: one message to the chats picked in the list, one after another, with the progress of earlier ones. */
export function CampaignDialog({ jids, onClose, onDone, notify }: { jids: string[]; onClose: () => void; onDone: () => void; notify: NotifyFn }) {
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const [gap, setGap] = useState(45);
  const [later, setLater] = useState(false);
  const [at, setAt] = useState(() => localInput(new Date(Date.now() + 3600e3)));
  const [saving, setSaving] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Array<{ id: string; title: string; body: string }>>([]);
  const load = useCallback(() => { mysqlAdmin.adminGet<{ campaigns: Campaign[] }>(`${API}/campaigns`).then(result => setCampaigns(result.campaigns), () => undefined); }, []);
  useEffect(() => {
    load();
    mysqlAdmin.adminGet<{ templates: Array<{ id: string; title: string; body: string }> }>(`${API}/templates`).then(result => setTemplates(result.templates), () => undefined);
  }, [load]);
  const minutes = Math.ceil((jids.length * gap) / 60);
  const send = async () => {
    setSaving(true);
    try {
      const result = await mysqlAdmin.adminPost<{ queued: number; skipped: { unsubscribed: number; invalid: number; duplicate: number }; notInYourChats: number }>(`${API}/campaign`, {
        jids, text, gapSeconds: gap, label: label.trim() || undefined, ...(later ? { startAt: new Date(at).toISOString() } : {}),
      });
      const left = result.skipped.unsubscribed + result.skipped.invalid + result.skipped.duplicate + result.notInYourChats;
      notify('success', `اتجدولت الحملة لـ${result.queued} محادثة${left ? ` (${left} اتخطّت: طلبوا إيقاف أو رقم مش صالح)` : ''}`);
      setText(''); load(); onDone();
    } catch (error) { notify('error', errorText(error)); }
    finally { setSaving(false); }
  };
  const cancel = async (batchId: string) => {
    try { await mysqlAdmin.adminDelete(`${API}/campaigns/${encodeURIComponent(batchId)}`); load(); onDone(); }
    catch (error) { notify('error', errorText(error)); }
  };
  return (
    <Modal open onClose={onClose} title="حملة واتساب" subtitle={`لـ${jids.length} محادثة — واحدة ورا التانية من الواتساب بتاعك`} size="md" layer="over">
      <div className="space-y-3 px-5 pb-5 pt-3" dir="rtl">
        {templates.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {templates.slice(0, 8).map(template => (
              <button key={template.id} type="button" onClick={() => setText(current => (current ? `${current}\n` : '') + template.body.replace(/\{me\}/g, ''))}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-700 hover:border-green-400 hover:text-green-700">{template.title}</button>
            ))}
          </div>
        )}
        <textarea value={text} onChange={event => setText(event.target.value)} rows={5} placeholder="اكتب الرسالة — {name} بيتبدّل باسم كل واحد" className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm" />
        <div className="grid gap-2 sm:grid-cols-3">
          <input value={label} onChange={event => setLabel(event.target.value)} maxLength={60} placeholder="اسم الحملة (اختياري)" className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          <select value={gap} onChange={event => setGap(Number(event.target.value))} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" aria-label="الفاصل بين الرسايل">
            {[30, 45, 60, 90, 120].map(seconds => <option key={seconds} value={seconds}>كل ~{seconds} ثانية</option>)}
          </select>
          <label className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm"><input type="checkbox" checked={later} onChange={event => setLater(event.target.checked)} /> ابدأ في وقت محدد</label>
        </div>
        {later && <input type="datetime-local" value={at} onChange={event => setAt(event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />}
        <p className="rounded-xl bg-amber-50 p-2.5 text-[11px] text-amber-900">
          هتخلص تقريبًا في {minutes.toLocaleString('ar-EG-u-nu-latn')} دقيقة. الرسايل بتتبعت ببطء وبحد يومي لحماية رقمك من الحظر، وأي حد طلب إيقاف الرسايل بيتخطّى، وبتفضل تتبعت حتى لو قفلت الصفحة.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50">إغلاق</button>
          <button type="button" onClick={() => void send()} disabled={saving || !text.trim() || !jids.length} className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-green-600 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-40">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} className="rotate-180" />} ابدأ الحملة
          </button>
        </div>
        {campaigns.length > 0 && (
          <div className="space-y-1.5 border-t border-gray-100 pt-3">
            <p className="text-xs font-bold text-gray-500">حملاتك</p>
            {campaigns.map(campaign => (
              <div key={campaign.batchId} className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-1.5 text-[11px]">
                <Megaphone size={13} className="shrink-0 text-green-600" />
                <span className="min-w-0 flex-1 truncate font-bold text-gray-800">{campaign.label || `حملة ${when(campaign.createdMs)}`}</span>
                <span className="text-green-700">اتبعتت {campaign.sent}</span>
                {campaign.waiting > 0 && <span className="text-amber-700">مستنية {campaign.waiting}</span>}
                {campaign.failed > 0 && <span className="text-red-600">فشلت {campaign.failed}</span>}
                {campaign.waiting > 0 && <button type="button" onClick={() => void cancel(campaign.batchId)} className="rounded-lg border border-red-200 bg-white px-2 py-0.5 font-bold text-red-600 hover:bg-red-50">وقف</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
