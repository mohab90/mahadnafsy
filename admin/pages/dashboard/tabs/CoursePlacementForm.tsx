import { useMemo, useState } from 'react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { useStaticData } from '../../../context/siteDataSlices';
import { clientItems } from '../../../lib/agreedPrice';
import { clientCurrency } from './onlineClientsUtils';
import { itemBranch, PLACEMENT_BRANCHES } from '../../../lib/coursePlacement';
import type { SubscriberItem } from '../../../types';

// «لو العميل بيحضر كورس اونلاين وكورس حضور محتاجين نقدر نقسم العميل بين الفروع، وفي زر تحويل اونلاين ممكن يبقى
// في تحويل جزئي لكورس معين مش لكل كورسات العميل او العكس» (15 Oct 2026). Each course (or track) of the client is
// put in the branch it is studied at; the client stays one file, and each branch lists them with only its own
// courses (lib/coursePlacement.ts). «فرع العميل» puts a course back where the client belongs.
const OWN = '__own__';
const branchName = (branch?: string | null) => PLACEMENT_BRANCHES.find(([key]) => key === branch)?.[1] || branch || '—';

export function CoursePlacementForm({ row, onBack, onDone }: {
  row: SubscriberItem;
  onBack: () => void;
  onDone: (type: 'success' | 'error', text: string, changed: boolean) => void;
}) {
  const { courses, bundles } = useStaticData();
  const items = useMemo(() => clientItems(row, courses, bundles, clientCurrency(row)), [row, courses, bundles]);
  const [chosen, setChosen] = useState<Record<string, string>>(() => Object.fromEntries(items.map(item => [item.item, (row.coursePlacements || {})[item.item] || OWN])));
  const [saving, setSaving] = useState(false);

  const changes = items.filter(item => chosen[item.item] !== ((row.coursePlacements || {})[item.item] || OWN));

  const save = async () => {
    setSaving(true);
    try {
      for (const item of changes) {
        const target = chosen[item.item];
        await mysqlAdmin.adminPut(`/admin/subscribers/${encodeURIComponent(row.id)}/course-branch`, { item: item.item, branch: target === OWN ? null : target });
      }
      onDone('success', `✅ اتحدّث توزيع كورسات ${row.name} على الفروع`, true);
    } catch (error) {
      onDone('error', error instanceof Error ? error.message : 'تعذّر تحويل الكورس', changes.length > 0);
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
        العميل بيفضل ملف واحد. كل كورس تحدد له الفرع اللي بيدرس فيه، وكل فرع بيشوف العميل بكورساته هو بس. الفلوس بتتحسب على فرع كل دفعة.
        فرع العميل الأساسي: <b>{branchName(row.branch)}</b>.
      </p>
      {items.length === 0 ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">العميل ده مالوش كورسات مسجّلة لسه.</p>
      ) : items.map(item => (
        <label key={item.item} className="block rounded-xl border border-gray-200 p-3">
          <span className="mb-1 block text-sm font-bold text-gray-800">{item.isTrack ? '📌 ' : '🎓 '}{item.title}</span>
          <span className="mb-1 block text-[11px] text-gray-500">دلوقتي في: {branchName(itemBranch(row, item.item))}</span>
          <select value={chosen[item.item] || OWN} onChange={event => setChosen(current => ({ ...current, [item.item]: event.target.value }))}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold">
            <option value={OWN}>↩️ فرع العميل ({branchName(row.branch)})</option>
            {PLACEMENT_BRANCHES.filter(([key]) => key !== row.branch).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={onBack} className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">رجوع</button>
        <button disabled={saving || changes.length === 0} onClick={() => void save()}
          className="flex-1 rounded-xl bg-teal-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-teal-700 disabled:opacity-50">
          {saving ? '⏳...' : `حفظ التوزيع${changes.length ? ` (${changes.length})` : ''}`}
        </button>
      </div>
    </div>
  );
}
