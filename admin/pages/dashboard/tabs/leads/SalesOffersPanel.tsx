import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgePercent, Gift, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';
import { BRANCH_LABELS_AR } from '../../../../constants/branches';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;

export type SalesOffer = {
  id: string;
  title: string;
  description: string | null;
  kind: 'discount' | 'bonus';
  valueType: 'percent' | 'amount';
  value: number;
  scopeType: 'course' | 'all_courses' | 'bundle' | 'all_bundles' | 'branch';
  scopeId: string | null;
  startsOn: string | null;
  endsOn: string | null;
  isActive: boolean;
};

type Catalog = {
  courses: { id: string; title: string }[];
  bundles: { id: string; title: string }[];
  branchOptions: { id: string; label: string }[];
};

const SCOPE_LABELS: Record<SalesOffer['scopeType'], string> = {
  course: 'كورس محدد',
  all_courses: 'كل الكورسات',
  bundle: 'باقة محددة',
  all_bundles: 'كل الباقات',
  branch: 'فرع محدد',
};

const emptyDraft = () => ({
  id: '', title: '', description: '',
  kind: 'discount' as SalesOffer['kind'],
  valueType: 'percent' as SalesOffer['valueType'],
  value: '', scopeType: 'all_courses' as SalesOffer['scopeType'], scopeId: '',
  startsOn: '', endsOn: '', isActive: true,
});

export const offerValueLabel = (offer: SalesOffer) =>
  offer.valueType === 'percent'
    ? `${offer.value}%`
    : `${Number(offer.value).toLocaleString('ar-EG')} ج.م`;

export function offerScopeLabel(offer: SalesOffer, catalog: Catalog): string {
  if (offer.scopeType === 'course') {
    return catalog.courses.find(c => c.id === offer.scopeId)?.title || 'كورس';
  }
  if (offer.scopeType === 'bundle') {
    return catalog.bundles.find(b => b.id === offer.scopeId)?.title || 'باقة';
  }
  if (offer.scopeType === 'branch') {
    return BRANCH_LABELS_AR[offer.scopeId as keyof typeof BRANCH_LABELS_AR]
      || catalog.branchOptions.find(b => b.id === offer.scopeId)?.label
      || 'فرع';
  }
  return SCOPE_LABELS[offer.scopeType];
}

/**
 * One offer, rendered as something a rep actually wants to look at. A discount
 * and a bonus read differently on purpose — a discount is what the customer
 * gets, a bonus is what the rep gets — so they do not share a colour.
 */
