import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Clock, Phone, Send, UserRound } from 'lucide-react';
import { Modal } from '../../../shared/ui/Modal';
import { cairoDateTime, cairoDateTimeInput, cairoInputToUtc } from '../../../shared/cairoDate';
import { mysqlAdmin } from '../../lib/mysqlapi';
import { commTypeMeta } from './constants';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

/** One contact, from GET /api/staff/subscribers/:id/communications. */
export type ContactEntry = {
  id: string; type: string; date: string; notes: string; outcome: string | null; nextFollowUp: string | null;
  staffName: string | null; stage: 'client' | 'lead'; direction: 'out' | 'in';
};

const CONTACT_TYPES = ['call', 'whatsapp', 'meeting', 'payment_followup', 'note'] as const;
const OUTCOMES = ['رد وهيدفع', 'رد ومحتاج متابعة', 'مردش', 'الرقم مقفول', 'طلب يتكلم بعدين', 'اتحلت المشكلة'];

export function useClientContacts(subscriberId: string | null | undefined) {
  const [entries, setEntries] = useState<ContactEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!subscriberId) return;
    setLoading(true);
    try {
      const rows = await mysqlAdmin.adminGet<ContactEntry[]>(`/staff/subscribers/${encodeURIComponent(subscriberId)}/communications`);
      setEntries(Array.isArray(rows) ? rows : []);
    } catch { setEntries([]); } finally { setLoading(false); }
  }, [subscriberId]);
  useEffect(() => { void reload(); }, [reload]);
  return { entries, loading, reload };
}

/**
 * The history of a client's contacts as a timeline: who spoke to them, when,
 * how, and what was said — the contacts made while they were a lead included.
 */
