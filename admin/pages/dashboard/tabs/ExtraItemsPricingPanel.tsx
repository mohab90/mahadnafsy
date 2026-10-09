import { useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useStaticData } from '../../../context/siteDataSlices';
import { EXTRA_ITEMS_KEY, EXTRA_KIND_LABEL, parseExtraItems, type ExtraItem, type ExtraItemKind, type ExtraItemsMap } from '../../../lib/extraItemsCatalog';

// The carnets and books on offer and their prices, beside the certificates'
// (lib/extraItemsCatalog.ts): as many of each as the institute sells.
export function ExtraItemsPricingPanel({ notify }: { notify: (type: 'success' | 'error' | 'info', text: string) => void }) {
  const { content, setContentValue } = useStaticData();
  const [items, setItems] = useState<ExtraItemsMap>(() => parseExtraItems(content[EXTRA_ITEMS_KEY]));
  const [saving, setSaving] = useState(false);

  const update = (kind: ExtraItemKind, index: number, patch: Partial<ExtraItem>) =>
    setItems(current => ({ ...current, [kind]: current[kind].map((item, i) => (i === index ? { ...item, ...patch } : item)) }));
  const add = (kind: ExtraItemKind) =>
    setItems(current => ({ ...current, [kind]: [...current[kind], { id: `${kind}-${Date.now()}`, label: '', priceEGP: 0, priceSAR: 0, priceUSD: 0 }] }));
  const remove = (kind: ExtraItemKind, index: number) =>
    setItems(current => ({ ...current, [kind]: current[kind].filter((_, i) => i !== index) }));

  const save = async () => {
    const clean = (list: ExtraItem[]) => list.filter(item => item.label.trim()).map(item => ({ ...item, label: item.label.trim() }));
    setSaving(true);
    try {
      const saved = await setContentValue(EXTRA_ITEMS_KEY, JSON.stringify({ carnets: clean(items.carnets), books: clean(items.books) }));
      notify(saved ? 'success' : 'error', saved ? 'اتحفظت أسعار الكارنيهات والكتب' : 'تعذر الحفظ');
    } catch {
      notify('error', 'تعذر الحفظ');
    } finally { setSaving(false); }
  };

  const field = 'w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-200';
  return (
    <article className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-gray-900">الكارنيهات والكتب</h3>
        <button onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1 rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50">
          <Save size={13} /> {saving ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
      </div>
      <p className="text-xs text-gray-500">لما العميل يطلب واحد منهم ويدفعه، الطلب بيظهر باسمه في «طلبات إضافية».</p>
      {(Object.keys(EXTRA_KIND_LABEL) as ExtraItemKind[]).map(kind => (
        <section key={kind} className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-gray-700">{EXTRA_KIND_LABEL[kind]}</h4>
            <button onClick={() => add(kind)} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-100">
              <Plus size={11} /> إضافة {kind === 'carnets' ? 'كارنيه' : 'كتاب'}
            </button>
          </div>
          {items[kind].length === 0 ? <p className="text-xs text-gray-400">لسه مفيش.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead className="text-gray-500"><tr><th className="py-1 text-right">الاسم</th><th className="py-1 text-right">ج.م</th><th className="py-1 text-right">ر.س</th><th className="py-1 text-right">$</th><th /></tr></thead>
                <tbody>
                  {items[kind].map((item, index) => (
                    <tr key={item.id}>
                      <td className="py-1 pl-2"><input value={item.label} onChange={event => update(kind, index, { label: event.target.value })} placeholder={kind === 'carnets' ? 'مثلاً: كارنيه النقابة' : 'مثلاً: كتاب العلاج المعرفي'} className={field} /></td>
                      {(['priceEGP', 'priceSAR', 'priceUSD'] as const).map(key => (
                        <td key={key} className="w-24 py-1 pl-2"><input type="number" min={0} value={item[key] || ''} onChange={event => update(kind, index, { [key]: Number(event.target.value) || 0 })} className={field} /></td>
                      ))}
                      <td className="w-8 py-1"><button onClick={() => remove(kind, index)} title="حذف" className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 size={13} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </article>
  );
}
