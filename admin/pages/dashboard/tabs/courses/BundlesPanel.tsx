// Learning paths (bundles): the list, and the form that builds one from courses.
//
// Lifted out of CoursesTab.tsx with its own state — twelve drafts and two
// handlers that no other section read. The list, the courses it draws from and
// its writers come from useSiteData here, so notify is the only prop.
//
// The saving flag is its own. CoursesTab's catalogSaving is shared with the
// courses and lectures sections, so saving a course disabled this form.

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useSiteData } from '../../../../context/SiteDataContext';
import type { Bundle } from '../../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

export default function BundlesPanel({ notify }: { notify: NotifyFn }) {
  const { bundles, courses, addBundle, updateBundle, deleteBundle, isAdmin } = useSiteData();
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
  };
  setSaving(true);
  const saved = editingBundleId ? await updateBundle(payload) : await addBundle(payload);
  setSaving(false);
  if (!saved) { notify('error', 'تعذر حفظ المسار.'); return; }
  setEditingBundleId('');
  setIsBundleFormOpen(false);
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
          <div><label className="block text-xs font-bold text-gray-600 mb-1">السعر الحالي EGP (جنيه مصري)</label><input className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="0" type="number" value={bundlePrice.EGP} onChange={(e) => setBundlePrice({ ...bundlePrice, EGP: Number(e.target.value) })} /></div>
          <div><label className="block text-xs font-bold text-gray-600 mb-1">السعر قبل الخصم EGP (جنيه)</label><input className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="0" type="number" value={bundleOriginalPrice.EGP} onChange={(e) => setBundleOriginalPrice({ ...bundleOriginalPrice, EGP: Number(e.target.value) })} /></div>
          <div><label className="block text-xs font-bold text-gray-600 mb-1">السعر الحالي SAR (ريال سعودي)</label><input className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="0" type="number" value={bundlePrice.SAR} onChange={(e) => setBundlePrice({ ...bundlePrice, SAR: Number(e.target.value) })} /></div>
          <div><label className="block text-xs font-bold text-gray-600 mb-1">السعر قبل الخصم SAR (ريال)</label><input className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="0" type="number" value={bundleOriginalPrice.SAR} onChange={(e) => setBundleOriginalPrice({ ...bundleOriginalPrice, SAR: Number(e.target.value) })} /></div>
          <div><label className="block text-xs font-bold text-gray-600 mb-1">السعر الحالي USD (دولار أمريكي)</label><input className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="0" type="number" value={bundlePrice.USD} onChange={(e) => setBundlePrice({ ...bundlePrice, USD: Number(e.target.value) })} /></div>
          <div><label className="block text-xs font-bold text-gray-600 mb-1">السعر قبل الخصم USD (دولار)</label><input className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="0" type="number" value={bundleOriginalPrice.USD} onChange={(e) => setBundleOriginalPrice({ ...bundleOriginalPrice, USD: Number(e.target.value) })} /></div>
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