export function OfferCard({ offer, catalog, onDelete }: {
  offer: SalesOffer; catalog: Catalog; onDelete?: (id: string) => void;
}) {
  const discount = offer.kind === 'discount';
  const daysLeft = offer.endsOn
    ? Math.ceil((new Date(`${offer.endsOn}T23:59:59`).getTime() - Date.now()) / 86400000)
    : null;
  return (
    <div className={`relative overflow-hidden rounded-2xl p-4 text-white shadow-sm bg-gradient-to-l ${
      discount ? 'from-emerald-500 to-teal-600' : 'from-amber-500 to-orange-600'}`}>
      <div className="pointer-events-none absolute -top-12 left-4 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
      <div className="relative z-10 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/20">
          {discount ? <BadgePercent size={18} /> : <Gift size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-extrabold">
              {discount ? 'خصم للعميل' : 'مكافأة للمندوب'}
            </span>
            <span className="text-2xl font-black leading-none">{offerValueLabel(offer)}</span>
          </div>
          <p className="mt-1 text-sm font-extrabold leading-tight">{offer.title}</p>
          {offer.description && (
            <p className="mt-0.5 text-xs leading-relaxed text-white/85">{offer.description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
            <span className="rounded-full bg-white/20 px-2 py-0.5">{offerScopeLabel(offer, catalog)}</span>
            {daysLeft !== null && daysLeft >= 0 && (
              <span className="rounded-full bg-white/20 px-2 py-0.5">
                {daysLeft === 0 ? 'آخر يوم' : `باقي ${daysLeft} يوم`}
              </span>
            )}
            {daysLeft !== null && daysLeft < 0 && (
              <span className="rounded-full bg-black/25 px-2 py-0.5">منتهي</span>
            )}
            {!offer.isActive && <span className="rounded-full bg-black/25 px-2 py-0.5">موقوف</span>}
          </div>
        </div>
        {onDelete && (
          <button type="button" onClick={() => onDelete(offer.id)}
            className="rounded-lg bg-white/20 p-1.5 hover:bg-white/30 transition" title="حذف العرض">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Compact strip for the sales home page — active offers only. */
export function SalesOffersStrip({ offers, catalog }: { offers: SalesOffer[]; catalog: Catalog }) {
  if (offers.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-extrabold text-gray-800">
        <Sparkles size={15} className="text-amber-500" /> عروض متاحة لك الآن
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
          {offers.length}
        </span>
      </h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {offers.map(offer => <OfferCard key={offer.id} offer={offer} catalog={catalog} />)}
      </div>
    </div>
  );
}

export default function SalesOffersPanel({
  courses, bundles, branchOptions, canManage, notify,
}: Catalog & { canManage: boolean; notify: Notify }) {
  const catalog = useMemo<Catalog>(() => ({ courses, bundles, branchOptions }), [courses, bundles, branchOptions]);
  const [offers, setOffers] = useState<SalesOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/sales-offers', { credentials: 'include', headers: adminAuthHeaders() });
      setOffers(r.ok ? await r.json() : []);
    } catch { setOffers([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const scopeNeedsId = ['course', 'bundle', 'branch'].includes(draft.scopeType);
  const scopeChoices = draft.scopeType === 'course' ? courses.map(c => ({ id: c.id, label: c.title }))
    : draft.scopeType === 'bundle' ? bundles.map(b => ({ id: b.id, label: b.title }))
      : draft.scopeType === 'branch' ? branchOptions
        : [];

  const save = async () => {
    if (!draft.title.trim()) { notify('error', 'اكتب عنوان العرض'); return; }
    if (!Number(draft.value)) { notify('error', 'اكتب قيمة العرض'); return; }
    if (scopeNeedsId && !draft.scopeId) { notify('error', 'اختر العنصر الذي ينطبق عليه العرض'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/admin/sales-offers', {
        method: 'POST', credentials: 'include', headers: adminAuthHeaders(true),
        body: JSON.stringify({ ...draft, value: Number(draft.value), id: draft.id || undefined }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'تعذر حفظ العرض');
      setShowForm(false);
      setDraft(emptyDraft());
      await load();
      notify('success', 'تم نشر العرض لفريق المبيعات');
    } catch (e) { notify('error', (e as Error).message); } finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    try {
      const r = await fetch(`/api/admin/sales-offers/${id}`, {
        method: 'DELETE', credentials: 'include', headers: adminAuthHeaders(),
      });
      if (!r.ok) throw new Error('تعذر الحذف');
      await load();
      notify('success', 'تم حذف العرض');
    } catch (e) { notify('error', (e as Error).message); }
  };

  const active = offers.filter(o => o.isActive
    && (!o.endsOn || o.endsOn >= new Date().toISOString().slice(0, 10)));
  const inactive = offers.filter(o => !active.includes(o));

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="flex items-center gap-2 font-extrabold text-gray-900">
          <Sparkles size={17} className="text-amber-500" /> العروض
          <span className="text-xs font-normal text-gray-400">
            {canManage ? 'العرض اللي تنشره يظهر لكل فريق المبيعات' : 'عروض متاحة لك من الإدارة'}
          </span>
        </h3>
        {canManage && (
          <button type="button" onClick={() => { setDraft(emptyDraft()); setShowForm(v => !v); }}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 transition">
            {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? 'إلغاء' : 'عرض جديد'}
          </button>
        )}
      </div>

      {canManage && showForm && (
        <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-bold text-gray-600">عنوان العرض</label>
              <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                placeholder="مثال: خصم بداية الترم على دبلومة CBT"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-gray-600">نوع العرض</label>
              <select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as SalesOffer['kind'] }))}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                <option value="discount">خصم من سعر الكورس (للعميل)</option>
                <option value="bonus">مكافأة / زيادة (للمندوب)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-gray-600">القيمة</label>
              <div className="flex gap-2">
                <input type="number" min="0" value={draft.value}
                  onChange={e => setDraft(d => ({ ...d, value: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
                <select value={draft.valueType}
                  onChange={e => setDraft(d => ({ ...d, valueType: e.target.value as SalesOffer['valueType'] }))}
                  className="rounded-xl border border-gray-200 bg-white px-2 py-2 text-sm font-bold">
                  <option value="percent">%</option>
                  <option value="amount">ج.م</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-gray-600">ينطبق على</label>
              <select value={draft.scopeType}
                onChange={e => setDraft(d => ({ ...d, scopeType: e.target.value as SalesOffer['scopeType'], scopeId: '' }))}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                {(Object.keys(SCOPE_LABELS) as SalesOffer['scopeType'][]).map(key => (
                  <option key={key} value={key}>{SCOPE_LABELS[key]}</option>
                ))}
              </select>
            </div>
            {scopeNeedsId && (
              <div>
                <label className="mb-1 block text-xs font-bold text-gray-600">اختر</label>
                <select value={draft.scopeId} onChange={e => setDraft(d => ({ ...d, scopeId: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                  <option value="">— اختر —</option>
                  {scopeChoices.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-bold text-gray-600">من تاريخ (اختياري)</label>
              <input type="date" value={draft.startsOn} onChange={e => setDraft(d => ({ ...d, startsOn: e.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-gray-600">إلى تاريخ (اختياري)</label>
              <input type="date" value={draft.endsOn} onChange={e => setDraft(d => ({ ...d, endsOn: e.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-bold text-gray-600">تفاصيل تظهر للمندوب (اختياري)</label>
              <textarea rows={2} value={draft.description}
                onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                className="w-full resize-y rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <button type="button" disabled={saving} onClick={save}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60 transition">
            {saving ? 'جارٍ النشر…' : 'انشر العرض'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-10 text-sm text-gray-400">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          جاري تحميل العروض...
        </div>
      ) : offers.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
          {canManage ? 'لا توجد عروض بعد — انشر أول عرض لفريقك.' : 'لا توجد عروض متاحة حاليًا.'}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {active.map(offer => (
              <OfferCard key={offer.id} offer={offer} catalog={catalog}
                onDelete={canManage ? remove : undefined} />
            ))}
          </div>
          {inactive.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-gray-400">عروض منتهية أو موقوفة</p>
              <div className="grid gap-3 md:grid-cols-2 opacity-60">
                {inactive.map(offer => (
                  <OfferCard key={offer.id} offer={offer} catalog={catalog}
                    onDelete={canManage ? remove : undefined} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
