// Learning paths (bundles): the list, and the form that builds one from courses.
//
// Lifted out of CoursesTab.tsx with its own state — twelve drafts and two
// handlers that no other section read. The list, the courses it draws from and
// its writers come from useSiteData here, so notify is the only prop.
//
// The saving flag is its own. CoursesTab's catalogSaving is shared with the
// courses and lectures sections, so saving a course disabled this form.

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useStaticData } from '../../../../context/siteDataSlices';
import type { Bundle } from '../../../../types';
import { uploadImage } from '../../../../lib/uploadImage';
import type { SeoInput } from '../../../../lib/seoScore';
import CatalogPricingPanel from './CatalogPricingPanel';
import SeoScorePanel from './SeoScorePanel';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

export default function BundlesPanel({ notify }: { notify: NotifyFn }) {
  const { bundles, courses, addBundle, updateBundle, deleteBundle, isAdmin } = useStaticData();
  const [saving, setSaving] = useState(false);
  const [editingBundleId, setEditingBundleId] = useState('');
  const [isBundleFormOpen, setIsBundleFormOpen] = useState(false);
  const [bundleTitle, setBundleTitle] = useState('');
  const [bundleTitleEn, setBundleTitleEn] = useState('');
  const [bundleSlug, setBundleSlug] = useState('');
  const [bundleVideoUrl, setBundleVideoUrl] = useState('');
  const [bundleShortDesc, setBundleShortDesc] = useState('');
  const [bundleDescription, setBundleDescription] = useState('');
  const [bundleCourseIds, setBundleCourseIds] = useState<string[]>([]);
  const [bundlePrice, setBundlePrice] = useState({ EGP: 0, SAR: 0, USD: 0 });
  const [bundleOriginalPrice, setBundleOriginalPrice] = useState({ EGP: 0, SAR: 0, USD: 0 });
  const [bundleDetailsJson, setBundleDetailsJson] = useState('{}');
  // The form had no cover or publish field, so saving a track sent an empty
  // cover and is_published=1 — the picture was wiped and a hidden track went live.
  const [bundleThumbnail, setBundleThumbnail] = useState('');
  const [bundlePublished, setBundlePublished] = useState(true);
  const [seo, setSeo] = useState({ title: '', description: '', keywords: '' });

  const resetForm = () => {
    setEditingBundleId('');
    setBundleTitle('');
    setBundleTitleEn('');
    setBundleSlug('');
    setBundleVideoUrl('');
    setBundleShortDesc('');
    setBundleDescription('');
    setBundleCourseIds([]);
    setBundlePrice({ EGP: 0, SAR: 0, USD: 0 });
    setBundleOriginalPrice({ EGP: 0, SAR: 0, USD: 0 });
    setBundleDetailsJson('{}');
    setBundleThumbnail('');
    setBundlePublished(true);
    setSeo({ title: '', description: '', keywords: '' });
  };

  const seoInput = useMemo<SeoInput>(() => ({
    kind: 'bundle',
    title: bundleTitle,
    titleEn: bundleTitleEn,
    seoTitle: seo.title,
    seoDescription: seo.description,
    seoKeywords: seo.keywords,
    slug: bundleSlug.trim().replace(/\s+/g, '-').toLowerCase(),
    shortDescription: bundleShortDesc,
    description: bundleDescription,
    thumbnail: bundleThumbnail,
    videoUrl: bundleVideoUrl,
    outlineCount: bundleCourseIds.length,
    hasPrice: Object.values(bundlePrice).some(v => Number(v) > 0),
    published: bundlePublished,
  }), [bundleTitle, bundleTitleEn, seo, bundleSlug, bundleShortDesc, bundleDescription, bundleThumbnail, bundleVideoUrl, bundleCourseIds, bundlePrice, bundlePublished]);

  const uploadCover = async (file?: File) => {
    if (!file) return;
    try { setBundleThumbnail(await uploadImage(file, 'cover')); }
    catch { notify('error', 'تعذر رفع الصورة — جرّب صورة أصغر.'); }
  };

  const startEditBundle = (row: Bundle) => {
  setEditingBundleId(row.id);
  setIsBundleFormOpen(true);
  setBundleTitle(row.title);
  setBundleTitleEn(row.titleEn || '');
  setBundleSlug(row.slug || '');
  setBundleVideoUrl(row.videoUrl || '');
  setBundleShortDesc(row.shortDescription || '');
  setBundleDescription(row.description);
  setBundleCourseIds(row.courses.map((c) => c.id));
  setBundlePrice({ ...row.price });
  setBundleOriginalPrice({ ...row.originalPrice });
  setBundleDetailsJson(JSON.stringify(row.detailsContent ?? {}, null, 2));
  setBundleThumbnail(row.thumbnail || '');
  setBundlePublished(row.isPublished !== false);
  setSeo({ title: row.seo_title || '', description: row.seo_description || '', keywords: row.seo_keywords || '' });
};

  const saveBundle = async () => {
  if (!bundleTitle.trim()) {
    notify('error', 'لا يمكن حفظ المسار بدون عنوان.');
    return;
  }
  if (bundleCourseIds.length === 0) {
    notify('error', 'اختر كورس واحد على الأقل داخل المسار قبل الحفظ.');
    return;
  }
  let parsedDetails: Record<string, string> = {};
  try {
    const raw = bundleDetailsJson.trim();
    parsedDetails = raw ? JSON.parse(raw) : {};
  } catch {
    notify('error', 'تنسيق JSON في تفاصيل صفحة المسار غير صحيح.');
    return;
  }

  const selectedCourses = courses.filter((c) => bundleCourseIds.includes(c.id));
  const rawSlug = bundleSlug.trim().replace(/\s+/g, '-').toLowerCase();
  const payload: Bundle = {
    id: editingBundleId || `b-${Date.now()}`,
    title: bundleTitle,
    titleEn: bundleTitleEn.trim() || undefined,
    slug: rawSlug || undefined,
    videoUrl: bundleVideoUrl.trim() || undefined,
    shortDescription: bundleShortDesc.trim() || undefined,
    description: bundleDescription,
    courses: selectedCourses,
    price: { ...bundlePrice },
    originalPrice: { ...bundleOriginalPrice },
    detailsContent: parsedDetails,
    thumbnail: bundleThumbnail.trim() || undefined,
    isPublished: bundlePublished,
    seo_title: seo.title.trim() || undefined,
    seo_description: seo.description.trim() || undefined,
    seo_keywords: seo.keywords.trim() || undefined,
  };
  setSaving(true);
  const saved = editingBundleId ? await updateBundle(payload) : await addBundle(payload);
  setSaving(false);
  if (!saved) { notify('error', 'تعذر حفظ المسار.'); return; }
  resetForm();
  setIsBundleFormOpen(false);
  notify('success', `تم حفظ المسار: ${payload.title}`);
};

  return (
  <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h3 className="font-bold text-gray-900">إدارة المسارات والباقات</h3>
      <div className="flex items-center gap-2">
        {isAdmin && (
          <button
            onClick={() => {
              const now = new Date();
              const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'00')}`;
              const backup = { _meta: { createdAt: now.toISOString(), type: 'bundles' }, bundles };
              const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = `backup_bundles_${stamp}.json`; a.click();
              URL.revokeObjectURL(url);
            }}
            className="bg-green-50 text-green-700 border border-green-200 px-3 py-2 rounded-xl text-sm font-bold hover:bg-green-100 transition flex items-center gap-1"
          >
            💾 نسخة احتياطية
          </button>
        )}
        <button
          onClick={() => {
            if (isBundleFormOpen && !editingBundleId) {
              setIsBundleFormOpen(false);
              return;
            }
            resetForm();
            setIsBundleFormOpen(true);
          }}
          className="bg-primary-600 hover:bg-primary-700 text-white rounded-xl px-4 py-2.5 font-bold text-sm"
        >
          <Plus size={16} className="inline ml-1" />
          {isBundleFormOpen ? 'إغلاق نموذج المسار' : 'إضافة مسار'}
        </button>
      </div>
    </div>

    {isBundleFormOpen && (
      <div className="border border-gray-200 rounded-2xl p-4 mb-4 bg-gray-50/70 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="عنوان المسار (عربي)" value={bundleTitle} onChange={(e) => setBundleTitle(e.target.value)} />
          <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="اسم المسار بالإنجليزية (English Name)" value={bundleTitleEn} onChange={(e) => setBundleTitleEn(e.target.value)} />
          <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="رابط URL المسار (slug) مثال: psychology-track" value={bundleSlug} onChange={(e) => setBundleSlug(e.target.value)} />
          <input className="border border-gray-300 rounded-xl px-4 py-2.5 md:col-span-1" placeholder="رابط فيديو تعريفي (YouTube embed)" value={bundleVideoUrl} onChange={(e) => setBundleVideoUrl(e.target.value)} />
          <div className="md:col-span-2 flex flex-wrap items-center gap-3 border border-gray-200 rounded-xl bg-white p-3">
            {bundleThumbnail
              ? <img src={bundleThumbnail} alt="" className="w-24 h-16 object-cover rounded-lg border border-gray-200" />
              : <div className="w-24 h-16 rounded-lg bg-gray-100 grid place-items-center text-[11px] text-gray-400">بدون غلاف</div>}
            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="text-xs font-bold text-gray-600">صورة غلاف المسار</p>
              <div className="flex flex-wrap gap-2">
                <label className="px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 text-xs font-bold cursor-pointer">
                  رفع صورة
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { void uploadCover(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                <input className="flex-1 min-w-[12rem] border border-gray-300 rounded-lg px-3 py-1.5 text-xs" dir="ltr" placeholder="أو رابط صورة https://..." value={bundleThumbnail} onChange={(e) => setBundleThumbnail(e.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
              <input type="checkbox" checked={bundlePublished} onChange={(e) => setBundlePublished(e.target.checked)} />
              منشور في الموقع
            </label>
          </div>
          <div><label className="block text-xs font-bold text-gray-600 mb-1">السعر المشطوب في الموقع EGP (جنيه)</label><input className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="0" type="number" value={bundleOriginalPrice.EGP} onChange={(e) => setBundleOriginalPrice({ ...bundleOriginalPrice, EGP: Number(e.target.value) })} /></div>
          <div><label className="block text-xs font-bold text-gray-600 mb-1">السعر المشطوب في الموقع SAR (ريال)</label><input className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="0" type="number" value={bundleOriginalPrice.SAR} onChange={(e) => setBundleOriginalPrice({ ...bundleOriginalPrice, SAR: Number(e.target.value) })} /></div>
          <div><label className="block text-xs font-bold text-gray-600 mb-1">السعر المشطوب في الموقع USD (دولار)</label><input className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="0" type="number" value={bundleOriginalPrice.USD} onChange={(e) => setBundleOriginalPrice({ ...bundleOriginalPrice, USD: Number(e.target.value) })} /></div>
          <CatalogPricingPanel
            type="bundle"
            itemId={editingBundleId || null}
            notify={notify}
            onSaved={online => setBundlePrice(online)}
          />
          <div className="md:col-span-2 text-xs text-gray-500 -mb-1">لاختيار أكثر من كورس: استخدم Ctrl أو Cmd أثناء التحديد.</div>
          <select multiple className="border border-gray-300 rounded-xl px-4 py-2.5 min-h-36" value={bundleCourseIds} onChange={(e) => setBundleCourseIds(Array.from(e.target.selectedOptions).map((o) => (o as HTMLOptionElement).value))}>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <div className="flex gap-2 md:col-span-2">
            <button onClick={() => setBundleCourseIds(courses.map((c) => c.id))} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm">اختيار كل الكورسات</button>
            <button onClick={() => setBundleCourseIds([])} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm">مسح الاختيار</button>
          </div>
          <textarea className="md:col-span-2 border border-gray-300 rounded-xl px-4 py-2.5" rows={2} placeholder="وصف قصير (tagline) - يظهر تحت العنوان في الهيدر" value={bundleShortDesc} onChange={(e) => setBundleShortDesc(e.target.value)} />
          <textarea className="md:col-span-2 border border-gray-300 rounded-xl px-4 py-2.5" rows={3} placeholder="وصف كامل للمسار - يظهر في أول الصفحة" value={bundleDescription} onChange={(e) => setBundleDescription(e.target.value)} />
          <textarea
            className="md:col-span-2 border border-gray-300 rounded-xl px-4 py-2.5 font-mono text-xs"
            rows={8}
            placeholder='تفاصيل صفحة المسار JSON (key:value)'
            value={bundleDetailsJson}
            onChange={(e) => setBundleDetailsJson(e.target.value)}
          />
          <div className="md:col-span-2 border border-violet-200 rounded-2xl p-4 bg-violet-50 space-y-3">
            <p className="text-xs font-bold text-violet-700">🔍 الظهور في جوجل (SEO) — التقييم والمقترحات</p>
            <SeoScorePanel input={seoInput} />
            <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm" maxLength={120} placeholder="عنوان SEO — يظهر في نتائج البحث (30-60 حرف)" value={seo.title} onChange={(e) => setSeo({ ...seo, title: e.target.value })} />
            <textarea className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm resize-none" rows={2} maxLength={300} placeholder="وصف SEO — يظهر تحت العنوان في جوجل (120-160 حرف)" value={seo.description} onChange={(e) => setSeo({ ...seo, description: e.target.value })} />
            <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm" placeholder="الكلمات المفتاحية مفصولة بفاصلة — أول كلمة هي الأساسية" value={seo.keywords} onChange={(e) => setSeo({ ...seo, keywords: e.target.value })} />
          </div>
        </div>
        <button onClick={() => void saveBundle()} disabled={saving} className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-bold px-5 py-2.5 rounded-xl transition">{editingBundleId ? 'تحديث المسار' : 'إضافة مسار'}</button>
      </div>
    )}
    <div className="mt-5 border-t pt-4 space-y-2 max-h-80 overflow-auto">
      {bundles.map((row) => (
        <div key={row.id} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl p-3">
          <div><p className="font-bold text-gray-800">{row.title}</p><p className="text-xs text-gray-500">{row.courses.length} كورس</p></div>
          <div className="flex gap-2">
            <button onClick={() => window.open(`https://mahadnafsy.com/bundle/${row.id}`, '_blank')} className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-sm">عرض</button>
            <button onClick={() => startEditBundle(row)} className="px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 text-sm">تعديل</button>
            <button onClick={() => { void deleteBundle(row.id).then(ok => notify(ok ? 'success' : 'error', ok ? 'تم حذف المسار.' : 'تعذر حذف المسار.')); }} className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm">حذف</button>
          </div>
        </div>
      ))}
    </div>
  </article>
  );
}
