import { useState } from 'react';
import { MessageCircle, Phone } from 'lucide-react';
import { Modal } from '../../../../shared/ui/Modal';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { toDialable, waLink } from '../../../lib/whatsappLink';

// «ضيف في الاجراءات زر تواصل وزر واتس اب وتسجل قالت ايه للعميل» (14 Oct 2026).
// The two ways to reach the client from a problem: a call and WhatsApp. Either one
// opens the phone / WhatsApp, then asks what happened and what was said, and writes it
// on the ticket and on the client's file (POST /api/admin/tickets/:id/contact).

type Channel = 'call' | 'whatsapp';
const OUTCOMES: Array<[string, string]> = [
  ['answered', 'رد وكلمته'], ['no_answer', 'ماردش'], ['busy', 'مشغول'], ['wrong_number', 'الرقم غلط'],
];

export function TicketContactButtons({ ticketId, phone, size = 13, onLogged, onError }: {
  ticketId: string;
  phone?: string;
  size?: number;
  onLogged: () => void;
  onError: (text: string) => void;
}) {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [outcome, setOutcome] = useState('answered');
  const [said, setSaid] = useState('');
  const [saving, setSaving] = useState(false);

  const dialable = toDialable(phone);
  if (!dialable) return null;

  const start = (next: Channel) => {
    setChannel(next); setOutcome(next === 'whatsapp' ? 'answered' : 'answered'); setSaid('');
    // The phone or WhatsApp opens on its own; the form waits for what was said.
    const url = next === 'whatsapp' ? waLink(phone) : `tel:+${dialable}`;
    if (url) window.open(url, next === 'whatsapp' ? '_blank' : '_self', 'noopener');
  };
  const save = async () => {
    if (!channel) return;
    setSaving(true);
    try {
      await mysqlAdmin.adminPost(`/admin/tickets/${encodeURIComponent(ticketId)}/contact`, { channel, outcome, said: said.trim() });
      setChannel(null);
      onLogged();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'تعذر تسجيل التواصل');
    } finally { setSaving(false); }
  };

  const base = 'inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold text-white';
  return (
    <>
      <button type="button" onClick={e => { e.stopPropagation(); start('call'); }} className={`${base} bg-sky-600 hover:bg-sky-700`} title="اتصال بالعميل">
        <Phone size={size} /> تواصل
      </button>
      <button type="button" onClick={e => { e.stopPropagation(); start('whatsapp'); }} className={`${base} bg-green-600 hover:bg-green-700`} title="واتساب">
        <MessageCircle size={size} /> واتس
      </button>
      {channel && (
        <Modal open onClose={() => setChannel(null)} title={channel === 'call' ? 'سجّل المكالمة' : 'سجّل رسالة الواتساب'} layer="over" size="sm">
          <div className="space-y-3 p-5" dir="rtl">
            <label className="block text-xs font-bold text-slate-600">
              حصل إيه؟
              <select value={outcome} onChange={e => setOutcome(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                {OUTCOMES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                {channel === 'whatsapp' && <option value="read">بعت ومستني الرد</option>}
              </select>
            </label>
            <label className="block text-xs font-bold text-slate-600">
              قلت للعميل إيه؟ <span className="text-red-500">*</span>
              <textarea value={said} onChange={e => setSaid(e.target.value)} rows={4} autoFocus
                placeholder="مثلاً: اعتذرت له ووعدته إن المحاضر الجديد يبدأ الأسبوع الجاي"
                className="mt-1 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </label>
            <p className="text-[11px] text-slate-500">بيتسجل على المشكلة وفي ملف العميل باسمك.</p>
            <div className="flex gap-2">
              <button type="button" disabled={saving || !said.trim()} onClick={() => void save()}
                className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                {saving ? 'جارى الحفظ…' : 'سجّل'}
              </button>
              <button type="button" onClick={() => setChannel(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">إلغاء</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
