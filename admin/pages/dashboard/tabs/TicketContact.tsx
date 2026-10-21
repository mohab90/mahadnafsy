import { useState } from 'react';
import { Mail, MessageCircle, Phone, UserRoundPen } from 'lucide-react';
import { Modal } from '../../../../shared/ui/Modal';
import { cairoDaysAhead } from '../../../../shared/cairoDate';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { toDialable, waLink } from '../../../lib/whatsappLink';

// «زر التواصل … كان ايه سبب المشكلة الحقيقي عمل ايه؟ يختار من قايمة: المشكلة انتهت ولا لسه فى تواصل
// تانى ولا هيرجع للادارة ولا هيسترد» (15 Oct 2026). Calling, WhatsApp or e-mail opens the channel, then asks what
// happened, the real cause, what was done or said — and what comes next, which is then done: the
// problem is closed with its solution, a new contact is set for a date (it shows in the owner's
// follow-ups), it goes back to the administration, or it is sent to the accounts as a refund.
// A client with no number — a visitor, or a file without one — is no longer a client with no buttons:
// the number can be typed here (and is saved on the client's file), or the client is written to.

type Channel = 'call' | 'whatsapp' | 'email';
type Next = 'resolved' | 'follow_up' | 'escalate' | 'refund';

const OUTCOMES: Array<[string, string]> = [
  ['answered', 'رد وكلمته'], ['no_answer', 'ماردش'], ['busy', 'مشغول'], ['wrong_number', 'الرقم غلط'],
];
const NEXT: Array<[Next, string, string, string]> = [
  ['resolved', '✅ المشكلة انتهت', 'بتتقفل بالحل ويتسجل في ملف العميل', 'border-emerald-400 bg-emerald-50 text-emerald-800'],
  ['follow_up', '📞 لسه في تواصل تاني', 'بتفضل مفتوحة وبتظهر في متابعاتك يوم ما تحدده', 'border-sky-400 bg-sky-50 text-sky-800'],
  ['escalate', '⬆️ يرجع للإدارة', 'بتتصعّد للإدارة بسبب المشكلة والحل اللي جرّبناه', 'border-purple-400 bg-purple-50 text-purple-800'],
  ['refund', '💸 هيسترد', 'بتتحول للحسابات كطلب استرداد', 'border-rose-400 bg-rose-50 text-rose-800'],
];
const NEXT_LABEL: Record<Next, string> = { resolved: 'اتقفلت بالحل', follow_up: 'اتحدد تواصل تاني', escalate: 'اتصعدت للإدارة', refund: 'اتحولت للحسابات للاسترداد' };

