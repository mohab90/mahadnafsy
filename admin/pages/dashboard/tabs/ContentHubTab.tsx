import { useState, useEffect, useRef } from 'react';
import {
  Save, Plus, X, Trash2, Upload, Phone, Mail, MapPin,
  Globe, Facebook, Instagram, Youtube,
} from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { BranchAddForm } from '../dashboardShared';
import {
  aboutPageFields, homeOfferFields, pageCoursesFields, pageBundlesFields,
  pageConsultationsFields, pageInstructorsFields, pageContactFields,
  pageJoinUsFields, pageCommunityFields, policySections,
} from '../contentFields';
import type { TabKey } from '../navigation';
import type { NotifyFn } from '../../../types';

type BranchEntry = { id: string; label: string };

interface Props {
  activeTab: string;
  notify: NotifyFn;
  policyDrafts: Record<string, string>;
  setPolicyDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  instituteGalleryImages: string[];
  instituteBranches: BranchEntry[];
}

const PAGE_TAB_MAP: Record<string, { title: string; subtitle: string; fields: { key: string; label: string; multiline: boolean }[]; msg: string }> = {
  page_courses:       { title: 'محتوى صفحة الكورسات والدبلومات',  subtitle: 'تعديل العناوين والنصوص التي تظهر في صفحة الدبلومات والبرامج',            fields: pageCoursesFields,       msg: 'تم حفظ محتوى صفحة الكورسات بنجاح.' },
  page_bundles:       { title: 'محتوى صفحة الباقات',              subtitle: 'تعديل العناوين والنصوص التي تظهر في صفحة الباقات التعليمية',              fields: pageBundlesFields,       msg: 'تم حفظ محتوى صفحة الباقات بنجاح.' },
  page_consultations: { title: 'محتوى صفحة الاستشارات',           subtitle: 'تعديل نصوص وأسعار صفحة الاستشارات النفسية السريعة',                     fields: pageConsultationsFields, msg: 'تم حفظ محتوى صفحة الاستشارات بنجاح.' },
  page_instructors:   { title: 'محتوى صفحة المحاضرين',            subtitle: 'تعديل عنوان وعرض صفحة قائمة المحاضرين والمستشارين',                     fields: pageInstructorsFields,   msg: 'تم حفظ محتوى صفحة المحاضرين بنجاح.' },
  page_contact:       { title: 'محتوى صفحة تواصل معنا',           subtitle: 'تعديل عناوين ونصوص صفحة التواصل مع المعهد',                             fields: pageContactFields,       msg: 'تم حفظ محتوى صفحة التواصل بنجاح.' },
  page_joinus:        { title: 'محتوى صفحة انضم إلينا',           subtitle: 'تعديل عناوين وإحصائيات ومزايا صفحة الانضمام للمحاضرين والمستشارين',    fields: pageJoinUsFields,        msg: 'تم حفظ محتوى صفحة انضم إلينا بنجاح.' },
  page_community:     { title: 'محتوى صفحة المجتمع',             subtitle: 'تعديل عناوين أقسام صفحة مجتمع المعهد النفسي',                            fields: pageCommunityFields,     msg: 'تم حفظ محتوى صفحة المجتمع بنجاح.' },
};

