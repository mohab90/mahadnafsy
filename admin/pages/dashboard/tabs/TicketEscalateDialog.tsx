import { useState } from 'react';
import { Modal } from '../../../../shared/ui/Modal';
import { mysqlAdmin } from '../../../lib/mysqlapi';

// «لما عملت تصعيد للادارة ايه اللي حصل؟ … محتاجين يكون عند الادارة 2 اشعار واحد للحاجات
// المهمة جدا وواحد للحاجات المكررة ويبقى في فرق بينهم» (14 Oct 2026). The two kinds the
// administration is told apart by (api/lib/ticketEscalation.js); the server also marks it
// «متكررة» on its own when this client has raised the same kind of problem again.
const KINDS = [
  { key: 'critical', icon: '🚨', label: 'مهم جدا', hint: 'مش هتستنى — الأولوية بتبقى عاجلة وبيوصل للإدارة بإشعار أحمر', tone: 'border-red-400 bg-red-50 text-red-800' },
  { key: 'repeated', icon: '🔁', label: 'متكررة', hint: 'نفس العميل بيرجع بنفس المشكلة — الإدارة تشوف السبب الجذرى', tone: 'border-violet-400 bg-violet-50 text-violet-800' },
] as const;

export function TicketEscalateDialog({ ticketId, title, onClose, onDone, onError }: {
  ticketId: string;
  title: string;
  onClose: () => void;
  onDone: (kind: string, repeats: number) => void;
  onError: (text: string) => void;
}) {
  const [kind, setKind] = useState<'critical' | 'repeated'>('critical');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const send = async () => {
    setSaving(true);
    try {
      const answer = await mysqlAdmin.adminPost<{ kind: string; repeats: number }>(
        `/admin/tickets/${encodeURIComponent(ticketId)}/escalate`, { reason: reason.trim(), kind });
      onDone(answer?.kind || kind, Number(answer?.repeats) || 0);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'تعذر التصعيد');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="تصعيد للإدارة" subtitle={title} layer="over" size="sm">
      <div className="space-y-3 p-5" dir="rtl">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="نوع التصعيد">
          {KINDS.map(item => (
            <button key={item.key} type="button" role="radio" aria-checked={kind === item.key} onClick={() => setKind(item.key)}
              className={`rounded-xl border-2 p-3 text-right transition ${kind === item.key ? `${item.tone} ring-2 ring-offset-1 ring-sky-300` : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              <span className="block text-sm font-extrabold">{item.icon} {item.label}</span>
              <span className="mt-1 block text-[11px] font-normal leading-snug opacity-80">{item.hint}</span>
            </button>
          ))}
        </div>
        <label className="block text-xs font-bold text-slate-600">
          السبب <span className="text-red-500">*</span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} autoFocus
            placeholder="ليه الإدارة لازم تتدخل؟"
            className="mt-1 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <div className="flex gap-2">
          <button type="button" disabled={saving || !reason.trim()} onClick={() => void send()}
            className="flex-1 rounded-xl bg-purple-600 px-3 py-2 text-sm font-bold text-white hover:bg-purple-700 disabled:opacity-50">
            {saving ? 'جارى التصعيد…' : 'صعّد للإدارة'}
          </button>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">إلغاء</button>
        </div>
      </div>
    </Modal>
  );
}