export function TicketContactButtons({ ticketId, subscriberId, personName, phone, email, size = 13, onLogged, onError }: {
  ticketId: string;
  subscriberId?: string;
  personName?: string;
  phone?: string;
  email?: string;
  size?: number;
  onLogged: (summary: string) => void;
  onError: (text: string) => void;
}) {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [outcome, setOutcome] = useState('answered');
  const [cause, setCause] = useState('');
  const [said, setSaid] = useState('');
  const [next, setNext] = useState<Next | ''>('');
  const [nextDate, setNextDate] = useState(cairoDaysAhead(1));
  const [kind, setKind] = useState<'critical' | 'repeated'>('critical');
  const [saving, setSaving] = useState(false);
  // The number typed here when the file has none.
  const [typed, setTyped] = useState('');
  const [typing, setTyping] = useState(false);
  const [savedPhone, setSavedPhone] = useState('');

  const number = savedPhone || phone || '';
  const dialable = toDialable(number);
  const mail = String(email || '').trim();
  const reached = outcome === 'answered';

  const start = (picked: Channel) => {
    setChannel(picked); setOutcome(picked === 'email' ? 'sent' : 'answered'); setCause(''); setSaid(''); setNext(''); setNextDate(cairoDaysAhead(1));
    // The phone, WhatsApp or mail opens on its own; the form waits for what was said.
    const url = picked === 'whatsapp' ? waLink(number) : picked === 'call' ? `tel:+${dialable}` : `mailto:${mail}`;
    if (url) window.open(url, picked === 'whatsapp' ? '_blank' : '_self', 'noopener');
  };

  const saveNumber = async () => {
    const value = typed.trim();
    if (!toDialable(value)) { onError('الرقم ده مش صحيح — اكتب رقم موبايل كامل'); return; }
    setSaving(true);
    try {
      // On the client's file when there is one, so the next person has it too.
      if (subscriberId) await mysqlAdmin.saveSubscriber({ id: subscriberId, name: personName || '', phone: value, changedFields: ['phone'] });
      setSavedPhone(value); setTyping(false); setTyped('');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'تعذر حفظ الرقم');
    } finally { setSaving(false); }
  };

  const effectiveNext: Next | '' = reached ? next : 'follow_up';
  const ready = Boolean(said.trim()) && (!reached || Boolean(cause.trim())) && Boolean(effectiveNext) && (effectiveNext !== 'follow_up' || Boolean(nextDate));

  const save = async () => {
    if (!channel || !effectiveNext) return;
    setSaving(true);
    try {
      await mysqlAdmin.adminPost(`/admin/tickets/${encodeURIComponent(ticketId)}/contact`, {
        channel, outcome, said: said.trim(), cause: cause.trim(), next: effectiveNext, nextDate: effectiveNext === 'follow_up' ? nextDate : undefined,
      });
      // The step chosen is then taken, through the same routes the ticket's own buttons use.
      // The contact is already on record by now, so a failure here closes the form
      // (a retry would log the contact twice) and says plainly which step did not
      // happen — it used to read like the whole thing had failed, or, worse, like
      // the ticket had been escalated when it had not.
      const summary = `${said.trim()}${cause.trim() ? ` (السبب: ${cause.trim()})` : ''}`;
      try {
        if (effectiveNext === 'resolved') {
          await mysqlAdmin.adminPut(`/admin/tickets/${encodeURIComponent(ticketId)}/status`, { status: 'resolved', closed_reason: summary });
        } else if (effectiveNext === 'escalate') {
          await mysqlAdmin.adminPost(`/admin/tickets/${encodeURIComponent(ticketId)}/escalate`, { reason: summary, kind });
        } else if (effectiveNext === 'refund') {
          await mysqlAdmin.adminPut(`/admin/tickets/${encodeURIComponent(ticketId)}/route`, { category: 'refund' });
        }
      } catch (error) {
        setChannel(null);
        const why = error instanceof Error && error.message ? ` (${error.message})` : '';
        onError(`اتسجل التواصل، لكن «${NEXT_LABEL[effectiveNext]}» ما اتنفذش${why} — نفّذها من أزرار التذكرة`);
        return;
      }
      setChannel(null);
      onLogged(`اتسجل التواصل — ${NEXT_LABEL[effectiveNext]}${effectiveNext === 'follow_up' ? ` (${nextDate})` : ''}`);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'تعذر تسجيل التواصل');
    } finally { setSaving(false); }
  };

  const base = 'inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold text-white';
  const field = 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';
  return (
    <>
      {dialable && (
        <>
          <button type="button" onClick={e => { e.stopPropagation(); start('call'); }} className={`${base} bg-sky-600 hover:bg-sky-700`} title="اتصال بالعميل"><Phone size={size} /> تواصل</button>
          <button type="button" onClick={e => { e.stopPropagation(); start('whatsapp'); }} className={`${base} bg-green-600 hover:bg-green-700`} title="واتساب"><MessageCircle size={size} /> واتس</button>
        </>
      )}
      {mail && (
        <button type="button" onClick={e => { e.stopPropagation(); start('email'); }} className={`${base} bg-slate-600 hover:bg-slate-700`} title={`إيميل: ${mail}`}><Mail size={size} /> إيميل</button>
      )}
      {!dialable && (
        typing ? (
          <span className="inline-flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <input value={typed} onChange={e => setTyped(e.target.value)} dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" autoFocus
              className="w-36 rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs" />
            <button type="button" disabled={saving} onClick={() => void saveNumber()} className={`${base} bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50`}>{saving ? '…' : 'حفظ'}</button>
            <button type="button" onClick={() => setTyping(false)} className="text-xs font-bold text-slate-500">إلغاء</button>
          </span>
        ) : (
          <button type="button" onClick={e => { e.stopPropagation(); setTyping(true); }} className={`${base} bg-amber-600 hover:bg-amber-700`}
            title="مفيش رقم تليفون للعميل ده"><UserRoundPen size={size} /> {subscriberId ? 'ضيف رقم العميل' : 'اكتب رقم العميل'}</button>
        )
      )}
      {channel && (
        <Modal open onClose={() => setChannel(null)} title={channel === 'call' ? 'سجّل المكالمة' : channel === 'whatsapp' ? 'سجّل رسالة الواتساب' : 'سجّل الإيميل'} layer="over" size="md">
          <div className="space-y-3 p-5" dir="rtl">
            <label className="block text-xs font-bold text-slate-600">
              حصل إيه؟
              <select value={outcome} onChange={e => setOutcome(e.target.value)} className={field}>
                {OUTCOMES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                {channel === 'whatsapp' && <option value="read">بعت ومستني الرد</option>}
                {channel === 'email' && <option value="sent">اتبعت</option>}
              </select>
            </label>
            {reached && (
              <label className="block text-xs font-bold text-slate-600">
                كان إيه سبب المشكلة الحقيقي؟ <span className="text-red-500">*</span>
                <textarea value={cause} onChange={e => setCause(e.target.value)} rows={2} placeholder="مثلاً: المحاضر اتغيّر من غير ما العميل يتبلّغ" className={`${field} resize-none`} />
              </label>
            )}
            <label className="block text-xs font-bold text-slate-600">
              {reached ? 'عملنا إيه / قلت للعميل إيه؟' : 'اللي حصل'} <span className="text-red-500">*</span>
              <textarea value={said} onChange={e => setSaid(e.target.value)} rows={3} autoFocus
                placeholder={reached ? 'مثلاً: اعتذرت له ووعدته إن المحاضر الجديد يبدأ الأسبوع الجاي' : 'مثلاً: اتصلت مرتين ومردش'} className={`${field} resize-none`} />
            </label>

            {reached ? (
              <div>
                <p className="mb-1 text-xs font-bold text-slate-600">وإيه اللي هيحصل بعد كده؟ <span className="text-red-500">*</span></p>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="الخطوة الجاية">
                  {NEXT.map(([key, label, hint, tone]) => (
                    <button key={key} type="button" role="radio" aria-checked={next === key} onClick={() => setNext(key)}
                      className={`rounded-xl border-2 p-2.5 text-right transition ${next === key ? `${tone} ring-2 ring-offset-1 ring-sky-300` : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                      <span className="block text-sm font-extrabold">{label}</span>
                      <span className="mt-0.5 block text-[10px] font-normal leading-snug opacity-80">{hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-[11px] font-bold text-sky-800">📞 العميل ما اتكلمش — هتتحدد محاولة تانية وهتظهر في متابعاتك.</p>
            )}

            {effectiveNext === 'follow_up' && (
              <label className="block text-xs font-bold text-slate-600">
                نكلّمه تاني يوم
                <input type="date" value={nextDate} min={cairoDaysAhead(0)} onChange={e => setNextDate(e.target.value)} className={field} />
              </label>
            )}
            {effectiveNext === 'escalate' && (
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="نوع التصعيد">
                {([['critical', '🚨 مهم جدا'], ['repeated', '🔁 متكررة']] as const).map(([key, label]) => (
                  <button key={key} type="button" role="radio" aria-checked={kind === key} onClick={() => setKind(key)}
                    className={`rounded-lg border-2 px-3 py-1.5 text-xs font-bold ${kind === key ? 'border-purple-500 bg-purple-50 text-purple-800' : 'border-slate-200 text-slate-600'}`}>{label}</button>
                ))}
              </div>
            )}

            <p className="text-[11px] text-slate-500">بيتسجل على المشكلة وفي ملف العميل باسمك.</p>
            <div className="flex gap-2">
              <button type="button" disabled={saving || !ready} onClick={() => void save()}
                className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                {saving ? 'جارى الحفظ…' : 'سجّل ونفّذ'}
              </button>
              <button type="button" onClick={() => setChannel(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">إلغاء</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
