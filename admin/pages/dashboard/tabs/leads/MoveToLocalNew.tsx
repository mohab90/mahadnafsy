import { useState } from 'react';
import { Inbox } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { arabicReason } from '../../../../lib/apiErrorText';
import { confirmDialog } from '../../../../../shared/ui/confirmDialog';
import { useToast } from '../../../../../shared/ui/Toast';

/**
 * «محتاج من صفحة الجدول او صفحة محلي قديم اقدر اوّل داتا لمحلي جديد واقدر احولها عميل
 * عميل او دفعة كاملة» (13 Oct 2026): from the data table or «محلي قديم», leads go back
 * to «محلي جديد» — the ones ticked in the selection bar (the whole-batch block above the
 * table was taken away on 14 Oct 2026: «محتاجك تشيله»). POST
 * /api/admin/leads/move-to-local-new: an archive lead gets its earlier source back,
 * a lead on the table is taken from its rep, a hidden or archived one is shown again.
 */
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
