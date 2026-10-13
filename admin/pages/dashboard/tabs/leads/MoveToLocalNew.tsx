import { useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { arabicReason } from '../../../../lib/apiErrorText';
import { confirmDialog } from '../../../../../shared/ui/confirmDialog';
import { useToast } from '../../../../../shared/ui/Toast';
import type { LeadItem } from '../../../../types';
import { isArchiveSource } from './leadSourceGroups';

/**
 * «محتاج من صفحة الجدول او صفحة محلي قديم اقدر اوّل داتا لمحلي جديد واقدر احولها عميل
 * عميل او دفعة كاملة» (13 Oct 2026): from the data table or «محلي قديم», leads go back
 * to «محلي جديد» — the ones ticked, or a whole batch (a source). POST
 * /api/admin/leads/move-to-local-new: an archive lead gets its earlier source back,
 * a lead on the table is taken from its rep, a hidden or archived one is shown again.
 */
const needsMove = (lead: LeadItem) => isArchiveSource(lead.source) || Boolean(lead.assignedSalesId || lead.assignedCsId);

type Outcome = { moved: number; skipped: number };

async function moveToLocalNew(body: { leadIds?: string[]; source?: string }): Promise<Outcome> {
  const result = await mysqlAdmin.adminPost<{ moved: number; skipped?: number }>('/admin/leads/move-to-local-new', body);
  return { moved: Number(result.moved) || 0, skipped: Number(result.skipped) || 0 };
}

const explain = 'هيرجعوا لتاب «محلي جديد» (أو «دولي جديد» حسب الفرع)، والمندوب بيتشال من عليهم، ومفيش حاجة بتتمسح.';

/** In the bulk bar: the ticked leads, one or many. */
export function MoveSelectedToLocalNew({ selectedIds, reloadLeads, onDone }: {
  selectedIds: string[]; reloadLeads: () => void | Promise<unknown>; onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!await confirmDialog(`نقل ${selectedIds.length} عميل لمحلي جديد؟ ${explain}`)) return;
    setBusy(true);
    try {
      const { moved, skipped } = await moveToLocalNew({ leadIds: selectedIds });
      await reloadLeads();
      toast.show(`اتنقل ${moved} عميل لمحلي جديد${skipped ? ` — ${skipped} اتخطّوا (اتحولوا لعملاء أو برا نطاقك)` : ''}`, moved ? 'success' : 'warning');
      onDone();
    } catch (error) {
      toast.show(arabicReason(error, 'تعذّر النقل لمحلي جديد'), 'error');
    } finally { setBusy(false); }
  };
  return (
    <button type="button" onClick={() => void run()} disabled={busy}
      className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50">
      <Inbox size={14} /> {busy ? 'جاري النقل…' : `نقل المحدد لمحلي جديد (${selectedIds.length})`}
    </button>
  );
}

/** Above the table: a whole batch (every lead of one source) at once. */
export function MoveBatchToLocalNew({ rows, reloadLeads }: { rows: LeadItem[]; reloadLeads: () => void | Promise<unknown> }) {
  const toast = useToast();
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const batches = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of rows) {
      const key = String(lead.source || '').trim();
      if (key && needsMove(lead)) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  if (!batches.length) return null;

  const run = async () => {
    const count = batches.find(([name]) => name === source)?.[1] || 0;
    if (!source || !await confirmDialog(`نقل الدفعة «${source}» كلها (${count} عميل في القايمة دي، وأي حد تاني عليها) لمحلي جديد؟ ${explain}`)) return;
    setBusy(true);
    try {
      const { moved } = await moveToLocalNew({ source });
      await reloadLeads();
      toast.show(`اتنقلت الدفعة «${source}»: ${moved} عميل لمحلي جديد`, moved ? 'success' : 'warning');
      setSource('');
    } catch (error) {
      toast.show(arabicReason(error, 'تعذّر نقل الدفعة'), 'error');
    } finally { setBusy(false); }
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2">
      <Inbox size={15} className="text-indigo-600" />
      <span className="text-xs font-bold text-indigo-900">نقل دفعة كاملة لمحلي جديد:</span>
      <select value={source} onChange={event => setSource(event.target.value)} aria-label="الدفعة"
        className="min-w-[220px] rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs">
        <option value="">اختار الدفعة (المصدر)…</option>
        {batches.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
      </select>
      <button type="button" onClick={() => void run()} disabled={!source || busy}
        className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
        {busy ? 'جاري النقل…' : 'نقل الدفعة'}
      </button>
      <span className="text-[11px] text-gray-500">أو علّم العملاء بنفسك وانقلهم من شريط التحديد.</span>
    </div>
  );
}
