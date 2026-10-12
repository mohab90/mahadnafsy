import { useEffect, useMemo, useState } from 'react';
import { Loader2, Save, ShieldAlert } from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import type { NotifyFn } from '../../../types';

/**
 * «صلاحية الحذف» — who, besides the owner, may delete anything.
 *
 * The owner, 12 Oct 2026: «شيل من صلاحيات اي شخص غير المدير وليد وحازم ومهاب
 * الحذف اي ما كان سواء نشوى او خلود حذف عميل او حذف موظف او حذف حتي شخص منضم».
 *
 * Until the owner saves here, the list is whoever's name is Walid, Hazem or
 * Mohab, so the rule held from the deploy. Once saved, only the ticked people
 * count. The server enforces it (api/lib/deleteRights.js); this card only
 * writes the list, and only the owner sees it.
 */

type StaffRow = { id: string; name: string; role: string; allowed: boolean };
type View = { saved: boolean; staffIds: string[]; staff: StaffRow[] };

const ROLE_LABELS: Record<string, string> = {
  admin: 'مدير النظام', manager: 'مدير عام', online_manager: 'مدير الأونلاين', daqqi_manager: 'مدير الدقي',
  tagamoa_manager: 'مدير التجمع', sales_collection_manager: 'مدير المبيعات والتحصيل', hr: 'موارد بشرية',
  accountant: 'محاسب', sales: 'مبيعات', collection: 'تحصيل', support: 'خدمة عملاء',
};

export default function DeleteRightsPanel({ notify }: { notify: NotifyFn }) {
  const [view, setView] = useState<View | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/delete-rights', { credentials: 'include', headers: adminAuthHeaders() })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'مقدرناش نجيب قائمة الحذف');
        return body as View;
      })
      .then(body => { if (!cancelled) { setView(body); setChosen(new Set(body.staffIds)); } })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'مقدرناش نجيب قائمة الحذف'); });
    return () => { cancelled = true; };
  }, []);

  const changed = useMemo(() => {
    if (!view) return false;
    const before = new Set(view.staffIds);
    return before.size !== chosen.size || [...chosen].some(id => !before.has(id)) || !view.saved;
  }, [view, chosen]);

  const toggle = (id: string) => setChosen(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/delete-rights', {
        method: 'PUT',
        credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify({ staffIds: [...chosen] }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'الحفظ مانجحش');
      setView(body as View);
      setChosen(new Set((body as View).staffIds));
      notify('success', 'اتحفظت صلاحية الحذف — اللي مش متعلّم عليه مش هيقدر يمسح حاجة');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'الحفظ مانجحش');
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" dir="rtl">{error}</p>;
  }
  if (!view) {
    return <div className="flex items-center gap-2 p-6 text-sm text-gray-500" dir="rtl"><Loader2 size={16} className="animate-spin" /> بنحمّل…</div>;
  }

  return (
    <div className="space-y-4 rounded-2xl border border-red-100 bg-white p-5 shadow-sm" dir="rtl">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900"><ShieldAlert size={20} className="text-red-600" /> صلاحية الحذف</h2>
        <p className="mt-1 text-sm text-gray-600">
          محدش يقدر يمسح أي حاجة — عميل، موظف، متقدم، دفعة، ليد… — غيرك وغير اللي متعلّم عليهم هنا، مهما كانت وظيفته أو صلاحياته.
        </p>
        {!view.saved && (
          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            لسه ماتحفظتش: دلوقتي المسموح لهم هم اللي اسمهم وليد أو حازم أو مهاب. أول ما تحفظ، القائمة دي بس هي اللي بتتحسب.
          </p>
        )}
      </div>

      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
        {view.staff.map(row => (
          <li key={row.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50">
              <input type="checkbox" checked={chosen.has(row.id)} onChange={() => toggle(row.id)} className="h-4 w-4 accent-red-600" />
              <span className="flex-1 text-sm font-semibold text-gray-800">{row.name}</span>
              <span className="text-xs text-gray-400">{ROLE_LABELS[row.role] || row.role}</span>
            </label>
          </li>
        ))}
        {view.staff.length === 0 && <li className="px-3 py-4 text-sm text-gray-500">مفيش موظفين نشطين.</li>}
      </ul>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-gray-500">{chosen.size} مسموح لهم بالحذف (وإنت دايمًا)</span>
        <button type="button" onClick={() => void save()} disabled={saving || !changed}
          className="flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-40">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} حفظ
        </button>
      </div>
    </div>
  );
}
