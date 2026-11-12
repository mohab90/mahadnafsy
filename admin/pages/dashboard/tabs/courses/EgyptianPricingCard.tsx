import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface OwnerRow {
  type: 'course' | 'bundle';
  id: string;
  title: string;
  published: boolean;
  egyptian: number | null;
  foreign: number | null;
  egyptianOffer: number | null;
  foreignOffer: number | null;
  /** No non-Egyptian price above the Egyptian one: the site shows this item exactly as before. */
  unpriced: boolean;
}
interface State { settings: { enabled: boolean; offerActive: boolean }; items: OwnerRow[] }

const money = (value: number | null) => (value == null ? '—' : value.toLocaleString('ar-EG-u-nu-latn'));

/**
 * «سعر المصريين وغير المصريين» — the two switches for the Egypt site's prices (api/lib/egyptianPricing.js) and, before they are turned on, the
 * list of what the site will print: every course and track with the Egyptian price, the non-Egyptian price (the one visitors will see) and the
 * tiers' discount prices. The prices themselves are edited where they always were: «الأسعار حسب الفرع» in the course and track page.
 */
export function EgyptianPricingCard({ notify }: { notify: NotifyFn }) {
  const [state, setState] = useState<State | null>(null);
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    mysqlAdmin.adminGet<State>('/admin/egyptian-pricing')
      .then(data => { if (alive) setState(data); })
      // Finance / owner only: anyone else simply does not see the card.
      .catch(() => { if (alive) setHidden(true); });
    return () => { alive = false; };
  }, []);

  if (hidden) return null;
  if (!state) return <div className="bg-white rounded-2xl border border-gray-200 p-5 text-sm text-gray-500"><Loader2 size={16} className="inline animate-spin" /> جاري التحميل…</div>;

  const save = async (next: { enabled: boolean; offerActive: boolean }) => {
    setSaving(true);
    try {
      const res = await mysqlAdmin.adminPut<{ ok: boolean; settings: State['settings'] }>('/admin/egyptian-pricing', next);
      setState(current => (current ? { ...current, settings: res.settings } : current));
      notify('success', next.enabled ? 'اتفعّل سعر المصريين وغير المصريين على الموقع' : 'اتقفل — الموقع رجع للأسعار زي ما هي');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const { enabled, offerActive } = state.settings;
  const unpriced = state.items.filter(row => row.unpriced && row.published).length;
  const example = state.items.find(row => !row.unpriced && row.published);

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4" dir="rtl" aria-labelledby="egyptian-pricing-title">
      <div>
        <h3 id="egyptian-pricing-title" className="text-lg font-extrabold text-gray-900">سعر المصريين وغير المصريين (موقع مصر)</h3>
        <p className="text-sm text-gray-600 mt-1">
          لما تشغّله، الموقع بيعرض سعر «غير المصريين المقيمين في مصر» لكل كورس ومسار ليه سعر ده، ومن يكتب رقمه القومي بيدفع سعر «المصريين».
          الكورس اللي مالوش سعر غير مصريين بيفضل زي ما هو. الأسعار بتتحط من صفحة الكورس ← الأسعار حسب الفرع.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-start gap-3 rounded-xl border border-gray-200 p-3 cursor-pointer">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={enabled} disabled={saving}
            onChange={event => void save({ enabled: event.target.checked, offerActive })} />
          <span>
            <b className="block text-gray-900">تشغيل سعر المصريين وغير المصريين</b>
            <span className="text-xs text-gray-500">مقفول = الموقع والحجز زي ما هم بالظبط.</span>
          </span>
        </label>
        <label className={`flex items-start gap-3 rounded-xl border border-gray-200 p-3 ${enabled ? 'cursor-pointer' : 'opacity-50'}`}>
          <input type="checkbox" className="mt-1 h-5 w-5" checked={offerActive} disabled={saving || !enabled}
            onChange={event => void save({ enabled, offerActive: event.target.checked })} />
          <span>
            <b className="block text-gray-900">العرض شغّال (سعر الخصم)</b>
            <span className="text-xs text-gray-500">بيظهر سعر الخصم لكل فئة: غير المصريين ←  سعر خصمهم، والمصريين ← سعر خصمهم. مقفول = ما بيظهرش.</span>
          </span>
        </label>
      </div>

      {example && (
        <p className="text-sm text-gray-700">
          مثال: «{example.title}» — سعر المصري <b className="tabular-nums">{money(example.egyptian)}</b> ← سعر غير المصريين <b className="tabular-nums">{money(example.foreign)}</b> ج.م
        </p>
      )}
      {unpriced > 0 && <p className="text-sm font-bold text-amber-700">{unpriced} كورس/مسار منشور مالوش سعر غير مصريين — هيظهر بسعره الحالي للكل.</p>}

      <details>
        <summary className="cursor-pointer text-sm font-bold text-teal-700">إيه اللي هيظهر على الموقع (قائمة كل الكورسات والمسارات)</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-gray-500 border-b">
                <th className="py-2 pe-3">الكورس / المسار</th>
                <th className="py-2 pe-3">سعر المصريين</th>
                <th className="py-2 pe-3">سعر غير المصريين</th>
                <th className="py-2 pe-3">خصم المصريين (عرض)</th>
                <th className="py-2 pe-3">خصم غير المصريين (عرض)</th>
                <th className="py-2">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map(row => (
                <tr key={`${row.type}:${row.id}`} className={`border-b last:border-0 ${row.unpriced ? 'bg-amber-50' : ''}`}>
                  <td className="py-2 pe-3 font-bold text-gray-900">{row.title}{row.type === 'bundle' ? ' (مسار)' : ''}{row.published ? '' : ' — غير منشور'}</td>
                  <td className="py-2 pe-3 tabular-nums">{money(row.egyptian)}</td>
                  <td className="py-2 pe-3 tabular-nums">{money(row.foreign)}</td>
                  <td className="py-2 pe-3 tabular-nums">{money(row.egyptianOffer)}</td>
                  <td className="py-2 pe-3 tabular-nums">{money(row.foreignOffer)}</td>
                  <td className="py-2">{row.unpriced ? 'مالوش سعر غير مصريين' : 'جاهز'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