export function ContactTimeline({ entries, loading, compact = false }: { entries: ContactEntry[]; loading: boolean; compact?: boolean }) {
  if (loading && !entries.length) return <p className="py-6 text-center text-xs text-gray-400">جاري التحميل…</p>;
  if (!entries.length) return <p className="py-6 text-center text-xs text-gray-400">لسه مفيش أي تواصل متسجل مع العميل ده.</p>;
  return (
    <ol className={`relative space-y-3 border-r-2 border-gray-100 pr-5 ${compact ? 'max-h-64 overflow-y-auto' : ''}`}>
      {entries.map(entry => {
        const meta = commTypeMeta[entry.type] || commTypeMeta.note;
        return (
          <li key={entry.id} className="relative">
            <span className={`absolute -right-[31px] top-1 grid h-6 w-6 place-items-center rounded-full border-2 border-white text-[11px] shadow-sm ${meta.color}`}>{meta.icon}</span>
            <div className="rounded-xl border border-gray-100 bg-white px-3 py-2 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                <span className="flex items-center gap-1 font-extrabold text-gray-800"><UserRound size={11} className="text-gray-400" />{entry.staffName || 'غير مسجّل'}</span>
                <span className={`rounded-full px-1.5 py-0.5 font-bold ${meta.color}`}>{meta.label}</span>
                {entry.stage === 'lead' && <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-gray-500">وهو عميل محتمل</span>}
                {entry.direction === 'in' && <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-sky-700">وارد</span>}
                <span className="mr-auto text-gray-400">{cairoDateTime(entry.date)}</span>
              </div>
              {entry.notes && <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{entry.notes}</p>}
              {entry.outcome && <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-emerald-700"><CheckCircle size={11} /> {entry.outcome}</p>}
              {entry.nextFollowUp && <p className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-orange-700"><Clock size={11} /> المتابعة الجاية: {String(entry.nextFollowUp).slice(0, 10)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * «تواصل» — record a contact where the client is, with the history beside it.
 * The online table's button opened the client page instead.
 */
export function ClientContactDialog({ subscriber, notify, onClose, onSaved }: {
  subscriber: { id: string; name: string };
  notify: Notify;
  onClose: () => void;
  onSaved?: (entry: ContactEntry & { staffId?: string | null }, updatedAt?: string) => void;
}) {
  const { entries, loading, reload } = useClientContacts(subscriber.id);
  const [draft, setDraft] = useState({ type: 'call', date: cairoDateTimeInput(), notes: '', outcome: '', nextFollowUp: '' });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!draft.notes.trim()) return;
    setSaving(true);
    try {
      const result = await mysqlAdmin.adminPost<{ communication: ContactEntry; updatedAt?: string }>(
        `/staff/subscribers/${encodeURIComponent(subscriber.id)}/communications`,
        { ...draft, date: cairoInputToUtc(draft.date), nextFollowUp: draft.nextFollowUp || undefined, outcome: draft.outcome || undefined },
      );
      notify('success', 'اتسجل التواصل');
      setDraft(d => ({ ...d, notes: '', outcome: '', nextFollowUp: '', date: cairoDateTimeInput() }));
      onSaved?.(result.communication, result.updatedAt);
      await reload();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تسجيل التواصل');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} size="md" title={`تواصل مع ${subscriber.name}`} icon={<Phone size={16} />} subtitle="سجّل التواصل — بيتكتب باسمك ووقته">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-1.5">
          {CONTACT_TYPES.map(type => (
            <button key={type} type="button" onClick={() => setDraft(d => ({ ...d, type }))}
              className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition ${draft.type === type ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300'}`}>
              {commTypeMeta[type]?.icon} {commTypeMeta[type]?.label}
            </button>
          ))}
        </div>
        <textarea value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} rows={3}
          placeholder="اتقال إيه؟ (مطلوب)" className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="block"><span className="mb-1 block text-[11px] font-bold text-gray-500">النتيجة</span>
            <select value={draft.outcome} onChange={e => setDraft(d => ({ ...d, outcome: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-2 py-2">
              <option value="">—</option>
              {OUTCOMES.map(outcome => <option key={outcome} value={outcome}>{outcome}</option>)}
            </select></label>
          <label className="block"><span className="mb-1 block text-[11px] font-bold text-gray-500">وقت التواصل</span>
            <input type="datetime-local" value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-2 py-2" /></label>
          <label className="block"><span className="mb-1 block text-[11px] font-bold text-gray-500">المتابعة الجاية</span>
            <input type="date" value={draft.nextFollowUp} onChange={e => setDraft(d => ({ ...d, nextFollowUp: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-2 py-2" /></label>
        </div>
        <button type="button" disabled={saving || !draft.notes.trim()} onClick={() => void save()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 font-bold text-white hover:bg-blue-700 disabled:opacity-50">
          <Send size={14} /> {saving ? 'جارٍ الحفظ…' : 'سجّل التواصل'}
        </button>
        <div>
          <h4 className="mb-2 text-xs font-extrabold text-gray-500">التواصل اللي فات ({entries.length})</h4>
          <ContactTimeline entries={entries} loading={loading} compact />
        </div>
      </div>
    </Modal>
  );
}

/** The client page's «التواصل» tab for a client: the timeline, and a way to add to it. */
export function ClientContactsPanel({ subscriber, notify, dialogOpen, setDialogOpen }: {
  subscriber: { id: string; name: string };
  notify: Notify;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
}) {
  const { entries, loading, reload } = useClientContacts(subscriber.id);
  return (
    <div id="section-communications" className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-5 w-1 flex-shrink-0 rounded-full bg-blue-500" />
        <h3 className="flex flex-1 items-center gap-2 text-sm font-extrabold text-gray-800"><Phone size={14} className="text-blue-500" /> سجل التواصل</h3>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-400">{entries.length}</span>
      </div>
      <button type="button" onClick={() => setDialogOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-200 py-3 text-sm text-blue-600 hover:border-blue-400 hover:bg-blue-50">
        <Phone size={16} /> تسجيل تواصل جديد
      </button>
      <ContactTimeline entries={entries} loading={loading} />
      {dialogOpen && (
        <ClientContactDialog subscriber={subscriber} notify={notify} onClose={() => { setDialogOpen(false); void reload(); }} onSaved={() => void reload()} />
      )}
    </div>
  );
}