const ContentHubTab: React.FC<Props> = ({
  activeTab,
  notify,
  policyDrafts,
  setPolicyDrafts,
  instituteGalleryImages,
  instituteBranches,
}) => {
  const { content, setContentValue, addContentKey, removeContentKey, courses } = useSiteData();

  const [contentHubSubTab, setContentHubSubTab] = useState<TabKey>('home_offer');
  const [contentEdits, setContentEdits] = useState<Record<string, string>>({});
  const [offerSelectedCourseId, setOfferSelectedCourseId] = useState(() => content['offer.courseId'] || '');
  const [newContentKey, setNewContentKey] = useState('');
  const [newContentValue, setNewContentValue] = useState('');
  const [searchText, setSearchText] = useState('');
  const [instituteGalleryUrlInput, setInstituteGalleryUrlInput] = useState('');
  const instituteGalleryUploadRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (content['offer.courseId']) setOfferSelectedCourseId(content['offer.courseId']);
  }, [content['offer.courseId']]);

  const filteredContent = Object.entries(content).filter(
    ([key, value]) => `${key} ${value}`.toLowerCase().includes(searchText.toLowerCase())
  );

  const saveInstituteGalleryImages = (images: string[]) => {
    setContentValue('institute.gallery.images', JSON.stringify(images, null, 2));
  };

  const handleInstituteGalleryUpload = async (files: FileList | null) => {
    const readFileAsDataUrl = (file: File, maxWidth: number, quality: number): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new window.Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, maxWidth / img.width);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', quality));
          };
          img.onerror = reject;
          img.src = e.target!.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    if (!files || files.length === 0) return;
    try {
      const uploaded = await Promise.all(Array.from(files).map((file) => readFileAsDataUrl(file, 600, 0.65)));
      saveInstituteGalleryImages(Array.from(new Set([...instituteGalleryImages, ...uploaded])));
      notify('success', 'تم رفع صور المعرض بنجاح.');
    } catch {
      notify('error', 'حدث خطأ أثناء رفع صور المعهد.');
    }
  };

  // ── Raw content editor (used by activeTab === 'content' and content_hub > hub_advanced) ──
  const rawContentEditor = (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="font-bold text-gray-900">إدارة محتوى الموقع</h3>
        {Object.keys(contentEdits).length > 0 && (
          <button
            onClick={() => {
              Object.entries(contentEdits).forEach(([k, v]) => setContentValue(k, v));
              setContentEdits({});
              notify('success', `تم حفظ ${Object.keys(contentEdits).length} تعديل بنجاح.`);
            }}
            className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-primary-700 transition"
          >
            <Save size={14} /> حفظ كل التعديلات ({Object.keys(contentEdits).length})
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-3 mb-4">
        <input value={newContentKey} onChange={(e) => setNewContentKey(e.target.value)} placeholder="مثال: new.key" className="border border-gray-300 rounded-xl px-3 py-2" />
        <input value={newContentValue} onChange={(e) => setNewContentValue(e.target.value)} placeholder="القيمة" className="border border-gray-300 rounded-xl px-3 py-2" />
        <button onClick={() => { if (!newContentKey) return; addContentKey(newContentKey, newContentValue); setNewContentKey(''); setNewContentValue(''); }} className="bg-primary-600 text-white rounded-xl px-4 py-2 font-bold">
          <Plus size={16} className="inline ml-1" />إضافة
        </button>
      </div>
      <div className="mb-4">
        <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="ابحث داخل المفاتيح والقيم" className="w-full border border-gray-300 rounded-xl px-3 py-2" />
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-right border-b border-gray-100">
            <th className="py-2">المفتاح</th><th className="py-2">القيمة</th><th className="py-2">إجراءات</th>
          </tr>
        </thead>
        <tbody>
          {filteredContent.map(([key, savedValue]) => {
            const isDirty = contentEdits[key] !== undefined && contentEdits[key] !== savedValue;
            const displayValue = contentEdits[key] !== undefined ? contentEdits[key] : savedValue;
            return (
              <tr key={key} className={`border-b border-gray-50 align-top ${isDirty ? 'bg-amber-50/50' : ''}`}>
                <td className="py-3 font-medium text-gray-700 pr-1">
                  {key}
                  {isDirty && <span className="mr-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">غير محفوظ</span>}
                </td>
                <td className="py-3">
                  <textarea
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-24 focus:border-primary-400 focus:outline-none"
                    value={displayValue}
                    onChange={(e) => setContentEdits(prev => ({ ...prev, [key]: e.target.value }))}
                  />
                </td>
                <td className="py-3 pl-2">
                  <div className="flex flex-col gap-1">
                    {isDirty && (
                      <button
                        onClick={() => {
                          setContentValue(key, contentEdits[key]!);
                          setContentEdits(prev => { const n = { ...prev }; delete n[key]; return n; });
                        }}
                        className="flex items-center gap-1 px-2 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-bold hover:bg-primary-700 transition whitespace-nowrap"
                      >
                        <Save size={11} /> حفظ
                      </button>
                    )}
                    {isDirty && (
                      <button
                        onClick={() => setContentEdits(prev => { const n = { ...prev }; delete n[key]; return n; })}
                        className="flex items-center gap-1 px-2 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200 transition whitespace-nowrap"
                      >
                        <X size={11} /> تراجع
                      </button>
                    )}
                    <button onClick={() => { if (window.confirm('حذف هذا المفتاح نهائياً؟')) removeContentKey(key); }} className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition"><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </article>
  );

  // ── Policies section ──
  const policiesSection = (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold text-gray-900">إدارة السياسات القانونية</h3>
        <div className="flex gap-2">
          <button onClick={() => setPolicyDrafts({})} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm">إعادة تحميل من البيانات الحالية</button>
          <button
            onClick={() => {
              policySections.forEach((section) => {
                section.fields.forEach((field) => {
                  const value = policyDrafts[field.key] ?? content[field.key] ?? '';
                  setContentValue(field.key, value);
                });
              });
              notify('success', 'تم حفظ نصوص السياسات القانونية بنجاح.');
            }}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold"
          >
            حفظ التعديلات
          </button>
        </div>
      </div>
      {policySections.map((section) => (
        <section key={section.title} className="border border-gray-200 rounded-xl p-4 space-y-3">
          <h4 className="font-bold text-gray-800">{section.title}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {section.fields.map((field) => {
              const value = policyDrafts[field.key] ?? content[field.key] ?? '';
              return (
                <div key={field.key} className={field.multiline ? 'md:col-span-2' : ''}>
                  <label className="block text-xs font-bold text-gray-600 mb-1">{field.label} • <code className="text-primary-500">{field.key}</code></label>
                  {field.multiline ? (
                    <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-24 text-sm" value={value} onChange={(e) => setPolicyDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))} />
                  ) : (
                    <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={value} onChange={(e) => setPolicyDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))} />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </article>
  );

  // ── About page section ──
  const aboutPageSection = (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold text-gray-900">إدارة صفحة عن المعهد</h3>
        <div className="flex gap-2">
          <button onClick={() => setPolicyDrafts({})} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm">إعادة تحميل</button>
          <button
            onClick={() => {
              aboutPageFields.forEach((field) => {
                const value = policyDrafts[field.key] ?? content[field.key] ?? '';
                setContentValue(field.key, value);
              });
              notify('success', 'تم حفظ إعدادات صفحة عن المعهد بنجاح.');
            }}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold"
          >
            حفظ التعديلات
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {aboutPageFields.map((field) => {
          const value = policyDrafts[field.key] ?? content[field.key] ?? '';
          return (
            <div key={field.key} className={field.multiline ? 'md:col-span-2' : ''}>
              <label className="block text-xs font-bold text-gray-600 mb-1">{field.label} • <code className="text-primary-500">{field.key}</code></label>
              {field.multiline ? (
                <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-24 text-sm" value={value} onChange={(e) => setPolicyDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))} />
              ) : (
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={value} onChange={(e) => setPolicyDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))} />
              )}
            </div>
          );
        })}
      </div>
    </article>
  );

  // ── Home offer section ──
  const homeOfferSection = (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold text-gray-900">إدارة الصفحة الرئيسية</h3>
        <div className="flex gap-2">
          <button onClick={() => setPolicyDrafts({})} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm">إعادة تحميل</button>
          <button
            onClick={() => {
              homeOfferFields.forEach((field) => {
                const value = policyDrafts[field.key] ?? content[field.key] ?? '';
                setContentValue(field.key, value);
              });
              notify('success', 'تم حفظ إعدادات الصفحة الرئيسية بنجاح.');
            }}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold"
          >
            حفظ التعديلات
          </button>
        </div>
      </div>

      {/* Offer Course Selector */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-bold text-amber-900 flex items-center gap-2">
            <span className="bg-amber-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">★</span>
            كورس العرض المميز (24 ساعة)
          </h4>
          <button
            type="button"
            onClick={() => {
              const now = new Date().toISOString();
              setContentValue('offer.timerStartedAt', now);
              notify('success', 'تم إعادة ضبط مؤقت الـ24 ساعة! سيبدأ العد التنازلي من الصفر لجميع الزوار.');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-colors"
          >
            🔄 إعادة ضبط المؤقت
          </button>
        </div>
        <p className="text-xs text-amber-700">اختر الكورس الذي تريد تمييزه في قسم العرض على الصفحة الرئيسية. عند الضغط على "تطبيق" سيتم ملء بيانات العرض تلقائياً من بيانات الكورس. اضغط "إعادة ضبط المؤقت" ليبدأ العد من الصفر لجميع الزوار.</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-bold text-amber-800 mb-1">اختر كورس العرض</label>
            <select
              value={offerSelectedCourseId}
              onChange={(e) => setOfferSelectedCourseId(e.target.value)}
              className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-amber-400 outline-none"
            >
              <option value="">— اختر كورساً —</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => {
              const selected = courses.find((c) => c.id === offerSelectedCourseId);
              if (!selected) { notify('error', 'يرجى اختيار كورس أولاً.'); return; }
              setContentValue('offer.courseId', selected.id);
              setContentValue('home.offer.title', selected.title);
              setContentValue('home.offer.description', (selected.shortDescription || selected.description?.slice(0, 200) || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim());
              const egpPrice = selected.price?.EGP ?? 0;
              const egpOriginal = selected.originalPrice?.EGP ?? 0;
              setContentValue('home.offer.newPrice', egpPrice > 0 ? `${egpPrice} ج.م` : '');
              setContentValue('home.offer.oldPrice', egpOriginal > 0 ? `${egpOriginal} ج.م` : '');
              if (egpOriginal > 0 && egpPrice > 0) {
                const pct = Math.round(((egpOriginal - egpPrice) / egpOriginal) * 100);
                setContentValue('home.offer.discount', `خصم ${pct}%`);
              }
              setContentValue('home.offer.registerFor', `${selected.title} (عرض 24 ساعة)`);
              notify('success', `تم تطبيق كورس "${selected.title}" على قسم العرض بنجاح.`);
            }}
            className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold transition-colors whitespace-nowrap"
          >
            تطبيق على العرض
          </button>
        </div>
        {content['offer.courseId'] && (
          <p className="text-xs text-amber-700 bg-amber-100 rounded-lg px-3 py-2">
            الكورس الحالي في العرض: <strong>{courses.find((c) => c.id === content['offer.courseId'])?.title || content['offer.courseId']}</strong>
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {homeOfferFields.map((field) => {
          const value = policyDrafts[field.key] ?? content[field.key] ?? '';
          return (
            <div key={field.key} className={field.multiline ? 'md:col-span-2' : ''}>
              <label className="block text-xs font-bold text-gray-600 mb-1">{field.label} • <code className="text-primary-500">{field.key}</code></label>
              {field.multiline ? (
                <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-24 text-sm" value={value} onChange={(e) => setPolicyDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))} />
              ) : (
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={value} onChange={(e) => setPolicyDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))} />
              )}
            </div>
          );
        })}
      </div>
    </article>
  );

  // ── Footer settings section ──
  const footerSection = (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold text-gray-900 text-lg">إعدادات الفوتر والتواصل الاجتماعي</h3>
        <button
          onClick={() => {
            Object.entries(policyDrafts).forEach(([k, v]) => {
              if (k.startsWith('footer.') || k === 'institute.logo') setContentValue(k, v);
            });
            setPolicyDrafts(prev => {
              const next = { ...prev };
              Object.keys(next).filter(k => k.startsWith('footer.') || k === 'institute.logo').forEach(k => delete next[k]);
              return next;
            });
            notify('success', 'تم حفظ إعدادات الفوتر بنجاح.');
          }}
          className="px-5 py-2 rounded-xl bg-primary-600 text-white text-sm font-bold flex items-center gap-2 hover:bg-primary-700 transition"
        >
          <Save size={15} />حفظ التغييرات
        </button>
      </div>

      {/* Logo */}
      <section className="border border-gray-200 rounded-xl p-5 space-y-3">
        <h4 className="font-bold text-gray-800">🖼️ شعار المعهد (اللوجو)</h4>
        <div className="flex gap-2 items-start">
          <input
            type="url"
            placeholder="https://..."
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={policyDrafts['institute.logo'] ?? content['institute.logo'] ?? ''}
            onChange={e => setPolicyDrafts(prev => ({ ...prev, 'institute.logo': e.target.value }))}
          />
          {(policyDrafts['institute.logo'] || content['institute.logo']) && (
            <img
              src={policyDrafts['institute.logo'] || content['institute.logo']}
              alt="logo"
              className="h-12 w-auto object-contain border border-gray-200 rounded-lg p-1 bg-gray-50"
            />
          )}
        </div>
        <p className="text-xs text-gray-400">الشعار يظهر في الهيدر، الفوتر، والشهادات. • المفتاح: <code>institute.logo</code></p>
      </section>

      {/* Contact Info */}
      <section className="border border-gray-200 rounded-xl p-5 space-y-4">
        <h4 className="font-bold text-gray-800 flex items-center gap-2"><Phone size={16} className="text-primary-500" />معلومات التواصل</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { key: 'footer.phone', label: 'رقم الهاتف', type: 'text' },
            { key: 'footer.email', label: 'البريد الإلكتروني', type: 'email' },
            { key: 'footer.whatsapp', label: 'رقم واتساب (أرقام فقط بدون +)', type: 'text' },
            { key: 'footer.address', label: 'العنوان', type: 'text' },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-xs font-bold text-gray-600 mb-1">{f.label} <span className="text-gray-400 font-normal">• {f.key}</span></label>
              <input
                type={f.type}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
                value={policyDrafts[f.key] ?? content[f.key] ?? ''}
                onChange={e => setPolicyDrafts(prev => ({ ...prev, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-gray-600 mb-1">وصف المعهد في الفوتر <span className="text-gray-400 font-normal">• footer.description</span></label>
            <textarea
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
              value={policyDrafts['footer.description'] ?? content['footer.description'] ?? ''}
              onChange={e => setPolicyDrafts(prev => ({ ...prev, 'footer.description': e.target.value }))}
            />
          </div>
        </div>
      </section>

      {/* Social Media Links */}
      <section className="border border-gray-200 rounded-xl p-5 space-y-4">
        <h4 className="font-bold text-gray-800 flex items-center gap-2"><Globe size={16} className="text-blue-500" />روابط التواصل الاجتماعي</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { key: 'footer.facebook', label: 'فيسبوك', icon: Facebook, color: 'text-blue-600' },
            { key: 'footer.instagram', label: 'إنستجرام', icon: Instagram, color: 'text-pink-600' },
            { key: 'footer.youtube', label: 'يوتيوب', icon: Youtube, color: 'text-red-600' },
          ].map(f => {
            const Icon = f.icon;
            return (
              <div key={f.key}>
                <label className="block text-xs font-bold text-gray-600 mb-1 flex items-center gap-1.5">
                  <Icon size={13} className={f.color} />{f.label} <span className="text-gray-400 font-normal">• {f.key}</span>
                </label>
                <input
                  type="url"
                  placeholder="https://..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
                  value={policyDrafts[f.key] ?? content[f.key] ?? ''}
                  onChange={e => setPolicyDrafts(prev => ({ ...prev, [f.key]: e.target.value }))}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* Save contact + social (footer) — these fields write to policyDrafts and were never
          committed before (no save button), so footer edits appeared to "not save". */}
      {['footer.phone','footer.email','footer.whatsapp','footer.address','footer.description','footer.facebook','footer.instagram','footer.youtube'].some(k => policyDrafts[k] !== undefined) && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              const FK = ['footer.phone','footer.email','footer.whatsapp','footer.address','footer.description','footer.facebook','footer.instagram','footer.youtube'];
              FK.forEach(k => { if (policyDrafts[k] !== undefined) setContentValue(k, policyDrafts[k]); });
              setPolicyDrafts(prev => { const n = { ...prev }; FK.forEach(k => delete n[k]); return n; });
              notify('success', 'تم حفظ بيانات التواصل والفوتر بنجاح.');
            }}
            className="bg-primary-600 hover:bg-primary-700 text-white font-bold px-5 py-2.5 rounded-xl text-sm flex items-center gap-2"
          >
            <Save size={14} /> حفظ بيانات التواصل والفوتر
          </button>
          <button
            onClick={() => setPolicyDrafts(prev => { const n = { ...prev }; ['footer.phone','footer.email','footer.whatsapp','footer.address','footer.description','footer.facebook','footer.instagram','footer.youtube'].forEach(k => delete n[k]); return n; })}
            className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm"
          >
            إلغاء
          </button>
        </div>
      )}

      {/* Preview */}
      <section className="border border-dashed border-gray-300 rounded-xl p-4 bg-gray-50">
        <h4 className="text-sm font-bold text-gray-600 mb-3">معاينة سريعة للبيانات الحالية</h4>
        <div className="flex flex-wrap gap-4 text-sm text-gray-600">
          {[
            { icon: Phone, val: policyDrafts['footer.phone'] || content['footer.phone'] },
            { icon: Mail, val: policyDrafts['footer.email'] || content['footer.email'] },
            { icon: MapPin, val: policyDrafts['footer.address'] || content['footer.address'] },
          ].filter(i => i.val).map((i, idx) => {
            const Icon = i.icon;
            return <span key={idx} className="flex items-center gap-1.5"><Icon size={14} className="text-gray-400" />{i.val}</span>;
          })}
        </div>
        <div className="flex gap-3 mt-3">
          {(policyDrafts['footer.facebook'] || content['footer.facebook']) && (
            <a href={policyDrafts['footer.facebook'] || content['footer.facebook']} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600 text-xs hover:underline"><Facebook size={13} />فيسبوك</a>
          )}
          {(policyDrafts['footer.instagram'] || content['footer.instagram']) && (
            <a href={policyDrafts['footer.instagram'] || content['footer.instagram']} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-pink-600 text-xs hover:underline"><Instagram size={13} />إنستجرام</a>
          )}
          {(policyDrafts['footer.youtube'] || content['footer.youtube']) && (
            <a href={policyDrafts['footer.youtube'] || content['footer.youtube']} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-red-600 text-xs hover:underline"><Youtube size={13} />يوتيوب</a>
          )}
        </div>
      </section>

      {/* Branches */}
      <section className="border border-gray-200 rounded-xl p-5 space-y-4">
        <h4 className="font-bold text-gray-800">🏢 إدارة الفروع والقاعات</h4>
        <p className="text-xs text-gray-500">الفروع التي تضيفها هنا ستظهر تلقائياً في نماذج التسجيل. يمكنك إضافة قاعات لكل فرع (مثل قاعات الدقي).</p>
        <BranchAddForm instituteBranches={instituteBranches} setContentValue={setContentValue} />
      </section>
    </article>
  );

  // ── Institute gallery section ──
  const gallerySection = (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-gray-900">معرض صور المعهد</h3>
        <button type="button" onClick={() => instituteGalleryUploadRef.current?.click()} className="px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold">
          <Upload size={14} className="inline ml-1" />رفع صور
        </button>
      </div>

      {/* Gallery Page Title/Subtitle */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-b pb-4">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">عنوان صفحة المعرض</label>
          <input
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
            placeholder="معرض صور المعهد"
            value={policyDrafts['institute.gallery.title'] ?? content['institute.gallery.title'] ?? ''}
            onChange={(e) => setPolicyDrafts(prev => ({ ...prev, 'institute.gallery.title': e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">وصف صفحة المعرض</label>
          <input
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
            placeholder="صور من القاعات، الفعاليات، والأنشطة التدريبية..."
            value={policyDrafts['institute.gallery.subtitle'] ?? content['institute.gallery.subtitle'] ?? ''}
            onChange={(e) => setPolicyDrafts(prev => ({ ...prev, 'institute.gallery.subtitle': e.target.value }))}
          />
        </div>
        {(policyDrafts['institute.gallery.title'] !== undefined || policyDrafts['institute.gallery.subtitle'] !== undefined) && (
          <div className="md:col-span-2 flex gap-2">
            <button
              onClick={() => {
                if (policyDrafts['institute.gallery.title'] !== undefined) setContentValue('institute.gallery.title', policyDrafts['institute.gallery.title']);
                if (policyDrafts['institute.gallery.subtitle'] !== undefined) setContentValue('institute.gallery.subtitle', policyDrafts['institute.gallery.subtitle']);
                setPolicyDrafts(prev => { const next = { ...prev }; delete next['institute.gallery.title']; delete next['institute.gallery.subtitle']; return next; });
              }}
              className="bg-primary-600 hover:bg-primary-700 text-white font-bold px-4 py-2 rounded-xl text-sm"
            >
              حفظ العنوان والوصف
            </button>
            <button
              onClick={() => setPolicyDrafts(prev => { const next = { ...prev }; delete next['institute.gallery.title']; delete next['institute.gallery.subtitle']; return next; })}
              className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm"
            >
              إلغاء
            </button>
          </div>
        )}
      </div>
      <input ref={instituteGalleryUploadRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => { void handleInstituteGalleryUpload(e.target.files); e.target.value = ''; }} />

      <div className="flex flex-wrap gap-2">
        <input
          value={instituteGalleryUrlInput}
          onChange={(e) => setInstituteGalleryUrlInput(e.target.value)}
          placeholder="رابط صورة جديدة"
          className="flex-1 min-w-[220px] border border-gray-300 rounded-xl px-3 py-2"
        />
        <button
          type="button"
          onClick={() => {
            if (!instituteGalleryUrlInput.trim()) return;
            saveInstituteGalleryImages(Array.from(new Set([...instituteGalleryImages, instituteGalleryUrlInput.trim()])));
            setInstituteGalleryUrlInput('');
          }}
          className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-bold"
        >
          إضافة رابط
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {instituteGalleryImages.map((imageUrl, index) => (
          <div key={`${imageUrl}-${index}`} className="relative border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
            <img src={imageUrl} alt={`gallery-${index}`} className="w-full h-28 object-cover" />
            <button
              type="button"
              onClick={() => saveInstituteGalleryImages(instituteGalleryImages.filter((_, i) => i !== index))}
              className="absolute top-1 left-1 bg-white/90 text-red-600 rounded-full p-1"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      {instituteGalleryImages.length === 0 && <p className="text-sm text-gray-500">لا توجد صور بعد. ارفع صور أو أضف روابط.</p>}

      {/* Branches Management */}
      <div className="border-t pt-4 mt-4">
        <h4 className="font-bold text-gray-800 mb-3">إدارة الفروع</h4>
        <p className="text-xs text-gray-500 mb-3">الفروع التي تضيفها هنا ستظهر تلقائياً في نماذج التسجيل بجميع صفحات الموقع.</p>
        <BranchAddForm instituteBranches={instituteBranches} setContentValue={setContentValue} />
      </div>
    </article>
  );

  // ── hub_advanced sub-tab (logo + video + raw content editor) ──
  const hubAdvancedSection = (
    <div className="space-y-4">
      {/* Logo Settings */}
      <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
        <h3 className="font-bold text-gray-900">🖼️ شعار المعهد (اللوجو)</h3>
        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">رابط الشعار <span className="text-gray-400 font-normal">• institute.logo</span></label>
          <div className="flex gap-2 items-start">
            <input
              type="url"
              placeholder="https://..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={policyDrafts['institute.logo'] ?? content['institute.logo'] ?? ''}
              onChange={e => setPolicyDrafts(prev => ({ ...prev, 'institute.logo': e.target.value }))}
            />
            <button
              onClick={() => {
                setContentValue('institute.logo', policyDrafts['institute.logo'] ?? content['institute.logo'] ?? '');
                setPolicyDrafts(prev => { const n = { ...prev }; delete n['institute.logo']; return n; });
                notify('success', 'تم حفظ الشعار بنجاح.');
              }}
              className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold whitespace-nowrap"
            >حفظ الشعار</button>
          </div>
          {(policyDrafts['institute.logo'] || content['institute.logo']) && (
            <div className="mt-3 p-3 border border-gray-100 rounded-xl bg-gray-50 inline-block">
              <p className="text-xs text-gray-400 mb-2">معاينة:</p>
              <img src={policyDrafts['institute.logo'] || content['institute.logo']} alt="logo preview" className="h-16 w-auto object-contain" />
            </div>
          )}
        </div>
      </article>

      {/* Video Autoplay Settings */}
      <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
        <h3 className="font-bold text-gray-900">▶️ إعدادات تشغيل الفيديوهات</h3>
        <div className="space-y-3">
          {[
            { key: 'video.autoplay', label: 'تشغيل الفيديو تلقائياً عند فتح الصفحة', hint: 'true أو false' },
            { key: 'video.muted', label: 'تشغيل الفيديو بدون صوت (مطلوب للتشغيل التلقائي)', hint: 'true أو false' },
            { key: 'video.loop', label: 'تكرار تشغيل الفيديو', hint: 'true أو false' },
            { key: 'video.heroUrl', label: 'رابط فيديو الهيرو في الصفحة الرئيسية', hint: 'https://...' },
          ].map(f => (
            <div key={f.key} className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs font-bold text-gray-600 mb-1">{f.label} • <code className="text-primary-500 text-xs">{f.key}</code></label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder={f.hint}
                  value={policyDrafts[f.key] ?? content[f.key] ?? ''}
                  onChange={e => setPolicyDrafts(prev => ({ ...prev, [f.key]: e.target.value }))}
                />
              </div>
            </div>
          ))}
          <button
            onClick={() => {
              ['video.autoplay', 'video.muted', 'video.loop', 'video.heroUrl'].forEach(k => {
                if (policyDrafts[k] !== undefined) setContentValue(k, policyDrafts[k]);
              });
              setPolicyDrafts(prev => {
                const n = { ...prev };
                ['video.autoplay', 'video.muted', 'video.loop', 'video.heroUrl'].forEach(k => delete n[k]);
                return n;
              });
              notify('success', 'تم حفظ إعدادات الفيديو بنجاح.');
            }}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold"
          >حفظ إعدادات الفيديو</button>
        </div>
      </article>

      {/* Raw content editor */}
      {rawContentEditor}
    </div>
  );

  // ── Generic page tab renderer ──
  const renderPageTab = (tabKey: string) => {
    const tabCfg = PAGE_TAB_MAP[tabKey];
    if (!tabCfg) return null;
    return (
      <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-gray-900 text-lg">{tabCfg.title}</h3>
            <p className="text-xs text-gray-400 mt-1">{tabCfg.subtitle}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPolicyDrafts({})} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm">إعادة تحميل</button>
            <button
              onClick={() => {
                tabCfg.fields.forEach(field => setContentValue(field.key, policyDrafts[field.key] ?? content[field.key] ?? ''));
                notify('success', tabCfg.msg);
              }}
              className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold"
            >
              حفظ التعديلات
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {tabCfg.fields.map((field) => {
            const value = policyDrafts[field.key] ?? content[field.key] ?? '';
            return (
              <div key={field.key} className={field.multiline ? 'md:col-span-2' : ''}>
                <label className="block text-xs font-bold text-gray-600 mb-1">{field.label} • <code className="text-primary-500 text-xs">{field.key}</code></label>
                {field.multiline ? (
                  <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-24 text-sm" value={value} onChange={(e) => setPolicyDrafts(prev => ({ ...prev, [field.key]: e.target.value }))} />
                ) : (
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={value} onChange={(e) => setPolicyDrafts(prev => ({ ...prev, [field.key]: e.target.value }))} />
                )}
              </div>
            );
          })}
        </div>
      </article>
    );
  };

  // ── Content Hub navigation (only when activeTab === 'content_hub') ──
  const CONTENT_TABS: { key: TabKey; label: string; icon: string }[] = [
    { key: 'home_offer', label: 'الصفحة الرئيسية', icon: '🏠' },
    { key: 'about_page', label: 'عن المعهد', icon: '📖' },
    { key: 'policies', label: 'الشروط والسياسات', icon: '📋' },
    { key: 'footer_settings', label: 'الفوتر والتواصل', icon: '🔗' },
    { key: 'page_courses', label: 'صفحة الكورسات', icon: '🎓' },
    { key: 'page_bundles', label: 'صفحة المسارات', icon: '📌' },
    { key: 'page_consultations', label: 'صفحة الاستشارات', icon: '💬' },
    { key: 'page_community', label: 'صفحة المجتمع', icon: '👥' },
    { key: 'page_instructors', label: 'صفحة الخبراء', icon: '🧑‍🏫' },
    { key: 'page_contact', label: 'صفحة التواصل', icon: '✉️' },
    { key: 'page_joinus', label: 'صفحة انضم إلينا', icon: '🤝' },
    { key: 'institute_gallery', label: 'معرض الصور', icon: '🖼️' },
    { key: 'hub_advanced', label: 'متقدم', icon: '⚙️' },
  ];

  // ── Determine what to render ──
  const isContentHub = activeTab === 'content_hub';
  const effectiveTab = isContentHub ? contentHubSubTab : activeTab;

  const renderSubContent = () => {
    if (effectiveTab === 'content' || effectiveTab === 'hub_advanced') return hubAdvancedSection;
    if (effectiveTab === 'policies') return policiesSection;
    if (effectiveTab === 'about_page') return aboutPageSection;
    if (effectiveTab === 'home_offer') return homeOfferSection;
    if (effectiveTab === 'footer_settings') return footerSection;
    if (effectiveTab === 'institute_gallery') return gallerySection;
    if (PAGE_TAB_MAP[effectiveTab]) return renderPageTab(effectiveTab);
    return null;
  };

  if (isContentHub) {
    return (
      <div className="space-y-4" dir="rtl">
        {/* Header */}
        <div className="bg-gradient-to-l from-violet-600 to-indigo-600 rounded-2xl p-5 text-white">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Globe size={22} /> صفحات الموقع
          </h2>
          <p className="text-indigo-200 text-sm mt-1">إدارة محتوى جميع صفحات الموقع من مكان واحد</p>
        </div>
        {/* Sub-tab nav */}
        <div className="flex flex-wrap gap-2 bg-gray-100 rounded-xl p-1.5">
          {CONTENT_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setContentHubSubTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                contentHubSubTab === t.key
                  ? 'bg-white shadow-sm text-violet-700 font-bold'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
        {renderSubContent()}
      </div>
    );
  }

  return <>{renderSubContent()}</>;
};

export default ContentHubTab;
